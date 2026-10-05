const prisma = require("../config/db");
const pricingEngine = require("./pricingEngine");
const { getDriverRealDistanceKm, computeRouteDistanceKm } = require("./orderRouteRepricing");
const { haversineKm } = require("../utils/geoDistance");
const { istNow } = require("../utils/istTime");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");
const logger = require("../utils/logger");
const { reconcileRideDiscountToFare } = require("./referralPointsRefund");

// Early Drop: the customer asks to be dropped before the booked destination.
// When the driver taps Complete while still this far from the booked drop, the
// driver's current GPS fix becomes the actual drop point and the fare is
// recomputed for the distance actually travelled.
const EARLY_DROP_MIN_DISTANCE_M = 300;
const MILESTONE = "early_drop";

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function validPoint(lat, lng) {
  const a = Number(lat);
  const b = Number(lng);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= 90 && Math.abs(b) <= 180 && !(a === 0 && b === 0)
    ? { lat: a, lng: b }
    : null;
}

/**
 * The driver's position at completion. The server's own fresh GPS fix (kept
 * current by the driver app's location pings) wins over the coordinates sent
 * with the request, so the actual drop can't be set by just typing numbers.
 */
async function resolveDriverPosition(riderId, reportedLat, reportedLng) {
  const rider = await prisma.tbl_rider.findUnique({
    where: { id: riderId },
    select: { rlats: true, rlongs: true, rloc_updated_at: true },
  });
  const fresh = rider?.rloc_updated_at && Date.now() - new Date(rider.rloc_updated_at).getTime() <= RIDER_LOCATION_FRESHNESS_MS;
  return (fresh ? validPoint(rider.rlats, rider.rlongs) : null) || validPoint(reportedLat, reportedLng);
}

/** Pure: is `point` far enough from the booked drop to count as an early drop? */
function distanceToDropM(order, point) {
  const drop = validPoint(order.dlat, order.dlong);
  if (!drop || !point) return null;
  return haversineKm(point.lat, point.lng, drop.lat, drop.lng) * 1000;
}

function isEarlyDrop(distanceM) {
  return distanceM !== null && distanceM > EARLY_DROP_MIN_DISTANCE_M;
}

// Stops already finished by the driver stay on the billed route; stops not yet
// reached are dropped (the trip ends before them).
async function completedStops(orderId) {
  const [stops, progress] = await Promise.all([
    prisma.pkg_order_stops.findMany({ where: { order_id: orderId }, orderBy: [{ sequence: "asc" }, { id: "asc" }] }),
    prisma.driver_trip_progress.findUnique({ where: { order_id: orderId } }),
  ]);
  const step = Number(progress?.stop_step) || 0;
  return stops.filter((_, index) => step >= (index + 1) * 2);
}

async function reverseGeocode(point) {
  const fallback = `Early drop point (${point.lat.toFixed(5)}, ${point.lng.toFixed(5)})`;
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey || typeof fetch !== "function") return fallback;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${point.lat},${point.lng}&key=${apiKey}`,
      { signal: AbortSignal.timeout(3000) }
    );
    const json = await res.json();
    return json?.results?.[0]?.formatted_address?.slice(0, 500) || fallback;
  } catch (err) {
    logger.warn(`earlyDrop: reverse geocode failed, using coordinates: ${err.message}`);
    return fallback;
  }
}

/**
 * Re-prices `order` for a trip that ends at `point` instead of the booked
 * drop. The fare never goes UP because of an early drop (road-distance
 * rounding can otherwise make a shorter trip cost more).
 */
async function computeEarlyDropFare(order, point) {
  const stops = await completedStops(Number(order.id));
  const newDistanceKm = await computeRouteDistanceKm({
    plat: order.plat, plong: order.plong, stops, dlat: point.lat, dlong: point.lng,
  });
  const radiusKm = await getDriverRealDistanceKm(order.rid, order.plat, order.plong);
  const priced = await pricingEngine.priceForPackageId(
    Number(order.delivery_type) || 1,
    newDistanceKm,
    radiusKm,
    Number(order.extra_mile_charge) || 0,
    Number(order.uid)
  );
  const oldFare = Math.round(Number(order.total_dcharge) > 0 ? Number(order.total_dcharge) : Number(order.d_charge) || 0);
  const repriced = Math.round(priced.fare);
  const keepOld = repriced >= oldFare;
  return {
    oldFare,
    newFare: keepOld ? oldFare : repriced,
    driverEarning: keepOld ? Number(order.driver_earning) : priced.driverEarning,
    commission: keepOld ? Number(order.commission) : priced.commission,
    oldDistance: round2(Number(order.distance) || 0),
    newDistance: round2(newDistanceKm),
  };
}

// A wallet-paid booking was charged up front; hand back the part of it the
// shorter trip no longer needs. Idempotent per order.
//
// Bounded by what the customer actually paid from the wallet: with referral
// points / a coupon the wallet debit was already smaller than the old fare, so
// refunding the whole fare difference would pay the customer more than they
// ever put in. refund = min(fareDiff, walletPaid - what is still payable at the
// new fare after points + coupon). When the debit can't be found (never linked
// to the order) we can't bound it, so the plain fare difference is kept.
async function refundWalletDifference(tx, order, fareDiff, { newFare, pointsAmount = 0 } = {}) {
  if (fareDiff <= 0) return 0;
  const walletPaid = Number(order.p_method_id) === -2 || String(order.trans_id || "").toLowerCase().startsWith("wallet");
  if (!walletPaid) return 0;
  const key = `early_drop_refund:${order.id}`;
  const already = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, type: "credit", wallet_type: "user" } });
  if (already) return 0;

  let refund = fareDiff;
  if (typeof tx.tbl_wallet_history.findMany === "function") {
    const debits = await tx.tbl_wallet_history.findMany({
      where: { order_id: Number(order.id), wallet_type: "user", type: "debit", remark: "Delivery payment" },
    });
    const paid = round2(debits.reduce((sum, r) => sum + Number(r.amount || 0), 0));
    if (paid > 0 && Number.isFinite(Number(newFare))) {
      const stillPayable = Math.max(0, Number(newFare) - Number(pointsAmount || 0) - (Number(order.cou_amt) || 0));
      refund = round2(Math.min(fareDiff, Math.max(0, paid - stillPayable)));
    }
  }
  if (refund <= 0) return 0;
  await tx.tbl_user.update({ where: { id: order.uid }, data: { wallet: { increment: refund } } });
  await tx.tbl_wallet_history.create({
    data: {
      user_id: order.uid,
      amount: refund,
      type: "credit",
      remark: `Early drop refund for order #${order.id} (shorter trip)`,
      wallet_type: "user",
      order_id: order.id,
      payment_id: key,
      created_at: istNow(),
    },
  });
  return refund;
}

/**
 * Makes `point` the order's actual drop and stores the recomputed fare. The
 * booked destination is kept in a driver_trip_event row for audit. Run BEFORE
 * the completion maths so waiting charge, commission and cash-to-collect are
 * all derived from the new fare. Returns the summary shown to both apps.
 */
async function applyEarlyDrop(order, riderId, point, distanceM) {
  const fare = await computeEarlyDropFare(order, point);
  const address = await reverseGeocode(point);
  const fareDiff = fare.oldFare - fare.newFare;

  await prisma.$transaction(async (tx) => {
    await tx.pkg_order.update({
      where: { id: order.id },
      data: {
        dlat: String(point.lat),
        dlong: String(point.lng),
        daddress: address,
        distance: fare.newDistance,
        d_charge: fare.newFare,
        total_dcharge: fare.newFare,
        driver_earning: fare.driverEarning,
        commission: fare.commission,
      },
    });
    // Order #468: 326 points were redeemed at the Rs652 booking fare (50% cap);
    // the fare fell to Rs170 but every point stayed spent. Hand back what the
    // new fare's cap no longer allows.
    const points = await reconcileRideDiscountToFare(order.id, fare.newFare, tx);
    const payload = {
      original_drop: { lat: Number(order.dlat), lng: Number(order.dlong), address: order.daddress || "" },
      actual_drop: { lat: point.lat, lng: point.lng, address },
      distance_from_booked_drop_m: Math.round(distanceM),
      old_fare: fare.oldFare,
      new_fare: fare.newFare,
      old_distance: fare.oldDistance,
      new_distance: fare.newDistance,
      recorded_at: new Date().toISOString(),
    };
    await tx.driver_trip_event.upsert({
      where: { order_id_milestone: { order_id: order.id, milestone: MILESTONE } },
      create: { order_id: order.id, rider_id: riderId, user_id: order.uid, milestone: MILESTONE, payload },
      update: { payload },
    });
    await refundWalletDifference(tx, order, fareDiff, { newFare: fare.newFare, pointsAmount: points.pointsAmount });
  });

  logger.info(`earlyDrop: order #${order.id} dropped ${Math.round(distanceM)} m before the booked drop; fare ₹${fare.oldFare} -> ₹${fare.newFare}`);
  return {
    early_drop: true,
    old_fare: fare.oldFare,
    new_fare: fare.newFare,
    fare_diff: fareDiff,
    old_distance: fare.oldDistance,
    new_distance: fare.newDistance,
    actual_drop_address: address,
  };
}

module.exports = {
  EARLY_DROP_MIN_DISTANCE_M,
  resolveDriverPosition,
  distanceToDropM,
  isEarlyDrop,
  computeEarlyDropFare,
  applyEarlyDrop,
};

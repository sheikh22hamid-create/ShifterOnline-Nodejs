const prisma = require("../config/db");
const logger = require("../utils/logger");
const dispatchManager = require("./dispatchManager");

// Turns an accepted Customise Order offer into a normal, assigned ride (spec 2026-10-26). The customise_order row is
// claimed first with a conditional UPDATE on the server clock, so of any number of simultaneous accepts exactly one
// proceeds. The ride is then created through the existing createOrderCore (negotiated fare, no driver search) and the
// driver is assigned through the existing acceptOrder path, so pricing, advance payment, notifications and every
// later stage are the normal ones. Any failure reopens the order and cancels the ride it just created.
// tripLifecycle and orderController are required lazily: both reach back into services that load this module.
const tripLifecycle = () => require("./tripLifecycle");
const orderController = () => require("../controllers/orderController");

const fail = (msg) => ({ ok: false, msg });

async function logEvent(orderId, type, riderId = null, meta = null) {
  try {
    await prisma.customise_event.create({ data: { order_id: orderId, rider_id: riderId, type, meta } });
  } catch (err) {
    logger.error(`customiseConvert: event ${type} for order ${orderId} not written:`, err);
  }
}

async function reopen(orderId) {
  try {
    await prisma.customise_order.update({ where: { id: orderId }, data: { status: "open" } });
  } catch (err) {
    logger.error(`customiseConvert: order ${orderId} not reopened:`, err);
  }
}

/** Rate-card package for the driver's vehicle in the order's city. tbl_package.city_id is free text ("" or "3,5"). */
function packageForCity(packages, cityId) {
  const matches = (p) => {
    const ids = String(p.city_id || "").split(",").map((v) => v.trim()).filter(Boolean);
    return cityId == null || ids.length === 0 || ids.includes(String(cityId));
  };
  return packages.find(matches) || null;
}

async function cancelCreatedRide(rideId) {
  try {
    await prisma.$executeRaw`UPDATE pkg_order SET o_status = 'Cancelled', order_status = 4, cancel_reason = 'Customise Order could not be assigned', rid = 0 WHERE id = ${rideId}`;
  } catch (err) {
    logger.error(`customiseConvert: ride ${rideId} not cancelled:`, err);
  }
}

async function convert(orderId, offerId, { now = new Date() } = {}) {
  orderId = Number(orderId);
  offerId = Number(offerId);
  let claimed = false;
  let rideId = null;
  try {
    const claim = await prisma.customise_order.updateMany({
      where: { id: orderId, status: "open", bargain_start_at: { lte: now }, expires_at: { gt: now } },
      data: { status: "converting" },
    });
    if (claim.count === 0) {
      const current = await prisma.customise_order.findUnique({ where: { id: orderId } });
      if (current?.pkg_order_id && current.agreed_offer_id === offerId) return { ok: true, pkg_order_id: current.pkg_order_id };
      return fail("This order is no longer available");
    }
    claimed = true;

    const [order, offer] = await Promise.all([
      prisma.customise_order.findUnique({ where: { id: orderId } }),
      prisma.customise_offer.findFirst({ where: { id: offerId, order_id: orderId, status: "active" } }),
    ]);
    if (!offer) throw new Refusal("This offer is no longer available");

    const riderId = offer.rider_id;
    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider || rider.status !== 1) throw new Refusal("This driver is not available");
    if (rider.a_status !== 1) throw new Refusal("This driver is offline");
    const busy = await prisma.pkg_order.count({
      where: { rid: riderId, order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
    });
    if (busy) throw new Refusal("Driver already has an active trip");

    const categories = await prisma.pkg_category.findMany({ where: { cat_status: 1 } });
    const category = categories.find((c) => String(c.cat_name).trim().toLowerCase() === String(rider.vehicle || "").trim().toLowerCase());
    const packages = category ? await prisma.tbl_package.findMany({ where: { cat_id: category.id, status: 1 }, orderBy: { sort_order: "asc" } }) : [];
    const pkg = packageForCity(packages, order.city_id);
    if (!pkg) throw new Refusal("No rate card for this vehicle in your city");

    const stops = await prisma.customise_order_stop.findMany({ where: { order_id: orderId }, orderBy: { seq: "asc" } });
    const amount = Number(offer.amount);
    const created = await orderController().createOrderCore({
      uid: order.uid,
      category: rider.vehicle,
      deliveryTypeIds: [pkg.id],
      bookingType: 1,
      plat: String(order.p_lat), plong: String(order.p_lng), paddress: order.p_address,
      dlat: String(order.d_lat), dlong: String(order.d_lng), daddress: order.d_address,
      stops: stops.map((s) => ({ lat: Number(s.lat), lng: Number(s.lng), address: s.address })),
      description: `${order.goods_desc} (qty ${order.goods_qty})`,
      packageWeight: Number(order.goods_weight_kg),
      pMethodId: Number(order.p_method_id) === -2 ? 1 : Number(order.p_method_id) || 1, // wallet prepay is not part of this flow
      cityId: order.city_id,
      agreedFare: amount,
      skipDispatch: true,
      customiseOrderId: orderId,
    });
    if (!created.ok) throw new Refusal(created.msg || "Could not create the ride");
    rideId = created.order.id;

    const assigned = await prisma.$executeRaw`
      UPDATE pkg_order SET rid = ${riderId}, order_status = 1, o_status = 'Processing', accept_time = NOW()
      WHERE id = ${rideId} AND rid = 0 AND order_status = 0 AND o_status != 'Cancelled'`;
    if (assigned !== 1) throw new Refusal("Could not assign the driver");
    const accepted = await tripLifecycle().acceptOrder(rideId, riderId);
    if (!accepted.success) throw new Refusal(accepted.msg || "Could not assign the driver");

    await prisma.customise_order.update({
      where: { id: orderId },
      data: { status: "converted", agreed_fare: amount, agreed_rider_id: riderId, agreed_offer_id: offerId, pkg_order_id: rideId },
    });
    await prisma.customise_offer.updateMany({ where: { id: offerId }, data: { status: "accepted", decided_at: now } });
    const others = await prisma.customise_offer.findMany({ where: { order_id: orderId, status: "active" } });
    await prisma.customise_offer.updateMany({ where: { order_id: orderId, status: "active" }, data: { status: "void", decided_at: now } });
    await logEvent(orderId, "converted", riderId, { offer_id: offerId, pkg_order_id: rideId, fare: amount });
    notifyConverted({ order, rider, rideId, amount, others }).catch((err) => logger.error(`customiseConvert: notify failed for ${orderId}:`, err));
    return { ok: true, pkg_order_id: rideId };
  } catch (err) {
    if (rideId) await cancelCreatedRide(rideId);
    if (claimed) await reopen(orderId);
    if (err instanceof Refusal) return fail(err.message);
    logger.error(`customiseConvert: order ${orderId} offer ${offerId} failed:`, err);
    return fail("Could not complete the booking, please try again");
  }
}

class Refusal extends Error {}

async function notifyConverted({ order, rider, rideId, amount, others }) {
  dispatchManager.emitCustomerEvent(order.uid, "order:assigned", {
    order_id: rideId, rider_id: rider.id, rider_name: `${rider.first_name || ""} ${rider.last_name || ""}`.trim(),
    rider_phone: rider.fmobile, vehicle_no: rider.vehicle_no, order_status: 1, o_status: "Processing",
    customise_order_id: order.id, // lets the customer app route straight to the advance-payment screen
  });
  dispatchManager.emitCustomerEvent(order.uid, "customise:converted", { order_id: order.id, pkg_order_id: rideId, rider_id: rider.id, fare: amount });
  const ride = await prisma.pkg_order.findUnique({ where: { id: rideId } });
  if (ride) await dispatchManager.emitDirectAssign(rider.id, ride);
  dispatchManager.emitDriverEvent(rider.id, "customise:converted", { order_id: order.id, pkg_order_id: rideId, fare: amount });
  new Set(others.map((o) => o.rider_id)).forEach((id) => {
    if (id !== rider.id) dispatchManager.emitDriverEvent(id, "customise:closed", { order_id: order.id, reason: "taken" });
  });
}

module.exports = { convert };

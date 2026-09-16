const crypto = require("crypto");
const prisma = require("../config/db");
const pricingEngine = require("../services/pricingEngine");
const tripLifecycle = require("../services/tripLifecycle");
const dispatchManager = require("../services/dispatchManager");
const adminSocket = require("../sockets/adminSocket");
const { getRoadDistanceKm, getMultiStopDistanceKm } = require("../utils/geoDistance");
const { getAdvancePaymentTimerInfo } = require("../utils/advancePaymentTimer");
const { verifyRazorpayPayment } = require("../utils/razorpayVerify");
const { sendPushNotification } = require("../config/firebase");
const logger = require("../utils/logger");
const { SEARCH_RADIUS_KM } = require("../config/constants");

function isFiniteNumber(value) {
  return typeof value === "number" ? Number.isFinite(value) : Number.isFinite(Number(value));
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function nextDayScheduleDateIST(now = new Date()) {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const istHour = ist.getUTCHours();
  // If order is placed at or after 10:00 PM IST (22:00), cutoff has passed -> schedule for day after tomorrow
  const daysToAdd = istHour >= 22 ? 2 : 1;
  ist.setUTCDate(ist.getUTCDate() + daysToAdd);
  return ist.toISOString().slice(0, 10);
}

function resolveSearchRadiusKm(radiusRangeRaw, radiusChargeRaw, perKmCharge, fallbackKm) {
  const range = Number(radiusRangeRaw);
  const charge = Number(radiusChargeRaw);
  const rate = Number(perKmCharge);

  const rangeLooksLikeRate =
    Number.isFinite(range) &&
    range > 0 &&
    ((Number.isFinite(rate) && rate > 0 && Math.abs(range - rate) < 0.01) || range > 20);

  if (rangeLooksLikeRate && Number.isFinite(charge) && charge > 0 && charge <= 20) {
    return charge;
  }
  if (Number.isFinite(range) && range > 0 && range <= 20) {
    return range;
  }
  if (Number.isFinite(charge) && charge > 0 && charge <= 20) {
    return charge;
  }

  const parsedFallback = Number(fallbackKm);
  return Number.isFinite(parsedFallback) && parsedFallback > 0 ? parsedFallback : SEARCH_RADIUS_KM;
}

async function getCategories(req, res) {
  try {
    const categories = await prisma.pkg_category.findMany({
      where: { cat_status: 1 },
      orderBy: { sort_order: "asc" },
      select: { id: true, cat_name: true },
    });
    return res.status(200).json({ Result: true, categories });
  } catch (err) {
    logger.error("getCategories failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

async function fareEstimate(req, res) {
  try {
    const { cat_id, plat, plong, dlat, dlong, uid, extra_mile_charge, radius_km, stops } = req.body;

    if (
      !cat_id ||
      ![plat, plong, dlat, dlong].every(isFiniteNumber)
    ) {
      return res.status(400).json({ Result: false, msg: "cat_id and valid plat/plong/dlat/dlong are required" });
    }

    const estimate = await pricingEngine.getFareEstimate({
      cat_id, plat, plong, dlat, dlong, uid,
      // Product decision: this pre-booking quote intentionally scales with
      // the customer's own chosen SEARCH radius, as a disclosed "cost to
      // search this far" preview — NOT a prediction of which driver will
      // actually be dispatched. Real billing never uses this value: order
      // creation, dispatch, and accept each reprice off whichever driver
      // actually gets assigned (their real pickup distance), via
      // orderController.createOrderCore / dispatchManager.runBatchInner /
      // tripLifecycle.acceptOrder — none of which call getFareEstimate — so
      // a wide search radius here can never overcharge the customer if a
      // nearby driver ends up accepting.
      radiusRangeKm: radius_km,
      extraMileCharge: extra_mile_charge,
      stops,
    });
    return res.status(200).json(estimate);
  } catch (err) {
    logger.error("fareEstimate failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

/** Node mirror of the legacy PHP backend's get_distance.php — see pricingEngine.getDistanceEstimate. */
async function distanceEstimate(req, res) {
  try {
    const { pickup_lat, pickup_lng, drop_lat, drop_lng } = req.body;

    if (![pickup_lat, pickup_lng, drop_lat, drop_lng].every(isFiniteNumber)) {
      return res.status(200).json({
        ResponseCode: "401",
        Result: "false",
        ResponseMsg: "pickup_lat, pickup_lng, drop_lat, drop_lng required (numeric)",
      });
    }

    const estimate = await pricingEngine.getDistanceEstimate({
      plat: pickup_lat, plong: pickup_lng, dlat: drop_lat, dlong: drop_lng,
    });
    return res.status(200).json(estimate);
  } catch (err) {
    logger.error("distanceEstimate failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

/** Node mirror of the legacy PHP backend's packagelist.php — see pricingEngine.getPackageListForCategory. */
async function packageListEstimate(req, res) {
  try {
    const { uid, cat_id } = req.body;

    if (!cat_id) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "cat_id required" });
    }

    const estimate = await pricingEngine.getPackageListForCategory({ uid, catId: cat_id });
    return res.status(200).json(estimate);
  } catch (err) {
    logger.error("packageListEstimate failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function createOrderCore({
  uid, category, deliveryTypeIds, bookingType, plat, plong, paddress, pickName, pmobile, pickType,
  dlat, dlong, daddress, dropName, dmobile, dropType, packageWeight, packageCost, description,
  pMethodId, transactionId, extraMileCharge, couId, couAmt, radiusKm, radiusRangeRaw, radiusChargeRaw,
  cityId, photos, distance, totalDcharge, dCharge, scheduleDateTime, schedule_date_time,
  stops = [],
}) {
  if (
    !uid ||
    !category ||
    !Array.isArray(deliveryTypeIds) ||
    deliveryTypeIds.length === 0 ||
    ![plat, plong, dlat, dlong].every(isFiniteNumber)
  ) {
    return { ok: false, code: "VALIDATION", msg: "uid, category, a non-empty delivery_type array, and valid coordinates are required" };
  }

  const requestedPackageIds = deliveryTypeIds.map(Number);

  const normalizedStops = Array.isArray(stops) ? stops : [];
  const validStops = normalizedStops.map((stop) => ({
    lat: Number(stop.lat), lng: Number(stop.lng), address: stop.address, hno: stop.hno,
    landmark: stop.landmark, contact_name: stop.contact_name, contact_number: stop.contact_number,
  }));
  if (validStops.some((stop) => !Number.isFinite(stop.lat) || !Number.isFinite(stop.lng))) {
    return { ok: false, code: "VALIDATION", msg: "Every stop must have valid coordinates" };
  }
  const stopSettings = typeof pricingEngine.getAddStopSettings === "function"
    ? await pricingEngine.getAddStopSettings()
    : { maxExtraStops: 2, extraStopCharge: 0 };
  if (validStops.length > stopSettings.maxExtraStops) {
    return { ok: false, code: "VALIDATION", msg: `A maximum of ${stopSettings.maxExtraStops} extra stops is allowed` };
  }
  const clientDistance = Number(distance);
  const distancePromise = validStops.length > 0
    ? getMultiStopDistanceKm([{ lat: plat, lng: plong }, ...validStops, { lat: dlat, lng: dlong }])
    : (Number.isFinite(clientDistance) && clientDistance > 0)
    ? Promise.resolve({ distanceKm: clientDistance, durationMin: Math.round(clientDistance * 2), source: "client" })
    : getRoadDistanceKm(Number(plat), Number(plong), Number(dlat), Number(dlong));

  const [validPackages, customer, distanceResult, planDiscount, slabPricingConfig] = await Promise.all([
    prisma.tbl_package.findMany({ where: { id: { in: requestedPackageIds }, status: 1 } }),
    cityId ? Promise.resolve(null) : prisma.tbl_user.findUnique({ where: { id: Number(uid) }, select: { city_id: true } }),
    distancePromise,
    pricingEngine.getActivePlanDiscount(uid),
    pricingEngine.getSlabPricingConfig(),
  ]);

  const packagesById = new Map(validPackages.map((p) => [p.id, p]));
  const invalidPackageIds = requestedPackageIds.filter((id) => !packagesById.has(id));

  if (invalidPackageIds.length > 0) {
    return { ok: false, code: "INVALID_PACKAGES", invalidPackageIds };
  }

  // Dispatch tier order must be cheapest-model-first regardless of what
  // order the client's delivery_type array arrived in — a caller sending
  // toggle-state in UI/insertion order (not ascending by tier) previously
  // caused the cascade to offer the priciest model (e.g. Model 5) first.
  // tbl_package.sort_order is the source of truth for tier priority, not
  // package id or client array position.
  const orderedPackageIds = [...requestedPackageIds].sort(
    (a, b) => packagesById.get(a).sort_order - packagesById.get(b).sort_order
  );

  const resolvedCityId = cityId ? Number(cityId) : (customer?.city_id ?? null);

  const firstTierPackageId = orderedPackageIds[0];
  const firstPkg = packagesById.get(firstTierPackageId);
  const { distanceKm } = distanceResult;

  // Needs firstPkg.per_km_charge to detect the legacy app's field-swap
  // quirk, so this must run after the package lookup above — and before
  // pricing, since the fare formula itself now bills the radius (matching
  // pks_order.php: first 1km free, everything beyond billed at the
  // package's per-km rate).
  const resolvedRadiusKm = Math.min(
    Math.max(resolveSearchRadiusKm(radiusRangeRaw, radiusChargeRaw, firstPkg?.per_km_charge, radiusKm), 1),
    100
  );

  const firstVehicleSlabConfig = pricingEngine.findVehicleSlabConfig(
    slabPricingConfig?.slabRates,
    firstPkg?.cat_id || firstPkg?.category || firstPkg?.category_id
  );

  // radiusRangeKm=1 (zero radius charge), not resolvedRadiusKm — no driver
  // is known yet at order-creation time, so there's no real pickup distance
  // to bill. resolvedRadiusKm remains the search-filter radius stored below
  // as radius_range; the actual radius charge is billed per-driver once
  // dispatch/accept knows who's actually being offered/assigned this order
  // (see dispatchManager.runBatchInner and tripLifecycle.acceptOrder).
  const { fare, driverEarning, commission } = (firstVehicleSlabConfig || slabPricingConfig?.modelMultipliers)
    ? pricingEngine.priceForPackage(
        firstPkg,
        distanceKm,
        1,
        (Number(extraMileCharge) || 0) + validStops.length * stopSettings.extraStopCharge,
        planDiscount,
        firstVehicleSlabConfig,
        slabPricingConfig?.modelMultipliers
      )
    : pricingEngine.priceForPackage(
        firstPkg,
        distanceKm,
        1,
        (Number(extraMileCharge) || 0) + validStops.length * stopSettings.extraStopCharge,
        planDiscount
      );

  const clientTotal = Number(totalDcharge);
  const clientBase = Number(dCharge);
  const finalTotalCharge = validStops.length > 0 ? fare : ((Number.isFinite(clientTotal) && clientTotal > 0) ? clientTotal : fare);
  const finalDCharge = validStops.length > 0 ? fare : ((Number.isFinite(clientBase) && clientBase > 0) ? clientBase : fare);

  const parsedWeight = parseFloat(String(packageWeight));
  const finalScheduleDateTime = Number(bookingType) === 3
    ? nextDayScheduleDateIST()
    : ((scheduleDateTime || schedule_date_time) ? String(scheduleDateTime || schedule_date_time) : null);

  if (Number(bookingType) === 3) {
    if (!planDiscount || !planDiscount.noAdvancePayment) {
      return {
        ok: false,
        code: "PREMIUM_PLAN_REQUIRED",
        msg: "Next Day Delivery is exclusively available for Premium Plan members with No Advance Payment benefits.",
      };
    }
  }

  const stopCharge = validStops.length * stopSettings.extraStopCharge;
  const order = await prisma.pkg_order.create({
    data: {
      uid: Number(uid),
      category,
      o_status: "Pending",
      odate: new Date(),
      p_method_id: Number(pMethodId) || 0,
      plat: String(plat),
      plong: String(plong),
      dlat: String(dlat),
      dlong: String(dlong),
      paddress: paddress || null,
      daddress: daddress || null,
      pmobile: pmobile || null,
      dmobile: dmobile || null,
      pick_type: pickType || "",
      drop_type: dropType || "",
      pick_name: pickName || "",
      drop_name: dropName || "",
      description: description || null,
      distance: distanceKm,
      d_charge: finalDCharge,
      total_dcharge: finalTotalCharge,
      commission,
      extra_mile_charge: (Number(extraMileCharge) || 0) + stopCharge,
      time_duration: 0,
      package_weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
      package_cost: Number(packageCost) || 0,
      cou_id: Number(couId) || 0,
      cou_amt: Number(couAmt) || 0,
      radius_range: Math.round(resolvedRadiusKm),
      radius_charge: 0,
      booking_type: Number(bookingType) || 1,
      schedule_date_time: finalScheduleDateTime,
      city_id: resolvedCityId,
      delivery_type: firstTierPackageId,
      allowed_delivery_types: JSON.stringify(orderedPackageIds),
      trans_id: transactionId || null,
      photos: photos || null,
      otp: crypto.randomInt(1000, 10000),
    },
  });

  if (validStops.length > 0) {
    await prisma.pkg_order_stops.createMany({
      data: validStops.map((stop, index) => ({ order_id: order.id, sequence: index + 1, lat: String(stop.lat), lng: String(stop.lng), address: stop.address || null, hno: stop.hno || null, landmark: stop.landmark || null, contact_name: stop.contact_name || null, contact_number: stop.contact_number || null })),
    });
  }
  order.stops = validStops.map((stop, index) => ({ ...stop, sequence: index + 1 }));

  // Next-day orders (booking_type 3) are never auto-dispatched — admin
  // assigns them manually, individually or as a sequenced batch, from the
  // Next Day Orders admin panel. See docs/superpowers/specs/2026-09-10-next-day-booking-design.md §5.
  //
  // Scheduled-for-later-today orders (booking_type 2) are ALSO never
  // dispatched immediately here — ported from the legacy PHP's
  // cron_schedule_order_notify.php, which held these until schedule_date_time
  // actually arrived (dispatching a "6 PM delivery" order to drivers the
  // moment it's placed at 2 PM defeats the point of scheduling it). Node's
  // equivalent is tripLifecycle.dispatchDueScheduledOrders(), a periodic
  // sweep wired into server.js — same pattern as sweepOverduePickups /
  // sweepExpiredAdvancePayments above. (ShifterOnline's "Schedule Booking"
  // button currently sends booking_type=2 with no actual date/time picker
  // behind it yet — schedule_date_time ends up null — so the sweep treats a
  // null schedule time as immediately due, meaning today this only adds a
  // sweep-interval-sized delay vs the old instant dispatch. Once the app
  // grows a real time picker for this button, the wait becomes meaningful.)
  if (Number(bookingType) !== 3 && Number(bookingType) !== 2) {
    dispatchManager.startDispatch(order, {
      fare, driverEarning, commission, packageTitle: firstPkg?.title || null,
      // Handed through so dispatchManager can price each eligible driver's own
      // popup off their real pickup distance without a redundant re-fetch of
      // the package row/discount it already looked up for tier 0 above.
      pkg: firstPkg, discount: planDiscount,
      ...(firstVehicleSlabConfig ? { slabConfig: firstVehicleSlabConfig } : {}),
      ...(slabPricingConfig?.modelMultipliers ? { modelMultipliers: slabPricingConfig.modelMultipliers } : {}),
    }).catch((err) =>
      logger.error(`createOrderCore: dispatch failed to start for order ${order.id}:`, err)
    );
  }

  try {
    adminSocket.notifyNewOrder(order);
  } catch (err) {
    logger.error(`createOrderCore: admin socket notify failed for order ${order.id}:`, err);
  }

  return { ok: true, order };
}

async function createOrder(req, res) {
  try {
    const {
      uid, category, delivery_type, booking_type, plat, plong, paddress, pick_name, pmobile, pick_type,
      dlat, dlong, daddress, drop_name, dmobile, drop_type, package_weight, package_cost, description,
      p_method_id, transaction_id, extra_mile_charge, cou_id, cou_amt, radius_km, city_id, photos,
      schedule_date_time, scheduleDateTime,
      stops,
    } = req.body;

    const result = await createOrderCore({
      uid, category, deliveryTypeIds: delivery_type, bookingType: booking_type, plat, plong, paddress,
      pickName: pick_name, pmobile, pickType: pick_type, dlat, dlong, daddress, dropName: drop_name,
      dmobile, dropType: drop_type, packageWeight: package_weight, packageCost: package_cost, description,
      pMethodId: p_method_id, transactionId: transaction_id, extraMileCharge: extra_mile_charge,
      couId: cou_id, couAmt: cou_amt, radiusKm: radius_km, cityId: city_id, photos: photos || null,
      scheduleDateTime: schedule_date_time || scheduleDateTime || null,
      stops,
    });

    if (!result.ok && result.code === "VALIDATION") {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: result.msg });
    }
    if (!result.ok && result.code === "PREMIUM_PLAN_REQUIRED") {
      return res.status(403).json({ ResponseCode: "403", Result: "false", ResponseMsg: result.msg });
    }
    if (!result.ok && result.code === "INVALID_PACKAGES") {
      return res.status(400).json({
        ResponseCode: "400",
        Result: "false",
        ResponseMsg: `Invalid or inactive package id(s) in delivery_type: ${result.invalidPackageIds.join(", ")}. Call /api/order/fare-estimate first to get valid package_id values for this cat_id.`,
      });
    }

    const { order } = result;
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      order_id: order.id,
      booking_type: order.booking_type,
      ResponseMsg: "Package Order Placed Successfully!!!",
    });
  } catch (err) {
    logger.error("createOrder failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function getOrderDetails(req, res) {
  try {
    const { uid, order_id } = req.body;
    if (!uid || !order_id) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "uid and order_id are required" });
    }

    const order = await prisma.pkg_order.findFirst({ where: { id: Number(order_id), uid: Number(uid) } });
    if (!order) {
      return res.status(404).json({ ResponseCode: "404", Result: "false", ResponseMsg: "Order not found" });
    }

    // This column exists in the production table but is not part of the
    // generated Prisma model yet. Returning it is essential for the mobile
    // app's REST recovery path after an assignment socket event.
    const advanceRows = await prisma.$queryRaw`
      SELECT advance_payment
      FROM pkg_order
      WHERE id = ${Number(order_id)}
      LIMIT 1
    `;
    const advancePayment = advanceRows[0]?.advance_payment;
    const stops = prisma.pkg_order_stops
      ? await prisma.pkg_order_stops.findMany({ where: { order_id: order.id }, orderBy: { sequence: "asc" } })
      : [];

    let rider = null;
    if (order.rid && order.rid !== 0) {
      rider = await prisma.tbl_rider.findUnique({ where: { id: order.rid } });
    }

    // Customer-facing average, not this one order's own cust_rate (that's
    // this order's own not-yet-submitted rating, always 0 at this point).
    let riderStar = null;
    if (rider) {
      const ratingAgg = await prisma.pkg_order.aggregate({
        where: { rid: rider.id, cust_rate: { gt: 0 } },
        _avg: { cust_rate: true },
      });
      riderStar = ratingAgg._avg.cust_rate;
    }

    // The Prisma enum's JS member name (On_Route) differs from the space
    // that every string comparison in the app (TrackingWay's status switch,
    // "Completed"/"Cancelled" checks, etc.) expects.
    const orderStatusMap = { On_Route: "On Route" };
    const orderStatus = orderStatusMap[order.o_status] || order.o_status;

    // pkg_order.photos is a single TEXT column holding either a JSON array
    // or a comma-separated list of relative image paths (legacy PHP wrote
    // it, format not enforced by the schema) — handle both so the app's
    // `Config.imageURLPath + photos[i]` keeps working either way.
    const parsePhotos = (raw) => {
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
      } catch (_) {}
      return String(raw).split(",").map((s) => s.trim()).filter(Boolean);
    };

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      OrderProductList: [
        {
          order_id: order.id,
          rider_id: order.rid,
          rider_name: rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : null,
          rider_mobile: rider ? rider.fmobile : null,
          rider_img: rider ? rider.profile_picture : null,
          rider_star: riderStar == null ? null : Number(riderStar).toFixed(1),
          vehicle_no: rider ? rider.vehicle_no : null,
          rider_lats: rider ? rider.rlats : null,
          rider_longs: rider ? rider.rlongs : null,
          Order_Status: orderStatus,
          Order_flow_id: order.order_status,
          otp: order.otp,
          total_Delivery_charge: String(order.total_dcharge),
          grand_total: String(order.total_dcharge),
          Delivery_charge: String(order.d_charge),
          advance_payment: advancePayment == null ? "0" : String(advancePayment),
          payment_status: (advancePayment == null || advancePayment === "0" || Number(advancePayment) === 0) ? 1 : (order.payment_status ?? 0),
          advance_payment_timer: 120,
          is_rate: order.is_rate,
          distance: order.distance,
          extra_mile_charge: order.extra_mile_charge,
          cou_amt: order.cou_amt,
          package_weight: order.package_weight,
          category: order.category,
          booking_type: order.booking_type,
          schedule_date_time: order.schedule_date_time,
          description: order.description,
          photos: parsePhotos(order.photos),
          order_date: order.odate,
          order_deliver_date: order.ddate,
          pick_type: order.pick_type,
          drop_type: order.drop_type,
          pick_name: order.pick_name,
          drop_name: order.drop_name,
          customer_pname: order.pick_name,
          customer_dname: order.drop_name,
          customer_paddress: order.paddress,
          customer_daddress: order.daddress,
          customer_pmobile: order.pmobile,
          customer_dmobile: order.dmobile,
          plat: order.plat,
          plong: order.plong,
          dlat: order.dlat,
          dlong: order.dlong,
          drop_mobile: order.dmobile,
          stops,
        },
      ],
    });
  } catch (err) {
    logger.error("getOrderDetails failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function customerCancel(req, res) {
  try {
    const { uid, order_id, comment } = req.body;
    if (!uid || !order_id) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "uid and order_id are required" });
    }

    const result = await tripLifecycle.customerCancel(Number(uid), Number(order_id), comment);
    if (!result.success) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: result.msg });
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Order Cancelled Successfully!!!" });
  } catch (err) {
    logger.error("customerCancel failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}


async function driverCancel(req, res) {
  try {
    const { rider_id, order_id, reason } = req.body;
    if (!rider_id || !order_id) {
      return res.status(400).json({ success: false, message: "rider_id and order_id are required" });
    }

    const result = await tripLifecycle.driverCancel(Number(order_id), Number(rider_id), reason);
    return res.status(200).json({
      success: true,
      message: "Ride cancelled and advance refunded where applicable",
      data: {
        order_id: Number(order_id),
        refund_amount: result.refund_amount,
        refund_status: result.refund_status,
      },
    });
  } catch (err) {
    const messages = {
      ORDER_NOT_FOUND: [404, "Order not found"],
      NOT_ASSIGNED_DRIVER: [403, "You are not assigned to this order"],
      ORDER_NOT_CANCELLABLE: [409, "Order can no longer be cancelled"],
    };
    if (messages[err.message]) {
      const [status, message] = messages[err.message];
      return res.status(status).json({ success: false, message });
    }
    logger.error("driverCancel failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function rateOrder(req, res) {
  try {
    const { uid, order_id, rider_id, star, comment } = req.body;
    if (!uid || !order_id || !rider_id || !star) {
      return res.status(400).json({
        ResponseCode: "400",
        Result: "false",
        ResponseMsg: "uid, order_id, rider_id and star are required",
      });
    }

    const result = await tripLifecycle.rateOrder(Number(uid), Number(order_id), Number(rider_id), Number(star), comment);
    if (!result.success) {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: result.msg });
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Rating submitted successfully!" });
  } catch (err) {
    logger.error("rateOrder failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function checkNextDayEligibility(req, res) {
  try {
    const uid = req.body?.uid || req.query?.uid;
    if (!uid) {
      return res.status(400).json({
        ResponseCode: "400",
        Result: "false",
        ResponseMsg: "uid is required",
      });
    }

    const plan = await pricingEngine.getActiveCustomerPlan(Number(uid));
    const isEligible = Boolean(
      plan &&
      (plan.noAdvancePayment === true ||
       plan.noAdvancePayment === 1 ||
       String(plan.noAdvancePayment) === "1" ||
       String(plan.noAdvancePayment) === "true")
    );
    const scheduleDate = nextDayScheduleDateIST();

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: isEligible
        ? "User is eligible for Next Day Delivery"
        : "Next Day Delivery is exclusively available for Premium Plan members with No Advance Payment benefits.",
      is_eligible: isEligible,
      has_active_plan: Boolean(plan),
      plan_name: plan?.planName || null,
      no_advance_payment: Boolean(plan?.noAdvancePayment),
      delivery_date: scheduleDate,
      delivery_window: "Tomorrow between 10:00 AM – 8:00 PM",
      cutoff_time: "10:00 PM",
    });
  } catch (err) {
    logger.error("checkNextDayEligibility failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// Node port of cust_api/payment_status.php - which payment methods (COD /
// wallet / online) are currently enabled, read by confirm_order_map.dart
// before showing payment options on the booking screen. Live endpoint, not
// legacy - same hot path as availableVehicles.
async function paymentMethodStatus(req, res) {
  try {
    const setting = await prisma.setting.findFirst({
      where: { id: 1 },
      select: { payment_cod: true, payment_wallet: true, payment_online: true },
    });
    if (!setting) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Settings Not Found!" });
    }
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Settings Fetched Successfully!!", setting });
  } catch (err) {
    logger.error("paymentMethodStatus failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// Node port of cust_api/map_info.php - the customer's live order-tracking
// screen (rider location/status + advance-payment countdown) for the
// CURRENT pkg_order flow. Confirmed still actively called from
// trackingpoliyline.dart and trackingway.dart - unlike the buy_order-tied
// endpoints in legacyOrderController.js, this one is on the live tracking
// path for every in-progress order today.
const MAP_INFO_STATUS_COPY = {
  Pending: {
    withRider: ["Pending – Assigning a Delivery Partner", "A delivery partner has been assigned and is reviewing your order. This usually takes 1 to 2 minutes."],
    noRider: ["Searching for an available delivery partner", "We are finding an available delivery partner for your order. This may take up to 5 minutes."],
  },
  Processing: ["Processing – Rider is Picking Up Your Order", "Your delivery partner is on the way to the pickup location to collect your order."],
  // "Pickup" isn't in the PHP original - added here for the OTP-wait step
  // tripLifecycle.js introduced after that file was written (driver at
  // pickup location, waiting for the customer's OTP).
  Pickup: ["Arrived at Pickup – Waiting for OTP", "Your delivery partner has arrived at the pickup location and is waiting for your OTP."],
  On_Route: ["On Route – Order is on the Way", "Your order is on its way! The delivery partner is en route to your location."],
  Completed: ["Completed – Order Delivered Successfully", "Your order has been successfully delivered! Thank you for choosing us."],
};

async function getMapInfo(req, res) {
  try {
    const orderId = Number(req.body?.orderid || 0);
    if (!orderId) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went Wrong!" });

    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went Wrong!" });

    // IDOR guard: the shipped app (trackingway.dart / trackingpoliyline.dart)
    // only ever sends { orderid } today, same as the PHP original it was
    // ported from - so uid can't be made mandatory without breaking those
    // screens. Enforce it whenever a caller does send one (new/updated
    // clients), same "trust but verify when given" pattern already used for
    // the other unauthenticated order/rider endpoints (see memory: order
    // dispatch auth gap - deferred deliberately).
    const requestedUid = Number(req.body?.uid || 0);
    if (requestedUid && order.uid !== requestedUid) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went Wrong!" });
    }

    let rider = null;
    if (order.rid) rider = await prisma.tbl_rider.findUnique({ where: { id: order.rid } });

    let orderStep = 0;
    let restMsg = "";
    let riderMsg = "";
    if (order.o_status === "Pending") {
      orderStep = 1;
      const [r, m] = order.rid ? MAP_INFO_STATUS_COPY.Pending.withRider : MAP_INFO_STATUS_COPY.Pending.noRider;
      restMsg = r;
      riderMsg = m;
    } else if (order.o_status === "Cancelled") {
      orderStep = 5;
      restMsg = "Cancelled – Order Could Not Be Delivered. Reason: ";
      riderMsg = order.cancel_reason || order.comment_reject || "Order Cancelled";
    } else {
      const stepByStatus = { Processing: 2, Pickup: 2, On_Route: 3, Completed: 4 };
      orderStep = stepByStatus[order.o_status] || 0;
      const copy = MAP_INFO_STATUS_COPY[order.o_status];
      if (copy) [restMsg, riderMsg] = copy;
    }

    const timerInfo = getAdvancePaymentTimerInfo(await (async () => {
      // advance_payment isn't in this repo's Prisma schema for pkg_order
      // (same gap tripLifecycle.js works around elsewhere) - read via raw
      // query alongside the fields getAdvancePaymentTimerInfo needs.
      const [raw] = await prisma.$queryRaw`SELECT advance_payment FROM pkg_order WHERE id = ${orderId} LIMIT 1`;
      return { ...order, advance_payment: raw?.advance_payment };
    })());

    const durationMinutes = Math.max(10, Math.round(Number(order.distance || 0) * 3));
    const timeDuration = order.time_duration || `${durationMinutes} mins`;

    const info = {
      rider_id: rider?.id || "",
      rider_name: rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "",
      rider_img: rider?.profile_picture || "",
      rider_lats: rider?.rlats ? Number(rider.rlats) : 0.0,
      rider_longs: rider?.rlongs ? Number(rider.rlongs) : 0.0,
      rider_mobile: rider?.fmobile || "",
      order_step: orderStep,
      rest_msg: restMsg,
      rider_msg: riderMsg,
      photos: (order.photos || "").split(","),
      pick_type: order.pick_type,
      drop_type: order.drop_type,
      customer_paddress: order.paddress,
      customer_pmobile: order.pmobile,
      customer_daddress: order.daddress,
      customer_dmobile: order.dmobile,
      cust_address_plat: order.plat,
      cust_address_plong: order.plong,
      cust_address_dlat: order.dlat,
      cust_address_dlong: order.dlong,
      distance: order.distance,
      time_duration: timeDuration,
      estimated_time: timeDuration,
      advance_payment: timerInfo.advance_payment,
      payment_status: timerInfo.payment_status,
      accept_time: timerInfo.accept_time,
      advance_timeout_seconds: timerInfo.advance_timeout_seconds,
      time_passed_seconds: timerInfo.time_passed_seconds,
      remaining_seconds: timerInfo.remaining_seconds,
      is_advance_payment_required: timerInfo.is_advance_payment_required,
      is_advance_required: timerInfo.is_advance_required,
    };

    return res.status(200).json({ Mapinfo: info, ResponseCode: "200", Result: "true", ResponseMsg: "Order Information  Get Successfully!!!" });
  } catch (err) {
    logger.error("getMapInfo failed:", err);
    return res.status(500).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// --- cust_api/advanced_payment.php --- (customer pays the pre-computed
// advance amount online, ahead of the trip). Credits the amount straight
// into the customer's wallet - this looks like a bug (a free top-up) but
// tripLifecycle.applyFinalSettlement deliberately debits the same amount
// back out at order completion (see its own comment on advancePaymentCollected),
// so the net wallet effect across a completed ride is zero. Kept identical
// to the legacy PHP behavior this compensates for - do not "fix" the credit
// here without also updating that debit logic.
async function advancePayment(req, res) {
  const b = req.body || {};
  const orderId = Number(b.order_id || 0);
  const amount = Number(b.amount || 0);
  const remark = b.remark || "Advance Payment";
  const paymentId = b.razorpay_payment_id;
  const razorpayOrderId = b.razorpay_order_id;
  const signature = b.razorpay_signature;

  if (!orderId || amount <= 0 || !paymentId || !razorpayOrderId || !signature) {
    return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: "Missing Parameters" });
  }

  try {
    let verification;
    try {
      verification = await verifyRazorpayPayment({ paymentId, orderId: razorpayOrderId, signature, expectedAmountRupees: amount });
    } catch (e) {
      logger.error("advancePayment: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured - refusing to credit any wallet.", e);
      return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: "Payment verification is not configured. Try again later." });
    }
    if (!verification.ok) {
      return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: verification.reason });
    }

    const order = await prisma.pkg_order.findUnique({ where: { id: orderId } });
    if (!order) return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: "Order Not Found" });
    if (order.o_status === "Cancelled" || Number(order.order_status) === 4) {
      return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: "Order is already cancelled." });
    }
    if (Number(order.payment_status) === 1) {
      return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: "Order Already Paid" });
    }

    const user = await prisma.tbl_user.findUnique({ where: { id: order.uid } });
    if (!user) return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: "User Not Found" });

    // Idempotency backed by the same DB unique constraint addWallet relies
    // on (razorpay_payment_id) - a retried/duplicated client call can't
    // double-credit even under a race.
    try {
      await prisma.tbl_wallet_history.create({
        data: {
          user_id: user.id,
          mobile: String(user.mobile ?? ""),
          amount,
          type: "credit",
          remark,
          payment_id: paymentId,
          razorpay_payment_id: paymentId,
          wallet_type: "user",
          order_id: orderId,
          created_at: new Date(),
        },
      });
    } catch (e) {
      if (e.code === "P2002") return res.status(200).json({ ResponseCode: "401", Result: false, ResponseMsg: "Payment already processed" });
      throw e;
    }

    const updatedUser = await prisma.tbl_user.update({ where: { id: user.id }, data: { wallet: { increment: amount } } });
    await prisma.pkg_order.update({ where: { id: orderId }, data: { payment_status: 1, razorpay_payment_id: paymentId } });

    if (order.rid) {
      const rider = await prisma.tbl_rider.findUnique({ where: { id: order.rid }, select: { fcm_token: true } });
      if (rider?.fcm_token) {
        await sendPushNotification(
          rider.fcm_token,
          "Advance Payment Received",
          `Customer has paid advance payment of ₹${amount} for order #${orderId}`,
          { type: "advance_payment", order_id: String(orderId) }
        );
      }
    }

    return res.status(200).json({
      ResponseCode: "200",
      Result: true,
      ResponseMsg: "Advance Payment Success",
      order_id: orderId,
      payment_status: 1,
      user_wallet_balance: Number(updatedUser.wallet),
    });
  } catch (err) {
    logger.error("advancePayment failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: false, ResponseMsg: "Internal server error" });
  }
}

module.exports = {
  getCategories,
  fareEstimate,
  distanceEstimate,
  packageListEstimate,
  createOrder,
  createOrderCore,
  getOrderDetails,
  customerCancel,
  driverCancel,
  rateOrder,
  checkNextDayEligibility,
  paymentMethodStatus,
  getMapInfo,
  advancePayment,
};

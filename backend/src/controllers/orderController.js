const prisma = require("../config/db");
const pricingEngine = require("../services/pricingEngine");
const tripLifecycle = require("../services/tripLifecycle");
const dispatchManager = require("../services/dispatchManager");
const adminSocket = require("../sockets/adminSocket");
const { getRoadDistanceKm } = require("../utils/geoDistance");
const logger = require("../utils/logger");
const { SEARCH_RADIUS_KM } = require("../config/constants");

function isFiniteNumber(value) {
  return typeof value === "number" ? Number.isFinite(value) : Number.isFinite(Number(value));
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
    const { cat_id, plat, plong, dlat, dlong } = req.body;

    if (
      !cat_id ||
      ![plat, plong, dlat, dlong].every(isFiniteNumber)
    ) {
      return res.status(400).json({ Result: false, msg: "cat_id and valid plat/plong/dlat/dlong are required" });
    }

    const estimate = await pricingEngine.getFareEstimate({ cat_id, plat, plong, dlat, dlong });
    return res.status(200).json(estimate);
  } catch (err) {
    logger.error("fareEstimate failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

async function createOrderCore({
  uid, category, deliveryTypeIds, bookingType, plat, plong, paddress, pickName, pmobile, pickType,
  dlat, dlong, daddress, dropName, dmobile, dropType, packageWeight, packageCost, description,
  pMethodId, transactionId, extraMileCharge, couId, couAmt, radiusKm, cityId, photos, distance,
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

  const clientDistance = Number(distance);
  const distancePromise = (Number.isFinite(clientDistance) && clientDistance > 0)
    ? Promise.resolve({ distanceKm: clientDistance, durationMin: Math.round(clientDistance * 2), source: "client" })
    : getRoadDistanceKm(Number(plat), Number(plong), Number(dlat), Number(dlong));

  const [validPackages, customer, distanceResult] = await Promise.all([
    prisma.tbl_package.findMany({ where: { id: { in: requestedPackageIds }, status: 1 } }),
    cityId ? Promise.resolve(null) : prisma.tbl_user.findUnique({ where: { id: Number(uid) }, select: { city_id: true } }),
    distancePromise,
  ]);

  const packagesById = new Map(validPackages.map((p) => [p.id, p]));
  const invalidPackageIds = requestedPackageIds.filter((id) => !packagesById.has(id));

  if (invalidPackageIds.length > 0) {
    return { ok: false, code: "INVALID_PACKAGES", invalidPackageIds };
  }

  const resolvedCityId = cityId ? Number(cityId) : (customer?.city_id ?? null);

  const parsedRadiusKm = Number(radiusKm);
  const resolvedRadiusKm = Number.isFinite(parsedRadiusKm) ? Math.min(Math.max(parsedRadiusKm, 1), 100) : SEARCH_RADIUS_KM;

  const firstTierPackageId = requestedPackageIds[0];
  const { distanceKm } = distanceResult;
  const { fare, driverEarning, commission } = pricingEngine.priceForPackage(packagesById.get(firstTierPackageId), distanceKm);

  const parsedWeight = parseFloat(String(packageWeight));

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
      d_charge: fare,
      total_dcharge: fare,
      commission,
      extra_mile_charge: Number(extraMileCharge) || 0,
      time_duration: 0,
      package_weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
      package_cost: Number(packageCost) || 0,
      cou_id: Number(couId) || 0,
      cou_amt: Number(couAmt) || 0,
      radius_range: Math.round(resolvedRadiusKm),
      radius_charge: 0,
      booking_type: Number(bookingType) || 1,
      city_id: resolvedCityId,
      delivery_type: firstTierPackageId,
      allowed_delivery_types: JSON.stringify(requestedPackageIds),
      trans_id: transactionId || null,
      photos: photos || null,
      otp: Math.floor(1000 + Math.random() * 9000),
    },
  });

  dispatchManager.startDispatch(order, { fare, driverEarning, commission }).catch((err) =>
    logger.error(`createOrderCore: dispatch failed to start for order ${order.id}:`, err)
  );

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
      p_method_id, transaction_id, extra_mile_charge, cou_id, cou_amt, radius_km, city_id,
    } = req.body;

    const result = await createOrderCore({
      uid, category, deliveryTypeIds: delivery_type, bookingType: booking_type, plat, plong, paddress,
      pickName: pick_name, pmobile, pickType: pick_type, dlat, dlong, daddress, dropName: drop_name,
      dmobile, dropType: drop_type, packageWeight: package_weight, packageCost: package_cost, description,
      pMethodId: p_method_id, transactionId: transaction_id, extraMileCharge: extra_mile_charge,
      couId: cou_id, couAmt: cou_amt, radiusKm: radius_km, cityId: city_id, photos: null,
    });

    if (!result.ok && result.code === "VALIDATION") {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: result.msg });
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

    let rider = null;
    if (order.rid && order.rid !== 0) {
      rider = await prisma.tbl_rider.findUnique({ where: { id: order.rid } });
    }

    const o_status_map = { 0: "Pending", 1: "Processing", 2: "Pickup", 3: "On Route", 5: "Completed", 4: "Cancelled" };

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      OrderProductList: [
        {
          order_id: order.id,
          rider_id: order.rid,
          rider_name: rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : null,
          rider_mobile: rider ? rider.fmobile : null,
          vehicle_no: rider ? rider.vehicle_no : null,
          rider_lats: rider ? rider.rlats : null,
          rider_longs: rider ? rider.rlongs : null,
          Order_Status: order.o_status,
          Order_flow_id: order.order_status,
          otp: order.otp,
          total_Delivery_charge: String(order.total_dcharge),
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

module.exports = { getCategories, fareEstimate, createOrder, createOrderCore, getOrderDetails, customerCancel, rateOrder };

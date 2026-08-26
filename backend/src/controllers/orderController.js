const prisma = require("../config/db");
const pricingEngine = require("../services/pricingEngine");
const tripLifecycle = require("../services/tripLifecycle");
const dispatchManager = require("../services/dispatchManager");
const { getRoadDistanceKm } = require("../utils/geoDistance");
const logger = require("../utils/logger");
const { SEARCH_RADIUS_KM } = require("../config/constants");

function isFiniteNumber(value) {
  return typeof value === "number" ? Number.isFinite(value) : Number.isFinite(Number(value));
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

async function createOrder(req, res) {
  try {
    const {
      uid,
      category,
      delivery_type,
      booking_type,
      plat,
      plong,
      paddress,
      pick_name,
      pmobile,
      pick_type,
      dlat,
      dlong,
      daddress,
      drop_name,
      dmobile,
      drop_type,
      package_weight,
      package_cost,
      description,
      p_method_id,
      transaction_id,
      extra_mile_charge,
      cou_id,
      cou_amt,
    } = req.body;

    if (
      !uid ||
      !category ||
      !Array.isArray(delivery_type) ||
      delivery_type.length === 0 ||
      ![plat, plong, dlat, dlong].every(isFiniteNumber)
    ) {
      return res.status(400).json({
        ResponseCode: "400",
        Result: "false",
        ResponseMsg: "uid, category, a non-empty delivery_type array, and valid coordinates are required",
      });
    }

    const firstTierPackageId = delivery_type[0];
    const { distanceKm } = await getRoadDistanceKm(Number(plat), Number(plong), Number(dlat), Number(dlong));
    const { fare, commission } = await pricingEngine.priceForPackageId(firstTierPackageId, distanceKm);

    // package_weight arrives as a free-text string in the legacy client
    // payload (e.g. "5 Kg") but the live schema types this column as
    // Float — parse out the leading number, drop the unit text.
    const parsedWeight = parseFloat(String(package_weight));

    const order = await prisma.pkg_order.create({
      data: {
        uid: Number(uid),
        category,
        o_status: "Pending",
        odate: new Date(),
        p_method_id: Number(p_method_id) || 0,
        plat: String(plat),
        plong: String(plong),
        dlat: String(dlat),
        dlong: String(dlong),
        paddress: paddress || null,
        daddress: daddress || null,
        pmobile: pmobile || null,
        dmobile: dmobile || null,
        pick_type: pick_type || "",
        drop_type: drop_type || "",
        pick_name: pick_name || "",
        drop_name: drop_name || "",
        description: description || null,
        distance: distanceKm,
        d_charge: fare,
        total_dcharge: fare,
        commission,
        extra_mile_charge: Number(extra_mile_charge) || 0,
        time_duration: 0,
        package_weight: Number.isFinite(parsedWeight) ? parsedWeight : 0,
        package_cost: Number(package_cost) || 0,
        cou_id: Number(cou_id) || 0,
        cou_amt: Number(cou_amt) || 0,
        radius_range: SEARCH_RADIUS_KM,
        radius_charge: 0,
        booking_type: Number(booking_type) || 1,
        delivery_type: Number(firstTierPackageId),
        allowed_delivery_types: JSON.stringify(delivery_type),
        trans_id: transaction_id || null,
      },
    });

    dispatchManager.startDispatch(order).catch((err) =>
      logger.error(`createOrder: dispatch failed to start for order ${order.id}:`, err)
    );

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

module.exports = { fareEstimate, createOrder, getOrderDetails, customerCancel, rateOrder };

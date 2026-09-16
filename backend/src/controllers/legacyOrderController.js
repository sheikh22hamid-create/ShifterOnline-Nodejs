const prisma = require("../config/db");
const logger = require("../utils/logger");
const { uploadBuffer } = require("../utils/cloudinaryStorage");

// Two different things live in this file:
//
// 1. pkgHistory - a Node port of cust_api/pkg_history.php's LIST query,
//    but this isn't actually legacy: pkg_order is the live table the new
//    order flow (orderController.js) writes to, and nothing in
//    orderRoutes.js currently lists a customer's past/active orders (only
//    /details fetches one order by id). This fills that real gap.
//
// 2. buyHistory / buyOrderDetail / buyMapInfo / buyRate / buyCancel - Node
//    ports of the cust_api buy_order_* endpoints. buy_order is the
//    pre-migration order table; nothing creates new rows there since order
//    creation moved to pkg_order (orderController.createOrder), but
//    ShifterOnline's myorder.dart / trackingway.dart still read from it to
//    show/rate/cancel orders placed before the migration. Kept for that
//    historical-data reason, not because the write path is still live.
//
// NOT ported here (superseded, calling them would fight the current flow):
// pkg_rate.php and pks_cancle.php - orderController.js's rateOrder and
// customerCancel (backed by services/tripLifecycle.js) already own rating
// and cancellation for pkg_order, with more current penalty/refund logic
// than the old PHP had. A second endpoint doing the same job on the same
// table would drift from tripLifecycle's bookkeeping.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

const PKG_FLOW_MESSAGES = {
  0: "Waiting for Delivery Partners Decision",
  1: "Heading to Pickup Location",
  2: "Finding Another Delivery Partner",
  3: "Out for Delivery",
  4: "Delivery Canceled",
  5: "Order Delivered Successfully",
};

// --- pkg_history.php --- (list, filtered by active vs past)
async function pkgHistory(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const type = req.body?.type; // "past" | anything else = active
    if (!uid) return fail(res, "Something Went Wrong!");

    const where =
      type === "past"
        ? { uid, OR: [{ o_status: "Completed" }, { o_status: "Cancelled" }] }
        : { uid, NOT: [{ o_status: "Completed" }, { o_status: "Cancelled" }] };

    const rows = await prisma.pkg_order.findMany({ where, orderBy: { id: "desc" } });
    if (!rows.length) return fail(res, "Order  Not Found!!!");

    const list = rows.map((row) => {
      const durationMinutes = Math.max(10, Math.round(Number(row.distance || 0) * 3));
      return {
        id: row.id,
        status: row.o_status,
        order_date: row.odate,
        total: row.d_charge,
        is_rate: row.is_rate,
        pick_address: row.paddress,
        drop_address: row.daddress,
        distance: row.distance,
        time_duration: row.time_duration || `${durationMinutes} mins`,
        estimated_time: row.time_duration || `${durationMinutes} mins`,
        flow_msg: PKG_FLOW_MESSAGES[row.order_status] ?? "",
      };
    });

    return res.status(200).json({ OrderHistory: list, ResponseCode: "200", Result: "true", ResponseMsg: "Order History  Get Successfully!!!" });
  } catch (err) {
    logger.error("legacyOrderController.pkgHistory failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

const BUY_FLOW_MESSAGES = {
  0: "Waiting for Delivery Partners Decision.",
  1: "Heading to Pickup Location",
  2: "Finding Another Delivery Partner",
  3: "Delivery Partner Reached Pickup Location",
  4: "Delivery Canceled",
  5: "Reviewing Item Options",
  6: "Delivery Partner Awaiting Payment Confirmation",
  7: "Payment Completed – Partner Paying the Bill",
  8: "Order Picked Up",
  9: "Out for Delivery",
  10: "Order Delivered Successfully",
};

function buyOrderTotal(row) {
  // buy_order has no complxity_charge/vat_charge columns in this schema
  // (the PHP formula referenced both) - totals computed from the columns
  // that actually exist.
  return Number(row.d_charge) + Number(row.extra_mile_charge) - Number(row.cou_amt);
}

// --- buy_history.php --- (list, filtered by active vs past)
async function buyHistory(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const type = req.body?.type;
    if (!uid) return fail(res, "Something Went Wrong!");

    const where =
      type === "past"
        ? { uid, OR: [{ o_status: "Completed" }, { o_status: "Cancelled" }] }
        : { uid, NOT: [{ o_status: "Completed" }, { o_status: "Cancelled" }] };

    const rows = await prisma.buy_order.findMany({ where, orderBy: { id: "desc" } });
    if (!rows.length) return fail(res, "Order  Not Found!!!");

    const list = rows.map((row) => ({
      id: row.id,
      status: row.o_status,
      order_date: row.order_date,
      total: buyOrderTotal(row),
      order_step: row.flow_id,
      is_rate: row.is_rate,
      pick_address: row.pick_address,
      drop_address: row.drop_address,
      flow_msg: BUY_FLOW_MESSAGES[row.flow_id] ?? "",
    }));

    return res.status(200).json({ BuyOrderHistory: list, ResponseCode: "200", Result: "true", ResponseMsg: "Order History  Get Successfully!!!" });
  } catch (err) {
    logger.error("legacyOrderController.buyHistory failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- buy_order_list.php --- (single order detail, incl. items + rider)
async function buyOrderDetail(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!uid || !orderId) return fail(res, "Something Went Wrong!");

    const row = await prisma.buy_order.findFirst({ where: { uid, id: orderId } });
    if (!row) return res.status(200).json({ BuyOrderProductList: [], ResponseCode: "200", Result: "true", ResponseMsg: "Order Product Get successfully!" });

    let rider = null;
    let riderStar = 5;
    if (row.rid) {
      rider = await prisma.tbl_rider.findUnique({ where: { id: row.rid } });
      const rateAgg = await prisma.buy_order.aggregate({ where: { rid: row.rid, is_rate: 1 }, _avg: { cust_rate: true } });
      if (rateAgg._avg.cust_rate != null) riderStar = Math.round(Number(rateAgg._avg.cust_rate) * 10) / 10;
    }

    const paymentMethod = row.p_method_id ? await prisma.tbl_payment_list.findUnique({ where: { id: Math.trunc(row.p_method_id) } }) : null;
    const items = await prisma.buy_order_item.findMany({ where: { order_id: row.id } });

    const detail = {
      order_id: row.id,
      rider_id: rider?.id || "",
      rider_name: rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "",
      rider_img: rider?.profile_picture || "",
      rider_lats: rider?.rlats ? Number(rider.rlats) : 0.0,
      rider_longs: rider?.rlongs ? Number(rider.rlongs) : 0.0,
      rider_mobile: rider?.fmobile || "",
      rider_star: riderStar,
      order_date: row.order_date,
      pick_name: row.title,
      cou_amt: row.cou_amt,
      drop_name: row.drop_name,
      is_rate: row.is_rate,
      drop_mobile: row.drop_mobile,
      pick_type: row.pick_type,
      drop_type: row.drop_type,
      p_method_name: paymentMethod?.title || "",
      bill_img: row.bill_img,
      store_paddress: row.pick_address,
      customer_daddress: row.drop_address,
      total_Delivery_charge: row.total_dcharge,
      Delivery_charge: row.d_charge,
      extra_mile_charge: row.extra_mile_charge,
      total_item: items.length,
      service_bill: row.item_total,
      service_charge: row.service_charge,
      grand_total: row.total_amt,
      Order_Transaction_id: row.transaction_id,
      Order_Status: row.o_status,
      comment_reject: row.comment_reject,
      Order_flow_id: row.flow_id,
      store_plat: row.pick_lat,
      store_plong: row.pick_long,
      cust_address_dlat: row.drop_lat,
      cust_address_dlong: row.drop_long,
      order_deliver_date: row.delivery_date || "",
      item_list: items.map((it) => ({
        item_id: it.id,
        item_title: it.item_title,
        quantity: it.quantity,
        item_img: (it.item_img || "").split("$;"),
        item_total: it.item_total ?? "",
        is_available: it.is_available,
      })),
    };

    return res.status(200).json({ BuyOrderProductList: [detail], ResponseCode: "200", Result: "true", ResponseMsg: "Order Product Get successfully!" });
  } catch (err) {
    logger.error("legacyOrderController.buyOrderDetail failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- buy_map_info.php --- (tracking-style detail with flow message pairs)
const BUY_FLOW_STEPS = {
  0: ["Waiting for Delivery Partner's Decision", "We've assigned a delivery partner to your order. They are reviewing the request and will confirm within 1 to 2 minutes."],
  1: ["Heading to Pickup Location", "Your delivery partner has accepted the request and is on the way to the pickup location to collect your items."],
  2: ["Finding Another Delivery Partner", "The assigned delivery partner is unable to fulfill your order. We are finding another available delivery partner, which may take up to 5 minutes."],
  3: ["Delivery Partner Has Reached Pickup Location", "The delivery partner has reached the pickup location. They will verify the order details and upload the bill for confirmation."],
  4: ["The delivery partner is unable to proceed with your order. Reason: ", null], // rider_msg = comment_reject
  5: ["Reviewing Item Options", "The store may have alternative options for your selected items. Please review and confirm if you'd like to proceed with the available options."],
  6: ["Delivery Partner Waiting for Payment Before Proceeding", "The delivery partner is waiting for payment confirmation. Please pay the required amount to proceed."],
  7: ["Payment Completed – Order Confirmed", "Your payment has been received. The delivery partner will now proceed with your order."],
  8: ["Items Picked Up from Store", "Your order has been picked up from the store and is now on its way to you."],
  9: ["Out for Delivery", "Your order is on its way! The delivery partner is en route to your location."],
  10: ["Order Delivered Successfully", "Your order has been successfully delivered! Thank you for choosing us."],
  11: ["Order Cancelled Successfully", "Your order has been successfully Cancelled! Thank you for choosing us."],
};

async function buyMapInfo(req, res) {
  try {
    const orderId = Number(req.body?.orderid || 0);
    if (!orderId) return fail(res, "Something Went Wrong!");

    const row = await prisma.buy_order.findUnique({ where: { id: orderId } });
    if (!row) return fail(res, "Something Went Wrong!");

    // IDOR guard: same "trust but verify when given" pattern as
    // buyOrderDetailDriver/orderController.getMapInfo - the shipped app
    // (trackingway.dart's buyMapinfoget) only sends { orderid } today, so
    // uid can't be made mandatory without breaking it. Enforce it whenever a
    // caller does send one.
    const requestedUid = Number(req.body?.uid || 0);
    if (requestedUid && row.uid !== requestedUid) return fail(res, "Something Went Wrong!");

    let rider = null;
    if (row.rid) rider = await prisma.tbl_rider.findUnique({ where: { id: row.rid } });

    const [restMsg, riderMsgTemplate] = BUY_FLOW_STEPS[row.flow_id] || ["", ""];
    const riderMsg = row.flow_id === 4 ? row.comment_reject || "" : riderMsgTemplate || "";

    const items = await prisma.buy_order_item.findMany({ where: { order_id: orderId } });

    const info = {
      rider_id: rider?.id || "",
      rider_name: rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "",
      rider_img: rider?.profile_picture || "",
      rider_lats: rider?.rlats ? Number(rider.rlats) : 0.0,
      rider_longs: rider?.rlongs ? Number(rider.rlongs) : 0.0,
      rider_mobile: rider?.fmobile || "",
      order_step: row.flow_id,
      rest_msg: restMsg,
      rider_msg: riderMsg,
      item_list: items.map((it) => ({
        item_id: it.id,
        item_title: it.item_title,
        quantity: it.quantity,
        item_img: (it.item_img || "").split("$;"),
        item_total: it.item_total,
        item_confirm: it.item_confirm,
      })),
      pick_name: row.title,
      drop_name: row.drop_name,
      pick_type: row.pick_type,
      drop_type: row.drop_type,
      store_paddress: row.pick_address,
      total_item: items.length,
      service_bill: row.item_total,
      service_charge: row.service_charge,
      pay_already: row.total_dcharge,
      customer_daddress: row.drop_address,
      store_plat: row.pick_lat,
      store_plong: row.pick_long,
      cust_address_dlat: row.drop_lat,
      cust_address_dlong: row.drop_long,
    };

    return res.status(200).json({ BuyMapinfo: info, ResponseCode: "200", Result: "true", ResponseMsg: "Order Information  Get Successfully!!!" });
  } catch (err) {
    logger.error("legacyOrderController.buyMapInfo failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- buy_rate.php ---
async function buyRate(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const rate = req.body?.rate;
    const orderId = Number(req.body?.order_id || 0);
    const comment = req.body?.comment || "";
    if (!uid || !rate || !orderId) return fail(res, "Something Went wrong  try again !");

    await prisma.buy_order.updateMany({ where: { id: orderId, uid }, data: { cust_rate: Number(rate), cust_comment: comment, is_rate: 1 } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Review Sent Successfully!!" });
  } catch (err) {
    logger.error("legacyOrderController.buyRate failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- buy_cancle.php ---
async function buyCancel(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    const orderId = Number(req.body?.order_id || 0);
    if (!uid || !orderId) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something went wrong, try again!" });

    const existing = await prisma.buy_order.findFirst({ where: { uid, id: orderId } });
    if (!existing) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Order Not Found !!!" });

    await prisma.buy_order.updateMany({ where: { uid, id: orderId }, data: { o_status: "Cancelled", flow_id: 11 } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Order Cancelled Successfully!!!" });
  } catch (err) {
    logger.error("legacyOrderController.buyCancel failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// --- rider_api/buy_history.php --- (driver's own buy_order history, rid-filtered)
async function buyHistoryDriver(req, res) {
  try {
    const rid = Number(req.body?.rid || 0);
    const type = req.body?.type;
    if (!rid) return fail(res, "Something Went Wrong!");

    const where =
      type === "past"
        ? { rid, OR: [{ o_status: "Completed" }, { o_status: "Cancelled" }] }
        : {
            OR: [{ rid: 0 }, { rid }],
            NOT: [{ o_status: "Completed" }, { o_status: "Cancelled" }],
            id: { notIn: (await prisma.reject_rider_list.findMany({ where: { rid, type: "buy" }, select: { order_id: true } })).map((r) => r.order_id) },
          };

    const rows = await prisma.buy_order.findMany({ where, orderBy: { id: "desc" } });
    if (!rows.length) return fail(res, "Order  Not Found!!!");

    const uids = [...new Set(rows.map((r) => r.uid))];
    const users = await prisma.tbl_user.findMany({ where: { id: { in: uids } }, select: { id: true, mobile: true } });
    const mobileByUid = Object.fromEntries(users.map((u) => [u.id, u.mobile]));

    const list = rows.map((row) => formatBuyOrderForDriver(row, mobileByUid[row.uid] ?? null));

    return res.status(200).json({ BuyOrderHistory: list, ResponseCode: "200", Result: "true", ResponseMsg: "Order History  Get Successfully!!!" });
  } catch (err) {
    logger.error("legacyOrderController.buyHistoryDriver failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// Extracted so driverContentController.homeData can build the same shape for
// a single active buy_order without duplicating the field mapping.
function formatBuyOrderForDriver(row, customerMobile) {
  return {
    id: row.id,
    status: row.o_status,
    order_date: row.order_date,
    total: row.total_dcharge,
    pick_name: row.title,
    drop_name: row.drop_name,
    time_duration: row.time_duration,
    order_flow_id: row.flow_id,
    plat: row.pick_lat,
    plong: row.pick_long,
    dlat: row.drop_lat,
    dlong: row.drop_long,
    store_paddress: row.pick_address,
    customer_daddress: row.drop_address,
    customer_dmobile: customerMobile,
    pick_type: row.pick_type,
    drop_type: row.drop_type,
    distance: row.distance,
  };
}

// --- rider_api/buy_order_list.php --- (driver's view of a single buy_order, incl. items)
async function buyOrderDetailDriver(req, res) {
  try {
    const orderId = Number(req.body?.orderid || 0);
    if (!orderId) return fail(res, "Something Went Wrong!");

    const row = await prisma.buy_order.findUnique({ where: { id: orderId } });
    if (!row) return fail(res, "Something Went Wrong!");

    // IDOR guard: same "trust but verify when given" pattern as
    // orderController.getMapInfo - the shipped driver app only sends
    // { orderid } here today (matching the PHP original), so rid can't be
    // made mandatory without breaking it. Enforce it whenever a caller does
    // send one.
    const requestedRid = Number(req.body?.rid || 0);
    if (requestedRid && row.rid !== requestedRid) return fail(res, "Something Went Wrong!");

    const user = await prisma.tbl_user.findUnique({ where: { id: row.uid }, select: { mobile: true } });
    const items = await prisma.buy_order_item.findMany({ where: { order_id: row.id } });

    const detail = {
      id: row.id,
      order_user_id: row.uid,
      status: row.o_status,
      order_date: row.order_date,
      total: row.d_charge,
      pick_name: row.title,
      drop_name: row.drop_name,
      time_duration: row.time_duration,
      order_flow_id: row.flow_id,
      plat: row.pick_lat,
      plong: row.pick_long,
      dlat: row.drop_lat,
      dlong: row.drop_long,
      store_paddress: row.pick_address,
      pay_total: row.item_total,
      customer_daddress: row.drop_address,
      customer_dmobile: user?.mobile ?? null,
      pick_type: row.pick_type,
      drop_type: row.drop_type,
      distance: row.distance,
      item_list: items.map((it) => ({
        item_id: it.id,
        item_title: it.item_title,
        quantity: it.quantity,
        item_img: (it.item_img || "").split(","),
        item_total: it.item_total,
        item_confirm: it.item_confirm,
      })),
    };

    return res.status(200).json({ BuyOrderDetails: detail, ResponseCode: "200", Result: "true", ResponseMsg: "Order History  Get Successfully!!!" });
  } catch (err) {
    logger.error("legacyOrderController.buyOrderDetailDriver failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- rider_api/bill_upload.php --- (driver uploads pickup bill photos for a buy_order)
const multer = require("multer");
const billUploadMiddleware = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).any();

function billUpload(req, res) {
  billUploadMiddleware(req, res, async (err) => {
    if (err) {
      logger.error("legacyOrderController.billUpload upload failed:", err);
      return fail(res, err.message || "Upload failed", 400);
    }
    try {
      const b = req.body || {};
      const riderId = Number(b.rider_id || 0);
      const orderId = Number(b.order_id || 0);
      if (!riderId || !orderId) return fail(res, "Something Went Wrong!");

      const files = (req.files || []).filter((f) => /^image\d+$/.test(f.fieldname));
      const paths = await Promise.all(
        files.map((file) => {
          const filename = `${Date.now()}${Math.floor(Math.random() * 1e6)}.jpg`;
          return uploadBuffer(file.buffer, `images/bill_list/${filename}`);
        })
      );

      const result = await prisma.buy_order.updateMany({
        where: { rid: riderId, id: orderId },
        data: { bill_img: paths.join("$;"), flow_id: 8 },
      });
      if (result.count === 0) return fail(res, "Order not found!");

      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Item Upload Successfully!!!" });
    } catch (e) {
      logger.error("legacyOrderController.billUpload failed:", e);
      return fail(res, "Internal server error", 500);
    }
  });
}

// --- pay_bill.php --- (buy_order bill-payment confirmation - still called from trackingway.dart/optiontraking.dart)
// Skips the PHP version's OneSignal push (a third push provider alongside
// Firebase, which is what the rest of Node already uses for driver/customer
// notifications) - not worth adding a second push stack for a
// pre-migration-only flow. The DB update it actually gates on is kept.
async function payBill(req, res) {
  try {
    const b = req.body || {};
    const uid = Number(b.uid || 0);
    const orderId = Number(b.order_id || 0);
    const pMethodId = b.p_method_id;
    const transId = b.trans_id;
    const amt = b.amt;
    if (!uid || !orderId || !pMethodId || !transId || !amt) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went wrong  try again !" });
    }

    const result = await prisma.buy_order.updateMany({
      where: { id: orderId, uid },
      data: { flow_id: 7, service_payment_id: Number(pMethodId), service_transaction_id: String(transId) },
    });
    if (result.count === 0) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Order not found!" });
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Invoice Paid Successfully!!" });
  } catch (err) {
    logger.error("legacyOrderController.payBill failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// --- buy_order.php --- (customer places a "Buy Anything" order). Skips the
// PHP version's OneSignal broadcast-to-all-riders push and its
// notify-all-riders-of-new-order call - same "not worth a second push
// stack" reasoning as payBill above. rid stays 0 (unassigned) exactly as
// the legacy version left it; nothing in this codebase currently assigns a
// rider to a buy_order (see memory on the Buy Anything accept-step gap).
async function buyOrderCreate(req, res) {
  try {
    const b = req.body || {};
    const uid = Number(b.uid || 0);
    const title = b.title;
    const pickAddress = b.pick_address;
    const pickLat = b.pick_lat;
    const pickLong = b.pick_long;
    const dropAddress = b.drop_address;
    const dropLat = b.drop_lat;
    const dropLong = b.drop_long;
    const dCharge = b.d_charge;
    const pMethodId = b.p_method_id;
    const transactionId = b.transaction_id;
    if (
      !uid || !title || !pickAddress || !pickLat || !pickLong || !dropAddress || !dropLat || !dropLong ||
      dCharge === undefined || dCharge === "" || pMethodId === undefined || pMethodId === "" || !transactionId
    ) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went Wrong!" });
    }

    const setting = await prisma.setting.findFirst({ select: { rider_commission: true } });
    const productData = Array.isArray(b.ProductData) ? b.ProductData : [];

    const created = await prisma.buy_order.create({
      data: {
        uid,
        title,
        pick_type: b.pick_type || "",
        drop_type: b.drop_type || "",
        pick_address: pickAddress,
        pick_lat: pickLat,
        pick_long: pickLong,
        drop_address: dropAddress,
        drop_lat: dropLat,
        drop_long: dropLong,
        drop_name: b.drop_name || "",
        drop_mobile: b.drop_mobile || "",
        d_charge: dCharge,
        total_dcharge: b.total_dcharge ?? dCharge,
        p_method_id: Number(pMethodId),
        transaction_id: String(transactionId),
        cou_id: Number(b.cou_id || 0),
        cou_amt: Number(b.cou_amt || 0),
        extra_mile_charge: Number(b.extra_mile_charge || 0),
        distance: Number(b.distance || 0),
        time_duration: Number(b.time_duration || 0),
        commission: Number(setting?.rider_commission ?? 0),
        order_date: new Date(),
        rid: 0,
      },
    });

    if (productData.length) {
      await prisma.buy_order_item.createMany({
        data: productData.map((p) => ({
          order_id: created.id,
          item_title: String(p.item_title || ""),
          quantity: Number(p.quantity || 0),
        })),
      });
    }

    const user = await prisma.tbl_user.findUnique({ where: { id: uid }, select: { name: true } });
    const description = `${user?.name || ""}, Your Buy Anything Order #${created.id} Has Been Received.`;
    await prisma.tbl_notification.create({
      data: { uid, datetime: new Date(), title: "Buy Anything Order Received!!", description },
    });

    return res.status(200).json({ order_id: created.id, ResponseCode: "200", Result: "true", ResponseMsg: "Buy Anything Order Placed Successfully!!!" });
  } catch (err) {
    logger.error("legacyOrderController.buyOrderCreate failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// --- confirm_item.php --- (customer confirms a store-substituted item).
// Skips the PHP version's "all items confirmed" push to the driver - same
// reasoning as buyOrderCreate/payBill above.
async function confirmItem(req, res) {
  try {
    const b = req.body || {};
    const uid = Number(b.uid || 0);
    const itemId = Number(b.itmeid || 0);
    const orderId = Number(b.order_id || 0);
    if (!uid || !itemId || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went wrong  try again !" });
    }

    // IDOR guard: same "trust but verify when given" pattern as
    // buyOrderDetail/getMapInfo elsewhere in this file - uid IS sent here
    // (unlike itemRemove/buyOrderCreate, which have no owner to check
    // against or no session to check it with), so cheaply confirm this
    // order actually belongs to the caller before mutating its items.
    const order = await prisma.buy_order.findUnique({ where: { id: orderId }, select: { uid: true } });
    if (!order || order.uid !== uid) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something Went wrong  try again !" });
    }

    await prisma.buy_order_item.updateMany({ where: { id: itemId, order_id: orderId }, data: { item_confirm: 1 } });

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Item Confirm Successfully!!" });
  } catch (err) {
    logger.error("legacyOrderController.confirmItem failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

// --- item_remove.php --- (customer removes an unavailable item; cancels
// the order outright once no items remain, same as the legacy PHP).
async function itemRemove(req, res) {
  try {
    const b = req.body || {};
    const itemId = Number(b.itmeid || 0);
    const orderId = Number(b.order_id || 0);
    if (!itemId || !orderId) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Something went wrong, try again!" });
    }

    const deleted = await prisma.buy_order_item.deleteMany({ where: { id: itemId, order_id: orderId } });
    const remaining = await prisma.buy_order_item.count({ where: { order_id: orderId } });

    if (remaining === 0) {
      await prisma.buy_order.updateMany({ where: { id: orderId }, data: { o_status: "Cancelled" } });
      const msg = deleted.count > 0
        ? "Item removed successfully, and order cancelled as no items remain."
        : "Item not found, but order has been cancelled as it has no items.";
      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: msg });
    }

    if (deleted.count === 0) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Item not found!" });
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Item removed successfully." });
  } catch (err) {
    logger.error("legacyOrderController.itemRemove failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = {
  pkgHistory,
  buyHistory,
  buyOrderDetail,
  buyMapInfo,
  buyRate,
  buyCancel,
  payBill,
  buyHistoryDriver,
  buyOrderDetailDriver,
  billUpload,
  formatBuyOrderForDriver,
  buyOrderCreate,
  confirmItem,
  itemRemove,
};

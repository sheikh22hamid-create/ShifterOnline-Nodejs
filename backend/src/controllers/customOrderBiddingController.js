const prisma = require("../config/db");
const logger = require("../utils/logger");

// Node port of cust_api/custom_order_create.php, custom_order_bid.php,
// custom_order_bid_list.php, custom_order_list_driver.php. This is the
// customer/driver-facing half of custom-order bidding; the admin-facing
// half (list all, view bids as admin, convert a winning bid into a real
// order) already exists in customOrderController.js / adminRoutes.js.

function fail(res, msg) {
  return res.status(200).json({ Result: false, msg });
}

// --- custom_order_create.php --- (customer posts a custom order for drivers to bid on)
async function createCustomOrder(req, res) {
  try {
    const b = req.body || {};
    const userId = Number(b.user_id || 0);
    const pickup = b.pickup;
    const drop = b.drop;
    const description = b.description || "";
    const price = Number(b.price || 0);
    const category = b.category;
    if (!userId || !pickup || !drop || !category) return fail(res, "Missing data");

    const created = await prisma.tbl_custom_order.create({
      data: {
        user_id: userId,
        pickup_address: pickup,
        drop_address: drop,
        description,
        base_price: price,
        category,
        status: "open",
        created_at: new Date(),
      },
    });

    return res.status(200).json({ Result: true, msg: "Custom order created", order_id: created.id });
  } catch (err) {
    logger.error("customOrderBiddingController.createCustomOrder failed:", err);
    return fail(res, "Internal server error");
  }
}

// --- custom_order_bid.php --- (driver places a bid, one per order)
async function placeBid(req, res) {
  try {
    const b = req.body || {};
    const orderId = Number(b.order_id || 0);
    const riderId = Number(b.rider_id || 0);
    const amount = Number(b.amount || 0);
    if (!orderId || !riderId || !amount) return fail(res, "Missing data");

    const order = await prisma.tbl_custom_order.findUnique({ where: { id: orderId } });
    if (!order || order.status !== "open") return fail(res, "This order is no longer accepting bids");

    const existing = await prisma.tbl_custom_order_bid.findFirst({ where: { order_id: orderId, rider_id: riderId } });
    if (existing) return fail(res, "Already bid");

    await prisma.tbl_custom_order_bid.create({
      data: { order_id: orderId, rider_id: riderId, bid_amount: amount, status: "pending", created_at: new Date() },
    });

    return res.status(200).json({ Result: true, msg: "Bid placed" });
  } catch (err) {
    logger.error("customOrderBiddingController.placeBid failed:", err);
    return fail(res, "Internal server error");
  }
}

// --- custom_order_bid_list.php --- (customer views bids on their order, cheapest first)
async function listBids(req, res) {
  try {
    const orderId = Number(req.body?.order_id || 0);
    if (!orderId) return fail(res, "order_id is required");

    // IDOR guard: same "trust but verify when given" pattern used elsewhere
    // in this migration - enforce ownership whenever the caller sends a
    // user_id (the freshly-migrated ShifterOnline call now does), without
    // breaking any caller that doesn't yet.
    const requestedUserId = Number(req.body?.user_id || 0);
    if (requestedUserId) {
      const order = await prisma.tbl_custom_order.findUnique({ where: { id: orderId }, select: { user_id: true } });
      if (!order || order.user_id !== requestedUserId) return fail(res, "order_id is required");
    }

    const bids = await prisma.tbl_custom_order_bid.findMany({
      where: { order_id: orderId },
      orderBy: { bid_amount: "asc" },
    });
    const riderIds = [...new Set(bids.map((b) => b.rider_id).filter(Boolean))];
    const riders = await prisma.tbl_rider.findMany({
      where: { id: { in: riderIds } },
      select: { id: true, first_name: true, vehicle: true },
    });
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const result = bids.map((b) => ({
      ...b,
      first_name: riderById[b.rider_id]?.first_name || null,
      vehicle: riderById[b.rider_id]?.vehicle || null,
    }));

    return res.status(200).json({ Result: true, bids: result });
  } catch (err) {
    logger.error("customOrderBiddingController.listBids failed:", err);
    return fail(res, "Internal server error");
  }
}

// --- custom_order_list_driver.php --- (driver browses open custom orders in their category to bid on)
async function listOpenOrdersForDriver(req, res) {
  try {
    const category = req.body?.category;
    if (!category) return fail(res, "category is required");

    const orders = await prisma.tbl_custom_order.findMany({
      where: { status: "open", category },
      orderBy: { id: "desc" },
    });

    return res.status(200).json({ Result: true, orders });
  } catch (err) {
    logger.error("customOrderBiddingController.listOpenOrdersForDriver failed:", err);
    return fail(res, "Internal server error");
  }
}

// --- custom_order_convert.php --- (customer accepts a specific driver's bid).
// The legacy PHP inserted a pkg_order row straight from tbl_custom_order at
// this point, using placeholder pick/drop_type values and no real lat/lng -
// tbl_custom_order only stores free-text addresses, while pkg_order requires
// real coordinates NOT NULL. customOrderController.convert (the admin-facing
// equivalent, already on Node) deliberately does NOT create that pkg_order
// row for the same reason - it only marks the quotation accepted, since full
// trip creation needs a geocoding step this codebase doesn't have. This
// customer-facing version does the same: accept the winning bid, reject the
// rest, no fake trip.
async function convertOrder(req, res) {
  try {
    const b = req.body || {};
    const orderId = Number(b.order_id || 0);
    const riderId = Number(b.rider_id || 0);
    if (!orderId || !riderId) return fail(res, "order_id and rider_id are required");

    const order = await prisma.tbl_custom_order.findUnique({ where: { id: orderId } });
    if (!order) return fail(res, "Order not found");
    if (order.status !== "open") return fail(res, "Order not accepted yet");

    const bids = await prisma.tbl_custom_order_bid.findMany({ where: { order_id: orderId } });
    const winningBid = bids.find((bid) => bid.rider_id === riderId);
    if (!winningBid) return fail(res, "No driver selected");

    const [updatedOrder] = await prisma.$transaction([
      prisma.tbl_custom_order.update({ where: { id: orderId }, data: { status: "accepted", base_price: winningBid.bid_amount } }),
      prisma.tbl_custom_order_bid.update({ where: { id: winningBid.id }, data: { status: "accepted" } }),
      ...bids.filter((bid) => bid.id !== winningBid.id).map((bid) => prisma.tbl_custom_order_bid.update({ where: { id: bid.id }, data: { status: "rejected" } })),
    ]);

    return res.status(200).json({ Result: true, msg: "Converted to normal order", new_order_id: updatedOrder.id });
  } catch (err) {
    logger.error("customOrderBiddingController.convertOrder failed:", err);
    return fail(res, "Internal server error");
  }
}

module.exports = { createCustomOrder, placeBid, listBids, listOpenOrdersForDriver, convertOrder };

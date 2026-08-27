const prisma = require("../config/db");
const logger = require("../utils/logger");

// Real enum values differ from the spec doc's open|bidded|converted|cancelled
// — the live schema only has these four (no distinct "bidded" state; bids
// live in a separate table while the order itself stays "open").
const CUSTOM_ORDER_STATUSES = ["open", "accepted", "completed", "cancel"];

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function isScopedOut(req, cityId) {
  return req.user.role !== "superadmin" && cityId !== parseInt(req.user.city_id, 10);
}

async function list(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;
    if (req.query.status) {
      if (!CUSTOM_ORDER_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ success: false, message: `status must be one of ${CUSTOM_ORDER_STATUSES.join(", ")}` });
      }
      where.status = req.query.status;
    }

    const rows = await prisma.tbl_custom_order.findMany({ where, orderBy: { id: "desc" } });

    const orderIds = rows.map((o) => o.id);
    const bidCounts = orderIds.length
      ? await prisma.tbl_custom_order_bid.groupBy({ by: ["order_id"], where: { order_id: { in: orderIds } }, _count: { id: true } })
      : [];
    const bidCountByOrder = Object.fromEntries(bidCounts.map((b) => [b.order_id, b._count.id]));

    const data = rows.map((o) => ({ ...o, bid_count: bidCountByOrder[o.id] || 0 }));
    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "customOrders.list");
  }
}

async function getBids(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const order = await prisma.tbl_custom_order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Custom order not found" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }

    const bids = await prisma.tbl_custom_order_bid.findMany({ where: { order_id: id }, orderBy: { bid_amount: "asc" } });
    const riderIds = [...new Set(bids.map((b) => b.rider_id).filter(Boolean))];
    const riders = await prisma.tbl_rider.findMany({ where: { id: { in: riderIds } }, select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true } });
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const data = bids.map((b) => {
      const r = riderById[b.rider_id];
      return {
        id: b.id,
        rider_id: b.rider_id,
        rider_name: r ? r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() : null,
        rider_mobile: r ? r.fmobile : null,
        bid_amount: b.bid_amount,
        status: b.status,
        created_at: b.created_at,
      };
    });

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "customOrders.getBids");
  }
}

async function convert(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { rider_id, final_agreed_price } = req.body;
    if (!rider_id || final_agreed_price === undefined) {
      return res.status(400).json({ success: false, message: "rider_id and final_agreed_price are required" });
    }

    const order = await prisma.tbl_custom_order.findUnique({ where: { id } });
    if (!order) {
      return res.status(404).json({ success: false, message: "Custom order not found" });
    }
    if (isScopedOut(req, order.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
    }
    if (order.status !== "open") {
      return res.status(409).json({ success: false, message: `Cannot convert an order that is already ${order.status}` });
    }

    const riderId = parseInt(rider_id, 10);
    const bids = await prisma.tbl_custom_order_bid.findMany({ where: { order_id: id } });
    const winningBid = bids.find((b) => b.rider_id === riderId);

    // tbl_custom_order has no lat/lng columns (only free-text addresses),
    // while pkg_order requires them NOT NULL — there is no safe way to
    // fabricate real trip coordinates here, so this marks the quotation
    // accepted rather than creating a pkg_order row. Full trip creation
    // needs a geocoding step this codebase doesn't have.
    const [updatedOrder] = await prisma.$transaction([
      prisma.tbl_custom_order.update({ where: { id }, data: { status: "accepted", base_price: final_agreed_price } }),
      ...(winningBid ? [prisma.tbl_custom_order_bid.update({ where: { id: winningBid.id }, data: { status: "accepted" } })] : []),
      ...bids.filter((b) => b.rider_id !== riderId).map((b) => prisma.tbl_custom_order_bid.update({ where: { id: b.id }, data: { status: "rejected" } })),
    ]);

    return res.status(200).json({
      success: true,
      message: "Custom order accepted for this driver at the agreed price. Full trip creation still requires pickup/drop coordinates from the customer app.",
      data: updatedOrder,
    });
  } catch (err) {
    return internalError(res, err, "customOrders.convert");
  }
}

module.exports = { list, getBids, convert };

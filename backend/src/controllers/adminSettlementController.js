const prisma = require("../config/db");
const logger = require("../utils/logger");
const settlementService = require("../services/settlementService");

const { SettlementError } = settlementService;

const RESOLVED = ["cash_received", "paid_online", "waived", "customer_owes"];
const FILTERS = {
  pending: () => ({ status: "pending" }),
  unsettled: () => ({ status: "pending", escalated_at: { not: null } }),
  disputed: () => ({ status: "disputed" }),
  resolved: () => ({ status: { in: RESOLVED } }),
  all: () => ({}),
};

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

const riderName = (r) => r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;

async function list(req, res) {
  try {
    const where = (FILTERS[req.query.status] || FILTERS.all)();
    if (req.query.rider_id) where.rid = Number(req.query.rider_id);
    if (req.query.user_id) where.uid = Number(req.query.user_id);
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const [rows, total] = await Promise.all([
      prisma.order_settlement.findMany({ where, orderBy: { pending_since: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.order_settlement.count({ where }),
    ]);

    const [users, riders] = await Promise.all([
      prisma.tbl_user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.uid))] } } }),
      prisma.tbl_rider.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.rid))] } } }),
    ]);
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const now = Date.now();
    const data = rows.map((s) => ({
      id: s.id,
      order_id: s.order_id,
      status: s.status,
      amount_due: Number(s.amount_due),
      fare: Number(s.fare),
      method: s.method,
      customer_name: userById[s.uid]?.name || null,
      customer_mobile: userById[s.uid] ? String(userById[s.uid].mobile) : null,
      rider_name: riderById[s.rid] ? riderName(riderById[s.rid]) : null,
      rider_mobile: riderById[s.rid]?.fmobile || null,
      pending_since: s.pending_since,
      minutes_pending: Math.floor((now - new Date(s.pending_since).getTime()) / 60000),
      escalated: !!s.escalated_at,
      dispute_reason: s.dispute_reason,
      dispute_raised_by: s.dispute_raised_by,
    }));
    return res.status(200).json({ success: true, data, pagination: { page, limit, total } });
  } catch (err) {
    return internalError(res, err, "adminSettlement list");
  }
}

async function detail(req, res) {
  try {
    const id = Number(req.params.id);
    const settlement = await prisma.order_settlement.findUnique({ where: { id } });
    if (!settlement) return res.status(404).json({ success: false, message: "Settlement not found" });
    const [events, order] = await Promise.all([
      prisma.order_settlement_event.findMany({ where: { settlement_id: id }, orderBy: { id: "asc" } }),
      prisma.pkg_order.findUnique({ where: { id: settlement.order_id } }),
    ]);
    return res.status(200).json({
      success: true,
      data: {
        settlement,
        events,
        order: order && {
          id: order.id, paddress: order.paddress, daddress: order.daddress, d_charge: order.d_charge,
          total_dcharge: order.total_dcharge, commission: order.commission, o_status: order.o_status,
        },
      },
    });
  } catch (err) {
    return internalError(res, err, "adminSettlement detail");
  }
}

async function resolve(req, res) {
  try {
    const { settlement } = await settlementService.adminResolve({
      settlementId: Number(req.params.id),
      adminId: req.user?.id,
      outcome: req.body?.outcome,
      note: req.body?.note,
    });
    return res.status(200).json({ success: true, data: { settlement } });
  } catch (err) {
    if (err instanceof SettlementError) {
      return res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ success: false, code: err.code, message: err.message });
    }
    return internalError(res, err, "adminSettlement resolve");
  }
}

module.exports = { list, detail, resolve };

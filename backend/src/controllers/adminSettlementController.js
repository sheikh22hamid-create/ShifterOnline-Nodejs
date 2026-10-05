const prisma = require("../config/db");
const logger = require("../utils/logger");
const settlementService = require("../services/settlementService");
const receiverSettlementService = require("../services/receiverSettlementService");

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

const NOT_FOUND_BODY = { success: false, message: "Settlement not found" };
const invalidId = (res) => res.status(400).json({ success: false, code: "INVALID_ID", message: "Invalid id" });

// Strict positive integer: a number or numeric string whose Number() is an integer > 0.
function parseId(v) {
  if (typeof v === "string" && !/^\d+$/.test(v.trim())) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// City scope: a city-bound admin (req.scopedCityId set by scopeFilter) only sees settlements of
// their own city. Settlements with a null city_id are therefore visible only to superadmin.
const outOfScope = (req, settlement) => req.scopedCityId != null && settlement.city_id !== req.scopedCityId;

const riderName = (r) => r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;

async function list(req, res) {
  try {
    const status = req.query.status;
    let key = "all";
    if (status !== undefined && status !== null && status !== "") {
      if (typeof status !== "string" || !Object.hasOwn(FILTERS, status)) {
        return res.status(400).json({ success: false, code: "INVALID_STATUS", message: "Unknown status filter" });
      }
      key = status;
    }
    const where = FILTERS[key]();
    if (req.query.rider_id) {
      const rid = parseId(req.query.rider_id);
      if (!rid) return invalidId(res);
      where.rid = rid;
    }
    if (req.query.user_id) {
      const uid = parseId(req.query.user_id);
      if (!uid) return invalidId(res);
      where.uid = uid;
    }
    if (req.scopedCityId != null) where.city_id = req.scopedCityId;
    const page = Math.min(100000, Math.max(1, parseInt(req.query.page, 10) || 1));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));

    const [rows, total] = await Promise.all([
      prisma.order_settlement.findMany({ where, orderBy: { pending_since: "desc" }, skip: (page - 1) * limit, take: limit }),
      prisma.order_settlement.count({ where }),
    ]);

    const [users, riders] = rows.length === 0 ? [[], []] : await Promise.all([
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
      payer: s.payer || "customer",
      receiver_markup: Number(s.receiver_markup || 0),
      advance_held: Number(s.advance_held || 0),
      reversal_shortfall: Number(s.reversal_shortfall || 0),
    }));
    return res.status(200).json({ success: true, data, pagination: { page, limit, total } });
  } catch (err) {
    return internalError(res, err, "adminSettlement list");
  }
}

// Receiver-pays details for the drawer. Never selects token_hash / razorpay ids, and a missing
// table or model (dev/prod schema drift) must not break the drawer, so every failure yields null.
const RECEIVER_PAY_SELECT = {
  receiver_phone: true, receiver_name: true, commission_percent: true, status: true, declined_by: true,
  declined_at: true, link_sent_at: true, link_send_count: true, token_expires_at: true,
};

async function loadReceiverRow(orderId) {
  try {
    return await prisma.order_receiver_pay.findUnique({ where: { order_id: orderId }, select: RECEIVER_PAY_SELECT });
  } catch {
    return null;
  }
}

async function detail(req, res) {
  try {
    const id = parseId(req.params.id);
    if (!id) return invalidId(res);
    const settlement = await prisma.order_settlement.findUnique({ where: { id } });
    if (!settlement || outOfScope(req, settlement)) return res.status(404).json(NOT_FOUND_BODY);
    const [events, order, receiverRow] = await Promise.all([
      prisma.order_settlement_event.findMany({ where: { settlement_id: id }, orderBy: { id: "asc" } }),
      prisma.pkg_order.findUnique({ where: { id: settlement.order_id } }),
      loadReceiverRow(settlement.order_id),
    ]);
    // Whitelist the fields (in addition to the query's select) so a secret can never leak by accident.
    const receiver_pay = receiverRow
      ? {
          receiver_phone: receiverRow.receiver_phone,
          receiver_name: receiverRow.receiver_name,
          commission_percent: Number(receiverRow.commission_percent),
          status: receiverRow.status,
          declined_by: receiverRow.declined_by,
          declined_at: receiverRow.declined_at,
          link_sent_at: receiverRow.link_sent_at,
          link_send_count: receiverRow.link_send_count,
          token_expires_at: receiverRow.token_expires_at,
        }
      : null;
    return res.status(200).json({
      success: true,
      data: {
        settlement,
        events,
        receiver_pay,
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
    const id = parseId(req.params.id);
    if (!id) return invalidId(res);
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const existing = await prisma.order_settlement.findUnique({ where: { id }, select: { id: true, city_id: true } });
    if (!existing || outOfScope(req, existing)) return res.status(404).json(NOT_FOUND_BODY);
    const { settlement } = await settlementService.adminResolve({
      settlementId: id,
      adminId: req.user.id,
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

async function convertToCustomer(req, res) {
  try {
    const id = parseId(req.params.id);
    if (!id) return invalidId(res);
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const existing = await prisma.order_settlement.findUnique({ where: { id }, select: { id: true, order_id: true, city_id: true } });
    if (!existing || outOfScope(req, existing)) return res.status(404).json(NOT_FOUND_BODY);
    const result = await receiverSettlementService.declineReceiverPay({ orderId: existing.order_id, actor: "admin", actorId: req.user.id });
    return res.status(200).json({ success: true, data: { phase: result.phase, settlement: result.settlement } });
  } catch (err) {
    if (err instanceof SettlementError) {
      return res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ success: false, code: err.code, message: err.message });
    }
    return internalError(res, err, "adminSettlement convertToCustomer");
  }
}

module.exports = { list, detail, resolve, convertToCustomer };

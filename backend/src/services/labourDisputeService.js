// Loading/Unloading labour dispute — DB layer (spec 2026-11-24, Phase 1).
// Raise freezes the held escrow (labour_status -> 'disputed', which blocks the drop-OTP release).
// An executive resolves: release to driver / refund to customer / split. Money is conserved — the
// held total (collected at hold + approved extra) is distributed, never minted. Mirrors the admin
// decide pattern (claim the pending row atomically).

const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const { resolveAmounts, canRaise } = require("./labourDispute");
const { payableTotal } = require("./labourEscrow");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** Customer or driver raises a labour dispute; freezes the escrow. */
async function raiseDispute({ orderId, raisedBy, raiserId, reason }) {
  if (!["customer", "driver"].includes(raisedBy)) throw httpError(400, "raised_by must be customer or driver");
  if (raiserId == null) throw httpError(400, "raiser id is required");

  return prisma.$transaction(async (tx) => {
    const order = await tx.pkg_order.findUnique({
      where: { id: Number(orderId) },
      select: { id: true, uid: true, rid: true, city_id: true, labour_status: true },
    });
    if (!order) throw httpError(404, "Order not found");
    // Ownership: the raiser must be this order's customer or driver.
    const ownerId = raisedBy === "customer" ? order.uid : order.rid;
    if (Number(ownerId) !== Number(raiserId)) throw httpError(403, "Not your order");

    const existing = await tx.labour_dispute.findFirst({ where: { order_id: Number(orderId), status: "pending" }, select: { id: true } });
    if (!canRaise(order.labour_status, !!existing)) throw httpError(409, "Labour is not in a disputable state");

    // Freeze the escrow atomically (only from 'held').
    const frozen = await tx.pkg_order.updateMany({
      where: { id: Number(orderId), labour_status: "held" },
      data: { labour_status: "disputed" },
    });
    if (frozen.count !== 1) throw httpError(409, "Labour is not in a disputable state");

    const dispute = await tx.labour_dispute.create({
      data: {
        order_id: Number(orderId), city_id: order.city_id ?? null,
        raised_by: raisedBy, reason: reason ? String(reason).slice(0, 2000) : null, status: "pending",
      },
    });
    return { raised: true, disputeId: dispute.id };
  });
}

/** Executive queue: pending disputes (city-scoped) with the evidence needed to decide. */
async function listForExecutive({ cityId }) {
  const where = { status: "pending" };
  if (cityId != null && !Number.isNaN(Number(cityId))) where.city_id = Number(cityId);
  const disputes = await prisma.labour_dispute.findMany({ where, orderBy: { raised_at: "asc" }, take: 200 });
  const orderIds = disputes.map((d) => Number(d.order_id));
  const orders = orderIds.length
    ? await prisma.pkg_order.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true, uid: true, rid: true, labour_charge_amount: true, labour_extra_amount: true,
          labour_extra_approved: true, labour_extra_photo: true, labour_declared_json: true, labour_extra_json: true,
        },
      })
    : [];
  const byId = new Map(orders.map((o) => [o.id, o]));
  return disputes.map((d) => {
    const o = byId.get(Number(d.order_id)) || {};
    const heldTotal = payableTotal({ base: o.labour_charge_amount, extra: o.labour_extra_amount, extraApproved: o.labour_extra_approved });
    return {
      dispute_id: d.id, order_id: d.order_id, raised_by: d.raised_by, reason: d.reason, raised_at: d.raised_at,
      held_total: heldTotal,
      base: round2(o.labour_charge_amount), extra: round2(o.labour_extra_amount), extra_approved: o.labour_extra_approved,
      extra_photo: o.labour_extra_photo, declared: o.labour_declared_json, extra_declared: o.labour_extra_json,
    };
  });
}

/** Executive resolves: distribute the held total (release / refund / split). Money conserved. */
async function resolveDispute({ disputeId, executiveId, actorRole, actorCityId, action, driverAmount, note }) {
  return prisma.$transaction(async (tx) => {
    const dispute = await tx.labour_dispute.findUnique({ where: { id: Number(disputeId) } });
    if (!dispute) throw httpError(404, "Dispute not found");
    if (dispute.status !== "pending") throw httpError(409, "Dispute already resolved");
    // City scope: only a superadmin may resolve across cities; everyone else is bound to their own.
    if (actorRole !== "superadmin") {
      if (actorCityId == null || Number(dispute.city_id) !== Number(actorCityId)) {
        throw httpError(403, "This dispute is outside your city scope");
      }
    }

    const order = await tx.pkg_order.findUnique({
      where: { id: Number(dispute.order_id) },
      select: { id: true, uid: true, rid: true, labour_charge_amount: true, labour_extra_amount: true, labour_extra_approved: true },
    });
    if (!order) throw httpError(404, "Order not found");

    const heldTotal = payableTotal({ base: order.labour_charge_amount, extra: order.labour_extra_amount, extraApproved: order.labour_extra_approved });
    const amounts = resolveAmounts(action, heldTotal, driverAmount);

    // Claim the dispute atomically (idempotent against a double-resolve).
    const claimed = await tx.labour_dispute.updateMany({
      where: { id: Number(disputeId), status: "pending" },
      data: {
        status: "resolved", action, driver_amount: amounts.driver, refund_amount: amounts.refund,
        resolved_by: executiveId ?? null, resolved_at: new Date(), resolve_note: note ? String(note).slice(0, 2000) : null,
      },
    });
    if (claimed.count !== 1) throw httpError(409, "Dispute already resolved");

    if (amounts.driver > 0 && order.rid) {
      await tx.tbl_rider.update({ where: { id: Number(order.rid) }, data: { wallet_balance: { increment: amounts.driver } } });
    }
    if (amounts.refund > 0 && order.uid) {
      const key = `labour_dispute_refund:${order.id}`;
      const dup = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" }, select: { id: true } });
      if (!dup) {
        await tx.tbl_user.update({ where: { id: Number(order.uid) }, data: { wallet: { increment: amounts.refund } } });
        await tx.tbl_wallet_history.create({
          data: {
            user_id: Number(order.uid), amount: amounts.refund, type: "credit",
            remark: `Labour dispute refund for order #${order.id}`, wallet_type: "user",
            order_id: Number(order.id), payment_id: key, created_at: istNow(),
          },
        });
      }
    }

    await tx.pkg_order.updateMany({ where: { id: Number(order.id) }, data: { labour_status: "resolved" } });
    return { resolved: true, action, driver: amounts.driver, refund: amounts.refund };
  });
}

module.exports = { raiseDispute, listForExecutive, resolveDispute };

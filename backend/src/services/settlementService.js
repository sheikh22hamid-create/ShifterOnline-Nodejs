const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const walletNotifier = require("./walletNotifier");
const settlementSettings = require("./settlementSettings");

const STATUS = Object.freeze({
  PENDING: "pending",
  CASH_RECEIVED: "cash_received",
  PAID_ONLINE: "paid_online",
  DISPUTED: "disputed",
  WAIVED: "waived",
  CUSTOMER_OWES: "customer_owes",
});
const EFFECT = Object.freeze({ NONE: "none", CASH: "cash", ONLINE: "online" });
// What an admin outcome does to the driver wallet. waived / customer_owes both
// mean the company pays the driver (same as online) without collecting from
// the customer here.
const OUTCOME_EFFECT = Object.freeze({
  cash_received: EFFECT.CASH,
  paid_online: EFFECT.ONLINE,
  waived: EFFECT.ONLINE,
  customer_owes: EFFECT.ONLINE,
});
const ADMIN_OUTCOMES = Object.freeze(Object.keys(OUTCOME_EFFECT));

class SettlementError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SettlementError";
    this.code = code;
  }
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function stateMessage(status) {
  if (status === STATUS.DISPUTED) return "Payment is under dispute. Admin will resolve it.";
  if (status === STATUS.CASH_RECEIVED) return "Driver has already confirmed this payment.";
  if (status === STATUS.PAID_ONLINE) return "Payment is already completed.";
  return `Payment is ${status}.`;
}

function publicView(s) {
  return {
    settlement_id: s.id,
    order_id: s.order_id,
    status: s.status,
    amount_due: Number(s.amount_due),
    fare: Number(s.fare),
    method: s.method || null,
    customer_choice: s.customer_choice || null,
    confirmed_by: s.confirmed_by || null,
    confirmed_at: s.confirmed_at || null,
    pending_since: s.pending_since,
    dispute_reason: s.dispute_reason || null,
    dispute_raised_by: s.dispute_raised_by || null,
  };
}

function emitSettlementUpdated(s) {
  try {
    // Lazy require: socketServer pulls in dispatchManager, which would create an import cycle at load time.
    const { getIO } = require("../sockets/socketServer");
    getIO().to(`order_${s.order_id}`).emit("settlement:updated", publicView(s));
  } catch (err) {
    // Sockets not initialised (tests, scripts) or a transient emit error must never fail a money transition.
    logger.warn(`emitSettlementUpdated skipped for order ${s?.order_id}: ${err.message}`);
  }
}

function assertParty(s, party, id) {
  if (!s) throw new SettlementError("NOT_FOUND", "No payment record for this order.");
  if (party === "customer" && Number(s.uid) !== Number(id)) {
    throw new SettlementError("FORBIDDEN", "This order belongs to another customer.");
  }
  if (party === "driver" && Number(s.rid) !== Number(id)) {
    throw new SettlementError("FORBIDDEN", "This order belongs to another driver.");
  }
}

// What each effect does to the driver wallet. Cash replicates what
// tripLifecycle's complete handler did before settlement existed.
function effectOps(effect, s) {
  const fare = Number(s.fare);
  const commission = Number(s.commission_amount);
  const perTrip = Number(s.per_trip_charge);
  const prepaid = Number(s.prepaid_amount);
  if (effect === EFFECT.CASH) {
    const netCommissionDue = round2(Math.max(0, commission + perTrip - prepaid));
    const advanceRefundDue = round2(Math.max(0, prepaid - (commission + perTrip)));
    const ops = [];
    if (netCommissionDue > 0) ops.push({ type: "debit", amount: netCommissionDue, remark: `Admin deduction for order #${s.order_id}` });
    if (advanceRefundDue > 0) {
      ops.push({
        type: "credit",
        amount: advanceRefundDue,
        remark: `Advance payment balance for order #${s.order_id} (cash collected was less than net earning)`,
      });
    }
    return ops;
  }
  if (effect === EFFECT.ONLINE) {
    const credit = round2(Math.max(0, fare - commission - perTrip));
    return credit > 0 ? [{ type: "credit", amount: credit, remark: `Online payment received for order #${s.order_id}` }] : [];
  }
  return [];
}

// PRECONDITION: `s` must be the settlement row read after taking the FOR UPDATE
// lock (lockByOrderId/lockById) in the same transaction. The idempotency check
// below is find-then-create and is only safe under that lock.
async function moveWallet(tx, s, ops, tag, notifications) {
  let i = 0;
  for (const op of ops) {
    const key = `settle:${s.id}:${s.effect_seq}:${tag}:${i++}`;
    const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "driver" } });
    if (duplicate) continue;
    await tx.tbl_rider.update({
      where: { id: s.rid },
      data: { wallet_balance: op.type === "debit" ? { decrement: op.amount } : { increment: op.amount } },
    });
    await tx.tbl_wallet_history.create({
      data: {
        user_id: s.rid,
        amount: op.amount,
        type: op.type,
        remark: op.remark,
        wallet_type: "driver",
        order_id: s.order_id,
        payment_id: key,
        created_at: istNow(),
      },
    });
    notifications.push({ riderId: s.rid, type: op.type, amount: op.amount, remark: op.remark });
  }
}

// PRECONDITION: `s` must be the settlement row read after taking the FOR UPDATE
// lock (lockByOrderId/lockById) inside the same transaction as `tx`; otherwise
// the find-then-create idempotency in moveWallet can double-apply.
// Moves the driver wallet from the effect currently applied to the target one
// by reversing the old effect, then applying the new. Returns the new
// effect_seq the caller must persist together with wallet_effect.
async function changeWalletEffect(tx, s, target) {
  const notifications = [];
  if (s.wallet_effect === target) return { effectSeq: s.effect_seq, notifications };
  let seq = s.effect_seq;
  if (s.wallet_effect !== EFFECT.NONE) {
    seq += 1;
    const reversal = effectOps(s.wallet_effect, s).map((op) => ({
      type: op.type === "debit" ? "credit" : "debit",
      amount: op.amount,
      remark: `Reversal: ${op.remark}`,
    }));
    await moveWallet(tx, { ...s, effect_seq: seq }, reversal, "rev", notifications);
  }
  if (target !== EFFECT.NONE) {
    seq += 1;
    await moveWallet(tx, { ...s, effect_seq: seq }, effectOps(target, s), "apply", notifications);
  }
  return { effectSeq: seq, notifications };
}

async function lockByOrderId(tx, orderId) {
  const rows = await tx.$queryRaw`SELECT id FROM order_settlement WHERE order_id = ${orderId} FOR UPDATE`;
  if (!rows[0]) return null;
  return tx.order_settlement.findUnique({ where: { id: rows[0].id } });
}

async function lockById(tx, id) {
  const rows = await tx.$queryRaw`SELECT id FROM order_settlement WHERE id = ${id} FOR UPDATE`;
  if (!rows[0]) return null;
  return tx.order_settlement.findUnique({ where: { id: rows[0].id } });
}

function logEvent(tx, s, { actor, actorId = null, from = null, to = null, note = null }) {
  return tx.order_settlement_event.create({
    data: { settlement_id: s.id, actor, actor_id: actorId, from_status: from, to_status: to, note, created_at: new Date() },
  });
}

// Runs `work(tx, notifications)` in a transaction; after commit, pushes the
// wallet notifications and the socket update. `work` returns { settlement, alreadyDone? }.
async function runTransition(work) {
  const notifications = [];
  const result = await prisma.$transaction((tx) => work(tx, notifications));
  for (const n of notifications) {
    try {
      Promise.resolve(walletNotifier.notifyDriverWalletTransaction(n.riderId, { type: n.type, amount: n.amount, remark: n.remark }))
        .catch((err) => logger.error(`settlement wallet notify failed for rider ${n.riderId}:`, err));
    } catch (err) {
      logger.error(`settlement wallet notify failed for rider ${n.riderId}:`, err);
    }
  }
  if (!result.alreadyDone) emitSettlementUpdated(result.settlement);
  return result;
}

async function createForCompletedOrder({ orderId, uid, riderId, amountDue, fare, commissionAmount, perTripCharge, prepaidAmount }) {
  const existing = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (existing) return existing;
  const now = new Date();
  let created;
  try {
    // Create + audit event commit together so a retry can never leave a settlement without its event.
    created = await prisma.$transaction(async (tx) => {
      const row = await tx.order_settlement.create({
        data: {
          order_id: orderId,
          uid,
          rid: riderId,
          amount_due: round2(amountDue),
          fare: round2(fare),
          commission_amount: round2(commissionAmount),
          per_trip_charge: round2(perTripCharge),
          prepaid_amount: round2(prepaidAmount),
          status: STATUS.PENDING,
          wallet_effect: EFFECT.NONE,
          pending_since: now,
          created_at: now,
          updated_at: now,
        },
      });
      await tx.order_settlement_event.create({
        data: { settlement_id: row.id, actor: "system", from_status: null, to_status: STATUS.PENDING, note: "Ride completed; awaiting payment", created_at: now },
      });
      return row;
    });
  } catch (err) {
    if (err?.code === "P2002") return prisma.order_settlement.findUnique({ where: { order_id: orderId } });
    throw err;
  }
  emitSettlementUpdated(created);
  return created;
}

async function getViewForParty({ orderId, party, partyId }) {
  const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!s) return null;
  assertParty(s, party, partyId);
  return publicView(s);
}

// Used inside order-details payloads: never let a missing table (dev/prod
// schema drift) or a transient error break the order screen.
async function getPublicViewForOrder(orderId) {
  try {
    const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
    return s ? publicView(s) : null;
  } catch (err) {
    logger.error(`getPublicViewForOrder failed for order ${orderId}:`, err);
    return null;
  }
}

module.exports = {
  STATUS, EFFECT, OUTCOME_EFFECT, ADMIN_OUTCOMES, SettlementError,
  round2, stateMessage, publicView, emitSettlementUpdated, assertParty,
  effectOps, changeWalletEffect, lockByOrderId, lockById, logEvent, runTransition,
  createForCompletedOrder, getViewForParty, getPublicViewForOrder,
  settlementSettings,
};

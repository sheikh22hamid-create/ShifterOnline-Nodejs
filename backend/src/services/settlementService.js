const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const walletNotifier = require("./walletNotifier");
const settlementSettings = require("./settlementSettings");
const { verifyRazorpayPayment } = require("../utils/razorpayVerify");
const { createRazorpayOrder } = require("../utils/razorpayOrders");
const receiverWalletCredits = require("./receiverWalletCredits");

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
// Statuses in which the customer can still pay online. customer_owes already has the online wallet
// effect applied, so paying moves it to paid_online without any wallet movement.
const ONLINE_PAYABLE = Object.freeze([STATUS.PENDING, STATUS.CUSTOMER_OWES]);

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

function assertCustomerPaysItself(s) {
  if (s.payer === "receiver") {
    throw new SettlementError("RECEIVER_MODE", "The receiver is paying for this order. Take over the payment first.");
  }
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
    payer: s.payer || "customer",
    receiver_markup: Number(s.receiver_markup || 0),
    advance_held: Number(s.advance_held || 0),
    receiver_pay_total: round2(Number(s.amount_due) + (s.payer === "receiver" ? Number(s.receiver_markup || 0) : 0)),
  };
}

function emitSettlementUpdated(s) {
  try {
    // Lazy require: socketServer pulls in dispatchManager, which would create an import cycle at load time.
    const { getIO } = require("../sockets/socketServer");
    const io = getIO();
    const payload = publicView(s);
    // Sockets only rejoin order_<id> rooms for statuses 0-3, so completed-order updates must also
    // reach the per-user rooms. A socket in several of these rooms receives duplicates; clients
    // key on settlement_id / order_id so that is harmless.
    const rooms = [`order_${s.order_id}`, `customer_${s.uid}`, `driver_${s.rid}`];
    for (const room of rooms) io.to(room).emit("settlement:updated", payload);
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
    // Receiver mode: the driver also collected the booker's commission in cash. It is handed to the
    // booker's wallet by the platform, so it comes off the driver wallet like the platform commission.
    const receiverMarkup = s.payer === "receiver" ? round2(Number(s.receiver_markup || 0)) : 0;
    if (receiverMarkup > 0) ops.push({ type: "debit", amount: receiverMarkup, remark: `Receiver commission collected in cash for order #${s.order_id}` });
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
      const send = n.userId
        ? walletNotifier.notifyCustomerWalletTransaction(n.userId, { type: n.type, amount: n.amount, remark: n.remark })
        : walletNotifier.notifyDriverWalletTransaction(n.riderId, { type: n.type, amount: n.amount, remark: n.remark });
      Promise.resolve(send).catch((err) => logger.error(`settlement wallet notify failed for ${n.userId ? `user ${n.userId}` : `rider ${n.riderId}`}:`, err));
    } catch (err) {
      logger.error(`settlement wallet notify failed for rider ${n.riderId}:`, err);
    }
  }
  if (!result.alreadyDone) emitSettlementUpdated(result.settlement);
  // Free Booking Offer: a payment that just settled may release a pending wallet credit.
  // tryCredit is idempotent and never throws; this must never affect the settlement itself.
  if (!result.alreadyDone && result.settlement && ["cash_received", "paid_online", "waived"].includes(result.settlement.status)) {
    try {
      Promise.resolve(require("./freeBookingService").tryCredit(result.settlement.order_id))
        .catch((err) => logger.error(`free-booking credit after settlement failed for order ${result.settlement.order_id}:`, err));
    } catch (err) {
      logger.error(`free-booking credit after settlement failed for order ${result.settlement.order_id}:`, err);
    }
  }
  return result;
}

async function createForCompletedOrder({ orderId, uid, riderId, amountDue, fare, commissionAmount, perTripCharge, prepaidAmount, cityId, receiver = null }) {
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
          city_id: cityId == null ? null : Number(cityId),
          amount_due: round2(amountDue),
          fare: round2(fare),
          commission_amount: round2(commissionAmount),
          per_trip_charge: round2(perTripCharge),
          prepaid_amount: round2(prepaidAmount),
          payer: receiver ? "receiver" : "customer",
          receiver_markup: receiver ? round2(receiver.markup) : 0,
          advance_held: receiver ? round2(receiver.advanceHeld) : 0,
          status: STATUS.PENDING,
          wallet_effect: EFFECT.NONE,
          pending_since: now,
          created_at: now,
          updated_at: now,
        },
      });
      await tx.order_settlement_event.create({
        data: { settlement_id: row.id, actor: "system", from_status: null, to_status: STATUS.PENDING, note: receiver ? "Ride completed; awaiting receiver payment" : "Ride completed; awaiting payment", created_at: now },
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

async function markCashReceived({ orderId, riderId }) {
  return runTransition(async (tx, notifications) => {
    const s = await lockByOrderId(tx, orderId);
    assertParty(s, "driver", riderId);
    if (s.status === STATUS.CASH_RECEIVED) return { settlement: s, alreadyDone: true };
    if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, EFFECT.CASH);
    notifications.push(...n);
    const receiverPatch = {};
    if (s.payer === "receiver") {
      await receiverWalletCredits.applyReceiverCredits(tx, s, { includeMarkup: true, notifications });
      await receiverWalletCredits.markReceiverRow(tx, s.order_id, "paid");
      Object.assign(receiverPatch, { receiver_credited: true });
    }
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: STATUS.CASH_RECEIVED, method: "cash", wallet_effect: EFFECT.CASH, effect_seq: effectSeq,
        confirmed_by: "driver", confirmed_at: now, updated_at: now,
        ...receiverPatch,
      },
    });
    await logEvent(tx, s, { actor: "driver", actorId: riderId, from: s.status, to: STATUS.CASH_RECEIVED });
    return { settlement: updated };
  });
}

// Informational: tells the driver screen the customer will pay in person.
// Does not change status or move money.
async function chooseDriverPayment({ orderId, uid }) {
  return runTransition(async (tx) => {
    const s = await lockByOrderId(tx, orderId);
    assertParty(s, "customer", uid);
    assertCustomerPaysItself(s);
    if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    if (s.customer_choice === "driver") return { settlement: s, alreadyDone: true };
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: { customer_choice: "driver", updated_at: new Date() },
    });
    await logEvent(tx, s, { actor: "customer", actorId: uid, from: s.status, to: s.status, note: "Chose to pay the driver directly" });
    return { settlement: updated };
  });
}

async function raiseDispute({ orderId, actor, actorId, reason }) {
  const text = String(reason || "").trim();
  if (text.length < 3) throw new SettlementError("REASON_REQUIRED", "Please describe the problem.");
  const { disputeWindowHours } = await settlementSettings.getSettlementSettings();
  return runTransition(async (tx) => {
    const s = await lockByOrderId(tx, orderId);
    assertParty(s, actor, actorId);
    if (s.status === STATUS.DISPUTED) return { settlement: s, alreadyDone: true };
    const customerOnConfirmedCash = actor === "customer" && s.status === STATUS.CASH_RECEIVED;
    if (s.status !== STATUS.PENDING && !customerOnConfirmedCash) {
      throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    }
    if (customerOnConfirmedCash) {
      if (s.confirmed_by !== "driver") {
        throw new SettlementError("INVALID_STATE", "An admin has already reviewed this payment.");
      }
      const ageMs = s.confirmed_at ? Date.now() - new Date(s.confirmed_at).getTime() : NaN;
      if (!Number.isFinite(ageMs) || ageMs > disputeWindowHours * 60 * 60 * 1000) {
        throw new SettlementError("WINDOW_CLOSED", "The window to report a problem with this payment has closed.");
      }
    }
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: STATUS.DISPUTED, dispute_reason: text, dispute_raised_by: actor, dispute_raised_at: now, updated_at: now,
      },
    });
    await logEvent(tx, s, { actor, actorId, from: s.status, to: STATUS.DISPUTED, note: text });
    return { settlement: updated };
  });
}

async function adminResolve({ settlementId, adminId, outcome, note }) {
  if (!ADMIN_OUTCOMES.includes(outcome)) throw new SettlementError("INVALID_OUTCOME", "Unknown outcome.");
  const text = String(note || "").trim();
  if (!text) throw new SettlementError("NOTE_REQUIRED", "A note is required to resolve a payment.");
  return runTransition(async (tx, notifications) => {
    const s = await lockById(tx, settlementId);
    if (!s) throw new SettlementError("NOT_FOUND", "No payment record found.");
    if (s.status === outcome) return { settlement: s, alreadyDone: true };
    const receiverPatch = await receiverWalletCredits.adminOutcomePatch(tx, s, outcome, { notifications });
    // Pass the ORIGINAL locked row: reversing a prior driver effect must recompute it from the values
    // it was applied with. receiverPatch (e.g. advance-netted prepaid_amount) only goes into the UPDATE.
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, OUTCOME_EFFECT[outcome]);
    notifications.push(...n);
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: outcome,
        method: outcome === STATUS.CASH_RECEIVED ? "cash" : outcome === STATUS.PAID_ONLINE ? "online" : null,
        wallet_effect: OUTCOME_EFFECT[outcome],
        effect_seq: effectSeq,
        confirmed_by: "admin", confirmed_at: now,
        resolved_by: adminId, resolved_at: now, resolve_note: text, updated_at: now,
        ...receiverPatch,
      },
    });
    await logEvent(tx, s, { actor: "admin", actorId: adminId, from: s.status, to: outcome, note: text });
    return { settlement: updated };
  });
}

async function createOnlineOrder({ orderId, uid }) {
  const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  assertParty(s, "customer", uid);
  assertCustomerPaysItself(s);
  if (!ONLINE_PAYABLE.includes(s.status)) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
  const amountDue = Number(s.amount_due);
  let razorpayOrderId = s.razorpay_order_id;
  let amountPaise = Math.round(amountDue * 100);
  // A stored razorpay_order_id is reused as-is. amount_due is fixed at creation, except when an admin
  // converts a receiver settlement to customer mode (which rewrites it); receiver mode never stores a
  // settlement razorpay_order_id, so a stored id always matches the current amount_due.
  if (!razorpayOrderId) {
    const created = await createRazorpayOrder({ amountRupees: amountDue, receipt: `settle_${orderId}` });
    if (!created.ok) throw new SettlementError("GATEWAY_ERROR", created.reason);
    // Conditional write: a concurrent first call (or a state change) must not be overwritten.
    const won = await prisma.order_settlement.updateMany({
      where: { id: s.id, status: { in: ONLINE_PAYABLE }, razorpay_order_id: null },
      data: { razorpay_order_id: created.id, customer_choice: "online", updated_at: new Date() },
    });
    if (won.count === 1) {
      razorpayOrderId = created.id;
      amountPaise = created.amountPaise;
      await prisma.order_settlement_event.create({
        data: { settlement_id: s.id, actor: "customer", actor_id: uid, from_status: s.status, to_status: s.status, note: "Chose to pay online", created_at: new Date() },
      });
    } else {
      const current = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
      if (!current || !ONLINE_PAYABLE.includes(current.status)) {
        throw new SettlementError("INVALID_STATE", stateMessage(current?.status));
      }
      razorpayOrderId = current.razorpay_order_id;
      amountPaise = Math.round(Number(current.amount_due) * 100);
    }
  }
  return { razorpay_order_id: razorpayOrderId, amount_paise: amountPaise, currency: "INR", key_id: process.env.RAZORPAY_KEY_ID };
}

async function settleOnline({ orderId, uid, paymentId, razorpayOrderId, signature }) {
  const pre = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  assertParty(pre, "customer", uid);
  assertCustomerPaysItself(pre);
  if (pre.status === STATUS.PAID_ONLINE && pre.razorpay_payment_id === paymentId) {
    return { settlement: pre, alreadyDone: true };
  }
  if (!ONLINE_PAYABLE.includes(pre.status)) throw new SettlementError("INVALID_STATE", stateMessage(pre.status));
  // The payment must belong to the Razorpay order we created for THIS settlement.
  if (!pre.razorpay_order_id || pre.razorpay_order_id !== razorpayOrderId) {
    throw new SettlementError("PAYMENT_MISMATCH", "This payment does not belong to this order.");
  }
  const verification = await verifyRazorpayPayment({
    paymentId, orderId: razorpayOrderId, signature, expectedAmountRupees: Number(pre.amount_due),
  });
  if (!verification.ok) throw new SettlementError("PAYMENT_VERIFICATION_FAILED", verification.reason);

  try {
    return await runTransition(async (tx, notifications) => {
    const s = await lockByOrderId(tx, orderId);
    if (s.status === STATUS.PAID_ONLINE && s.razorpay_payment_id === paymentId) return { settlement: s, alreadyDone: true };
    // Re-checked under the lock: the driver may have confirmed cash while the customer was paying.
    if (!ONLINE_PAYABLE.includes(s.status)) {
      throw Object.assign(new SettlementError("INVALID_STATE", stateMessage(s.status)), { currentStatus: s.status, lockedReason: "state" });
    }
    if (s.razorpay_order_id !== razorpayOrderId) {
      throw Object.assign(new SettlementError("PAYMENT_MISMATCH", "This payment does not belong to this order."), { currentStatus: s.status, lockedReason: "mismatch" });
    }
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, EFFECT.ONLINE);
    notifications.push(...n);
    const now = new Date();
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        status: STATUS.PAID_ONLINE, method: "online", wallet_effect: EFFECT.ONLINE, effect_seq: effectSeq,
        razorpay_payment_id: paymentId, confirmed_by: "customer_online", confirmed_at: now, updated_at: now,
      },
    });
    await logEvent(tx, s, { actor: "customer", actorId: uid, from: s.status, to: STATUS.PAID_ONLINE, note: `Razorpay payment ${paymentId}` });
    return { settlement: updated };
  });
  } catch (err) {
    // The payment was verified, so a rejection here means money was captured but not recorded.
    if (err instanceof SettlementError && err.lockedReason) {
      const status = err.currentStatus;
      const note = err.lockedReason === "state"
        ? `Razorpay payment ${paymentId} was captured and verified but the settlement was already ${status}; needs manual reconciliation`
        : `Razorpay payment ${paymentId} was captured and verified but belongs to a different Razorpay order than the one stored; needs manual reconciliation`;
      logger.error(`settleOnline: verified payment ${paymentId} for order ${orderId} could not be applied (${err.lockedReason}, status ${status}); needs manual reconciliation`);
      try {
        await prisma.order_settlement_event.create({
          data: { settlement_id: pre.id, actor: "customer", actor_id: uid, from_status: status, to_status: status, note, created_at: new Date() },
        });
      } catch (evErr) {
        logger.error(`settleOnline: failed to record reconciliation event for payment ${paymentId}:`, evErr);
      }
      throw new SettlementError("PAID_BUT_STATE_CHANGED", "Your payment was received but this order was already settled. Support will reconcile it.");
    }
    throw err;
  }
}

// A customer with an unpaid settlement (pending, or marked owed by an admin)
// cannot book again. Disputed settlements deliberately do NOT block.
async function listPendingForDriver(riderId) {
  const rows = await prisma.order_settlement.findMany({
    where: { rid: Number(riderId), status: { in: [STATUS.PENDING, STATUS.DISPUTED] } },
    orderBy: { id: "desc" },
    take: 20,
  });
  return rows.map(publicView);
}

async function findBlockingSettlement(uid) {
  if (!(await settlementSettings.isSettlementEnabled())) return null;
  return prisma.order_settlement.findFirst({
    // A pending receiver-pays settlement is the receiver's to pay, so it must not stop the booker booking again.
    where: { uid: Number(uid), OR: [{ status: STATUS.CUSTOMER_OWES }, { status: STATUS.PENDING, payer: "customer" }] },
    select: { order_id: true, amount_due: true, status: true },
  });
}

module.exports = {
  STATUS, EFFECT, OUTCOME_EFFECT, ADMIN_OUTCOMES, SettlementError,
  round2, stateMessage, publicView, emitSettlementUpdated, assertParty,
  effectOps, changeWalletEffect, lockByOrderId, lockById, logEvent, runTransition,
  createForCompletedOrder, getViewForParty, getPublicViewForOrder,
  markCashReceived, chooseDriverPayment, raiseDispute, adminResolve,
  createOnlineOrder, settleOnline, findBlockingSettlement, listPendingForDriver,
  settlementSettings,
};

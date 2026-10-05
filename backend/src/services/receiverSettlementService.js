const prisma = require("../config/db");
const logger = require("../utils/logger");
const { verifyRazorpayPayment, fetchRazorpayOrder } = require("../utils/razorpayVerify");
const { createRazorpayOrder } = require("../utils/razorpayOrders");
const settlementService = require("./settlementService");
const receiverWalletCredits = require("./receiverWalletCredits");
const { hashToken } = require("./receiverPayToken");
const { receiverPayable } = require("./receiverPayCalc");

const { STATUS, EFFECT, SettlementError, round2, stateMessage, changeWalletEffect, lockByOrderId, logEvent, runTransition } = settlementService;

const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || null;
const shorten = (s) => (s ? String(s).slice(0, 80) : null);

async function findRowByToken(token) {
  const row = await prisma.order_receiver_pay.findUnique({ where: { token_hash: hashToken(token) } });
  if (!row) throw new SettlementError("INVALID_LINK", "This payment link is not valid.");
  return row;
}

const isExpired = (row) => !row.token_expires_at || new Date(row.token_expires_at).getTime() < Date.now();

// A pending receiver-mode settlement behind an active, unexpired link.
async function loadPayable(token) {
  const row = await findRowByToken(token);
  if (row.status !== "active") throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
  if (isExpired(row)) throw new SettlementError("LINK_EXPIRED", "This payment link has expired.");
  const s = await prisma.order_settlement.findUnique({ where: { order_id: row.order_id } });
  if (!s || s.payer !== "receiver") throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
  return { row, s };
}

async function getPublicState(token) {
  const row = await findRowByToken(token);
  const s = await prisma.order_settlement.findUnique({ where: { order_id: row.order_id } });
  if (row.status === "paid") return { state: "paid" };
  if (row.status !== "active" || !s || s.payer !== "receiver" || s.status !== STATUS.PENDING) return { state: "closed" };
  if (isExpired(row)) return { state: "expired" };
  const [order, rider, booker] = await Promise.all([
    prisma.pkg_order.findUnique({ where: { id: row.order_id }, select: { id: true, rid: true, uid: true, paddress: true, daddress: true } }),
    prisma.tbl_rider.findUnique({ where: { id: s.rid }, select: { first_name: true } }),
    prisma.tbl_user.findUnique({ where: { id: s.uid }, select: { name: true } }),
  ]);
  return {
    state: "payable",
    order_id: row.order_id,
    amount_due: Number(s.amount_due),
    markup: Number(s.receiver_markup),
    total: receiverPayable(s.amount_due, s.receiver_markup),
    driver_first_name: firstName(rider?.first_name),
    booker_first_name: firstName(booker?.name),
    pickup: shorten(order?.paddress),
    drop: shorten(order?.daddress),
  };
}

async function createOrderByToken(token) {
  const { row, s } = await loadPayable(token);
  if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
  const total = receiverPayable(s.amount_due, s.receiver_markup);
  let razorpayOrderId = row.razorpay_order_id;
  let amountPaise = Math.round(total * 100);
  // amount_due and receiver_markup are immutable while payer = receiver, so a stored Razorpay
  // order always matches the amount and can be reused.
  if (!razorpayOrderId) {
    const created = await createRazorpayOrder({ amountRupees: total, receipt: `rpay_${row.order_id}` });
    if (!created.ok) throw new SettlementError("GATEWAY_ERROR", created.reason);
    const won = await prisma.order_receiver_pay.updateMany({
      where: { id: row.id, status: "active", razorpay_order_id: null },
      data: { razorpay_order_id: created.id, updated_at: new Date() },
    });
    if (won.count === 1) {
      razorpayOrderId = created.id;
      amountPaise = created.amountPaise;
    } else {
      const current = await prisma.order_receiver_pay.findUnique({ where: { id: row.id } });
      if (!current || current.status !== "active" || !current.razorpay_order_id) {
        throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
      }
      razorpayOrderId = current.razorpay_order_id;
    }
  }
  return { razorpay_order_id: razorpayOrderId, amount_paise: amountPaise, currency: "INR", key_id: process.env.RAZORPAY_KEY_ID };
}

async function recordReconciliation(orderId, settlementId, paymentId, status, payer) {
  const detail = payer !== "receiver" ? `${status} but converted to ${payer} payment` : status;
  const note = `Razorpay payment ${paymentId} was captured and verified but the settlement was already ${detail}; needs manual reconciliation`;
  logger.error(`settleByReceiver: ${note} (order ${orderId})`);
  try {
    await prisma.order_settlement_event.create({
      data: { settlement_id: settlementId, actor: "receiver", actor_id: null, from_status: status, to_status: status, note, created_at: new Date() },
    });
  } catch (evErr) {
    logger.error(`settleByReceiver: failed to record reconciliation event for payment ${paymentId}:`, evErr);
  }
}

async function settleByReceiver({ token, paymentId, razorpayOrderId, signature }) {
  // A resent link rotates the token, so a receiver who already opened checkout on the old link
  // would otherwise be turned away with a captured payment. The HMAC signature and the amount
  // check against Razorpay's own record bind the payment to its order, so fall back to that order.
  let row = await prisma.order_receiver_pay.findUnique({ where: { token_hash: hashToken(token) } });
  if (!row && razorpayOrderId) row = await prisma.order_receiver_pay.findFirst({ where: { razorpay_order_id: razorpayOrderId } });
  if (!row) throw new SettlementError("INVALID_LINK", "This payment link is not valid.");
  const pre = await prisma.order_settlement.findUnique({ where: { order_id: row.order_id } });
  if (!pre) throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
  if (pre.status === STATUS.PAID_ONLINE && pre.razorpay_payment_id === paymentId) return { settlement: pre, alreadyDone: true };
  if (pre.payer !== "receiver" || pre.status !== STATUS.PENDING || row.status !== "active") {
    const stateErr = new SettlementError("INVALID_STATE", pre.payer !== "receiver" ? "This payment link is no longer active." : stateMessage(pre.status));
    // A payment may already have been captured against this link's Razorpay order. Do not just
    // reject it: verify it and leave an audit trail so support can reconcile.
    if (!row.razorpay_order_id || row.razorpay_order_id !== razorpayOrderId) throw stateErr;
    let verified = false;
    try {
      const rzpOrder = await fetchRazorpayOrder(razorpayOrderId);
      if (rzpOrder && Number(rzpOrder.amount) > 0) {
        const v = await verifyRazorpayPayment({
          paymentId, orderId: razorpayOrderId, signature, expectedAmountRupees: Number(rzpOrder.amount) / 100,
        });
        verified = Boolean(v && v.ok);
      }
    } catch (e) {
      logger.error(`settleByReceiver: could not verify late payment ${paymentId} for order ${row.order_id}:`, e);
    }
    if (!verified) throw stateErr;
    await recordReconciliation(row.order_id, pre.id, paymentId, pre.status, pre.payer);
    throw new SettlementError("PAID_BUT_STATE_CHANGED", "Your payment was received but this order was already settled. Support will reconcile it.");
  }
  // The payment must belong to the Razorpay order created for THIS link.
  if (!row.razorpay_order_id || row.razorpay_order_id !== razorpayOrderId) {
    throw new SettlementError("PAYMENT_MISMATCH", "This payment does not belong to this order.");
  }
  const verification = await verifyRazorpayPayment({
    paymentId, orderId: razorpayOrderId, signature, expectedAmountRupees: receiverPayable(pre.amount_due, pre.receiver_markup),
  });
  if (!verification.ok) throw new SettlementError("PAYMENT_VERIFICATION_FAILED", verification.reason);

  try {
    return await runTransition(async (tx, notifications) => {
      const s = await lockByOrderId(tx, row.order_id);
      if (s.status === STATUS.PAID_ONLINE && s.razorpay_payment_id === paymentId) return { settlement: s, alreadyDone: true };
      if (s.payer !== "receiver" || s.status !== STATUS.PENDING) {
        throw Object.assign(new SettlementError("INVALID_STATE", stateMessage(s.status)), { currentStatus: s.status, currentPayer: s.payer });
      }
      const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, EFFECT.ONLINE);
      notifications.push(...n);
      await receiverWalletCredits.applyReceiverCredits(tx, s, { includeMarkup: true, notifications });
      await receiverWalletCredits.markReceiverRow(tx, s.order_id, "paid");
      const now = new Date();
      const updated = await tx.order_settlement.update({
        where: { id: s.id },
        data: {
          status: STATUS.PAID_ONLINE, method: "online", wallet_effect: EFFECT.ONLINE, effect_seq: effectSeq,
          razorpay_payment_id: paymentId, confirmed_by: "receiver_online", confirmed_at: now, receiver_credited: true, updated_at: now,
        },
      });
      await logEvent(tx, s, { actor: "receiver", from: s.status, to: STATUS.PAID_ONLINE, note: `Razorpay payment ${paymentId}` });
      return { settlement: updated };
    });
  } catch (err) {
    // The payment was verified, so a state rejection here means money was captured but not recorded.
    if (err instanceof SettlementError && err.code === "INVALID_STATE" && err.currentStatus) {
      await recordReconciliation(row.order_id, pre.id, paymentId, err.currentStatus, err.currentPayer);
      throw new SettlementError("PAID_BUT_STATE_CHANGED", "Your payment was received but this order was already settled. Support will reconcile it.");
    }
    throw err;
  }
}

async function authorizeActor(orderId, actor, actorId) {
  if (actor === "receiver" || actor === "admin" || actor === "system") return;
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { uid: true, rid: true } });
  if (!order) throw new SettlementError("NOT_FOUND", "No order found.");
  if (actor === "booker" && Number(order.uid) !== Number(actorId)) throw new SettlementError("FORBIDDEN", "This order belongs to another customer.");
  if (actor === "driver" && Number(order.rid) !== Number(actorId)) throw new SettlementError("FORBIDDEN", "This order belongs to another driver.");
}

// Receiver / driver / booker / admin stops the receiver paying. Before completion it only marks the
// intent declined; after completion it converts the pending settlement to normal customer mode
// (the held advance is netted off the amount due, no markup). Running the row update FIRST and the
// conversion SECOND makes a decline that races completion converge either way.
async function declineReceiverPay({ orderId, actor, actorId = null }) {
  await authorizeActor(orderId, actor, actorId);
  const markRowDeclined = (client) => {
    const at = new Date();
    return client.order_receiver_pay.updateMany({
      where: { order_id: orderId, status: "active" },
      data: { status: "declined", declined_by: actor, declined_at: at, updated_at: at },
    });
  };
  let existing = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!existing) {
    // Decline before completion: flip the intent, then re-read in case completion created the
    // settlement in the meantime.
    await markRowDeclined(prisma);
    existing = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
    if (!existing) return { phase: "before_completion" };
  }
  if (existing.payer !== "receiver") return { phase: "already_normal", settlement: existing };

  const result = await runTransition(async (tx, notifications) => {
    const s = await lockByOrderId(tx, orderId);
    if (s.payer !== "receiver") return { settlement: s, alreadyDone: true };
    if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    await markRowDeclined(tx);
    const advance = round2(s.advance_held);
    const newDue = round2(Math.max(0, Number(s.amount_due) - advance));
    const base = {
      payer: "customer", amount_due: newDue, prepaid_amount: round2(Number(s.prepaid_amount) + advance),
      receiver_markup: 0, razorpay_order_id: null, customer_choice: null, updated_at: new Date(),
    };
    const note = `Receiver payment declined by ${actor}; switched to customer payment`;
    if (newDue > 0) {
      const updated = await tx.order_settlement.update({ where: { id: s.id }, data: base });
      await logEvent(tx, s, { actor: actor === "booker" ? "customer" : actor, actorId, from: s.status, to: s.status, note });
      return { settlement: updated };
    }
    // The held advance covers everything still due: settle like a fully prepaid cash order.
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, { ...s, ...base }, EFFECT.CASH);
    notifications.push(...n);
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        ...base, status: STATUS.CASH_RECEIVED, method: null, wallet_effect: EFFECT.CASH, effect_seq: effectSeq,
        confirmed_by: "system", confirmed_at: new Date(),
      },
    });
    await logEvent(tx, s, { actor: actor === "booker" ? "customer" : actor, actorId, from: s.status, to: STATUS.CASH_RECEIVED, note: `${note}; the advance covered the amount due` });
    return { settlement: updated };
  });
  return { phase: result.alreadyDone ? "already_normal" : "converted", settlement: result.settlement };
}

const declineByToken = async (token) => {
  const row = await findRowByToken(token);
  if (isExpired(row)) throw new SettlementError("LINK_EXPIRED", "This payment link has expired.");
  return declineReceiverPay({ orderId: row.order_id, actor: "receiver" });
};

module.exports = { getPublicState, createOrderByToken, settleByReceiver, declineReceiverPay, declineByToken };

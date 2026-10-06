const { istNow } = require("../utils/istTime");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// All helpers run inside a settlement transaction (`tx`) with the settlement row already
// locked FOR UPDATE; the find-then-create idempotency below is only safe under that lock.

async function creditBooker(tx, { uid, orderId, amount, key, remark, notifications }) {
  const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
  if (duplicate) return false;
  await tx.tbl_user.update({ where: { id: uid }, data: { wallet: { increment: amount } } });
  await tx.tbl_wallet_history.create({
    data: { user_id: uid, amount, type: "credit", remark, wallet_type: "user", order_id: orderId, payment_id: key, created_at: istNow() },
  });
  notifications.push({ userId: uid, type: "credit", amount, remark });
  return true;
}

// Debits at most the wallet's available balance (it must never go negative) and returns the
// part that could not be taken back.
async function debitBookerCapped(tx, { uid, orderId, amount, key, remark, notifications }) {
  const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
  if (duplicate) return 0;
  const user = await tx.tbl_user.findUnique({ where: { id: uid }, select: { wallet: true } });
  const available = Math.max(0, round2(user?.wallet));
  const debit = Math.min(available, round2(amount));
  if (debit > 0) {
    await tx.tbl_user.update({ where: { id: uid }, data: { wallet: { decrement: debit } } });
    await tx.tbl_wallet_history.create({
      data: { user_id: uid, amount: debit, type: "debit", remark, wallet_type: "user", order_id: orderId, payment_id: key, created_at: istNow() },
    });
    notifications.push({ userId: uid, type: "debit", amount: debit, remark });
  }
  return round2(amount - debit);
}

async function applyReceiverCredits(tx, s, { includeMarkup, notifications }) {
  const advance = round2(s.advance_held);
  const markup = includeMarkup ? round2(s.receiver_markup) : 0;
  if (advance > 0) {
    await creditBooker(tx, {
      uid: s.uid, orderId: s.order_id, amount: advance, key: `receiver_advance_refund:${s.id}`,
      remark: `Advance refunded - receiver paid for order #${s.order_id}`, notifications,
    });
  }
  if (markup > 0) {
    await creditBooker(tx, {
      uid: s.uid, orderId: s.order_id, amount: markup, key: `receiver_markup_credit:${s.id}`,
      remark: `Receiver commission for order #${s.order_id}`, notifications,
    });
  }
  return { advance, markup };
}

async function reverseReceiverCredits(tx, s, { notifications }) {
  let shortfall = 0;
  const advance = round2(s.advance_held);
  const markup = round2(s.receiver_markup);
  if (advance > 0) {
    shortfall += await debitBookerCapped(tx, {
      uid: s.uid, orderId: s.order_id, amount: advance, key: `receiver_advance_refund_rev:${s.id}:${s.effect_seq}`,
      remark: `Reversal: advance refund for order #${s.order_id}`, notifications,
    });
  }
  if (markup > 0) {
    shortfall += await debitBookerCapped(tx, {
      uid: s.uid, orderId: s.order_id, amount: markup, key: `receiver_markup_credit_rev:${s.id}:${s.effect_seq}`,
      remark: `Reversal: receiver commission for order #${s.order_id}`, notifications,
    });
  }
  return { shortfall: round2(shortfall) };
}

async function markReceiverRow(tx, orderId, status) {
  await tx.order_receiver_pay.updateMany({
    where: { order_id: orderId, status: "active" },
    data: { status, updated_at: new Date() },
  });
}

// Extra settlement fields an admin outcome implies for a receiver-mode settlement.
//  - cash_received / paid_online: the receiver did pay (the commission too, in cash or online),
//    so credit the booker (once).
//  - waived / customer_owes: the receiver did not pay, so the advance is consumed against the
//    fare and the settlement becomes a normal customer one (any earlier credits are reversed,
//    capped at the available balance; the uncollected part is recorded as reversal_shortfall).
async function adminOutcomePatch(tx, s, outcome, { notifications }) {
  if (s.payer !== "receiver") return {};
  if (outcome === "cash_received" || outcome === "paid_online") {
    if (s.receiver_credited) return {};
    await applyReceiverCredits(tx, s, { includeMarkup: true, notifications });
    await markReceiverRow(tx, s.order_id, "paid");
    return { receiver_credited: true };
  }
  let shortfall = 0;
  if (s.receiver_credited) ({ shortfall } = await reverseReceiverCredits(tx, s, { notifications }));
  await markReceiverRow(tx, s.order_id, "closed");
  const advance = round2(s.advance_held);
  return {
    payer: "customer",
    amount_due: round2(Math.max(0, Number(s.amount_due) - advance)),
    prepaid_amount: round2(Number(s.prepaid_amount) + advance),
    receiver_markup: 0,
    receiver_credited: false,
    reversal_shortfall: round2(Number(s.reversal_shortfall || 0) + shortfall),
  };
}

module.exports = { applyReceiverCredits, reverseReceiverCredits, markReceiverRow, adminOutcomePatch };

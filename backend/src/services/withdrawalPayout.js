// Money-moving state transitions for driver withdrawal requests paid through
// RazorpayX (spec 2026-11-14). Every wallet write here is guarded by an
// expected-status updateMany inside the same interactive transaction, so a
// double click, a repeated webhook or a status sync racing a webhook can move
// money at most once. Notifications (tbl_rnoti, FCM push, admin socket) are
// best-effort and only run after the transaction has committed.
const prisma = require("../config/db");
const { istNow } = require("../utils/istTime");
const adminSocket = require("../sockets/adminSocket");
const pushNotifier = require("./pushNotifier");
const logger = require("../utils/logger");

const FAILED_STATES = new Set(["reversed", "failed", "rejected", "cancelled"]);

// Private sentinel used to roll an interactive transaction back from inside
// the callback; any other error propagates to the caller untouched.
class Rollback extends Error {
  constructor(reason) {
    super(`rollback: ${reason}`);
    this.reason = reason;
  }
}

function clip(text, max) {
  if (text == null) return null;
  const s = String(text);
  return s.length > max ? s.slice(0, max) : s;
}

function rupees(amount) {
  return `₹${amount.toFixed(2)}`;
}

async function findRider(riderId) {
  try {
    return await prisma.tbl_rider.findUnique({ where: { id: riderId } });
  } catch (err) {
    logger.error(`withdrawalPayout: rider ${riderId} lookup for notifications failed:`, err);
    return null;
  }
}

function notifyAdmin(withdrawal, rider, status, amount) {
  try {
    adminSocket.notifyPayoutUpdate({
      id: withdrawal.id,
      rider_id: withdrawal.rider_id,
      city_id: withdrawal.city_id ?? rider?.city_id ?? null,
      status,
      amount,
    });
  } catch (err) {
    logger.error(`withdrawalPayout: admin socket notify failed for withdrawal ${withdrawal.id}:`, err);
  }
}

// In-app notification row + FCM push. Never throws.
async function notifyDriver(rider, title, msg, amount, type) {
  if (!rider) return;
  try {
    await prisma.tbl_rnoti.create({
      data: { rid: rider.id, title, msg, type: "payout", date: new Date() },
    });
  } catch (err) {
    logger.error(`withdrawalPayout: tbl_rnoti insert failed for rider ${rider.id}:`, err);
  }
  if (rider.fcm_token) {
    try {
      await pushNotifier.notifyDriverWalletTransaction(rider.fcm_token, type, rupees(amount), msg);
    } catch (err) {
      logger.error(`withdrawalPayout: push notify failed for rider ${rider.id}:`, err);
    }
  }
}

// Must be called inside the transaction that made the status change.
async function refund(tx, withdrawal, amount, remark) {
  await tx.tbl_rider.update({
    where: { id: withdrawal.rider_id },
    data: { wallet_balance: { increment: amount } },
  });
  await tx.tbl_wallet_history.create({
    data: {
      user_id: withdrawal.rider_id,
      amount,
      type: "credit",
      remark,
      wallet_type: "driver",
      created_at: istNow(),
    },
  });
}

/**
 * Atomically claim a pending request (pending -> processing) and debit the
 * driver's wallet. Low balance rolls the claim back too.
 */
async function claimAndDebit(withdrawalId) {
  try {
    const withdrawal = await prisma.$transaction(async (tx) => {
      const claim = await tx.driver_withdraw_requests.updateMany({
        where: { id: withdrawalId, status: "pending" },
        data: { status: "processing", payout_started_at: new Date(), failure_reason: null },
      });
      if (claim.count !== 1) throw new Rollback("not_pending");

      const row = await tx.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
      const amount = Number(row.amount);

      const debit = await tx.tbl_rider.updateMany({
        where: { id: row.rider_id, wallet_balance: { gte: amount } },
        data: { wallet_balance: { decrement: amount } },
      });
      if (debit.count !== 1) throw new Rollback("low_balance");

      let remark = `Payout initiated (withdrawal #${withdrawalId})`;
      if (row.payout_detail) remark += ` via ${row.payout_detail}`;
      await tx.tbl_wallet_history.create({
        data: {
          user_id: row.rider_id,
          amount,
          type: "debit",
          remark,
          wallet_type: "driver",
          created_at: istNow(),
        },
      });
      return row;
    });
    return { ok: true, withdrawal };
  } catch (err) {
    if (err instanceof Rollback) return { ok: false, reason: err.reason };
    throw err;
  }
}

/**
 * Nothing was sent (definitive refusal): processing -> pending with the
 * reason, and refund the debit. Returns false (no refund) if the request was
 * not processing.
 */
async function revertToPending(withdrawalId, reason) {
  let withdrawal;
  let amount;
  try {
    await prisma.$transaction(async (tx) => {
      const moved = await tx.driver_withdraw_requests.updateMany({
        where: { id: withdrawalId, status: "processing" },
        data: { status: "pending", failure_reason: clip(reason, 255) },
      });
      if (moved.count !== 1) throw new Rollback("not_processing");

      withdrawal = await tx.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
      amount = Number(withdrawal.amount);
      await refund(tx, withdrawal, amount, `Payout not sent — returned (withdrawal #${withdrawalId})`);
    });
  } catch (err) {
    if (err instanceof Rollback) return false;
    throw err;
  }

  const rider = await findRider(withdrawal.rider_id);
  notifyAdmin(withdrawal, rider, "pending", amount);
  return true;
}

/**
 * Apply a RazorpayX payout status (webhook or status sync) to a request.
 */
async function applyPayoutState({ withdrawalId, payoutId, status, utr, failureReason }) {
  const isPaid = status === "processed";
  const isFailed = FAILED_STATES.has(status);
  if (!isPaid && !isFailed) return "ignored";

  const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal) return "ignored";
  const amount = Number(withdrawal.amount);

  if (isPaid) {
    if (withdrawal.status !== "processing") return "ignored";
    const data = { status: "paid", utr: clip(utr, 64), payout_processed_at: new Date() };
    if (payoutId) data.razorpay_payout_id = payoutId;
    const moved = await prisma.driver_withdraw_requests.updateMany({
      where: { id: withdrawalId, status: "processing" },
      data,
    });
    if (moved.count !== 1) return "ignored";

    const rider = await findRider(withdrawal.rider_id);
    await notifyDriver(
      rider,
      "Payout sent",
      `Your withdrawal of ${rupees(amount)} has been sent${utr ? ` (UTR ${utr})` : ""}.`,
      amount,
      "debit"
    );
    notifyAdmin(withdrawal, rider, "paid", amount);
    return "paid";
  }

  if (withdrawal.status !== "processing" && withdrawal.status !== "paid") return "ignored";
  try {
    await prisma.$transaction(async (tx) => {
      const data = { status: "failed", failure_reason: clip(failureReason || `Payout ${status}`, 255) };
      if (payoutId) data.razorpay_payout_id = payoutId;
      const moved = await tx.driver_withdraw_requests.updateMany({
        where: { id: withdrawalId, status: { in: ["processing", "paid"] } },
        data,
      });
      // Count decides who owns the refund: a repeat or a racing caller gets 0.
      if (moved.count !== 1) throw new Rollback("already_handled");
      await refund(tx, withdrawal, amount, `Payout failed — returned (withdrawal #${withdrawalId})`);
    });
  } catch (err) {
    if (err instanceof Rollback) return "ignored";
    throw err;
  }

  const rider = await findRider(withdrawal.rider_id);
  await notifyDriver(
    rider,
    "Payout failed",
    `Payout failed — ${rupees(amount)} returned to your ledger.`,
    amount,
    "credit"
  );
  notifyAdmin(withdrawal, rider, "failed", amount);
  return "failed";
}

module.exports = { claimAndDebit, revertToPending, applyPayoutState };

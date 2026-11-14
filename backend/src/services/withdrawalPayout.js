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
const razorpayx = require("../utils/razorpayx");

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

  // An event for a different payout than the one stored (e.g. a late event
  // for an earlier attempt after revert + re-approve) must never touch this
  // request. With no stored id yet the event's id is adopted (the webhook can
  // beat approve storing it); a stored id is never overwritten. The guarded
  // updateMany also matches on the id so a concurrent change can't slip in.
  const storedPayoutId = withdrawal.razorpay_payout_id ?? null;
  if (storedPayoutId && payoutId && payoutId !== storedPayoutId) return "ignored";
  const payoutIdWhere = { razorpay_payout_id: storedPayoutId };
  const payoutIdData = !storedPayoutId && payoutId ? { razorpay_payout_id: payoutId } : {};

  if (isPaid) {
    if (withdrawal.status !== "processing") return "ignored";
    const data = { status: "paid", utr: clip(utr, 64), payout_processed_at: new Date(), ...payoutIdData };
    const moved = await prisma.driver_withdraw_requests.updateMany({
      where: { id: withdrawalId, status: "processing", ...payoutIdWhere },
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
      const data = { status: "failed", failure_reason: clip(failureReason || `Payout ${status}`, 255), ...payoutIdData };
      const moved = await tx.driver_withdraw_requests.updateMany({
        where: { id: withdrawalId, status: { in: ["processing", "paid"] }, ...payoutIdWhere },
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

const NO_METHOD_MESSAGE = "no payout method on this request — reject and ask the driver to request again";
const MISMATCH_MESSAGE = "Driver changed payout details after requesting — reject and ask them to request again.";

/**
 * Where the money would go, checked against the snapshot the driver picked at
 * request time (payout_detail). Read-only: no writes, no Razorpay calls, so
 * the approve controller can run it before claiming/debiting.
 */
async function resolveDestination(withdrawal, rider) {
  if (!withdrawal || !withdrawal.payout_method) return { ok: false, message: NO_METHOD_MESSAGE };
  if (!rider) return { ok: false, message: MISMATCH_MESSAGE };

  if (withdrawal.payout_method === "upi") {
    const upiId = rider.upi_id ? String(rider.upi_id) : "";
    if (!upiId || withdrawal.payout_detail !== `UPI (${upiId})`) return { ok: false, message: MISMATCH_MESSAGE };
    return { ok: true, method: "upi", upiId };
  }

  if (withdrawal.payout_method === "bank") {
    const match = /\(•••(\d+)\)\s*$/.exec(withdrawal.payout_detail || "");
    const bank = await prisma.tbl_bank_account.findFirst({ where: { rider_id: rider.id } });
    const accountNumber = bank?.iban_num ? String(bank.iban_num) : "";
    if (!match || !accountNumber || accountNumber.slice(-4) !== match[1]) {
      return { ok: false, message: MISMATCH_MESSAGE };
    }
    return { ok: true, method: "bank", accountName: bank.a_name, accountNumber, ifsc: bank.ifsc_code };
  }

  return { ok: false, message: NO_METHOD_MESSAGE };
}

function contactName(rider) {
  const full = rider.full_name ? String(rider.full_name).trim() : "";
  if (full) return full;
  const parts = [rider.first_name, rider.last_name].map((p) => (p ? String(p).trim() : "")).filter(Boolean);
  if (parts.length) return parts.join(" ");
  return `Driver #${rider.id}`;
}

// Only a Razorpay result with ok:false + definitive:true proves nothing was
// sent, so only that refunds. Anything else leaves the request processing.
async function handleFailure(withdrawalId, result) {
  if (result.definitive === true) {
    const reverted = await revertToPending(withdrawalId, result.reason);
    if (reverted) return { outcome: "refused", reason: result.reason };
    return { outcome: "unknown", reason: "request is no longer processing" };
  }
  return { outcome: "unknown", reason: result.reason };
}

/**
 * Send the payout for a request that is already processing (claimed and
 * debited). Safe to repeat: the payout uses reference/idempotency key
 * "wd-<id>", and stored ids are only ever written when still null.
 */
async function submitPayout(withdrawalId) {
  const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal || withdrawal.status !== "processing") {
    return { outcome: "unknown", reason: "request is not processing" };
  }
  const rider = await prisma.tbl_rider.findUnique({ where: { id: withdrawal.rider_id } });
  if (!rider) {
    logger.error(`withdrawalPayout: rider ${withdrawal.rider_id} not found for withdrawal ${withdrawalId}`);
    return { outcome: "unknown", reason: "driver not found" };
  }

  const dest = await resolveDestination(withdrawal, rider);
  if (!dest.ok) {
    const reverted = await revertToPending(withdrawalId, dest.message);
    if (reverted) return { outcome: "refused", reason: dest.message };
    return { outcome: "unknown", reason: "request is no longer processing" };
  }

  let fundAccountId = withdrawal.razorpay_fund_account_id;
  if (!fundAccountId) {
    let contactId = rider.razorpay_contact_id;
    if (!contactId) {
      const contact = await razorpayx.createContact({
        name: contactName(rider),
        mobile: rider.fmobile,
        referenceId: `rider-${rider.id}`,
      });
      if (!contact.ok) return handleFailure(withdrawalId, contact);
      contactId = contact.id;
      await prisma.tbl_rider.updateMany({
        where: { id: rider.id, razorpay_contact_id: null },
        data: { razorpay_contact_id: contactId },
      });
    }

    const { ok: _ok, ...destination } = dest;
    const fundAccount = await razorpayx.createFundAccount({ contactId, ...destination });
    if (!fundAccount.ok) return handleFailure(withdrawalId, fundAccount);
    fundAccountId = fundAccount.id;
    const stored = await prisma.driver_withdraw_requests.updateMany({
      where: { id: withdrawalId, razorpay_fund_account_id: null },
      data: { razorpay_fund_account_id: fundAccountId },
    });
    if (stored.count !== 1) {
      // A concurrent submit stored one first: use it, so both calls send the
      // same payout body under the same idempotency key.
      const fresh = await prisma.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
      if (fresh?.razorpay_fund_account_id) fundAccountId = fresh.razorpay_fund_account_id;
    }
  }

  const payout = await razorpayx.createPayout({
    fundAccountId,
    amountRupees: Number(withdrawal.amount),
    method: dest.method,
    referenceId: `wd-${withdrawalId}`,
  });
  if (!payout.ok) return handleFailure(withdrawalId, payout);

  const stored = await prisma.driver_withdraw_requests.updateMany({
    where: { id: withdrawalId, razorpay_payout_id: null },
    data: { razorpay_payout_id: payout.id },
  });
  if (stored.count !== 1) {
    const fresh = await prisma.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
    const storedId = fresh?.razorpay_payout_id ?? null;
    if (storedId && storedId !== payout.id) {
      logger.error(
        `withdrawalPayout: withdrawal ${withdrawalId} already has payout ${storedId}; RazorpayX returned ${payout.id} — kept the stored id`
      );
    }
  }

  await applyPayoutState({ withdrawalId, payoutId: payout.id, status: payout.status, utr: payout.utr });
  return { outcome: "accepted" };
}

function currentState(withdrawal) {
  if (withdrawal?.status === "paid") return "paid";
  if (withdrawal?.status === "failed") return "failed";
  if (withdrawal?.status === "processing") return "processing";
  return "refused";
}

/**
 * Resolve a processing request against RazorpayX (admin "Check status" and
 * the sweeper). A failed fetch never refunds or reverts, even on a 404.
 */
async function syncWithdrawal(withdrawalId) {
  const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
  if (!withdrawal || withdrawal.status !== "processing") return currentState(withdrawal);

  if (withdrawal.razorpay_payout_id) {
    const payout = await razorpayx.fetchPayout(withdrawal.razorpay_payout_id);
    if (!payout.ok) {
      logger.error(
        `withdrawalPayout: fetchPayout ${withdrawal.razorpay_payout_id} for withdrawal ${withdrawalId} failed (${payout.reason}); left processing`
      );
      return "processing";
    }
    const applied = await applyPayoutState({
      withdrawalId,
      payoutId: payout.id,
      status: payout.status,
      utr: payout.utr,
      failureReason: payout.failureReason,
    });
    return applied === "paid" || applied === "failed" ? applied : "processing";
  }

  const result = await submitPayout(withdrawalId);
  if (result.outcome === "refused") return "refused";
  if (result.outcome === "unknown") return "processing";
  const fresh = await prisma.driver_withdraw_requests.findUnique({ where: { id: withdrawalId } });
  return currentState(fresh);
}

/**
 * Re-sync requests stuck in processing (missed webhook, crash between debit
 * and the Razorpay call, unknown outcome). Returns how many rows it looked at.
 */
async function sweepStuckPayouts(olderThanMs = 15 * 60 * 1000) {
  if (!razorpayx.isConfigured()) return 0;
  const cutoff = new Date(Date.now() - olderThanMs);
  const rows = await prisma.driver_withdraw_requests.findMany({
    where: { status: "processing", payout_started_at: { lt: cutoff } },
    select: { id: true },
    orderBy: { payout_started_at: "asc" },
    take: 20,
  });
  for (const row of rows) {
    try {
      await syncWithdrawal(row.id);
    } catch (err) {
      logger.error(`withdrawalPayout: sweep of withdrawal ${row.id} failed:`, err);
    }
  }
  return rows.length;
}

module.exports = {
  claimAndDebit,
  revertToPending,
  applyPayoutState,
  resolveDestination,
  submitPayout,
  syncWithdrawal,
  sweepStuckPayouts,
};

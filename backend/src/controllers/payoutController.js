const prisma = require("../config/db");
const adminSocket = require("../sockets/adminSocket");
const pushNotifier = require("../services/pushNotifier");
const logger = require("../utils/logger");
const razorpayx = require("../utils/razorpayx");
const payoutService = require("../services/withdrawalPayout");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function riderName(r) {
  return r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;
}

const FORBIDDEN_MESSAGE = "Forbidden: withdrawal request is outside your assigned city";

// Non-superadmin admins may only act on requests in their own city. Legacy
// rows without city_id fall back to the rider's city.
function cityScope(req, withdrawal, rider) {
  const cityId = withdrawal.city_id ?? rider?.city_id ?? null;
  const forbidden = req.user.role !== "superadmin" && cityId !== parseInt(req.user.city_id, 10);
  return { cityId, forbidden };
}

async function list(req, res) {
  try {
    const where = {};
    if (req.query.status) where.status = req.query.status;

    const rows = await prisma.driver_withdraw_requests.findMany({ where, orderBy: { id: "desc" } });

    const riderIds = [...new Set(rows.map((w) => w.rider_id).filter(Boolean))];
    const riders = await prisma.tbl_rider.findMany({ where: { id: { in: riderIds } } });
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const bankAccounts = await prisma.tbl_bank_account.findMany({ where: { rider_id: { in: riderIds } } });
    const bankByRiderId = Object.fromEntries(bankAccounts.map((b) => [b.rider_id, b]));

    // A handful of legacy rows never got city_id set — fall back to the
    // rider's own city so scoping still works for them.
    const scoped = rows.filter((w) => {
      if (!req.scopedCityId) return true;
      const cityId = w.city_id ?? riderById[w.rider_id]?.city_id ?? null;
      return cityId === req.scopedCityId;
    });

    const data = scoped.map((w) => {
      const rider = riderById[w.rider_id];
      const bank = bankByRiderId[w.rider_id];
      return {
        id: w.id,
        rider_id: w.rider_id,
        rider_name: rider ? riderName(rider) : null,
        rider_mobile: rider ? rider.fmobile : null,
        amount: w.amount,
        // payout_method/payout_detail are the snapshot taken at request time
        // (customerWalletController.withdrawWallet) - what the driver
        // actually chose, which can differ from their current saved
        // bank_account below if they've since changed it. Prefer the
        // snapshot; fall back to the current saved account for older rows
        // created before this column existed.
        payout_method: w.payout_method,
        payout_detail: w.payout_detail,
        bank_account: bank
          ? { bank_name: bank.bank_name, account_no: bank.iban_num, ifsc: bank.ifsc_code }
          : null,
        status: w.status,
        utr: w.utr ?? null,
        failure_reason: w.failure_reason ?? null,
        razorpay_payout_id: w.razorpay_payout_id ?? null,
        created_at: w.created_at,
      };
    });

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "payouts.list");
  }
}

// Driver-facing "Payout approved" entry plus a best-effort push. Never throws:
// money has already moved, so a notification failure must not change the
// HTTP result.
async function notifyPayoutApproved(rider, amount) {
  try {
    await prisma.tbl_rnoti.create({
      data: {
        rid: rider.id,
        title: "Payout approved",
        msg: `Your withdrawal of ${amount} is on its way to your account.`,
        type: "payout",
        date: new Date(),
      },
    });
  } catch (err) {
    logger.error(`payouts.approve: tbl_rnoti insert failed for rider ${rider.id}:`, err);
  }
  if (rider.fcm_token) {
    try {
      await pushNotifier.notifyDriverWalletTransaction(
        rider.fcm_token,
        "debit",
        `₹${amount.toFixed(2)}`,
        "Payout approved — on its way to your account"
      );
    } catch (err) {
      logger.error(`payouts.approve: wallet push notify failed for rider ${rider.id}:`, err);
    }
  }
}

async function approve(req, res) {
  try {
    const id = parseInt(req.params.id, 10);

    const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id } });
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: "Withdrawal request not found" });
    }
    if (withdrawal.status !== "pending") {
      return res.status(409).json({ success: false, message: `Withdrawal request is already ${withdrawal.status}` });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: withdrawal.rider_id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver for this withdrawal request no longer exists" });
    }
    const { cityId, forbidden } = cityScope(req, withdrawal, rider);
    if (forbidden) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }

    if (!razorpayx.isConfigured()) {
      return res.status(503).json({ success: false, message: "RazorpayX payouts are not configured." });
    }

    // Read-only check, so a mismatch is refused before anything is claimed.
    const destination = await payoutService.resolveDestination(withdrawal, rider);
    if (!destination.ok) {
      return res.status(409).json({ success: false, message: destination.message });
    }

    const claim = await payoutService.claimAndDebit(id);
    if (!claim.ok) {
      const message =
        claim.reason === "low_balance"
          ? "Driver's wallet balance is lower than the requested amount"
          : "Withdrawal request is already being processed";
      return res.status(409).json({ success: false, message });
    }

    const result = await payoutService.submitPayout(id);
    if (result.outcome === "refused") {
      // revertToPending has already refunded and notified the admin socket.
      return res.status(422).json({ success: false, message: result.reason });
    }

    const amount = Number(withdrawal.amount);
    try {
      adminSocket.notifyPayoutUpdate({ id, rider_id: rider.id, city_id: cityId, status: "processing", amount });
    } catch (err) {
      logger.error(`payouts.approve: admin socket notify failed for withdrawal ${id}:`, err);
    }

    if (result.outcome === "accepted") {
      await notifyPayoutApproved(rider, amount);
      return res.status(200).json({ success: true, status: "processing", message: "Payout sent to RazorpayX" });
    }
    return res
      .status(202)
      .json({ success: true, status: "processing", message: "Payout submitted; confirmation pending" });
  } catch (err) {
    return internalError(res, err, `payouts.approve (withdrawal #${req.params.id})`);
  }
}

async function sync(req, res) {
  try {
    const id = parseInt(req.params.id, 10);

    const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id } });
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: "Withdrawal request not found" });
    }
    const rider = await prisma.tbl_rider.findUnique({ where: { id: withdrawal.rider_id } });
    if (cityScope(req, withdrawal, rider).forbidden) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }
    // syncWithdrawal reports a misleading "refused" for non-processing rows.
    if (withdrawal.status !== "processing") {
      return res.status(409).json({ success: false, message: "Only processing payouts can be checked" });
    }

    const status = await payoutService.syncWithdrawal(id);
    return res.status(200).json({ success: true, status });
  } catch (err) {
    return internalError(res, err, "payouts.sync");
  }
}

async function reject(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { rejection_reason } = req.body;

    const withdrawal = await prisma.driver_withdraw_requests.findUnique({ where: { id } });
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: "Withdrawal request not found" });
    }
    if (withdrawal.status !== "pending") {
      return res.status(409).json({ success: false, message: `Withdrawal request is already ${withdrawal.status}` });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: withdrawal.rider_id } });
    const { cityId, forbidden } = cityScope(req, withdrawal, rider);
    if (forbidden) {
      return res.status(403).json({ success: false, message: FORBIDDEN_MESSAGE });
    }

    // Guarded on status: an approve may have claimed the request since the
    // read above, and rejecting a processing payout would orphan it.
    const moved = await prisma.driver_withdraw_requests.updateMany({
      where: { id, status: "pending" },
      data: { status: "rejected" },
    });
    if (moved.count !== 1) {
      return res.status(409).json({ success: false, message: "Withdrawal request is no longer pending" });
    }

    if (rider) {
      await prisma.tbl_rnoti.create({
        data: {
          rid: rider.id,
          title: "Payout rejected",
          msg: `Your withdrawal request was rejected${rejection_reason ? `: ${rejection_reason}` : "."}`,
          type: "payout",
          date: new Date(),
        },
      });
    }

    adminSocket.notifyPayoutUpdate({
      id,
      rider_id: withdrawal.rider_id,
      city_id: cityId,
      status: "rejected",
      amount: withdrawal.amount,
    });

    return res.status(200).json({ success: true, message: "Withdrawal request rejected" });
  } catch (err) {
    return internalError(res, err, "payouts.reject");
  }
}

module.exports = { list, approve, sync, reject };

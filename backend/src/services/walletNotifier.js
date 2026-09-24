const prisma = require("../config/db");
const logger = require("../utils/logger");
const pushNotifier = require("./pushNotifier");

// Every driver-wallet ledger write (commission debit, cancellation
// compensation, payout approval, ...) should reach the driver both as an
// in-app notification (tbl_rnoti, what driverContentController.notificationList
// serves) and as a real push so it's seen even with the app backgrounded -
// previously nothing notified the driver of ANY wallet_history row at all,
// including a fully-approved payout. Called after the DB write that changed
// the ledger has committed, never from inside that transaction - this does
// its own separate I/O (an FCM call) that must not hold a DB transaction
// open, and a failure here must never undo or block the wallet change that
// already happened.
async function notifyDriverWalletTransaction(riderId, { type, amount, remark }) {
  try {
    const amountText = `₹${Number(amount).toFixed(2)}`;
    const isCredit = type === "credit";
    const title = isCredit ? "Wallet credited" : "Wallet debited";
    const msg = `${isCredit ? "+" : "-"}${amountText}${remark ? ` — ${remark}` : ""}`;

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { fcm_token: true } });

    await prisma.tbl_rnoti.create({
      data: { rid: riderId, title, msg, type: "wallet", date: new Date() },
    });

    if (rider?.fcm_token) {
      await pushNotifier.notifyDriverWalletTransaction(rider.fcm_token, type, amountText, remark);
    }
  } catch (err) {
    logger.error(`walletNotifier.notifyDriverWalletTransaction failed for rider ${riderId}:`, err);
  }
}

module.exports = { notifyDriverWalletTransaction };

const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const { sendPushNotification } = require("../config/firebase");
const walletNotifier = require("./walletNotifier");

// Paying an order's advance straight from the customer's Shifter wallet.
//
// The Razorpay path (orderController.advancePayment) credits the advance INTO the wallet and
// tripLifecycle debits it back out at completion, so "advance paid" always means "the money is in the
// wallet". Here the money is already the customer's own wallet balance, so it is debited at once under
// the same `advance_apply:<order>` ledger key tripLifecycle uses - completion then sees it as already
// applied and does not debit it twice (and returns any surplus, see tripLifecycle).
//
// Because the debit happens up front, every cancel path must give it back (refundWalletAdvanceIfAny),
// exactly like the Razorpay path leaves the credited advance with the customer on a cancel.

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const applyKey = (orderId) => `advance_apply:${orderId}`;
const refundKey = (orderId) => `advance_wallet_refund:${orderId}`;

/**
 * Atomically pays the order's advance from the customer's wallet when the balance covers it in full.
 * Never partial: a short wallet changes nothing (code "402") and the app shows the normal payment screen.
 */
async function payAdvanceFromWallet(orderId, { uid } = {}) {
  const result = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`SELECT id, uid, rid, advance_payment, payment_status, o_status, order_status FROM pkg_order WHERE id = ${orderId} FOR UPDATE`;
    const order = rows[0];
    if (!order) return { code: "401", msg: "Order Not Found" };
    if (uid && Number(order.uid) !== Number(uid)) return { code: "401", msg: "This order belongs to another customer." };
    if (order.o_status === "Cancelled" || Number(order.order_status) === 4) return { code: "401", msg: "Order is already cancelled." };
    if (Number(order.payment_status) === 1) return { code: "401", msg: "Order Already Paid" };
    const due = Math.round(Number(order.advance_payment) || 0);
    if (due <= 0) return { code: "401", msg: "No advance payment due." };

    // Receiver-pays orders keep the advance as a deposit that stays in the booker's wallet (it is only
    // debited if the receiver ends up not paying) - they go through the normal advance payment screen.
    const receiverRow = await tx.order_receiver_pay.findFirst({ where: { order_id: orderId, status: "active" } });
    if (receiverRow) return { code: "402", msg: "Receiver-paid order: pay the advance from the payment screen." };

    const user = await tx.tbl_user.findUnique({ where: { id: Number(order.uid) }, select: { id: true, mobile: true, wallet: true } });
    if (!user) return { code: "401", msg: "User Not Found" };
    if (Number(user.wallet) < due) return { code: "402", msg: "Wallet balance is lower than the advance payment." };

    // Guarded decrement: a concurrent spend between the read above and here can never overdraw the wallet.
    const debited = await tx.tbl_user.updateMany({ where: { id: user.id, wallet: { gte: due } }, data: { wallet: { decrement: due } } });
    if (debited.count === 0) return { code: "402", msg: "Wallet balance is lower than the advance payment." };

    const remark = `Advance payment for order #${orderId} (paid from wallet)`;
    await tx.tbl_wallet_history.create({
      data: {
        user_id: user.id,
        mobile: String(user.mobile ?? ""),
        amount: due,
        type: "debit",
        remark,
        payment_id: applyKey(orderId),
        wallet_type: "user",
        order_id: orderId,
        created_at: istNow(),
      },
    });
    await tx.pkg_order.update({ where: { id: orderId }, data: { payment_status: 1 } });
    return { code: "200", due, remark, riderId: Number(order.rid) || 0, uid: user.id };
  });

  if (result.code !== "200") return result;

  // Best-effort notifications after commit: a push failure must never undo a paid advance.
  walletNotifier
    .notifyCustomerWalletTransaction(result.uid, { type: "debit", amount: result.due, remark: result.remark })
    .catch((err) => logger.error(`payAdvanceFromWallet: wallet notify failed for user ${result.uid}:`, err));
  if (result.riderId) {
    try {
      const rider = await prisma.tbl_rider.findUnique({ where: { id: result.riderId }, select: { fcm_token: true } });
      if (rider?.fcm_token) {
        await sendPushNotification(
          rider.fcm_token,
          "Advance Payment Received",
          `Customer has paid advance payment of ₹${result.due} for order #${orderId}`,
          { type: "advance_payment", order_id: String(orderId) }
        );
      }
    } catch (err) {
      logger.error(`payAdvanceFromWallet: driver notify failed for order ${orderId}:`, err);
    }
  }
  return result;
}

/**
 * Called from every cancel path: gives back an advance that payAdvanceFromWallet already debited (the
 * Razorpay path needs nothing - its credited advance never left the wallet). A no-op when the order had
 * no wallet-paid advance, idempotent per order, and never throws into the cancel flow.
 * `client` is the Prisma client or the caller's transaction.
 */
async function refundWalletAdvanceIfAny(orderId, client = prisma) {
  try {
    const debit = await client.tbl_wallet_history.findFirst({
      where: { payment_id: applyKey(orderId), type: "debit", wallet_type: "user" },
    });
    if (!debit) return 0;
    const already = await client.tbl_wallet_history.findFirst({
      where: { payment_id: refundKey(orderId), type: "credit", wallet_type: "user" },
    });
    if (already) return 0;
    const amount = round2(debit.amount);
    if (!(amount > 0)) return 0;
    await client.tbl_user.update({ where: { id: Number(debit.user_id) }, data: { wallet: { increment: amount } } });
    await client.tbl_wallet_history.create({
      data: {
        user_id: Number(debit.user_id),
        mobile: debit.mobile ?? null,
        amount,
        type: "credit",
        remark: `Advance payment refunded - order #${orderId} was cancelled`,
        payment_id: refundKey(orderId),
        wallet_type: "user",
        order_id: Number(orderId),
        created_at: istNow(),
      },
    });
    return amount;
  } catch (err) {
    logger.error(`refundWalletAdvanceIfAny: refund failed for order ${orderId}:`, err);
    return 0;
  }
}

module.exports = { payAdvanceFromWallet, refundWalletAdvanceIfAny, applyKey };

const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");

// A wallet-paid booking is charged up front: the customer app calls
// POST /wallet/withdraw (remark "Delivery payment") and only then creates the
// order. Nothing ever gave that money back when the order didn't happen
// (no driver found, customer/driver/admin cancel, OTP no-show), so customers
// lost the fare for a ride that never took place.
//
// linkWalletPrepayment() ties that debit to the order at creation time (the
// withdraw row carries no order id), and refundWalletPrepayment() returns it -
// minus any cancellation charge - from every cancel path.

const PREPAY_REMARK = "Delivery payment";
const LINK_WINDOW_MS = 15 * 60 * 1000; // the debit happens just before the order is created

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function isWalletPaidOrder(order) {
  if (!order) return false;
  return Number(order.p_method_id) === -2 || String(order.trans_id || "").toLowerCase().startsWith("wallet");
}

async function linkWalletPrepayment({ uid, orderId, client = prisma }) {
  // tbl_wallet_history.created_at is IST wall-clock (see utils/istTime)
  const since = new Date(istNow().getTime() - LINK_WINDOW_MS);
  const row = await client.tbl_wallet_history.findFirst({
    where: { user_id: Number(uid), wallet_type: "user", type: "debit", remark: PREPAY_REMARK, order_id: null, created_at: { gte: since } },
    orderBy: { id: "desc" },
  });
  if (!row) return null;
  const linked = await client.tbl_wallet_history.updateMany({ where: { id: row.id, order_id: null }, data: { order_id: Number(orderId) } });
  return linked.count ? row : null;
}

/**
 * Credits the order's linked wallet payment back to the customer, keeping
 * `deduct` (a cancellation charge) off the top. Idempotent per order (guarded
 * by a unique payment_id key under a row lock), so retried / concurrent
 * cancels can never refund twice.
 *
 * Returns { refunded, paid } (or { refunded: 0, alreadyRefunded: true }).
 */
async function refundWalletPrepayment(orderId, { deduct = 0, note = "" } = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM pkg_order WHERE id = ${Number(orderId)} FOR UPDATE`;
    const order = await tx.pkg_order.findUnique({ where: { id: Number(orderId) }, select: { uid: true } });
    if (!order) return { refunded: 0, paid: 0 };

    const refundKey = `wallet_prepay_refund:${orderId}`;
    const already = await tx.tbl_wallet_history.findFirst({ where: { payment_id: refundKey, type: "credit", wallet_type: "user" } });
    if (already) return { refunded: 0, alreadyRefunded: true };

    const rows = await tx.tbl_wallet_history.findMany({
      where: { order_id: Number(orderId), wallet_type: "user", type: "debit", remark: PREPAY_REMARK },
    });
    const paid = round2(rows.reduce((sum, r) => sum + Number(r.amount || 0), 0));
    if (paid <= 0) return { refunded: 0, paid: 0 };

    const charge = Math.max(0, Number(deduct) || 0);
    const refund = round2(Math.max(0, paid - charge));
    if (refund <= 0) return { refunded: 0, paid };

    await tx.tbl_user.update({ where: { id: order.uid }, data: { wallet: { increment: refund } } });
    await tx.tbl_wallet_history.create({
      data: {
        user_id: order.uid,
        amount: refund,
        type: "credit",
        remark: `Refund for cancelled order #${orderId}${charge > 0 ? ` (₹${round2(charge)} cancellation charge applied)` : ""}${note ? ` - ${note}` : ""}`,
        wallet_type: "user",
        order_id: Number(orderId),
        payment_id: refundKey,
        created_at: istNow(),
      },
    });
    return { refunded: refund, paid };
  });
}

/**
 * What every cancel path calls: a no-op for cash/online orders (no DB touch),
 * and never throws into the cancel flow - a refund problem is logged for
 * follow-up, it must not leave the order half-cancelled.
 */
async function refundIfWalletPaid(order, options = {}) {
  if (!isWalletPaidOrder(order)) return null;
  try {
    return await refundWalletPrepayment(order.id, options);
  } catch (err) {
    logger.error(`refundIfWalletPaid: refund failed for order ${order?.id}:`, err);
    return null;
  }
}

module.exports = { isWalletPaidOrder, linkWalletPrepayment, refundWalletPrepayment, refundIfWalletPaid };

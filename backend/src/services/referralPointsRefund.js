const prisma = require("../config/db");
const logger = require("../utils/logger");

/**
 * Gives back referral points a customer spent on an order (booking-time ride
 * discount and/or paying the advance with points - both land in
 * pkg_order.referral_points_used) when that order is cancelled before it was
 * completed. Idempotent: the points column is zeroed atomically first, so a
 * repeated or concurrent cancel can never refund twice.
 *
 * Takes only the order id and reads the order itself, so every cancel path
 * (customer, driver, admin, no driver found, OTP no-show, advance timeout)
 * can call it the same way. Never throws into the cancel flow.
 */
async function refundReferralPointsForOrder(orderId, client = prisma) {
  try {
    const order = await client.pkg_order.findUnique({
      where: { id: Number(orderId) },
      select: { uid: true, referral_points_used: true },
    });
    const pointsUsed = Number(order?.referral_points_used) || 0;
    if (!order || pointsUsed <= 0) return 0;

    const claimed = await client.pkg_order.updateMany({
      where: { id: Number(orderId), referral_points_used: { gt: 0 } },
      data: { referral_points_used: 0, referral_points_amount: 0 },
    });
    if (claimed.count === 0) return 0;

    const updatedUser = await client.tbl_user.update({
      where: { id: Number(order.uid) },
      data: { referral_points: { increment: pointsUsed } },
    });
    await client.tbl_referral_point_log.create({
      data: {
        user_id: Number(order.uid),
        user_type: "USER",
        points: pointsUsed,
        txn_type: "credit",
        source: "ride_discount_refund",
        balance_after: updatedUser.referral_points || 0,
        note: `Refunded - order #${orderId} was cancelled`,
        created_at: new Date(),
      },
    });
    return pointsUsed;
  } catch (err) {
    logger.error(`refundReferralPointsForOrder: failed for order ${orderId}:`, err);
    return 0;
  }
}

module.exports = { refundReferralPointsForOrder };

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

/**
 * Re-applies the admin's ride-discount cap (tbl_referral_setting.
 * ride_discount_percent) after an order's fare CHANGED (early drop, drop /
 * pickup change, extra stop...). The cap is only enforced at booking
 * (orderController.createOrderCore) against the then-fare, so a trip that gets
 * re-priced lower kept all its redeemed points: order #468 booked at Rs652
 * redeemed 326 points (50%), was early-dropped to Rs170, and still consumed
 * all 326 - and the platform-absorbed "prepaid" amount then exceeded the fare
 * and was credited to the driver's wallet.
 *
 * Refunds only the points above the new cap back to the customer and lowers
 * pkg_order.referral_points_used/amount to match. Never raises points on a
 * fare increase. Idempotent: the order row is updated only while it still
 * holds the points value we read, so a repeat/concurrent call refunds nothing.
 * Skipped when the program is off or at 0% so an admin settings change alone
 * can never strip redemptions that were valid at booking. Never throws.
 *
 * Returns { refundedPoints, pointsUsed, pointsAmount } - the order's redeemed
 * points/rupees AFTER reconciliation.
 */
async function reconcileRideDiscountToFare(orderId, newFare, client = prisma) {
  const none = { refundedPoints: 0, pointsUsed: 0, pointsAmount: 0 };
  try {
    const order = await client.pkg_order.findUnique({
      where: { id: Number(orderId) },
      select: { uid: true, referral_points_used: true, referral_points_amount: true, cou_amt: true },
    });
    const used = Number(order?.referral_points_used) || 0;
    if (!order || used <= 0) return none;
    const current = { refundedPoints: 0, pointsUsed: used, pointsAmount: Number(order.referral_points_amount) || 0 };

    const settings = await client.tbl_referral_setting.findFirst();
    const percent = Number(settings?.ride_discount_percent) || 0;
    if (!settings?.referral_enabled || percent <= 0) return current;

    const pointValue = Number(settings.point_value) > 0 ? Number(settings.point_value) : 1;
    const payable = Math.max(0, Number(newFare) - (Number(order.cou_amt) || 0));
    const cap = Math.floor((payable * percent) / 100 / pointValue);
    const excess = used - cap;
    if (excess <= 0) return current;

    const newAmount = Math.round(cap * pointValue * 100) / 100;
    const claimed = await client.pkg_order.updateMany({
      where: { id: Number(orderId), referral_points_used: used },
      data: { referral_points_used: cap, referral_points_amount: newAmount },
    });
    if (claimed.count === 0) return current;

    const updatedUser = await client.tbl_user.update({
      where: { id: Number(order.uid) },
      data: { referral_points: { increment: excess } },
    });
    await client.tbl_referral_point_log.create({
      data: {
        user_id: Number(order.uid),
        user_type: "USER",
        points: excess,
        txn_type: "credit",
        source: "ride_discount_refund",
        balance_after: updatedUser.referral_points || 0,
        note: `Refunded - order #${orderId} fare reduced to Rs${newFare}, points cap is now ${cap}`,
        created_at: new Date(),
      },
    });
    return { refundedPoints: excess, pointsUsed: cap, pointsAmount: newAmount };
  } catch (err) {
    logger.error(`reconcileRideDiscountToFare: failed for order ${orderId}:`, err);
    return none;
  }
}

module.exports = { refundReferralPointsForOrder, reconcileRideDiscountToFare };

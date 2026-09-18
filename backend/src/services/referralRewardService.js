const prisma = require("../config/db");
const logger = require("../utils/logger");

// tbl_referral gets a "pending" row at signup (customerAuthController.register
// / riderAuthController.registerHandler) recording who referred whom, but
// nothing ever moved it past "pending" or credited the referrer any points -
// referral_points_per_referral settings existed and adjustPoints let an admin
// manually credit someone, but no automatic trigger ever ran. This is that
// trigger: called from tripLifecycle's order-completion path for both the
// customer (uid) and driver (riderId) on every completed order, it checks
// whether either one has a pending referral tied to their FIRST-EVER
// completed order and, if so, credits the referrer.
//
// Reward amount is keyed off who was REFERRED (bringing in a new driver vs a
// new customer), matching tbl_referral_setting's column names
// (user_points_per_referral / driver_points_per_referral) - not who did the
// referring.

async function processReferralRewardsForCompletedOrder({ uid, riderId, orderId }) {
  await Promise.allSettled([
    creditReferralIfFirstOrder({ referredId: uid, referredType: "USER", orderId }),
    creditReferralIfFirstOrder({ referredId: riderId, referredType: "DRIVER", orderId }),
  ]);
}

async function creditReferralIfFirstOrder({ referredId, referredType, orderId }) {
  try {
    if (!referredId) return;

    const referral = await prisma.tbl_referral.findFirst({
      where: { referred_id: referredId, referred_type: referredType, status: "pending" },
    });
    if (!referral) return;

    // Only reward once this is the referred user/driver's first-ever
    // completed order - a referral row created after they'd already been
    // riding/ordering for a while (e.g. a late signup edge case) shouldn't
    // pay out on some later trip.
    const completedCount =
      referredType === "USER"
        ? await prisma.pkg_order.count({ where: { uid: referredId, o_status: "Completed" } })
        : await prisma.pkg_order.count({ where: { rid: referredId, o_status: "Completed" } });
    if (completedCount !== 1) return;

    const settings = await prisma.tbl_referral_setting.findFirst();
    if (!settings || !settings.referral_enabled) return;

    const pointsToAward = referredType === "DRIVER" ? settings.driver_points_per_referral : settings.user_points_per_referral;
    if (!pointsToAward || pointsToAward <= 0) return;

    // Atomic claim: only proceed if this row is still "pending" at the
    // moment of the update - guards against two near-simultaneous order
    // completions (e.g. the referred user's very first order completing
    // twice due to a retry) both trying to pay out the same referral.
    const claimed = await prisma.tbl_referral.updateMany({
      where: { id: referral.id, status: "pending" },
      data: { status: "completed", points_awarded: pointsToAward, verified_at: new Date(), ride_id: orderId || 0 },
    });
    if (claimed.count === 0) return; // another process already claimed it

    const referrerModel = referral.referrer_type === "DRIVER" ? prisma.tbl_rider : prisma.tbl_user;
    const referrer = await referrerModel.findUnique({ where: { id: referral.referrer_id } });
    if (!referrer) return;

    const balanceAfter = (referrer.referral_points || 0) + pointsToAward;
    await prisma.$transaction([
      referrerModel.update({ where: { id: referral.referrer_id }, data: { referral_points: balanceAfter } }),
      prisma.tbl_referral_point_log.create({
        data: {
          user_id: referral.referrer_id,
          user_type: referral.referrer_type,
          points: pointsToAward,
          txn_type: "credit",
          source: "referral_reward",
          ref_id: referral.id,
          balance_after: balanceAfter,
          note: `Referral reward: referred ${referredType.toLowerCase()} #${referredId} completed their first order (#${orderId})`,
          created_at: new Date(),
        },
      }),
    ]);
  } catch (err) {
    logger.error(`referralRewardService.creditReferralIfFirstOrder failed for referredId=${referredId} (${referredType}):`, err);
  }
}

module.exports = { processReferralRewardsForCompletedOrder };

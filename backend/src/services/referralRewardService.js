const prisma = require("../config/db");
const logger = require("../utils/logger");

/**
 * Process referral rewards for an order that just completed.
 * Triggered by tripLifecycle.updateStatus when order completes.
 */
async function processReferralRewardsForCompletedOrder({ uid, riderId, orderId }) {
  await Promise.allSettled([
    creditReferralIfCompletedOrder({ referredId: uid, referredType: "USER", orderId }),
    creditReferralIfCompletedOrder({ referredId: riderId, referredType: "DRIVER", orderId }),
  ]);
}

/**
 * Core reward awarding logic for a referral record.
 */
async function awardReferralReward({ referral, referredId, referredType, orderId }) {
  try {
    let settings = await prisma.tbl_referral_setting.findFirst();
    if (!settings) {
      settings = { referral_enabled: true, driver_points_per_referral: 100, user_points_per_referral: 100 };
    }
    if (!settings.referral_enabled) return 0;

    const pointsToAward = referredType === "DRIVER"
      ? (settings.driver_points_per_referral || 100)
      : (settings.user_points_per_referral || 100);

    if (!pointsToAward || pointsToAward <= 0) return 0;

    // Atomic claim: only proceed if this row is still "pending"
    const claimed = await prisma.tbl_referral.updateMany({
      where: { id: referral.id, status: "pending" },
      data: {
        status: "completed",
        points_awarded: pointsToAward,
        verified_at: new Date(),
        ride_id: Number(orderId) || 0,
      },
    });
    if (claimed.count === 0) return 0; // already claimed by another process

    const referrerModel = referral.referrer_type === "DRIVER" ? prisma.tbl_rider : prisma.tbl_user;
    const referrer = await referrerModel.findUnique({ where: { id: referral.referrer_id } });
    if (!referrer) return 0;

    const balanceAfter = (referrer.referral_points || 0) + pointsToAward;
    await prisma.$transaction([
      referrerModel.update({
        where: { id: referral.referrer_id },
        data: { referral_points: balanceAfter },
      }),
      prisma.tbl_referral_point_log.create({
        data: {
          user_id: referral.referrer_id,
          user_type: referral.referrer_type,
          points: pointsToAward,
          txn_type: "credit",
          source: "referral_reward",
          ref_id: referral.id,
          balance_after: balanceAfter,
          note: `Referral reward: referred ${referredType.toLowerCase()} #${referredId} completed ride (#${orderId || "first"})`,
          created_at: new Date(),
        },
      }),
    ]);

    logger.info(`Referral reward credited: ${pointsToAward} points to ${referral.referrer_type} #${referral.referrer_id} for referred ${referredType} #${referredId}`);
    return pointsToAward;
  } catch (err) {
    logger.error("awardReferralReward error:", err);
    return 0;
  }
}

/**
 * Checks and credits referral reward if the referred user/driver has completed at least 1 order.
 */
async function creditReferralIfCompletedOrder({ referredId, referredType, orderId }) {
  try {
    referredId = Number(referredId);
    if (!referredId) return;

    let referral = await prisma.tbl_referral.findFirst({
      where: { referred_id: referredId, referred_type: referredType },
    });

    // Self-healing: if tbl_referral row is missing but rider has refer_by set
    if (!referral && referredType === "DRIVER") {
      const rider = await prisma.tbl_rider.findUnique({ where: { id: referredId } });
      const referrerId = Number(rider?.referred_by || rider?.refer_by || 0);
      if (referrerId > 0) {
        const refType = rider.referred_by_type || "DRIVER";
        referral = await prisma.tbl_referral.create({
          data: {
            referrer_id: referrerId,
            referrer_type: refType,
            referred_id: referredId,
            referred_type: "DRIVER",
            referral_code: rider.refferal_code || "",
            status: "pending",
            points_awarded: 0,
            ride_id: Number(orderId) || 0,
            registered_at: rider.rdate || new Date(),
          },
        }).catch(() => null);
      }
    }

    if (!referral || referral.status !== "pending") return;

    const completedCount =
      referredType === "USER"
        ? await prisma.pkg_order.count({ where: { uid: referredId, o_status: "Completed" } })
        : await prisma.pkg_order.count({ where: { rid: referredId, o_status: "Completed" } });

    if (completedCount < 1) return;

    await awardReferralReward({ referral, referredId, referredType, orderId });
  } catch (err) {
    logger.error(`referralRewardService.creditReferralIfCompletedOrder failed for referredId=${referredId} (${referredType}):`, err);
  }
}

/**
 * On-demand sync for a driver:
 * 1. Checks if this driver was referred by someone and has completed >= 1 order -> credits the referrer.
 * 2. Checks if this driver referred others who have completed >= 1 order -> credits this driver.
 */
async function syncPendingReferralRewardsForDriver(riderId) {
  riderId = Number(riderId);
  if (!riderId) return { success: false, msg: "Invalid riderId" };

  try {
    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return { success: false, msg: "Driver not found" };

    let awardedToThisDriver = 0;
    let awardedToReferrer = 0;

    // 1. If this driver was referred by someone, check if this driver completed >= 1 order
    const referrerId = Number(rider.referred_by || rider.refer_by || 0);
    if (referrerId > 0) {
      const completedCount = await prisma.pkg_order.count({
        where: { rid: riderId, o_status: "Completed" },
      });

      if (completedCount >= 1) {
        let referral = await prisma.tbl_referral.findFirst({
          where: { referred_id: riderId, referred_type: "DRIVER" },
        });

        if (!referral) {
          referral = await prisma.tbl_referral.create({
            data: {
              referrer_id: referrerId,
              referrer_type: rider.referred_by_type || "DRIVER",
              referred_id: riderId,
              referred_type: "DRIVER",
              referral_code: rider.refferal_code || "",
              status: "pending",
              points_awarded: 0,
              ride_id: 0,
              registered_at: rider.rdate || new Date(),
            },
          }).catch(() => null);
        }

        if (referral && referral.status === "pending") {
          const firstCompletedOrder = await prisma.pkg_order.findFirst({
            where: { rid: riderId, o_status: "Completed" },
            orderBy: { id: "asc" },
            select: { id: true },
          });

          const credited = await awardReferralReward({
            referral,
            referredId: riderId,
            referredType: "DRIVER",
            orderId: firstCompletedOrder?.id || 0,
          });
          awardedToReferrer += credited;
        }
      }
    }

    // 2. If this driver referred others, check if any of them completed >= 1 order
    const outgoingReferrals = await prisma.tbl_referral.findMany({
      where: { referrer_id: riderId, referrer_type: "DRIVER", status: "pending" },
    });

    for (const ref of outgoingReferrals) {
      const count = ref.referred_type === "USER"
        ? await prisma.pkg_order.count({ where: { uid: ref.referred_id, o_status: "Completed" } })
        : await prisma.pkg_order.count({ where: { rid: ref.referred_id, o_status: "Completed" } });

      if (count >= 1) {
        const firstCompletedOrder = ref.referred_type === "USER"
          ? await prisma.pkg_order.findFirst({ where: { uid: ref.referred_id, o_status: "Completed" }, select: { id: true } })
          : await prisma.pkg_order.findFirst({ where: { rid: ref.referred_id, o_status: "Completed" }, select: { id: true } });

        const credited = await awardReferralReward({
          referral: ref,
          referredId: ref.referred_id,
          referredType: ref.referred_type,
          orderId: firstCompletedOrder?.id || 0,
        });
        awardedToThisDriver += credited;
      }
    }

    return {
      success: true,
      awardedToThisDriver,
      awardedToReferrer,
    };
  } catch (err) {
    logger.error(`syncPendingReferralRewardsForDriver failed for riderId=${riderId}:`, err);
    return { success: false, msg: err.message };
  }
}

module.exports = {
  processReferralRewardsForCompletedOrder,
  syncPendingReferralRewardsForDriver,
};

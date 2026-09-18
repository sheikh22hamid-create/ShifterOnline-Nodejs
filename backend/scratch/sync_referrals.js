const prisma = require("../src/config/db");
const { syncPendingReferralRewardsForDriver } = require("../src/services/referralRewardService");

async function main() {
  const riderId = process.argv[2] ? Number(process.argv[2]) : 15;
  console.log(`Syncing referral rewards for rider #${riderId}...`);
  const res = await syncPendingReferralRewardsForDriver(riderId);
  console.log("Result:", res);

  const r11 = await prisma.tbl_rider.findUnique({ where: { id: 11 }, select: { id: true, full_name: true, fmobile: true, referral_points: true } });
  console.log("Driver 11 (Referrer):", r11);
  const r15 = await prisma.tbl_rider.findUnique({ where: { id: 15 }, select: { id: true, full_name: true, fmobile: true, referral_points: true } });
  console.log("Driver 15 (Referred):", r15);
}

main().catch(console.error).finally(() => prisma.$disconnect());

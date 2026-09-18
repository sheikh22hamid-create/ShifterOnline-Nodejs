const prisma = require("../src/config/db");
const { uniqueRefferCode } = require("../src/controllers/riderAuthController");

async function backfill() {
  try {
    const riders = await prisma.tbl_rider.findMany({
      where: {
        OR: [
          { reffer_code: null },
          { reffer_code: "" },
          { referral_code: null },
          { referral_code: "" },
        ],
      },
    });

    console.log(`Found ${riders.length} riders needing referral codes...`);

    let updatedCount = 0;
    for (const rider of riders) {
      const code = rider.reffer_code || rider.referral_code || (await uniqueRefferCode(rider.full_name || "RID"));
      await prisma.tbl_rider.update({
        where: { id: rider.id },
        data: {
          reffer_code: code,
          referral_code: code,
        },
      });
      updatedCount++;
      console.log(`Updated rider #${rider.id} (${rider.full_name || rider.fmobile}) -> ${code}`);
    }

    console.log(`Successfully backfilled ${updatedCount} riders!`);
  } catch (err) {
    console.error("Backfill failed:", err);
  } finally {
    await prisma.$disconnect();
  }
}

backfill();

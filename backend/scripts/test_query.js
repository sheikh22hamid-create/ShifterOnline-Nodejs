const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const riders = await p.tbl_rider.findMany({
    select: { id: true, full_name: true, fmobile: true, wallet_balance: true }
  });
  console.log("Total riders in DATABASE_URL:", riders.length);
  console.log("Riders:", riders.slice(0, 15));
}

main().catch(console.error).finally(() => p.$disconnect());

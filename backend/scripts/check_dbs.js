const { PrismaClient } = require('@prisma/client');

async function testConn(name, uri) {
  const prisma = new PrismaClient({
    datasources: { db: { url: uri } }
  });
  try {
    const rows = await prisma.tbl_rider.findMany({
      where: { fmobile: '9999900001' },
      select: { id: true, full_name: true, fmobile: true, wallet_balance: true, rlats: true, rlongs: true, a_status: true, rloc_updated_at: true }
    });
    console.log(`[${name}] SUCCESS:`, rows);

  } catch (e) {
    console.error(`[${name}] FAILED:`, e.message);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  await testConn("DEV_URL", "mysql://u755836427_shifter_dev:Shifterdev%402026@srv2206.hstgr.io:3306/u755836427_shifter_dev");
  await testConn("PROD_URL", "mysql://u755836427_shifteronline:U755836427_shifteronline@srv2206.hstgr.io:3306/u755836427_shifteronline");
}

main();


const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'mysql://u755836427_shifteronline:U755836427_shifteronline@srv2206.hstgr.io:3306/u755836427_shifteronline'
    }
  }
});

async function main() {
  try {
    const riders = await prisma.$queryRawUnsafe('SELECT id, full_name, fmobile, reffer_code, referral_code, refferal_code FROM tbl_rider');
    console.log('Riders in u755836427_shifteronline:', riders);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();

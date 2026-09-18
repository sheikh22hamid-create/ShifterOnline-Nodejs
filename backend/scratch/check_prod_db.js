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
    const dbs = await prisma.$queryRawUnsafe('SHOW DATABASES');
    console.log('Databases on prod conn:', dbs);
    const tables = await prisma.$queryRawUnsafe('SHOW TABLES');
    console.log('Tables on prod conn:', tables);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();

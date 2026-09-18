const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  try {
    const dbs = await prisma.$queryRawUnsafe('SHOW DATABASES');
    console.log('Databases:', dbs);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main();

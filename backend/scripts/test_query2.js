const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const result = await p.$queryRawUnsafe('SELECT DATABASE() as db, USER() as user');
  console.log("Current DB & User:", result);
  const admins = await p.admin.findMany({ select: { id: true, username: true, password: true } });
  console.log("Admins with passwords:", admins);

}
main().catch(console.error).finally(() => p.$disconnect());


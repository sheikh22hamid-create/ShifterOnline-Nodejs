const { PrismaClient } = require("@prisma/client");
const DEV_URL = "mysql://u755836427_shifter_dev:Shifterdev%402026@srv2206.hstgr.io:3306/u755836427_shifter_dev";
const PROD_URL = "mysql://u755836427_shifteronline:U755836427_shifteronline@srv2206.hstgr.io:3306/u755836427_shifteronline";

async function check(name, url) {
  console.log(`\n=== ${name} ===`);
  const p = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await p.$queryRawUnsafe("SELECT id, cat_name, cat_status FROM pkg_category ORDER BY id ASC");
    console.table(rows);
  } catch (e) {
    console.error(e.message);
  } finally {
    await p.$disconnect();
  }
}

async function run() {
  await check("DEV", DEV_URL);
  await check("PROD", PROD_URL);
}

run();

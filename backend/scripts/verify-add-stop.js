const prisma = require("../src/config/db");

Promise.all([
  prisma.$queryRawUnsafe("SHOW TABLES LIKE 'pkg_order_stops'"),
  prisma.app_settings.findMany({ where: { setting_key: { in: ["max_extra_stops", "extra_stop_charge"] } } }),
]).then(([table, settings]) => {
  console.log(JSON.stringify({ table, settings }));
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

const prisma = require("../src/config/db");

async function main() {
  const defaults = [
    ["max_extra_stops", "2"],
    ["extra_stop_charge", "0"],
  ];
  for (const [setting_key, setting_value] of defaults) {
    await prisma.app_settings.upsert({
      where: { setting_key },
      create: { setting_key, setting_value, updated_at: new Date() },
      update: {},
    });
  }
  console.log("Add Stop settings seeded.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());

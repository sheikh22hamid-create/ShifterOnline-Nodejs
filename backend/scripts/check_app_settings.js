require("dotenv").config();
const prisma = require("../src/config/db");

async function main() {
  const rows = await prisma.app_settings.findMany({
    where: { setting_key: { in: ["pricing_slab_rates", "pricing_model_multipliers"] } },
  });
  console.log("DB app_settings rows:", rows);
  await prisma.$disconnect();
}

main().catch(console.error);

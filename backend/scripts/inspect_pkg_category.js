const prisma = require("../src/config/db");

async function main() {
  const categories = await prisma.pkg_category.findMany();
  console.log("Categories in DB:", JSON.stringify(categories, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

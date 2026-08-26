const prisma = require("../lib/prisma");
const logger = require("../utils/logger");

process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, disconnecting Prisma client...");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, disconnecting Prisma client...");
  await prisma.$disconnect();
  process.exit(0);
});

module.exports = prisma;

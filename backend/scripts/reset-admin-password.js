/**
 * Sets a bcrypt-hashed password for an existing `admin` row. Needed because
 * legacy PHP-panel passwords are not bcrypt hashes, so nobody can log in
 * through the new Node.js admin auth until their password is migrated.
 *
 * Usage: node scripts/reset-admin-password.js <username> <newPassword>
 */
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/db");
const { BCRYPT_SALT_ROUNDS } = require("../src/config/constants");

async function main() {
  const [username, newPassword] = process.argv.slice(2);
  if (!username || !newPassword) {
    console.error("Usage: node scripts/reset-admin-password.js <username> <newPassword>");
    process.exit(1);
  }

  const admin = await prisma.admin.findFirst({ where: { username } });
  if (!admin) {
    console.error(`No admin found with username "${username}"`);
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await prisma.admin.update({ where: { id: admin.id }, data: { password: hash } });

  console.log(`Password updated for "${username}" (id=${admin.id}, role=${admin.role}).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

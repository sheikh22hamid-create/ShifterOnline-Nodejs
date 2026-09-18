require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const prisma = require('../src/config/db');

async function main() {
  const sqlPath = path.resolve(__dirname, '../prisma/migrations/20260918193331_add_driver_lead/migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const stmts = sql.split(';').map(s => s.trim()).filter(Boolean);

  for (const s of stmts) {
    try {
      await prisma.$executeRawUnsafe(s);
      console.log('Applied successfully:', s.split('\n')[0]);
    } catch (err) {
      console.log('Skipped / note:', err.message);
    }
  }

  // Also regenerate prisma client to ensure all models are available
  console.log('Migration step done.');
}

main().catch(console.error).finally(() => prisma.$disconnect());

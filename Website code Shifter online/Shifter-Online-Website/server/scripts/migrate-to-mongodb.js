/**
 * One-time data migration: reads users out of the legacy local SQLite
 * database and inserts them into MongoDB Atlas. Safe to re-run — existing
 * emails in MongoDB are skipped rather than duplicated.
 *
 * Usage: npm run migrate:mongodb   (from server/)
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { connectDB, disconnectDB } from '../src/db.js';
import { User } from '../src/models/User.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sqlitePath = join(__dirname, '..', 'data', 'shifter.sqlite');

function readSqliteUsers() {
  if (!existsSync(sqlitePath)) {
    console.log(`No SQLite database found at ${sqlitePath} — nothing to migrate.`);
    return [];
  }
  const db = new DatabaseSync(sqlitePath, { readOnly: true });
  const rows = db.prepare('SELECT id, name, email, password_hash, created_at FROM users').all();
  db.close();
  return rows;
}

async function migrateUsers(rows) {
  const stats = { migrated: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    const email = String(row.email).trim().toLowerCase();
    try {
      const existing = await User.findOne({ email });
      if (existing) {
        stats.skipped += 1;
        continue;
      }

      await User.create({
        name: row.name,
        email,
        passwordHash: row.password_hash,
        createdAt: new Date(row.created_at.replace(' ', 'T') + 'Z'),
      });
      stats.migrated += 1;
    } catch (err) {
      stats.errors += 1;
      console.error(`  ! Failed to migrate user id=${row.id} (${row.email}):`, err.message);
    }
  }

  return stats;
}

async function main() {
  console.log('=== Shifter Online: SQLite -> MongoDB migration ===\n');

  const users = readSqliteUsers();
  console.log(`Found ${users.length} user record(s) in SQLite.`);

  await connectDB();
  console.log('Connected to MongoDB.\n');

  const userStats = await migrateUsers(users);

  console.log('\n=== Migration summary ===');
  console.log(`Users migrated:  ${userStats.migrated}`);
  console.log(`Users skipped (already in MongoDB): ${userStats.skipped}`);
  console.log(`Errors:          ${userStats.errors}`);

  await disconnectDB();
  console.log('\nDone. MongoDB connection closed.');

  if (userStats.errors > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});

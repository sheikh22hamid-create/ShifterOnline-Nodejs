const prisma = require('./src/config/db');

async function migrate() {
  console.log('Running pending schema updates...');
  
  // 1. puc_image, bima_image
  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE tbl_personal_doc
      ADD COLUMN puc_image VARCHAR(255) NULL,
      ADD COLUMN bima_image VARCHAR(255) NULL
    `);
    console.log('Added puc_image and bima_image to tbl_personal_doc');
  } catch (e) {
    if (e.message.includes('Duplicate column')) {
      console.log('puc_image/bima_image columns already exist');
    } else {
      console.log('Note on tbl_personal_doc:', e.message);
    }
  }

  // 2. driver_trip_progress
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS driver_trip_progress (
        order_id INT NOT NULL,
        rider_id INT NOT NULL,
        stop_step INT NOT NULL DEFAULT 0,
        automation_enabled BOOLEAN NOT NULL DEFAULT false,
        otp_verified_at DATETIME(3) NULL,
        candidate_key VARCHAR(50) NULL,
        candidate_since DATETIME(3) NULL,
        candidate_count INT NOT NULL DEFAULT 0,
        last_sample_at DATETIME(3) NULL,
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (order_id)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('Created table driver_trip_progress successfully');
  } catch (e) {
    console.error('Failed to create driver_trip_progress:', e.message);
  }

  // 3. driver_trip_event
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS driver_trip_event (
        id INT NOT NULL AUTO_INCREMENT,
        order_id INT NOT NULL,
        rider_id INT NOT NULL,
        user_id INT NOT NULL,
        milestone VARCHAR(50) NOT NULL,
        payload JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        sent_at DATETIME(3) NULL,
        lease_until DATETIME(3) NULL,
        PRIMARY KEY (id),
        UNIQUE KEY driver_trip_event_order_id_milestone_key (order_id, milestone),
        KEY driver_trip_event_sent_at_lease_until_idx (sent_at, lease_until)
      ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    console.log('Created table driver_trip_event successfully');
  } catch (e) {
    console.error('Failed to create driver_trip_event:', e.message);
  }

  console.log('Verifying tables...');
  const progressCount = await prisma.driver_trip_progress.count();
  const eventCount = await prisma.driver_trip_event.count();
  console.log(`Verified! driver_trip_progress count: ${progressCount}, driver_trip_event count: ${eventCount}`);
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

// Real-MySQL test harness for the guarantee executive queue. Tests that use it run only when
// GUARANTEE_TEST_DATABASE_URL points at a disposable database whose name ends in "_test"; otherwise they are
// SKIPPED (jest prints the skip count, so a skipped gate is visible, never silently green).
const url = process.env.GUARANTEE_TEST_DATABASE_URL || "";
const dbName = (url.split("?")[0].split("/").pop() || "").trim();

if (url && !/_test$/.test(dbName)) {
  throw new Error(`Refusing to run: GUARANTEE_TEST_DATABASE_URL database "${dbName}" must end with "_test"`);
}
if (url) process.env.DATABASE_URL = url; // must happen before config/db is first required

const enabled = Boolean(url);
const describeMysql = enabled ? describe : describe.skip;

const TABLES = [
  "guarantee_assignment", "guarantee_action", "executive_guarantee_profile", "booking_guarantee_audit",
  "booking_guarantee_case", "city_order_settings", "admin",
];

async function resetDb(prisma) {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of TABLES) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
}

let seq = 0;
const nextId = () => ++seq;

const makeExec = (prisma, cityId, o = {}) =>
  prisma.admin.create({ data: { username: `exec_${cityId}_${nextId()}_${Date.now()}`, password: "x", role: "executive", city_id: cityId, status: true, ...o } });

const makeAdmin = (prisma, cityId, role = "admin") =>
  prisma.admin.create({ data: { username: `${role}_${cityId}_${nextId()}_${Date.now()}`, password: "x", role, city_id: cityId, status: true } });

/** An open guarantee case, as openForExhaustedOrder + onCaseOpened would leave it for an enabled city. */
const makeCase = (prisma, cityId, o = {}) =>
  prisma.booking_guarantee_case.create({
    data: {
      order_id: 900000 + nextId(), uid: 1, status: "open", selected_package_ids: "[1]", compensation_amount: 100,
      opened_at: new Date(Date.now() - 60 * 1000), deadline_at: new Date(Date.now() + 30 * 60 * 1000),
      city_id: cityId, queue_state: "unassigned", ...o,
    },
  });

const setProfile = (prisma, adminId, data) =>
  prisma.executive_guarantee_profile.upsert({ where: { admin_id: adminId }, update: data, create: { admin_id: adminId, ...data } });

const enableQueue = (prisma, cityId, o = {}) =>
  prisma.city_order_settings.upsert({
    where: { city_id: cityId },
    update: { exec_queue_enabled: true, ...o },
    create: { city_id: cityId, exec_queue_enabled: true, ...o },
  });

const events = async (prisma, caseId) =>
  (await prisma.booking_guarantee_audit.findMany({ where: { case_id: caseId }, orderBy: { id: "asc" } })).map((e) => e.event);

// Inserts a row into any table, filling every NOT NULL column that has no default with a type-appropriate dummy,
// so the helper keeps working when the schema gains required columns. `overrides` win.
async function insertRow(prisma, table, overrides = {}) {
  const cols = await prisma.$queryRawUnsafe(
    "SELECT column_name AS name, data_type AS type, column_type AS ctype FROM information_schema.columns " +
    "WHERE table_schema = DATABASE() AND table_name = ? AND is_nullable = 'NO' AND column_default IS NULL AND extra NOT LIKE '%auto_increment%'",
    table
  );
  const values = {};
  for (const { name, type, ctype } of cols) {
    if (["int", "bigint", "smallint", "tinyint", "mediumint", "decimal", "float", "double"].includes(type)) values[name] = 0;
    else if (["datetime", "timestamp", "date"].includes(type)) values[name] = new Date();
    else if (type === "enum") values[name] = (/'([^']*)'/.exec(ctype) || [])[1];
    else values[name] = "x";
  }
  Object.assign(values, overrides);
  const names = Object.keys(values);
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`${table}\` (${names.map((n) => `\`${n}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`,
    ...names.map((n) => values[n])
  );
  const [{ id }] = await prisma.$queryRawUnsafe("SELECT LAST_INSERT_ID() AS id");
  return Number(id);
}

const makeOrder = (prisma, o = {}) =>
  insertRow(prisma, "pkg_order", { uid: 1, rid: 11, order_status: 1, o_status: "Processing", city_id: 3, ...o });
const makeUser = (prisma, o = {}) => insertRow(prisma, "tbl_user", { wallet: 0, ...o });

/** A guarantee case already closed by an assignment (what driver accept / admin assign leaves behind). */
const makeAssignedCase = (prisma, orderId, cityId, o = {}) =>
  prisma.booking_guarantee_case.create({
    data: {
      order_id: orderId, uid: 1, status: "resolved_assigned", selected_package_ids: "[1]", compensation_amount: 100,
      opened_at: new Date(Date.now() - 5 * 60 * 1000), deadline_at: new Date(Date.now() + 10 * 60 * 1000), closed_at: new Date(),
      city_id: cityId, queue_state: "assigned", owner_admin_id: 777, owner_assigned_at: new Date(), reminded_at: new Date(), ...o,
    },
  });

const resetOrders = async (prisma) => {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of ["pkg_order", "tbl_user", "tbl_wallet_history", "tbl_order_requests", "order_status_history", "driver_trip_progress"]) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  }
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
};

module.exports = {
  enabled, describeMysql, resetDb, makeExec, makeAdmin, makeCase, setProfile, enableQueue, events,
  insertRow, makeOrder, makeUser, makeAssignedCase, resetOrders,
};

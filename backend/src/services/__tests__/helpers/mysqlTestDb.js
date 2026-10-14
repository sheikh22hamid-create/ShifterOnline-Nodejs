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

module.exports = { enabled, describeMysql, resetDb, makeExec, makeAdmin, makeCase, setProfile, enableQueue, events };

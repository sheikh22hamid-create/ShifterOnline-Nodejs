const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue reports (real MySQL)", () => {
  const prisma = require("../../config/db");
  const settings = require("../guaranteeQueueSettings");
  const reports = require("../guaranteeQueueReports");

  beforeEach(async () => { settings._resetCache(); await db.resetDb(prisma); await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 }); });
  afterAll(() => prisma.$disconnect());

  const period = (c, adminId, o = {}) => prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: adminId, source: "auto", active: null, ended_at: new Date(), end_reason: "resolved", ...o } });

  it("workload counts live load from active periods on open cases only and scopes by city", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, 2);
    await db.setProfile(prisma, a.id, { capacity: 3 });
    const open = await db.makeCase(prisma, CITY, { owner_admin_id: a.id, queue_state: "escalated", escalated_at: new Date() });
    await period(open, a.id, { active: 1, ended_at: null, end_reason: null });
    const closed = await db.makeCase(prisma, CITY, { status: "resolved_assigned", owner_admin_id: a.id, resolved_by_admin_id: a.id, closed_at: new Date() });
    await period(closed, a.id);
    const rows = await reports.workload({ cityId: CITY });
    expect(rows.map((r) => r.admin_id)).toEqual([a.id]);
    expect(rows[0]).toMatchObject({ active: 1, escalated: 1, resolved: 1, owned_total: 2, capacity: 3, effective_capacity: 3, available: true });
    expect((await reports.workload({ cityId: null })).map((r) => r.admin_id).sort()).toEqual([a.id, b.id].sort());
  });

  it("report separates 'no executive', 'executive never acted' and 'executive acted' expiries instead of blaming staff for every SLA miss", async () => {
    const e = await db.makeExec(prisma, CITY);
    const base = { status: "expired_compensated", closed_at: new Date() };
    await db.makeCase(prisma, CITY, base);                                                                 // never owned
    const owned = await db.makeCase(prisma, CITY, { ...base, owner_admin_id: e.id }); await period(owned, e.id, { end_reason: "expired" });
    const acted = await db.makeCase(prisma, CITY, { ...base, owner_admin_id: e.id, first_action_at: new Date() }); await period(acted, e.id, { end_reason: "expired" });
    const resolved = await db.makeCase(prisma, CITY, { status: "resolved_assigned", closed_at: new Date(), owner_admin_id: e.id, first_action_at: new Date() });
    await period(resolved, e.id);
    const r = await reports.report({ cityId: CITY, from: new Date(Date.now() - 3600000), to: new Date(Date.now() + 3600000) });
    expect(r).toMatchObject({ total: 4, resolved: 1, expired: 3 });
    expect(r.failure_breakdown).toEqual({ expired_no_owner: 1, expired_owner_no_action: 1, expired_owner_acted: 1 });
    expect(r.auto_assigned).toBe(3);
  });

  it("queueList returns open cases first, nearest deadline first, and honours the state filter", async () => {
    await db.makeExec(prisma, CITY);
    const soon = await db.makeCase(prisma, CITY, { deadline_at: new Date(Date.now() + 60000) });
    await db.makeCase(prisma, CITY, { deadline_at: new Date(Date.now() + 600000), queue_state: "assigned", owner_admin_id: 5 });
    const all = await reports.queueList({ cityId: CITY });
    expect(all[0].order_id).toBe(soon.order_id);
    const un = await reports.queueList({ cityId: CITY, state: "unassigned" });
    expect(un).toHaveLength(1);
    expect(await reports.queueList({ cityId: 2 })).toHaveLength(0);
  });
});

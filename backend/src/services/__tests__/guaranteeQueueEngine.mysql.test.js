const db = require("./helpers/mysqlTestDb"); // sets DATABASE_URL first
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue engine (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  beforeEach(async () => {
    jest.clearAllMocks();
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 });
  });
  afterAll(() => prisma.$disconnect());

  it("AC-3: many ended periods may coexist for one case, a second ACTIVE period is rejected", async () => {
    const c = await db.makeCase(prisma, CITY);
    const mk = (adminId, active) => prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: adminId, source: "auto", active } });
    await mk(1, 1); await mk(2, null); await mk(3, null);
    await expect(mk(4, 1)).rejects.toMatchObject({ code: "P2002" });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(3);
  });

  it("assigns an open case to the one eligible executive of its city and records owner, period and audit", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    const res = await svc.claimCase(c.id, { cityId: CITY });
    expect(res).toMatchObject({ claimed: true, adminId: e.id });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: e.id, queue_state: "assigned", unassigned_reason: null });
    expect(row.owner_assigned_at).toBeInstanceOf(Date);
    const periods = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id } });
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ admin_id: e.id, active: 1, source: "auto", assigned_by: null });
    expect(await db.events(prisma, c.id)).toContain("exec_auto_assigned");
  });

  it("never selects executives of another city, city admins or superadmins", async () => {
    await db.makeExec(prisma, 2);
    await db.makeAdmin(prisma, CITY, "admin");
    await db.makeAdmin(prisma, CITY, "superadmin");
    const c = await db.makeCase(prisma, CITY);
    const res = await svc.claimCase(c.id, { cityId: CITY });
    expect(res).toEqual({ claimed: false, reason: "none_in_city" });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).queue_state).toBe("unassigned");
  });

  it("skips unavailable and deactivated executives", async () => {
    const off = await db.makeExec(prisma, CITY); await db.setProfile(prisma, off.id, { available: 0 });
    await db.makeExec(prisma, CITY, { status: false });
    const c = await db.makeCase(prisma, CITY);
    const res = await svc.claimCase(c.id, { cityId: CITY });
    expect(res.claimed).toBe(false);
    expect(res.reason).toBe("all_unavailable");
  });

  it("balances by load/capacity: the emptier executive gets the next case", async () => {
    const a = await db.makeExec(prisma, CITY);
    const b = await db.makeExec(prisma, CITY);
    const first = await db.makeCase(prisma, CITY);
    const r1 = await svc.claimCase(first.id, { cityId: CITY });
    const second = await db.makeCase(prisma, CITY);
    const r2 = await svc.claimCase(second.id, { cityId: CITY });
    expect(new Set([r1.adminId, r2.adminId])).toEqual(new Set([a.id, b.id]));
  });

  it("AC-4: with capacity 1 and many concurrent claims for one executive, exactly one succeeds; the rest stay unassigned with a reason", async () => {
    const e = await db.makeExec(prisma, CITY);
    await db.setProfile(prisma, e.id, { capacity: 1 });
    const cases = [];
    for (let i = 0; i < 8; i += 1) cases.push(await db.makeCase(prisma, CITY));
    const results = await Promise.all(cases.map((c) => svc.claimCase(c.id, { cityId: CITY })));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: e.id, active: 1 } })).toBe(1);
    const rest = await prisma.booking_guarantee_case.findMany({ where: { city_id: CITY, queue_state: "unassigned" } });
    expect(rest).toHaveLength(7);
    rest.forEach((r) => expect(r.unassigned_reason).toBe("all_at_capacity"));
  });

  it("AC-4b: capacity 3 with 10 concurrent cases and two executives never exceeds either limit", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    await db.setProfile(prisma, a.id, { capacity: 3 }); await db.setProfile(prisma, b.id, { capacity: 3 });
    const cases = [];
    for (let i = 0; i < 10; i += 1) cases.push(await db.makeCase(prisma, CITY));
    await Promise.all(cases.map((c) => svc.claimCase(c.id, { cityId: CITY })));
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: a.id, active: 1 } })).toBeLessThanOrEqual(3);
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: b.id, active: 1 } })).toBeLessThanOrEqual(3);
    expect(await prisma.guarantee_assignment.count({ where: { active: 1 } })).toBe(6);
  });

  it("AC-5: concurrent workers claiming the SAME case produce one owner and one active period", async () => {
    await db.makeExec(prisma, CITY); await db.makeExec(prisma, CITY); await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => svc.claimCase(c.id, { cityId: CITY })));
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(1);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(1);
  });

  it("does not claim a case that is already closed or already owned", async () => {
    await db.makeExec(prisma, CITY);
    const closed = await db.makeCase(prisma, CITY, { status: "resolved_assigned" });
    expect(await svc.claimCase(closed.id, { cityId: CITY })).toEqual({ claimed: false, reason: "not_claimable" });
    const owned = await db.makeCase(prisma, CITY, { owner_admin_id: 777, queue_state: "assigned" });
    expect(await svc.claimCase(owned.id, { cityId: CITY })).toEqual({ claimed: false, reason: "not_claimable" });
  });

  it("AC-7: no executive available keeps the case visible as unassigned, alerts supervisors once (throttled), never touches the deadline", async () => {
    const c = await db.makeCase(prisma, CITY);
    const before = c.deadline_at.getTime();
    await svc.claimCase(c.id, { cityId: CITY });
    await svc.claimCase(c.id, { cityId: CITY });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ queue_state: "unassigned", unassigned_reason: "none_in_city", owner_admin_id: null });
    expect(row.deadline_at.getTime()).toBe(before);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyDispatchAlert.mock.calls[0][3]).toMatchObject({ kind: "guarantee_unassigned", reason: "none_in_city" });
    expect((await db.events(prisma, c.id)).filter((e) => e === "exec_no_executive_alert")).toHaveLength(1);
  });

  it("a claim never changes deadline, compensation or status of the case (AC-9)", async () => {
    await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await svc.claimCase(c.id, { cityId: CITY });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    expect(Number(row.compensation_amount)).toBe(100);
    expect(row.status).toBe("open");
  });

  it("never lets a wrong city claim a case (claimCase and tryAssign both refuse)", async () => {
    const other = await db.makeExec(prisma, 2);
    const c = await db.makeCase(prisma, CITY);
    expect(await svc.claimCase(c.id, { cityId: 2 })).toEqual({ claimed: false, reason: "not_claimable" });
    expect(await svc.tryAssign(c.id, other.id, { cityId: 2, expectedOwnerId: null, source: "auto" })).not.toBe("claimed");
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.owner_admin_id).toBeNull();
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(0);
  });
});

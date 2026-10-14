const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue actions (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  let exec; let other; let sup; let c;
  const as = (a, role) => ({ id: a.id, role, cityId: a.city_id });

  beforeEach(async () => {
    jest.clearAllMocks();
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY);
    exec = await db.makeExec(prisma, CITY);
    other = await db.makeExec(prisma, CITY);
    sup = await db.makeAdmin(prisma, CITY, "admin");
    c = await db.makeCase(prisma, CITY);
    await svc.claimCase(c.id, { cityId: CITY });
    // claimCase picked one of the two; make the owner deterministic
    await prisma.guarantee_assignment.updateMany({ where: { case_id: c.id, active: 1 }, data: { admin_id: exec.id } });
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: exec.id } });
  });
  afterAll(() => prisma.$disconnect());

  it("AC-16: viewing is logged but never counts as progress", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "viewed" });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ queue_state: "assigned", first_action_at: null, last_action_at: null });
    const a = await prisma.guarantee_action.findFirst({ where: { case_id: c.id } });
    expect(a).toMatchObject({ type: "viewed", meaningful: 0, admin_id: exec.id });
  });

  it("the first meaningful action moves assigned -> in_progress and stamps first/last action times (server clock)", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "search_started" });
    let row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("in_progress");
    expect(row.first_action_at).toBeInstanceOf(Date);
    const first = row.first_action_at.getTime();
    await new Promise((r) => setTimeout(r, 1100));
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "driver_contacted", driverId: 55 });
    row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.first_action_at.getTime()).toBe(first);
    expect(row.last_action_at.getTime()).toBeGreaterThan(first);
  });

  it("AC-17: a client-supplied actor id or timestamp is ignored; metadata is whitelisted and truncated", async () => {
    await svc.recordAction({
      orderId: c.order_id, actor: as(exec, "executive"), type: "contact_outcome", result: "declined", driverId: 12,
      meta: { outcome: "declined", note: "x".repeat(900), admin_id: 9999, created_at: "2001-01-01", phone: "9999999999", token: "secret" },
    });
    const a = await prisma.guarantee_action.findFirst({ where: { case_id: c.id } });
    expect(a.admin_id).toBe(exec.id);
    expect(a.created_at.getFullYear()).toBeGreaterThan(2020);
    const meta = JSON.parse(a.meta);
    expect(Object.keys(meta).sort()).toEqual(["note", "outcome"]);
    expect(meta.note.length).toBe(500);
  });

  it("AC-14: an executive cannot act on, or view, a case they do not own", async () => {
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(other, "executive"), type: "search_started" })).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.getCaseDetail(c.order_id, as(other, "executive"))).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.guarantee_action.count({ where: { case_id: c.id } })).toBe(0);
  });

  it("a supervisor of another city cannot see the case (404); the same city supervisor may only add notes/escalations", async () => {
    const foreign = await db.makeAdmin(prisma, 2, "admin");
    await expect(svc.getCaseDetail(c.order_id, as(foreign, "admin"))).rejects.toMatchObject({ statusCode: 404 });
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(sup, "admin"), type: "driver_contacted" })).rejects.toMatchObject({ statusCode: 403 });
    await svc.recordAction({ orderId: c.order_id, actor: as(sup, "admin"), type: "note", meta: { note: "Called the executive, they are on it" } });
    expect(await prisma.guarantee_action.count({ where: { case_id: c.id, admin_id: sup.id } })).toBe(1);
  });

  it("rejects unknown action types (400) and meaningful actions on a closed case (409)", async () => {
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "teleport" })).rejects.toMatchObject({ statusCode: 400 });
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { status: "resolved_assigned", closed_at: new Date() } });
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "search_started" })).rejects.toMatchObject({ statusCode: 409 });
  });

  it("an executive escalation marks the case escalated once, audits it and alerts supervisors", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "escalated", meta: { reason: "no drivers online" } });
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "escalated", meta: { reason: "again" } });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("escalated");
    expect(row.escalated_at).toBeInstanceOf(Date);
    expect((await db.events(prisma, c.id)).filter((e) => e === "exec_escalated")).toHaveLength(1);
    expect(adminSocket.notifyDispatchAlert.mock.calls.filter((x) => x[3]?.kind === "guarantee_escalated")).toHaveLength(1);
  });

  it("assertExecutiveMayAssign: owner passes, a different executive is blocked, admins/superadmins always pass, queue OFF passes", async () => {
    await expect(svc.assertExecutiveMayAssign({ id: exec.id, role: "executive", city_id: CITY }, c.order_id)).resolves.toBeUndefined();
    await expect(svc.assertExecutiveMayAssign({ id: other.id, role: "executive", city_id: CITY }, c.order_id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.assertExecutiveMayAssign({ id: sup.id, role: "admin", city_id: CITY }, c.order_id)).resolves.toBeUndefined();
    // Review Focus 2: an UNASSIGNED case is not assignable by an executive either (only admins), but an order with no case is unaffected
    const un = await db.makeCase(prisma, CITY);
    await expect(svc.assertExecutiveMayAssign({ id: exec.id, role: "executive", city_id: CITY }, un.order_id)).rejects.toMatchObject({ statusCode: 403 });
    await expect(svc.assertExecutiveMayAssign({ id: exec.id, role: "executive", city_id: CITY }, 123456789)).resolves.toBeUndefined();
    await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { exec_queue_enabled: false } });
    settings._resetCache();
    await expect(svc.assertExecutiveMayAssign({ id: other.id, role: "executive", city_id: CITY }, c.order_id)).resolves.toBeUndefined();
  });

  it("recordAssignmentAction logs a meaningful driver_assigned for the acting admin and never throws", async () => {
    await svc.recordAssignmentAction({ orderId: c.order_id, adminId: exec.id, riderId: 31 });
    const a = await prisma.guarantee_action.findFirst({ where: { case_id: c.id, type: "driver_assigned" } });
    expect(a).toMatchObject({ meaningful: 1, driver_id: 31, admin_id: exec.id });
    await expect(svc.recordAssignmentAction({ orderId: 424242, adminId: 1, riderId: 1 })).resolves.toBeUndefined();
  });

  it("listMyCases returns my active cases, my recent closed ones, and ones taken away from me", async () => {
    const c2 = await db.makeCase(prisma, CITY, { status: "resolved_assigned", closed_at: new Date(), owner_admin_id: exec.id });
    await prisma.guarantee_assignment.create({ data: { case_id: c2.id, admin_id: exec.id, source: "auto", active: null, ended_at: new Date(), end_reason: "resolved" } });
    const c3 = await db.makeCase(prisma, CITY, { owner_admin_id: other.id, queue_state: "assigned" });
    await prisma.guarantee_assignment.create({ data: { case_id: c3.id, admin_id: exec.id, source: "auto", active: null, ended_at: new Date(), end_reason: "reassigned" } });
    const res = await svc.listMyCases(exec.id);
    expect(res.active.map((r) => r.order_id)).toEqual([c.order_id]);
    expect(res.recent.map((r) => r.order_id)).toEqual([c2.order_id]);
    expect(res.reassigned.map((r) => r.order_id)).toEqual([c3.order_id]);
  });

  it("getCaseDetail returns ownership history, actions and audit for the owner", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "search_started" });
    const d = await svc.getCaseDetail(c.order_id, as(exec, "executive"));
    expect(d.case).toMatchObject({ order_id: c.order_id, queue_state: "in_progress" });
    expect(d.assignments).toHaveLength(1);
    expect(d.actions.map((a) => a.type)).toEqual(expect.arrayContaining(["search_started", "viewed"]));
    expect(d.audit.length).toBeGreaterThan(0);
  });

  it("fix 1: after a reassignment the previous owner's action is 404 and the new owner's progress fields are untouched", async () => {
    await prisma.guarantee_assignment.updateMany({ where: { case_id: c.id, active: 1 }, data: { admin_id: other.id } });
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: other.id } });
    await expect(svc.recordAction({ orderId: c.order_id, actor: as(exec, "executive"), type: "search_started" })).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).toMatchObject({ queue_state: "assigned", first_action_at: null, last_action_at: null });
  });

  it("fix 1: a supervisor escalation on an unowned case sets escalated_at but keeps queue_state unassigned", async () => {
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: null, queue_state: "unassigned" } });
    await svc.recordAction({ orderId: c.order_id, actor: as(sup, "admin"), type: "escalated", meta: { reason: "nobody" } });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("unassigned");
    expect(row.escalated_at).toBeInstanceOf(Date);
  });

  it("fix 3: a supervisor note stores meaningful = 0 and does not move the case", async () => {
    await svc.recordAction({ orderId: c.order_id, actor: as(sup, "admin"), type: "note", meta: { note: "A long enough supervisor note" } });
    expect((await prisma.guarantee_action.findFirst({ where: { case_id: c.id, admin_id: sup.id } })).meaningful).toBe(0);
    expect(await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).toMatchObject({ queue_state: "assigned", first_action_at: null, last_action_at: null });
  });

  it("fix 2: a supervisor's assignment is logged non-meaningful and is not the executive's progress; the owner's is", async () => {
    await svc.recordAssignmentAction({ orderId: c.order_id, adminId: sup.id, riderId: 8 });
    expect((await prisma.guarantee_action.findFirst({ where: { case_id: c.id, admin_id: sup.id } })).meaningful).toBe(0);
    expect(await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).toMatchObject({ queue_state: "assigned", first_action_at: null, last_action_at: null });
    await svc.recordAssignmentAction({ orderId: c.order_id, adminId: exec.id, riderId: 9 });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("in_progress");
    expect(row.first_action_at).toBeInstanceOf(Date);
    expect(row.last_action_at).toBeInstanceOf(Date);
  });
});

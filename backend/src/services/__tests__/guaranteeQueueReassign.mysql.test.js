const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);

db.describeMysql("guarantee queue reassignment (real MySQL)", () => {
  const prisma = require("../../config/db");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  let sup;
  const actor = () => ({ id: sup.id, role: "admin", cityId: CITY });
  const claimed = async (caseRow, exec) => {
    // give `caseRow` to `exec` deterministically via the manual path
    await svc.reassignCase({ orderId: caseRow.order_id, targetAdminId: exec.id, actor: actor(), reason: "seed" });
  };

  beforeEach(async () => {
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 });
    sup = await db.makeAdmin(prisma, CITY, "admin");
  });
  afterAll(() => prisma.$disconnect());

  it("a supervisor can assign an unassigned case to a named executive (manual source)", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await claimed(c, e);
    const p = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id } });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ admin_id: e.id, active: 1, source: "manual", assigned_by: sup.id });
    expect(await db.events(prisma, c.id)).toContain("exec_manually_assigned");
  });

  it("AC-6/AC-10: reassigning keeps every period (old one ended, new one active) and never moves the deadline", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await claimed(c, a);
    await svc.reassignCase({ orderId: c.order_id, targetAdminId: b.id, actor: actor(), reason: "A is overloaded" });
    const periods = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id }, orderBy: { id: "asc" } });
    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({ admin_id: a.id, active: null, end_reason: "reassigned" });
    expect(periods[0].ended_at).toBeInstanceOf(Date);
    expect(periods[1]).toMatchObject({ admin_id: b.id, active: 1, source: "manual", reassign_reason: "A is overloaded" });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: b.id, queue_state: "assigned" });
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    expect(row.opened_at.getTime()).toBe(c.opened_at.getTime());
  });

  it("AC-6: two supervisors reassigning the same case at once: exactly one wins, the other gets 409", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY); const d = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY);
    await claimed(c, a);
    const settled = await Promise.allSettled([
      svc.reassignCase({ orderId: c.order_id, targetAdminId: b.id, actor: actor(), reason: "x1" }),
      svc.reassignCase({ orderId: c.order_id, targetAdminId: d.id, actor: actor(), reason: "x2" }),
    ]);
    expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
    const lost = settled.find((s) => s.status === "rejected");
    expect(lost.reason).toMatchObject({ statusCode: 409 });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(1);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(2);
  });

  it("capacity holds for supervisor reassignment: a full target is refused with 409 and the owner is unchanged", async () => {
    const a = await db.makeExec(prisma, CITY); const full = await db.makeExec(prisma, CITY);
    await db.setProfile(prisma, full.id, { capacity: 1 });
    const c1 = await db.makeCase(prisma, CITY); await claimed(c1, full);
    const c2 = await db.makeCase(prisma, CITY); await claimed(c2, a);
    await expect(svc.reassignCase({ orderId: c2.order_id, targetAdminId: full.id, actor: actor(), reason: "try" }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c2.id } })).owner_admin_id).toBe(a.id);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c2.id, active: 1 } })).toBe(1);
  });

  it("refuses an unavailable target, a target in another city, a non-executive target and reassigning to the current owner", async () => {
    const a = await db.makeExec(prisma, CITY);
    const off = await db.makeExec(prisma, CITY); await db.setProfile(prisma, off.id, { available: 0 });
    const other = await db.makeExec(prisma, 2);
    const c = await db.makeCase(prisma, CITY); await claimed(c, a);
    for (const target of [off.id, other.id, sup.id, a.id]) {
      await expect(svc.reassignCase({ orderId: c.order_id, targetAdminId: target, actor: actor(), reason: "x" })).rejects.toMatchObject({ statusCode: 409 });
    }
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).owner_admin_id).toBe(a.id);
    const periods = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id } });
    expect(periods).toHaveLength(1);
    expect(periods[0]).toMatchObject({ admin_id: a.id, active: 1 });
    expect(await prisma.executive_guarantee_profile.count({ where: { admin_id: sup.id } })).toBe(0);
  });

  it("a city admin cannot touch another city's case (404, not 403); a superadmin can", async () => {
    const e = await db.makeExec(prisma, 2);
    const c = await db.makeCase(prisma, 2);
    await expect(svc.reassignCase({ orderId: c.order_id, targetAdminId: e.id, actor: actor(), reason: "x" })).rejects.toMatchObject({ statusCode: 404 });
    const su = await db.makeAdmin(prisma, null, "superadmin");
    await svc.reassignCase({ orderId: c.order_id, targetAdminId: e.id, actor: { id: su.id, role: "superadmin", cityId: null }, reason: "ok" });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).owner_admin_id).toBe(e.id);
  });

  it("refuses to reassign a closed case (409) and requires a reason (400)", async () => {
    const e = await db.makeExec(prisma, CITY);
    const closed = await db.makeCase(prisma, CITY, { status: "resolved_assigned" });
    await expect(svc.reassignCase({ orderId: closed.order_id, targetAdminId: e.id, actor: actor(), reason: "x" })).rejects.toMatchObject({ statusCode: 409 });
    const open = await db.makeCase(prisma, CITY);
    await expect(svc.reassignCase({ orderId: open.order_id, targetAdminId: e.id, actor: actor(), reason: "  " })).rejects.toMatchObject({ statusCode: 400 });
  });

  it("auto-reassign (target null) picks the best OTHER executive; if none has capacity the case returns to unassigned and the old period is ended", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY); await claimed(c, a);
    const r1 = await svc.reassignCase({ orderId: c.order_id, targetAdminId: null, actor: actor(), reason: "rebalance" });
    expect(r1).toMatchObject({ queueState: "assigned", ownerAdminId: b.id });
    await db.setProfile(prisma, a.id, { available: 0 });
    const r2 = await svc.reassignCase({ orderId: c.order_id, targetAdminId: null, actor: actor(), reason: "nobody left" });
    expect(r2).toMatchObject({ queueState: "unassigned", ownerAdminId: null });
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: null, queue_state: "unassigned" });
    expect(row.unassigned_reason).toBeTruthy();
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(0);
  });

  it("Review Focus 1: marking the owner unavailable hands cases over, or releases them to unassigned when nobody has capacity, deadline unchanged", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c1 = await db.makeCase(prisma, CITY); await claimed(c1, a);
    const c2 = await db.makeCase(prisma, CITY); await claimed(c2, a);
    const originalDeadline = { [c1.id]: c1.deadline_at.getTime(), [c2.id]: c2.deadline_at.getTime() };
    await db.setProfile(prisma, b.id, { capacity: 1 });
    const res = await svc.setAvailability(a.id, false, actor());
    expect(res.handedOver).toBe(2);
    const rows = await prisma.booking_guarantee_case.findMany({ where: { id: { in: [c1.id, c2.id] } }, orderBy: { id: "asc" } });
    // b has capacity 1: one case moves to b, the other returns to the unassigned queue
    expect(rows.filter((r) => r.owner_admin_id === b.id)).toHaveLength(1);
    expect(rows.filter((r) => r.queue_state === "unassigned")).toHaveLength(1);
    rows.forEach((r) => expect(r.deadline_at.getTime()).toBe(originalDeadline[r.id]));
    expect(await prisma.guarantee_assignment.count({ where: { admin_id: a.id, active: 1 } })).toBe(0);
    expect((await prisma.guarantee_assignment.findMany({ where: { admin_id: a.id } })).every((p) => p.end_reason === "unavailable")).toBe(true);
  });

  it("setCapacity validates the executive belongs to the supervisor's city and the value is a positive integer", async () => {
    const other = await db.makeExec(prisma, 2);
    await expect(svc.setCapacity(other.id, 3, actor())).rejects.toMatchObject({ statusCode: 404 });
    const e = await db.makeExec(prisma, CITY);
    await expect(svc.setCapacity(e.id, 0, actor())).rejects.toMatchObject({ statusCode: 400 });
    await svc.setCapacity(e.id, 7, actor());
    expect((await prisma.executive_guarantee_profile.findUnique({ where: { admin_id: e.id } })).capacity).toBe(7);
    await svc.setCapacity(e.id, null, actor());
    expect((await prisma.executive_guarantee_profile.findUnique({ where: { admin_id: e.id } })).capacity).toBeNull();
  });

  it("onCaseOpened queues and auto-assigns only when the city flag is on; OFF leaves the case untouched (AC-1)", async () => {
    const e = await db.makeExec(prisma, CITY);
    const on = await db.makeCase(prisma, CITY, { queue_state: null });
    expect(await svc.onCaseOpened(on, CITY)).toMatchObject({ queued: true });
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: on.id } })).owner_admin_id).toBe(e.id);
    expect(await db.events(prisma, on.id)).toEqual(expect.arrayContaining(["exec_queue_unassigned", "exec_auto_assigned"]));

    const offCity = 9;
    await db.makeExec(prisma, offCity);
    const off = await db.makeCase(prisma, offCity, { queue_state: null });
    expect(await svc.onCaseOpened(off, offCity)).toEqual({ queued: false });
    expect(await prisma.booking_guarantee_case.findUnique({ where: { id: off.id } })).toMatchObject({ queue_state: null, owner_admin_id: null });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: off.id } })).toBe(0);
  });

  it("Review Focus 3: onCaseClosed ends the active period with the matching reason; a closed case is never claimed or reassigned afterwards", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY); await claimed(c, a);
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { status: "expired_compensated", closed_at: new Date() } });
    await svc.onCaseClosed({ id: c.id }, "expired_compensated");
    const p = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id } });
    expect(p[0]).toMatchObject({ active: null, end_reason: "expired" });
    await expect(svc.reassignCase({ orderId: c.order_id, targetAdminId: b.id, actor: actor(), reason: "late" })).rejects.toMatchObject({ statusCode: 409 });
    expect(await svc.claimCase(c.id, { cityId: CITY })).toMatchObject({ claimed: false });
  });

  it("hardening (a): an admin with no city fails closed (404) on a city case and on an executive with no city", async () => {
    const noCity = await db.makeAdmin(prisma, null, "admin");
    const nc = { id: noCity.id, role: "admin", cityId: null };
    const c = await db.makeCase(prisma, CITY);
    await expect(svc.reassignCase({ orderId: c.order_id, targetAdminId: null, actor: nc, reason: "x" })).rejects.toMatchObject({ statusCode: 404 });
    const execNoCity = await db.makeExec(prisma, null);
    await expect(svc.setCapacity(execNoCity.id, 3, nc)).rejects.toMatchObject({ statusCode: 404 });
    for (const bad of [0, -1, undefined]) {
      expect(() => svc.assertCityAccess({ role: "admin", cityId: bad }, 0)).toThrow(expect.objectContaining({ statusCode: 404 }));
    }
  });

  it("hardening (b): onCaseClosed ignores non-closed statuses and a case that is still open in the DB", async () => {
    const a = await db.makeExec(prisma, CITY);
    const c = await db.makeCase(prisma, CITY); await claimed(c, a);
    expect(await svc.onCaseClosed({ id: c.id }, "open")).toBe(0);
    expect(await svc.onCaseClosed({ id: c.id }, "bogus")).toBe(0);
    expect(await svc.onCaseClosed({ id: c.id }, "resolved_assigned")).toBe(0); // DB row still open
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(1);
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { status: "resolved_assigned", closed_at: new Date() } });
    expect(await svc.onCaseClosed({ id: c.id }, "resolved_assigned")).toBe(1);
    expect((await prisma.guarantee_assignment.findFirst({ where: { case_id: c.id } })).end_reason).toBe("resolved");

    const c2 = await db.makeCase(prisma, CITY); await claimed(c2, a);
    await prisma.booking_guarantee_case.update({ where: { id: c2.id }, data: { status: "cancelled", closed_at: new Date() } });
    expect(await svc.onCaseClosed({ id: c2.id }, "cancelled")).toBe(1);
    expect((await prisma.guarantee_assignment.findFirst({ where: { case_id: c2.id } })).end_reason).toBe("cancelled");
  });

  it("hardening (c): onCaseOpened uses the case's own city and ignores a mismatching caller city", async () => {
    await db.makeExec(prisma, CITY);
    const mismatch = await db.makeCase(prisma, CITY, { queue_state: null });
    expect(await svc.onCaseOpened(mismatch, 9)).toEqual({ queued: false });
    expect(await prisma.booking_guarantee_case.findUnique({ where: { id: mismatch.id } })).toMatchObject({ queue_state: null, owner_admin_id: null });
    const nullCity = await db.makeCase(prisma, null, { queue_state: null });
    expect(await svc.onCaseOpened(nullCity, CITY)).toEqual({ queued: false });
    const ok = await db.makeCase(prisma, CITY, { queue_state: null });
    expect(await svc.onCaseOpened(ok, 9)).toEqual({ queued: false });
    expect(await svc.onCaseOpened(ok, CITY)).toMatchObject({ queued: true });
  });
});

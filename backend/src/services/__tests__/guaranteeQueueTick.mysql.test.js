const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);
const min = (n) => n * 60 * 1000;

// Changing a GLOBAL MySQL variable is allowed ONLY on the throwaway test server (explicit opt-in + loopback host + port 3399).
const globalTuningAllowed = (env) => {
  if (env.GUARANTEE_TEST_ALLOW_GLOBAL_TUNING !== "1") return false;
  try {
    const u = new URL(env.GUARANTEE_TEST_DATABASE_URL || "");
    return (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === "3399";
  } catch (e) { return false; }
};
// When not allowed this test is reported as SKIPPED by jest (never silently green).
const itTuning = globalTuningAllowed(process.env) ? it : it.skip;

db.describeMysql("guarantee queue tick (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");

  // a 10-minute window that opened `elapsedMin` minutes ago
  const windowCase = (elapsedMin, o = {}) => {
    const now = Date.now();
    return db.makeCase(prisma, CITY, { opened_at: new Date(now - min(elapsedMin)), deadline_at: new Date(now + min(10 - elapsedMin)), ...o });
  };
  const own = async (c, exec) => {
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: exec.id, queue_state: "assigned", owner_assigned_at: new Date(Date.now() - min(1)) } });
    await prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: exec.id, source: "auto", active: 1 } });
  };
  const alerts = (kind) => adminSocket.notifyDispatchAlert.mock.calls.filter((x) => x[3]?.kind === kind);

  beforeEach(async () => {
    jest.clearAllMocks();
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY, { exec_default_capacity: 5 });
  });
  afterAll(() => prisma.$disconnect());

  it("retries unassigned cases each tick, nearest deadline first, once an executive appears", async () => {
    const soon = await windowCase(8); const later = await windowCase(1);
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: soon.id } })).queue_state).toBe("unassigned");
    const e = await db.makeExec(prisma, CITY); await db.setProfile(prisma, e.id, { capacity: 1 });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: soon.id } })).owner_admin_id).toBe(e.id); // nearest deadline wins the only slot
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: later.id } })).queue_state).toBe("unassigned");
  });

  it("AC-8: the reminder fires exactly once even when two ticks run concurrently", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await windowCase(6); await own(c, e); // 60% elapsed
    await Promise.all([svc.tick(), svc.tick(), svc.tick()]);
    await svc.tick();
    expect((await db.events(prisma, c.id)).filter((x) => x === "exec_reminder_sent")).toHaveLength(1);
    expect(alerts("guarantee_reminder")).toHaveLength(1);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).reminded_at).toBeInstanceOf(Date);
  });

  it("AC-8 / Review Focus 5: escalation fires once at 75% and marks an owned case escalated; a window already past both thresholds sends reminder and escalation once each", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await windowCase(9); await own(c, e); // 90% elapsed: both due on the first tick
    await Promise.all([svc.tick(), svc.tick()]);
    await svc.tick();
    const ev = await db.events(prisma, c.id);
    expect(ev.filter((x) => x === "exec_reminder_sent")).toHaveLength(1);
    expect(ev.filter((x) => x === "exec_escalated")).toHaveLength(1);
    expect(alerts("guarantee_escalated")).toHaveLength(1);
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.queue_state).toBe("escalated");
    expect(row.owner_admin_id).toBe(e.id);
  });

  it("escalating an UNASSIGNED case keeps it unassigned (it still has no owner) but alerts supervisors", async () => {
    const c = await windowCase(9);
    await svc.tick();
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.escalated_at).toBeInstanceOf(Date);
    expect(row.queue_state).toBe("unassigned");
  });

  it("idle auto-reassign hands the case to another executive with source escalation and keeps the deadline (only if time remains)", async () => {
    await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { auto_reassign_idle_minutes: 2 } });
    settings._resetCache();
    const idle = await db.makeExec(prisma, CITY); const fresh = await db.makeExec(prisma, CITY);
    const c = await windowCase(4);
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: idle.id, queue_state: "assigned", owner_assigned_at: new Date(Date.now() - min(3)) } });
    await prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: idle.id, source: "auto", active: 1 } });
    await svc.tick();
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row.owner_admin_id).toBe(fresh.id);
    expect(row.deadline_at.getTime()).toBe(c.deadline_at.getTime());
    const periods = await prisma.guarantee_assignment.findMany({ where: { case_id: c.id }, orderBy: { id: "asc" } });
    expect(periods[0]).toMatchObject({ admin_id: idle.id, active: null, end_reason: "idle_auto_reassign" });
    expect(periods[1]).toMatchObject({ admin_id: fresh.id, active: 1, source: "escalation" });
    // too little time left: no handover
    const late = await db.makeCase(prisma, CITY, { opened_at: new Date(Date.now() - min(10)), deadline_at: new Date(Date.now() + 5000) });
    await prisma.booking_guarantee_case.update({ where: { id: late.id }, data: { owner_admin_id: idle.id, queue_state: "assigned", owner_assigned_at: new Date(Date.now() - min(9)) } });
    await prisma.guarantee_assignment.create({ data: { case_id: late.id, admin_id: idle.id, source: "auto", active: 1 } });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: late.id } })).owner_admin_id).toBe(idle.id);
  });

  it("Review Focus 1: an owner who became unavailable or was deactivated is replaced on the next tick, or the case returns to unassigned", async () => {
    const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
    const c = await windowCase(1); await own(c, a);
    await db.setProfile(prisma, a.id, { available: 0 });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).owner_admin_id).toBe(b.id);

    await prisma.admin.update({ where: { id: b.id }, data: { status: false } });
    await svc.tick();
    const row = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(row).toMatchObject({ owner_admin_id: null, queue_state: "unassigned" });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id, active: 1 } })).toBe(0);
  });

  it("Review Focus 4: with the city flag OFF mid-flight nothing is assigned, reminded or escalated, but repair still runs", async () => {
    const e = await db.makeExec(prisma, CITY);
    const un = await windowCase(9);
    const owned = await windowCase(9); await own(owned, e);
    const closed = await db.makeCase(prisma, CITY, { status: "cancelled", closed_at: new Date() });
    await prisma.guarantee_assignment.create({ data: { case_id: closed.id, admin_id: e.id, source: "auto", active: 1 } });
    await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { exec_queue_enabled: false } });
    settings._resetCache();
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: un.id } })).owner_admin_id).toBeNull();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: owned.id } })).reminded_at).toBeNull();
    expect(alerts("guarantee_reminder")).toHaveLength(0);
    expect(await prisma.guarantee_assignment.count({ where: { case_id: closed.id, active: 1 } })).toBe(0);
  });

  it("AC-15 / Review Focus 3: repair ends active periods of closed cases (mapped end_reason) and reconciles owner/period mismatches, with an audit row", async () => {
    const e = await db.makeExec(prisma, CITY);
    const expired = await db.makeCase(prisma, CITY, { status: "expired_compensated", closed_at: new Date() });
    await prisma.guarantee_assignment.create({ data: { case_id: expired.id, admin_id: e.id, source: "auto", active: 1 } });
    const noPeriod = await windowCase(1);
    await prisma.booking_guarantee_case.update({ where: { id: noPeriod.id }, data: { owner_admin_id: e.id, queue_state: "assigned", owner_assigned_at: new Date() } });
    const noOwner = await windowCase(1);
    await prisma.guarantee_assignment.create({ data: { case_id: noOwner.id, admin_id: e.id, source: "auto", active: 1 } });
    await svc.tick();
    expect((await prisma.guarantee_assignment.findFirst({ where: { case_id: expired.id } }))).toMatchObject({ active: null, end_reason: "expired" });
    expect(await prisma.guarantee_assignment.count({ where: { case_id: noPeriod.id, active: 1 } })).toBe(1);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: noOwner.id } })).owner_admin_id).toBe(e.id);
    expect(await db.events(prisma, expired.id)).toContain("exec_assignment_repaired");
  });

  it("does not touch cases whose deadline has passed (the expiry sweeper owns those) or cases without queue_state", async () => {
    const e = await db.makeExec(prisma, CITY);
    const past = await db.makeCase(prisma, CITY, { opened_at: new Date(Date.now() - min(20)), deadline_at: new Date(Date.now() - min(1)) });
    const legacy = await db.makeCase(prisma, CITY, { queue_state: null });
    await svc.tick();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: past.id } })).owner_admin_id).toBeNull();
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: legacy.id } }))).toMatchObject({ owner_admin_id: null, queue_state: null });
    expect(e.id).toBeTruthy();
  });

  const reload = (id) => prisma.booking_guarantee_case.findUnique({ where: { id } });
  const pastCase = (o = {}) => db.makeCase(prisma, CITY, { opened_at: new Date(Date.now() - min(20)), deadline_at: new Date(Date.now() - min(1)), ...o });

  it("R3: repair ends the active period of a CANCELLED case (end_reason cancelled) and of a resolved_assigned case (resolved)", async () => {
    const e = await db.makeExec(prisma, CITY);
    const cancelled = await db.makeCase(prisma, CITY, { status: "cancelled", closed_at: new Date() });
    const resolved = await db.makeCase(prisma, CITY, { status: "resolved_assigned", closed_at: new Date() });
    for (const c of [cancelled, resolved]) await prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: e.id, source: "auto", active: 1 } });
    const out = await svc.tick();
    expect(out.repaired).toBe(2);
    expect(await prisma.guarantee_assignment.findFirst({ where: { case_id: cancelled.id } })).toMatchObject({ active: null, end_reason: "cancelled" });
    expect(await prisma.guarantee_assignment.findFirst({ where: { case_id: resolved.id } })).toMatchObject({ active: null, end_reason: "resolved" });
    expect(await db.events(prisma, cancelled.id)).toContain("exec_assignment_repaired");
    expect(await db.events(prisma, resolved.id)).toContain("exec_assignment_repaired");
  });

  it("R2: owner mismatch repair sets assigned only from null/unassigned; in_progress and escalated are kept", async () => {
    const e = await db.makeExec(prisma, CITY); const other = await db.makeExec(prisma, CITY);
    const a = await pastCase({ queue_state: "unassigned" });
    const b = await pastCase({ queue_state: "in_progress" });
    const c = await pastCase({ queue_state: "escalated", owner_admin_id: other.id });
    const d = await pastCase({ queue_state: null });
    for (const x of [a, b, c, d]) await prisma.guarantee_assignment.create({ data: { case_id: x.id, admin_id: e.id, source: "auto", active: 1 } });
    await svc.repairOrphans(new Date());
    expect(await reload(a.id)).toMatchObject({ owner_admin_id: e.id, queue_state: "assigned" });
    expect(await reload(b.id)).toMatchObject({ owner_admin_id: e.id, queue_state: "in_progress" });
    expect(await reload(c.id)).toMatchObject({ owner_admin_id: e.id, queue_state: "escalated" });
    expect(await reload(d.id)).toMatchObject({ owner_admin_id: e.id, queue_state: "assigned" });
  });

  it("R4: processing never writes status, deadline_at, opened_at or compensation/closure columns, skips past-deadline, NULL queue_state and NULL city cases", async () => {
    const e = await db.makeExec(prisma, CITY);
    const owned = await windowCase(9); await own(owned, e); // gets reminded + escalated
    const un = await windowCase(5); // gets assigned (second executive below) or stays queued
    const e2 = await db.makeExec(prisma, CITY);
    const past = await pastCase();
    const noCity = await windowCase(9, { city_id: null });
    const before = {};
    for (const c of [owned, un, past, noCity]) before[c.id] = await reload(c.id);
    const n = await svc.processOpenCases(new Date());
    expect(n).toBe(2); // owned + un only
    const pick = (r) => ({
      status: r.status, deadline_at: r.deadline_at, opened_at: r.opened_at, compensation_amount: r.compensation_amount,
      compensation_package_id: r.compensation_package_id, wallet_history_id: r.wallet_history_id, closed_at: r.closed_at,
      refunds_done_at: r.refunds_done_at, resolved_by_admin_id: r.resolved_by_admin_id,
    });
    for (const c of [owned, un, past, noCity]) expect(pick(await reload(c.id))).toEqual(pick(before[c.id]));
    expect((await reload(owned.id)).reminded_at).toBeInstanceOf(Date); // it really did process
    expect((await reload(un.id)).owner_admin_id).not.toBeNull();
    expect(e2.id).toBeTruthy();
    expect((await reload(past.id)).reminded_at).toBeNull();
    expect(await reload(noCity.id)).toMatchObject({ reminded_at: null, escalated_at: null, owner_admin_id: null });
  });

  itTuning("R5: tick resolves on an empty DB, and a case whose DB write really fails (row lock timeout) does not stop the next case", async () => {
    await expect(svc.tick()).resolves.toEqual({ processed: 0, repaired: 0 });
    const e = await db.makeExec(prisma, CITY);
    const locked = await windowCase(7); await own(locked, e); // nearest deadline: processed first, needs a reminder
    const good = await windowCase(6); await own(good, e);
    const originalTimeout = Number((await prisma.$queryRaw`SELECT @@GLOBAL.innodb_lock_wait_timeout AS v`)[0].v);
    let changed = false;
    try {
      await prisma.$executeRawUnsafe("SET GLOBAL innodb_lock_wait_timeout = 1");
      changed = true;
      await prisma.$disconnect(); // fresh pool connections pick up the 1s timeout
      let out;
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM booking_guarantee_case WHERE id = ${locked.id} FOR UPDATE`;
        out = await svc.tick(); // maybeRemind on the locked row fails with a lock wait timeout
      }, { timeout: 30000, maxWait: 10000 });
      expect(out).toBeDefined();
      expect(require("../../utils/logger").error).toHaveBeenCalled();
      expect((await reload(locked.id)).reminded_at).toBeNull();
      expect((await reload(good.id)).reminded_at).toBeInstanceOf(Date);
    } finally {
      if (changed) {
        await prisma.$executeRawUnsafe(`SET GLOBAL innodb_lock_wait_timeout = ${originalTimeout}`);
        await prisma.$disconnect();
      }
    }
  });

  it("alert after a same-tick claim carries the NEW owner (reminder threshold already passed)", async () => {
    const c = await windowCase(7); // 70%: reminder due on the first tick, case unowned
    const e = await db.makeExec(prisma, CITY);
    await svc.tick();
    const reminders = alerts("guarantee_reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0][3].owner_admin_id).toBe(e.id);
    expect((await reload(c.id)).owner_admin_id).toBe(e.id);
  });

  it("escalation alert after a same-tick claim carries the new owner and the case ends escalated", async () => {
    const c = await windowCase(9);
    const e = await db.makeExec(prisma, CITY);
    await svc.tick();
    expect(alerts("guarantee_escalated")[0][3].owner_admin_id).toBe(e.id);
    expect(await reload(c.id)).toMatchObject({ owner_admin_id: e.id, queue_state: "escalated" });
  });

  describe("tryAssign / reassignAuto edge rules", () => {
    it("idleBefore: owner who acted after idleBefore is NOT replaced; one who did not, is", async () => {
      const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
      const c = await windowCase(4); await own(c, a);
      const idleBefore = new Date(Date.now() - min(2));
      await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { last_action_at: new Date() } });
      let res = await svc.reassignAuto(await reload(c.id), { cityId: CITY, endReason: "idle_auto_reassign", source: "escalation", idleBefore });
      expect(res.queueState).toBe("unchanged");
      expect((await reload(c.id)).owner_admin_id).toBe(a.id);
      expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(1);

      await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { last_action_at: new Date(Date.now() - min(5)) } });
      res = await svc.reassignAuto(await reload(c.id), { cityId: CITY, endReason: "idle_auto_reassign", source: "escalation", idleBefore });
      expect(res.claimed).toBe(true);
      expect((await reload(c.id)).owner_admin_id).toBe(b.id);
    });

    it("a handover keeps an escalated case escalated with a fresh owner_assigned_at; a non-escalated case becomes assigned", async () => {
      const a = await db.makeExec(prisma, CITY); const b = await db.makeExec(prisma, CITY);
      const esc = await windowCase(8); await own(esc, a);
      await prisma.booking_guarantee_case.update({ where: { id: esc.id }, data: { escalated_at: new Date(), queue_state: "escalated" } });
      const plain = await windowCase(1); await own(plain, a);
      const before = Date.now() - 1500;
      const actor = { id: 1, role: "superadmin", cityId: null };
      await svc.reassignCase({ orderId: esc.order_id, targetAdminId: b.id, actor, reason: "t" });
      await svc.reassignCase({ orderId: plain.order_id, targetAdminId: b.id, actor, reason: "t" });
      const e2 = await reload(esc.id); const p2 = await reload(plain.id);
      expect(e2).toMatchObject({ owner_admin_id: b.id, queue_state: "escalated" });
      expect(e2.owner_assigned_at.getTime()).toBeGreaterThanOrEqual(before);
      expect(p2).toMatchObject({ owner_admin_id: b.id, queue_state: "assigned" });
    });
  });

  describe("idle handover target check", () => {
    const idleCase = async (owner) => {
      await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { auto_reassign_idle_minutes: 2 } });
      settings._resetCache();
      const c = await windowCase(4);
      await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { owner_admin_id: owner.id, queue_state: "assigned", owner_assigned_at: new Date(Date.now() - min(3)) } });
      await prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: owner.id, source: "auto", active: 1 } });
      return c;
    };
    const idleEvents = async (c) => (await db.events(prisma, c.id)).filter((x) => x === "exec_auto_reassigned_idle");

    it("a lone idle executive keeps the case: no audit row, no new period, no release", async () => {
      const idle = await db.makeExec(prisma, CITY);
      const c = await idleCase(idle);
      await svc.tick(); await svc.tick();
      expect((await reload(c.id)).owner_admin_id).toBe(idle.id);
      expect(await idleEvents(c)).toHaveLength(0);
      expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(1);
      expect(await db.events(prisma, c.id)).not.toContain("exec_owner_released");
    });

    it("idle owner plus a second executive at capacity keeps the owner", async () => {
      const idle = await db.makeExec(prisma, CITY); const busy = await db.makeExec(prisma, CITY);
      await db.setProfile(prisma, busy.id, { capacity: 1 });
      const filler = await windowCase(1); await own(filler, busy);
      const c = await idleCase(idle);
      await svc.tick();
      expect((await reload(c.id)).owner_admin_id).toBe(idle.id);
      expect(await idleEvents(c)).toHaveLength(0);
      expect(await prisma.guarantee_assignment.count({ where: { case_id: c.id } })).toBe(1);
    });

    it("idle owner plus a free second executive hands over with exactly one audit row", async () => {
      const idle = await db.makeExec(prisma, CITY);
      const c = await idleCase(idle);
      const fresh = await db.makeExec(prisma, CITY);
      await svc.tick(); await svc.tick();
      expect((await reload(c.id)).owner_admin_id).toBe(fresh.id);
      expect(await idleEvents(c)).toHaveLength(1);
    });
  });

  it("repair step 3 sets owner_assigned_at from the active period's started_at", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await pastCase({ queue_state: "unassigned" });
    const started = new Date(Date.now() - min(7)); started.setMilliseconds(0);
    await prisma.guarantee_assignment.create({ data: { case_id: c.id, admin_id: e.id, source: "auto", active: 1, started_at: started } });
    await svc.repairOrphans(new Date());
    const row = await reload(c.id);
    expect(row.owner_admin_id).toBe(e.id);
    expect(row.owner_assigned_at.getTime()).toBe(started.getTime());
  });

});

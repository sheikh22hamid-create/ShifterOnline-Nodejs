const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../guaranteeOutsideSearch", () => ({ startForCase: jest.fn(), sweep: jest.fn().mockResolvedValue(0), runSearch: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);
const min = (n) => n * 60 * 1000;

db.describeMysql("auto trial driver search + executive queue (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const search = require("../guaranteeOutsideSearch");
  const settings = require("../guaranteeQueueSettings");
  const svc = require("../guaranteeQueueService");
  const cands = require("../guaranteeOutsideCandidateService");

  let seq = 0;
  // A case that opened `agoMin` minutes ago (older = earlier in the queue).
  const makeCase = (agoMin = 1, o = {}) =>
    db.makeCase(prisma, CITY, { opened_at: new Date(Date.now() - min(agoMin)), ...o });
  const addCandidate = (c, o = {}) => {
    seq += 1;
    return cands.createLive({
      caseId: c.id, orderId: c.order_id, riderId: 5000 + seq,
      driver: { name: `Driver ${seq}`, mobile: `98000000${String(seq).padStart(2, "0")}`, vehicle_number: `MP09 AB ${1000 + seq}`, vehicle_name: "Bike", fare: 120 },
      ...o,
    });
  };
  const exec = (o) => db.makeExec(prisma, CITY, o);
  const owner = async (c) => (await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).owner_admin_id;
  const row = (c) => prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
  const actorOf = (e) => ({ id: e.id, role: "executive", cityId: CITY });

  beforeEach(async () => {
    jest.clearAllMocks();
    search.sweep.mockResolvedValue(0);
    settings._resetCache();
    await db.resetDb(prisma);
    await db.enableQueue(prisma, CITY, { exec_auto_outside_search: true });
    settings._resetCache();
  });
  afterAll(() => prisma.$disconnect());

  describe("claimCase in auto mode", () => {
    it("does not hand out (or alert about) a case that has no Trial Driver yet", async () => {
      await exec();
      const c = await makeCase();
      const res = await svc.claimCase(c.id, { cityId: CITY });
      expect(res).toEqual({ claimed: false, reason: "awaiting_driver" });
      expect(await owner(c)).toBeNull();
      expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
      expect(await db.events(prisma, c.id)).not.toContain("exec_no_executive_alert");
    });

    it("hands a case with a ready Trial Driver to a free executive", async () => {
      const e = await exec();
      const c = await makeCase();
      await addCandidate(c);
      const res = await svc.claimCase(c.id, { cityId: CITY });
      expect(res).toMatchObject({ claimed: true, adminId: e.id });
      expect(await owner(c)).toBe(e.id);
    });

    it("an executive holds ONE active case: a second case waits even with a roomy profile capacity", async () => {
      const e = await exec();
      await db.setProfile(prisma, e.id, { capacity: 5 });
      const a = await makeCase(5); const b = await makeCase(1);
      await addCandidate(a); await addCandidate(b);
      expect((await svc.claimCase(a.id, { cityId: CITY })).claimed).toBe(true);
      const second = await svc.claimCase(b.id, { cityId: CITY });
      expect(second).toMatchObject({ claimed: false, reason: "all_at_capacity" });
      expect(await owner(b)).toBeNull();
    });

    it("with the auto switch OFF behaviour is unchanged: a case with no candidate is claimed at once, capacity 5", async () => {
      await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { exec_auto_outside_search: false } });
      settings._resetCache();
      const e = await exec();
      const a = await makeCase(3); const b = await makeCase(2);
      expect((await svc.claimCase(a.id, { cityId: CITY })).claimed).toBe(true);
      expect((await svc.claimCase(b.id, { cityId: CITY })).adminId).toBe(e.id);
    });
  });

  describe("dispatchWaiting", () => {
    it("gives the OLDEST waiting case to the only free executive, once", async () => {
      const e = await exec();
      const old = await makeCase(10); const mid = await makeCase(5); const fresh = await makeCase(1);
      for (const c of [fresh, old, mid]) await addCandidate(c);
      expect(await svc.dispatchWaiting(CITY)).toBe(1);
      expect(await owner(old)).toBe(e.id);
      expect(await owner(mid)).toBeNull();
      expect(await owner(fresh)).toBeNull();
      expect(await svc.dispatchWaiting(CITY)).toBe(0);
    });

    it("distributes across free executives without a double assignment, under concurrent calls", async () => {
      const e1 = await exec(); const e2 = await exec();
      const cases = [await makeCase(9), await makeCase(8), await makeCase(7)];
      for (const c of cases) await addCandidate(c);
      await Promise.all([svc.dispatchWaiting(CITY), svc.dispatchWaiting(CITY), svc.dispatchWaiting(CITY)]);
      const owners = (await Promise.all(cases.map(owner))).filter(Boolean);
      expect(owners).toHaveLength(2);
      expect(new Set(owners)).toEqual(new Set([e1.id, e2.id]));
      const active = await prisma.guarantee_assignment.count({ where: { active: 1 } });
      expect(active).toBe(2);
    });

    it("does nothing when the auto switch is off for the city", async () => {
      await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { exec_auto_outside_search: false } });
      settings._resetCache();
      await exec();
      const c = await makeCase(); await addCandidate(c);
      expect(await svc.dispatchWaiting(CITY)).toBe(0);
    });
  });

  describe("onCaseOpened / onCaseClosed", () => {
    it("auto mode: queues the case, starts the search and does NOT claim even with a free executive", async () => {
      await exec();
      const c = await db.makeCase(prisma, CITY, { queue_state: null });
      expect(await svc.onCaseOpened(c, CITY)).toEqual({ queued: true });
      expect(search.startForCase).toHaveBeenCalledWith(c.id);
      expect((await row(c)).queue_state).toBe("unassigned");
      expect(await owner(c)).toBeNull();
    });

    it("closing a case frees the executive and the oldest waiting case is handed over at once", async () => {
      const e = await exec();
      const a = await makeCase(10); const b = await makeCase(2);
      await addCandidate(a); await addCandidate(b);
      await svc.claimCase(a.id, { cityId: CITY });
      expect(await owner(b)).toBeNull();
      await prisma.booking_guarantee_case.update({ where: { id: a.id }, data: { status: "resolved_assigned", closed_at: new Date() } });
      await svc.onCaseClosed(a, "resolved_assigned");
      expect(await owner(b)).toBe(e.id);
      expect((await prisma.guarantee_outside_candidate.findMany({ where: { case_id: a.id } }))[0].status).toBe("superseded");
    });
  });

  describe("rejectCandidate", () => {
    it("records the rejection, frees the executive, restarts the search and hands over the next waiting case", async () => {
      const e = await exec();
      const a = await makeCase(10); const b = await makeCase(2);
      await addCandidate(a); await addCandidate(b);
      await svc.claimCase(a.id, { cityId: CITY });
      const out = await svc.rejectCandidate({ orderId: a.order_id, actor: actorOf(e), reason: "not suitable" });
      expect(out).toEqual({ released: true });
      const rejected = (await prisma.guarantee_outside_candidate.findMany({ where: { case_id: a.id } }))[0];
      expect(rejected).toMatchObject({ status: "rejected", active: null, rejected_by: e.id, reject_reason: "not suitable" });
      expect(await owner(a)).toBeNull();
      expect((await row(a)).queue_state).toBe("unassigned");
      const period = await prisma.guarantee_assignment.findFirst({ where: { case_id: a.id } });
      expect(period).toMatchObject({ active: null, end_reason: "driver_rejected" });
      expect(search.startForCase).toHaveBeenCalledWith(a.id);
      expect(await owner(b)).toBe(e.id);
      expect(await db.events(prisma, a.id)).toContain("outside_driver_rejected");
    });

    it("a rejected driver can never be offered again for the same order", async () => {
      const e = await exec();
      const a = await makeCase();
      const first = await addCandidate(a);
      await svc.claimCase(a.id, { cityId: CITY });
      await svc.rejectCandidate({ orderId: a.order_id, actor: actorOf(e) });
      const again = await cands.createLive({ caseId: a.id, orderId: a.order_id, riderId: 1, driver: { mobile: first.row.mobile, name: "same" } });
      expect(again.created).toBe(false);
      expect(await cands.hasOffered(a.id, { mobile: first.row.mobile, vehicleNumber: "" })).toBe(true);
    });

    it("only the owning executive may reject (404 for another executive), and not without a live candidate (409)", async () => {
      const e1 = await exec(); const e2 = await exec();
      const a = await makeCase(); await addCandidate(a);
      await svc.claimCase(a.id, { cityId: CITY });
      const ownerId = await owner(a);
      const other = ownerId === e1.id ? e2 : e1;
      await expect(svc.rejectCandidate({ orderId: a.order_id, actor: actorOf(other) })).rejects.toMatchObject({ statusCode: 404 });
      await svc.rejectCandidate({ orderId: a.order_id, actor: actorOf(ownerId === e1.id ? e1 : e2) });
      await expect(svc.rejectCandidate({ orderId: a.order_id, actor: actorOf(ownerId === e1.id ? e1 : e2) })).rejects.toMatchObject({ statusCode: 404 });
    });

    it("a case with no live candidate answers 409 to its owner", async () => {
      const e = await exec();
      const a = await makeCase();
      await prisma.booking_guarantee_case.update({ where: { id: a.id }, data: { owner_admin_id: e.id, queue_state: "assigned" } });
      await prisma.guarantee_assignment.create({ data: { case_id: a.id, admin_id: e.id, source: "auto", active: 1 } });
      await expect(svc.rejectCandidate({ orderId: a.order_id, actor: actorOf(e) })).rejects.toMatchObject({ statusCode: 409 });
    });
  });

  describe("assign rules", () => {
    it("an executive may assign only the offered Trial Driver; admins are unaffected", async () => {
      const e = await exec();
      const a = await makeCase();
      const cand = await addCandidate(a);
      await svc.claimCase(a.id, { cityId: CITY });
      const user = { id: e.id, role: "executive" };
      await expect(svc.assertExecutiveMayAssign(user, a.order_id, 99999)).rejects.toMatchObject({ statusCode: 403 });
      await expect(svc.assertExecutiveMayAssign(user, a.order_id, cand.row.rider_id)).resolves.toBeUndefined();
      await expect(svc.assertExecutiveMayAssign({ id: 1, role: "admin" }, a.order_id, 99999)).resolves.toBeUndefined();
    });

    it("assigning the offered driver marks the candidate assigned", async () => {
      const e = await exec();
      const a = await makeCase();
      const cand = await addCandidate(a);
      await svc.claimCase(a.id, { cityId: CITY });
      await svc.recordAssignmentAction({ orderId: a.order_id, adminId: e.id, riderId: cand.row.rider_id });
      expect((await prisma.guarantee_outside_candidate.findUnique({ where: { id: cand.row.id } })).status).toBe("assigned");
    });
  });

  describe("sweeper tick", () => {
    it("restarts searches via the search sweep and hands a waiting case to a free executive", async () => {
      const e = await exec();
      const c = await makeCase(3); await addCandidate(c);
      const out = await svc.tick(new Date());
      expect(search.sweep).toHaveBeenCalledTimes(1);
      expect(out.searched).toBe(0);
      expect(await owner(c)).toBe(e.id);
    });
    it("a failing search sweep never stops the rest of the tick", async () => {
      search.sweep.mockRejectedValueOnce(new Error("boom"));
      await expect(svc.tick(new Date())).resolves.toMatchObject({ processed: expect.any(Number) });
    });
  });

  describe("admin queue view", () => {
    it("shows the offered driver and the search state next to each case", async () => {
      const reports = require("../guaranteeQueueReports");
      const waiting = await makeCase(3, { search_state: "searching" });
      const offered = await makeCase(2); const c = await addCandidate(offered);
      const rows = await reports.queueList({ cityId: CITY });
      const w = rows.find((r) => r.id === waiting.id); const o = rows.find((r) => r.id === offered.id);
      expect(w).toMatchObject({ search_state: "searching", candidate_name: null, candidate_status: null });
      expect(o).toMatchObject({ candidate_name: c.row.name, candidate_mobile: c.row.mobile, candidate_status: "ready" });
    });
  });

  describe("case detail", () => {
    it("shows the Trial Driver (with online flag) and the order details on one payload", async () => {
      const e = await exec();
      const orderId = await db.makeOrder(prisma, { rid: 0, order_status: 0, o_status: "Pending", city_id: CITY, category: "Bike", pick_name: "Khajrana, Indore", drop_name: "Vijay Nagar, Indore", total_dcharge: 120 });
      const c = await makeCase(1, { order_id: orderId });
      const cand = await addCandidate(c);
      await prisma.$executeRawUnsafe("DELETE FROM tbl_rider WHERE id = ?", cand.row.rider_id);
      await db.insertRow(prisma, "tbl_rider", { id: cand.row.rider_id, a_status: 1, status: 1, city_id: CITY, fmobile: cand.row.mobile });
      await svc.claimCase(c.id, { cityId: CITY });
      const detail = await svc.getCaseDetail(orderId, actorOf(e));
      expect(detail.candidate).toMatchObject({ name: cand.row.name, mobile: cand.row.mobile, vehicle_number: cand.row.vehicle_number, status: "ready", online: true });
      expect(detail.order).toMatchObject({ id: orderId, category: "Bike", pick_name: "Khajrana, Indore", drop_name: "Vijay Nagar, Indore" });
      const mine = await svc.listMyCases(e.id);
      expect(mine.active[0].candidate).toMatchObject({ mobile: cand.row.mobile, online: true });
      expect(mine.active[0].order).toMatchObject({ id: orderId });
    });
  });
});

const db = require("./helpers/mysqlTestDb");
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const CITY = 1;
jest.setTimeout(60000);
const min = (n) => n * 60 * 1000;

db.describeMysql("automatic outside driver search worker (real MySQL)", () => {
  const prisma = require("../../config/db");
  const adminSocket = require("../../sockets/adminSocket");
  const settings = require("../guaranteeQueueSettings");
  const search = require("../guaranteeOutsideSearch");

  let seq = 0;
  const driverN = (n) => ({ name: `Driver ${n}`, mobile: `97000000${String(n).padStart(2, "0")}`, vehicle_number: `MP09 CD ${2000 + n}`, vehicle_name: "Bike", fare: 120 });
  const heldOrder = (o = {}) => db.makeOrder(prisma, { rid: 0, order_status: 0, o_status: "Pending", city_id: CITY, category: "Bike", ...o });
  const makeHeldCase = async (o = {}) => {
    const orderId = await heldOrder();
    return db.makeCase(prisma, CITY, { order_id: orderId, ...o });
  };
  const makeDeps = (drivers) => {
    let i = 0;
    return {
      sleep: jest.fn().mockResolvedValue(),
      lookupFn: jest.fn(async () => ({ driver: drivers[Math.min(i++, drivers.length - 1)], repeat: false })),
      registerFn: jest.fn(async () => { seq += 1; return { rider_id: 7000 + seq, kind: "trial_created" }; }),
    };
  };
  const caseRow = (c) => prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
  const candidatesOf = (c) => prisma.guarantee_outside_candidate.findMany({ where: { case_id: c.id }, orderBy: { id: "asc" } });

  beforeEach(async () => {
    jest.clearAllMocks();
    settings._resetCache();
    await db.resetDb(prisma);
    await db.resetOrders(prisma);
    await db.enableQueue(prisma, CITY, { exec_auto_outside_search: true });
    settings._resetCache();
  });
  afterAll(() => prisma.$disconnect());

  it("finds a driver, stores one live candidate, frees the lease and hands the case to the free executive", async () => {
    const e = await db.makeExec(prisma, CITY);
    const c = await makeHeldCase();
    const deps = makeDeps([driverN(1)]);
    expect(await search.runSearch(c.id, deps)).toEqual({ outcome: "candidate" });
    const cands = await candidatesOf(c);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ status: "ready", active: 1, mobile: driverN(1).mobile });
    const row = await caseRow(c);
    expect(row).toMatchObject({ search_lease_until: null, search_state: null, owner_admin_id: e.id });
    expect(await db.events(prisma, c.id)).toEqual(expect.arrayContaining(["outside_search_started", "outside_driver_found", "outside_trial_created"]));
  });

  it("two workers racing on one case: exactly one searches, the other is busy, one candidate exists", async () => {
    const c = await makeHeldCase();
    const deps = { ...makeDeps([driverN(2)]) };
    deps.lookupFn = jest.fn(async () => { await new Promise((r) => setTimeout(r, 150)); return { driver: driverN(2), repeat: false }; });
    const outcomes = await Promise.all([search.runSearch(c.id, deps), search.runSearch(c.id, deps), search.runSearch(c.id, deps)]);
    expect(outcomes.filter((o) => o.outcome === "busy")).toHaveLength(2);
    expect(outcomes.filter((o) => o.outcome === "candidate")).toHaveLength(1);
    expect(deps.registerFn).toHaveBeenCalledTimes(1);
    expect(await candidatesOf(c)).toHaveLength(1);
  });

  it("a crashed worker's lease blocks a restart until it expires, then the sweeper resumes the case", async () => {
    const c = await makeHeldCase();
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { search_state: "searching", search_lease_until: new Date(Date.now() + min(2)) } });
    const started = [];
    expect(await search.sweep(new Date(), (id) => started.push(id))).toBe(0);
    expect(await search.acquireLease(c.id)).toBe(false);
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { search_lease_until: new Date(Date.now() - 1000) } });
    expect(await search.sweep(new Date(), (id) => started.push(id))).toBe(1);
    expect(started).toEqual([c.id]);
  });

  it("the sweeper skips exhausted cases, cases with a live driver, closed cases and cities with the switch off", async () => {
    const exhausted = await makeHeldCase({ search_state: "exhausted" });
    const offered = await makeHeldCase();
    const closed = await makeHeldCase({ status: "cancelled", closed_at: new Date() });
    await prisma.guarantee_outside_candidate.create({ data: { case_id: offered.id, order_id: offered.order_id, rider_id: 1, mobile: "9111111111", active: 1 } });
    const fresh = await makeHeldCase();
    const started = [];
    await search.sweep(new Date(), (id) => started.push(id));
    expect(started).toEqual([fresh.id]);
    expect(started).not.toContain(exhausted.id);
    expect(started).not.toContain(closed.id);

    await prisma.city_order_settings.update({ where: { city_id: CITY }, data: { exec_auto_outside_search: false } });
    settings._resetCache();
    const off = [];
    await search.sweep(new Date(), (id) => off.push(id));
    expect(off).toEqual([]);
  });

  it("stops when the order is cancelled while searching: no further lookups, no candidate, lease freed", async () => {
    const c = await makeHeldCase();
    const deps = makeDeps([driverN(3)]);
    deps.lookupFn = jest.fn(async () => {
      await prisma.pkg_order.update({ where: { id: c.order_id }, data: { o_status: "Cancelled" } });
      return { driver: null, reason: "no_driver_found" };
    });
    expect((await search.runSearch(c.id, deps)).outcome).toBe("stopped");
    expect(deps.lookupFn).toHaveBeenCalledTimes(1);
    expect(await candidatesOf(c)).toHaveLength(0);
    expect((await caseRow(c)).search_lease_until).toBeNull();
  });

  it("a lookup limit ends as exhausted: state saved, alert sent, and the sweeper does not restart it", async () => {
    const c = await makeHeldCase();
    const deps = makeDeps([driverN(4)]);
    deps.lookupFn = jest.fn().mockRejectedValue(Object.assign(new Error("Lookup limit reached for this order"), { statusCode: 429 }));
    expect((await search.runSearch(c.id, deps)).outcome).toBe("exhausted");
    expect(await caseRow(c)).toMatchObject({ search_state: "exhausted", search_lease_until: null });
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(c.order_id, CITY, expect.any(String), expect.objectContaining({ kind: "outside_search_exhausted" }));
    expect(await search.sweep(new Date(), () => {})).toBe(0);
  });

  it("a registration failure leaves no candidate or half-made record and the next driver is used", async () => {
    const c = await makeHeldCase();
    const deps = makeDeps([driverN(5), driverN(6)]);
    deps.registerFn = jest.fn()
      .mockRejectedValueOnce(new Error("trial create failed"))
      .mockResolvedValueOnce({ rider_id: 7777, kind: "trial_created" });
    expect((await search.runSearch(c.id, deps)).outcome).toBe("candidate");
    const cands = await candidatesOf(c);
    expect(cands).toHaveLength(1);
    expect(cands[0].mobile).toBe(driverN(6).mobile);
    expect(await db.events(prisma, c.id)).toContain("outside_trial_failed");
  });

  it("a driver the executive already rejected is never offered again for the order", async () => {
    const c = await makeHeldCase();
    await prisma.guarantee_outside_candidate.create({
      data: { case_id: c.id, order_id: c.order_id, rider_id: 1, mobile: driverN(7).mobile, vehicle_number: driverN(7).vehicle_number, status: "rejected", active: null },
    });
    const deps = makeDeps([driverN(7), driverN(8)]);
    expect((await search.runSearch(c.id, deps)).outcome).toBe("candidate");
    expect(deps.registerFn).toHaveBeenCalledTimes(1);
    expect((await candidatesOf(c)).filter((x) => x.active === 1)[0].mobile).toBe(driverN(8).mobile);
  });

  it("a worker whose lease was taken over mid-lookup registers nothing and leaves the new owner's lease alone", async () => {
    const c = await makeHeldCase();
    const takeover = new Date(Date.now() + min(5));
    takeover.setMilliseconds(0);
    const deps = makeDeps([driverN(9)]);
    deps.lookupFn = jest.fn(async () => {
      await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { search_lease_until: takeover } });
      return { driver: driverN(9), repeat: false };
    });
    expect((await search.runSearch(c.id, deps)).outcome).toBe("stopped");
    expect(deps.registerFn).not.toHaveBeenCalled();
    expect(await candidatesOf(c)).toHaveLength(0);
    expect((await caseRow(c)).search_lease_until.getTime()).toBe(takeover.getTime());
  });

  it("a case that closes while the trial driver is being registered leaves no live candidate", async () => {
    const c = await makeHeldCase();
    const deps = makeDeps([driverN(10)]);
    deps.registerFn = jest.fn(async () => {
      await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { status: "cancelled", closed_at: new Date() } });
      return { rider_id: 7900, kind: "trial_created" };
    });
    expect((await search.runSearch(c.id, deps)).outcome).toBe("stopped");
    const cands = await candidatesOf(c);
    expect(cands.filter((x) => x.active === 1)).toHaveLength(0);
    expect(cands.every((x) => x.status === "superseded")).toBe(true);
  });
});

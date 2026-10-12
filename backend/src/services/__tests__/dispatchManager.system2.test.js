jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  pkg_order: {
    findUnique: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
    aggregate: jest.fn().mockResolvedValue({ _avg: { cust_rate: null } }),
  },
  tbl_order_requests: { create: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  app_settings: { findFirst: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../pricingEngine", () => {
  const actual = jest.requireActual("../pricingEngine");
  return {
    ...actual,
    getPackageById: jest.fn().mockResolvedValue({ id: 6, title: "Model 1", min_charge: 20, per_km_charge: 5, pickup_per_km_charge: 10 }),
    getActivePlanDiscount: jest.fn().mockResolvedValue(null),
  };
});
jest.mock("../settlementSettings", () => ({
  getSettlementSettings: jest.fn().mockResolvedValue({ enabled: false, driverBlockGraceMinutes: 10 }),
}));
jest.mock("../freeBookingService", () => ({
  getDispatchPoolFilter: jest.fn().mockResolvedValue(null),
  fallbackToNormalDispatch: jest.fn().mockResolvedValue(false),
}));
jest.mock("../bookingGuaranteeService", () => ({
  openForExhaustedOrder: jest.fn().mockResolvedValue(false),
}));
jest.mock("../orderStageService", () => ({
  decideStartStage: jest.fn().mockResolvedValue(null),
  setStage: jest.fn().mockResolvedValue(undefined),
  riderIdsForStage: jest.fn().mockResolvedValue(null),
  offeredRiderIds: jest.fn().mockResolvedValue([]),
}));
jest.mock("../tierPenaltyService", () => ({
  previewForOffer: jest.fn().mockResolvedValue({ pct: 0, amount: 0 }),
  onMiss: jest.fn().mockResolvedValue({ applied: false }),
}));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { OFFERED: "offered", SUPERSEDED: "superseded" },
  logEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock("../pushNotifier");
jest.mock("../walletPrepaymentRefund");

const prisma = require("../../config/db");
const bookingGuaranteeService = require("../bookingGuaranteeService");
const dispatchManager = require("../dispatchManager");
const { SEARCH_RETRY_MS } = require("../../config/constants");

const flush = async (ticks = 24) => { for (let i = 0; i < ticks; i++) await Promise.resolve(); };

const base = {
  id: 601, uid: 7, city_id: 3, plat: "28.70", plong: "77.10", dlat: "28.61", dlong: "77.20", distance: 15.4,
  category: "Bike", pmobile: "9876543210", paddress: "A", daddress: "B", pick_name: "Rahul",
  rid: 0, order_status: 0, o_status: "Pending", allowed_delivery_types: JSON.stringify([6]),
};
const system2Order = (deadlineMs) => ({ ...base, search_system: 2, search_deadline_at: new Date(Date.now() + deadlineMs) });

let emitted;
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  dispatchManager._resetForTests();
  emitted = [];
  dispatchManager.init({ to: (room) => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) });
  prisma.$queryRaw.mockResolvedValue([]); // never any driver
  prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "tok" });
  prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
  prisma.tbl_order_requests.findMany.mockResolvedValue([]); // no rejections
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  prisma.pkg_order.update.mockResolvedValue({});
  bookingGuaranteeService.openForExhaustedOrder.mockResolvedValue(false);
});
afterEach(() => {
  dispatchManager.stopDispatch(base.id, "cancelled_by_user");
  jest.useRealTimers();
});

const cancelledWith = () => prisma.pkg_order.update.mock.calls
  .map(([a]) => a.data).find((d) => d && d.o_status === "Cancelled");
const driverQueries = () => prisma.$queryRaw.mock.calls.length;

describe("System 2 search window", () => {
  it("keeps searching (re-laps) after the cascade is exhausted while the window is open", async () => {
    const order = system2Order(60_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    const afterFirstLap = driverQueries();
    await jest.advanceTimersByTimeAsync(SEARCH_RETRY_MS + 10_000);
    await flush();
    expect(driverQueries()).toBeGreaterThan(afterFirstLap);
    expect(cancelledWith()).toBeUndefined();
    expect(bookingGuaranteeService.openForExhaustedOrder).not.toHaveBeenCalled();
    expect(emitted.filter((e) => e.event === "order:no_driver_found")).toHaveLength(0);
  });

  it("at the deadline with no guarantee cancels once with 'Driver is not available'", async () => {
    const order = system2Order(25_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    const cancelled = prisma.pkg_order.update.mock.calls.map(([a]) => a.data).filter((d) => d && d.o_status === "Cancelled");
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0].cancel_reason).toBe("Driver is not available");
    const events = emitted.filter((e) => e.event === "order:no_driver_found");
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ order_id: "601", reason: "driver_not_available" });
  });

  it("at the deadline an enabled guarantee holds the order instead of cancelling it", async () => {
    bookingGuaranteeService.openForExhaustedOrder.mockResolvedValue(true);
    const order = system2Order(25_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(bookingGuaranteeService.openForExhaustedOrder).toHaveBeenCalledTimes(1);
    expect(cancelledWith()).toBeUndefined();
    expect(emitted.filter((e) => e.event === "order:no_driver_found")).toHaveLength(0);
  });

  it("a customer cancel between laps stops the search: no more driver queries, no cancel write", async () => {
    const order = system2Order(120_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    dispatchManager.stopDispatch(order.id, "cancelled_by_user");
    const queriesAtCancel = driverQueries();
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(driverQueries()).toBe(queriesAtCancel);
    expect(cancelledWith()).toBeUndefined();
  });

  it("a pending re-lap does nothing when the order was assigned in the meantime", async () => {
    const order = system2Order(120_000);
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order });
    await dispatchManager.startDispatch(order);
    await jest.advanceTimersByTimeAsync(10_000);
    await flush();
    prisma.pkg_order.findUnique.mockResolvedValue({ ...order, rid: 9, order_status: 1 });
    const queriesBefore = driverQueries();
    await jest.advanceTimersByTimeAsync(SEARCH_RETRY_MS + 5_000);
    await flush();
    expect(driverQueries()).toBe(queriesBefore);
    expect(cancelledWith()).toBeUndefined();
  });

  it("a System 1 order is unchanged: it cancels right after exhaustion with 'No driver found'", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...base });
    await dispatchManager.startDispatch({ ...base });
    await jest.advanceTimersByTimeAsync(20_000);
    await flush();
    expect(cancelledWith()).toMatchObject({ cancel_reason: "No driver found" });
    expect(emitted.find((e) => e.event === "order:no_driver_found").payload.reason).toBeUndefined();
  });
});

describe("finishSearchWindow", () => {
  it("returns held:true when a guarantee case takes the order", async () => {
    bookingGuaranteeService.openForExhaustedOrder.mockResolvedValue(true);
    const out = await dispatchManager.finishSearchWindow({ ...base, search_system: 2 });
    expect(out).toEqual({ held: true });
    expect(bookingGuaranteeService.openForExhaustedOrder).toHaveBeenCalledWith(expect.objectContaining({ id: 601 }), [6]);
  });

  it("falls through to the cancel when opening the case throws", async () => {
    bookingGuaranteeService.openForExhaustedOrder.mockRejectedValue(new Error("table missing"));
    const out = await dispatchManager.finishSearchWindow({ ...base, search_system: 2 });
    expect(out).toEqual({ held: false });
    expect(cancelledWith()).toMatchObject({ cancel_reason: "Driver is not available" });
  });
});

describe("startup recovery of System 2 orders", () => {
  const sqlText = (call) => (Array.isArray(call[0]) ? call[0].join("?") : String(call[0]));

  it("the stale-order cancel and its refund select both skip System 2 orders", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(0);
    await dispatchManager.reconcileStaleOffersOnStartup();
    const cancelSql = prisma.$executeRaw.mock.calls.map(sqlText).find((s) => s.includes("No driver found (recovered after restart)"));
    const selectSql = prisma.$queryRaw.mock.calls.map(sqlText).find((s) => s.includes("p_method_id = -2"));
    expect(cancelSql).toContain("search_system");
    expect(selectSql).toContain("search_system");
  });

  it("resumes the search for an order whose deadline is still ahead", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockImplementation(async (strings) => (sqlText([strings]).includes("search_system = 2") ? [{ id: 601 }] : []));
    prisma.pkg_order.findUnique.mockResolvedValue(system2Order(60_000));
    await dispatchManager.reconcileStaleOffersOnStartup();
    await flush();
    expect(cancelledWith()).toBeUndefined();
    expect(bookingGuaranteeService.openForExhaustedOrder).not.toHaveBeenCalled();
    expect(require("../orderStageService").offeredRiderIds).toHaveBeenCalledWith(601);
  });

  it("finishes an order whose deadline passed while the server was down", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockImplementation(async (strings) => (sqlText([strings]).includes("search_system = 2") ? [{ id: 601 }] : []));
    prisma.pkg_order.findUnique.mockResolvedValue(system2Order(-5_000));
    await dispatchManager.reconcileStaleOffersOnStartup();
    await flush();
    expect(cancelledWith()).toMatchObject({ cancel_reason: "Driver is not available" });
  });

  it("an order the customer or a driver already closed is left alone", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.$queryRaw.mockImplementation(async (strings) => (sqlText([strings]).includes("search_system = 2") ? [{ id: 601 }] : []));
    prisma.pkg_order.findUnique.mockResolvedValue({ ...system2Order(-5_000), rid: 9, order_status: 1 });
    await dispatchManager.reconcileStaleOffersOnStartup();
    await flush();
    expect(cancelledWith()).toBeUndefined();
  });
});

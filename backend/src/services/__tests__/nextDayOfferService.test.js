jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  pkg_order: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  tbl_order_requests: { findFirst: jest.fn(), updateMany: jest.fn() },
  daily_driver_enrollment: { findMany: jest.fn() },
  next_day_daily_offer: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../nextDaySettings", () => ({ getOfferSeconds: jest.fn().mockResolvedValue(60), getLiveTime: jest.fn().mockResolvedValue("14:00") }));
jest.mock("../pricingEngine", () => ({ getFirstTierPricingContext: jest.fn().mockResolvedValue({ pkg: { id: 1 }, discount: null }) }));
jest.mock("../dispatchManager", () => ({
  offerToInterestedRiders: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined), emitDriverEvent: jest.fn(),
}));
jest.mock("../tieredDispatchSettings", () => ({ isTieredEnabled: jest.fn().mockResolvedValue(false) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const adminSocket = require("../../sockets/adminSocket");
const tieredSettings = require("../tieredDispatchSettings");
const pricingEngine = require("../pricingEngine");
const svc = require("../nextDayOfferService");

const NOW = new Date("2026-10-13T05:00:00Z");
const order = (extra = {}) => ({
  id: 10, uid: 3, city_id: 1, category: "Bike", booking_type: 3, next_day_stage: "arranging", rid: 0, o_status: "Pending",
  schedule_date_time: "2026-10-13", plat: "22.72", plong: "75.86", ...extra,
});
const rider = (id, lat = "22.73", lng = "75.87") => ({ id, status: 1, vehicle: "Bike", rlats: lat, rlongs: lng, full_name: `D${id}` });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue(order());
  prisma.daily_driver_enrollment.findMany.mockResolvedValue([{ rider_id: 1 }, { rider_id: 2 }, { rider_id: 3 }]);
  prisma.next_day_daily_offer.findMany.mockResolvedValue([]);
  prisma.next_day_daily_offer.findFirst.mockResolvedValue(null);
  prisma.next_day_daily_offer.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  prisma.next_day_daily_offer.updateMany.mockResolvedValue({ count: 1 });
  prisma.next_day_daily_offer.update.mockResolvedValue({});
  prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
  tieredSettings.isTieredEnabled.mockResolvedValue(false);
  prisma.tbl_rider.findMany.mockResolvedValue([rider(1), rider(2), rider(3)]);
  dispatchManager.offerToInterestedRiders.mockImplementation(async (o, ids) => ({ offeredRiderIds: ids }));
});

describe("listAvailableDailyDrivers", () => {
  it("excludes riders already offered this order and queries only the trip date's enrolled riders", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([{ rider_id: 2 }]);
    await svc.listAvailableDailyDrivers(order());
    const where = prisma.tbl_rider.findMany.mock.calls[0][0].where;
    expect(where.id.in.sort()).toEqual([1, 3]);
    expect(where).toMatchObject({ status: 1, vehicle: "Bike" });
    expect(prisma.daily_driver_enrollment.findMany.mock.calls[0][0].where.status.in).toEqual(["enrolled", "active"]);
  });
});

describe("offerToDriver", () => {
  it("records the offer and sends a 60 s popup at 90% fare", async () => {
    const row = await svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW });
    expect(row).toMatchObject({ order_id: 10, rider_id: 1, status: "offered", offered_by_admin: 9 });
    expect(row.expires_at.getTime() - NOW.getTime()).toBe(60000);
    const opts = dispatchManager.offerToInterestedRiders.mock.calls[0][4];
    expect(opts).toMatchObject({ ttlMs: 60000, requireOnline: false, fareScale: 0.9 });
    expect(opts.payloadExtras.next_day_daily_offer).toBe("1");
  });
  it("refuses when an offer is already open", async () => {
    prisma.next_day_daily_offer.findFirst.mockResolvedValue({ id: 5 });
    await expect(svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("refuses a rider who is not an available Daily Driver", async () => {
    await expect(svc.offerToDriver({ order: order(), riderId: 99, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 400 });
  });
  it("refuses orders that are not arranging next-day orders", async () => {
    await expect(svc.offerToDriver({ order: order({ next_day_stage: "live" }), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
    await expect(svc.offerToDriver({ order: order({ booking_type: 1 }), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("cancels the row and reports 409 when the driver could not be reached", async () => {
    dispatchManager.offerToInterestedRiders.mockResolvedValue({ offeredRiderIds: [] });
    await expect(svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.next_day_daily_offer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
});

describe("offerToDriver failure handling", () => {
  it("maps a unique-constraint race (P2002) to 409", async () => {
    prisma.next_day_daily_offer.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("cancels the created row and rethrows when pricing/sending throws", async () => {
    pricingEngine.getFirstTierPricingContext.mockRejectedValueOnce(new Error("pricing down"));
    await expect(svc.offerToDriver({ order: order(), riderId: 1, adminId: 9, now: NOW })).rejects.toThrow("pricing down");
    expect(prisma.next_day_daily_offer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
});

describe("cascade", () => {
  it("offers to the nearest remaining Daily Driver with no admin attached", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([rider(1, "22.90", "75.90"), rider(3, "22.72", "75.86")]);
    expect(await svc.cascade(10, NOW)).toBe("offered");
    expect(prisma.next_day_daily_offer.create.mock.calls[0][0].data).toMatchObject({ rider_id: 3, offered_by_admin: null });
  });
  it("alerts admin when nobody is left", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    expect(await svc.cascade(10, NOW)).toBe("none_left");
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(10, 1, expect.stringContaining("NEXT-DAY"), expect.objectContaining({ kind: "next_day_none_left" }));
  });
  it("tries the next driver when the first cannot be reached", async () => {
    dispatchManager.offerToInterestedRiders
      .mockResolvedValueOnce({ offeredRiderIds: [] })
      .mockImplementationOnce(async (o, ids) => ({ offeredRiderIds: ids }));
    expect(await svc.cascade(10, NOW)).toBe("offered");
    expect(prisma.next_day_daily_offer.create).toHaveBeenCalledTimes(2);
  });
  it("does nothing for an order that is no longer arranging or already has a driver", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 5 }));
    expect(await svc.cascade(10, NOW)).toBe("skipped");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ next_day_stage: "live" }));
    expect(await svc.cascade(10, NOW)).toBe("skipped");
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
  it("does nothing while another offer is open", async () => {
    prisma.next_day_daily_offer.findFirst.mockResolvedValue({ id: 5 });
    expect(await svc.cascade(10, NOW)).toBe("skipped");
  });
});

describe("onRejected", () => {
  it("closes the offer as rejected and cascades once", async () => {
    await svc.onRejected(10, 1);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { order_id: 10, rider_id: 1, status: "offered" }, data: expect.objectContaining({ status: "rejected" }),
    }));
    expect(dispatchManager.offerToInterestedRiders).toHaveBeenCalledTimes(1);
  });
  it("does not cascade when there was no open offer for that rider", async () => {
    prisma.next_day_daily_offer.updateMany.mockResolvedValue({ count: 0 });
    await svc.onRejected(10, 1);
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
});

describe("reconcileOffers", () => {
  const open = (extra = {}) => ({ id: 1, order_id: 10, rider_id: 1, status: "offered", expires_at: new Date(NOW.getTime() + 30000), ...extra });
  beforeEach(() => prisma.tbl_order_requests.findFirst.mockResolvedValue({ status: "sent" }));

  it("marks the offer accepted when the order now belongs to that driver, without cascading", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 1, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) }));
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
  it("accept wins over expiry when both are true", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open({ expires_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 1, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) }));
    expect(prisma.next_day_daily_offer.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }));
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
  it("cancels the offer and dismisses the popup when someone else got the order or it was cancelled", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 7, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(1, "order:dismiss", expect.objectContaining({ order_id: "10" }));
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({ where: { order_id: 10, rider_id: 1, status: "sent" }, data: { status: "timeout" } });
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
  });
  it("expires an overdue offer and cascades", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open({ expires_at: new Date(NOW.getTime() - 1000) })]);
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }));
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({ where: { order_id: 10, rider_id: 1, status: "sent" }, data: { status: "timeout" } });
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(1, "order:dismiss", expect.objectContaining({ order_id: "10" }));
    expect(dispatchManager.offerToInterestedRiders).toHaveBeenCalledTimes(1);
  });
  it("does not expire or cascade when the request row was already answered; settles accepted if the order is theirs", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open({ expires_at: new Date(NOW.getTime() - 1000) })]);
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 0 });
    prisma.pkg_order.findUnique
      .mockResolvedValueOnce(order())
      .mockResolvedValueOnce(order({ rid: 1, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) }));
    expect(prisma.next_day_daily_offer.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "expired" }) }));
    expect(dispatchManager.offerToInterestedRiders).not.toHaveBeenCalled();
    expect(dispatchManager.emitDriverEvent).not.toHaveBeenCalled();
  });
  it("a throwing offer does not block the next one", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open({ id: 1, order_id: 11 }), open({ id: 2, order_id: 10 })]);
    prisma.pkg_order.findUnique.mockRejectedValueOnce(new Error("db blip")).mockResolvedValue(order({ rid: 1, o_status: "Processing" }));
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith({ where: { id: 2, status: "offered" }, data: expect.objectContaining({ status: "accepted" }) });
  });
  it("treats a reject recorded on the request row as a reject and cascades", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ status: "10" });
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "rejected" }) }));
    expect(dispatchManager.offerToInterestedRiders).toHaveBeenCalledTimes(1);
  });
  it("leaves a fresh, unanswered offer alone", async () => {
    prisma.next_day_daily_offer.findMany.mockResolvedValue([open()]);
    await svc.reconcileOffers(NOW);
    expect(prisma.next_day_daily_offer.updateMany).not.toHaveBeenCalled();
  });
});

describe("goLiveDue", () => {
  it("releases a due unassigned order exactly once and starts normal dispatch", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.next_day_daily_offer.findMany.mockResolvedValue([]);
    expect(await svc.goLiveDue(NOW)).toBe(1);
    expect(prisma.pkg_order.updateMany).toHaveBeenCalledWith({
      where: { id: 10, next_day_stage: "arranging", rid: 0, o_status: "Pending" }, data: { next_day_stage: "live" },
    });
    expect(dispatchManager.startDispatch).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(10, 1, expect.stringContaining("NEXT-DAY"), expect.objectContaining({ kind: "next_day_live" }));
  });
  it("does nothing when another worker already flipped it", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.goLiveDue(NOW)).toBe(0);
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });
  it("cancels the open offer and dismisses its popup before dispatching", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.next_day_daily_offer.findMany.mockResolvedValue([{ id: 1, order_id: 10, rider_id: 4, status: "offered" }]);
    await svc.goLiveDue(NOW);
    expect(prisma.next_day_daily_offer.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(4, "order:dismiss", expect.any(Object));
  });
  it("also kills the request row of the cancelled open offer", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.next_day_daily_offer.findMany.mockResolvedValue([{ id: 1, order_id: 10, rider_id: 4, status: "offered" }]);
    await svc.goLiveDue(NOW);
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({ where: { order_id: 10, rider_id: 4, status: "sent" }, data: { status: "timeout" } });
  });
  it("on startDispatch failure alerts admin, reverts to arranging, does not count it, and still processes the next order", async () => {
    const due = (id) => order({ id, next_day_live_at: new Date(NOW.getTime() - 1000) });
    prisma.pkg_order.findMany.mockResolvedValue([due(10), due(11)]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    dispatchManager.startDispatch.mockRejectedValueOnce(new Error("boom"));
    expect(await svc.goLiveDue(NOW)).toBe(1);
    expect(prisma.pkg_order.updateMany).toHaveBeenCalledWith({
      where: { id: 10, next_day_stage: "live", rid: 0, o_status: "Pending" }, data: { next_day_stage: "arranging" },
    });
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(10, 1, expect.stringContaining("GO-LIVE FAILED"), expect.objectContaining({ kind: "next_day_live_failed" }));
    expect(dispatchManager.startDispatch).toHaveBeenCalledTimes(2);
  });
  it("starts the normal stage when tiered dispatch is on, no stage when off", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([order({ next_day_live_at: new Date(NOW.getTime() - 1000) })]);
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    tieredSettings.isTieredEnabled.mockResolvedValue(true);
    await svc.goLiveDue(NOW);
    expect(dispatchManager.startDispatch.mock.calls[0][2]).toEqual({ stage: "normal" });
    dispatchManager.startDispatch.mockClear();
    tieredSettings.isTieredEnabled.mockResolvedValue(false);
    await svc.goLiveDue(NOW);
    expect(dispatchManager.startDispatch.mock.calls[0][2]).toEqual({});
  });
  it("a throwing order does not block the next one", async () => {
    const due = (id) => order({ id, next_day_live_at: new Date(NOW.getTime() - 1000) });
    prisma.pkg_order.findMany.mockResolvedValue([due(10), due(11)]);
    prisma.pkg_order.updateMany.mockRejectedValueOnce(new Error("db blip")).mockResolvedValue({ count: 1 });
    expect(await svc.goLiveDue(NOW)).toBe(1);
  });
  it("selects only arranging, unassigned, pending next-day orders that are due", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([]);
    await svc.goLiveDue(NOW);
    expect(prisma.pkg_order.findMany.mock.calls[0][0].where).toEqual({
      booking_type: 3, next_day_stage: "arranging", rid: 0, o_status: "Pending", next_day_live_at: { lte: NOW },
    });
  });
});

describe("sweep", () => {
  it("still runs go-live when reconcile fails", async () => {
    prisma.next_day_daily_offer.findMany.mockRejectedValueOnce(new Error("db down"));
    prisma.pkg_order.findMany.mockResolvedValue([]);
    await expect(svc.sweep(NOW)).resolves.toBeUndefined();
    expect(prisma.pkg_order.findMany).toHaveBeenCalled();
  });
});

jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findMany: jest.fn() },
  pkg_category: { findMany: jest.fn(), findFirst: jest.fn() },
  customise_order: { create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  customise_order_stop: { createMany: jest.fn(), findMany: jest.fn() },
  customise_offer: { create: jest.fn(), findMany: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  customise_dismissal: { upsert: jest.fn(), findMany: jest.fn() },
  customise_event: { create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), emitDriverEvent: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyDriverCustomiseOrder: jest.fn().mockResolvedValue(), notifyCustomerCustomiseOffer: jest.fn().mockResolvedValue() }));
jest.mock("../customiseOrderSettings", () => ({
  isEnabled: jest.fn().mockResolvedValue(true),
  getBounds: jest.fn().mockResolvedValue({ minFare: 50, maxFare: 500000, maxWindowHours: 24 }),
}));
jest.mock("../customiseConvertService", () => ({ convert: jest.fn() }), { virtual: true });

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const settings = require("../customiseOrderSettings");
const convertService = require("../customiseConvertService");
const service = require("../customiseOrderService");

const NOW = new Date("2026-10-27T12:00:00Z");
const BODY = {
  pickup: { lat: 22.7, lng: 75.8, address: "A" }, drop: { lat: 22.75, lng: 75.9, address: "B" },
  goods: { description: "Sofa", quantity: 1, weight_kg: 100 },
  initial_fare: 1500, bargain_start_at: "2026-10-27T13:00:00Z", expires_at: "2026-10-27T20:00:00Z",
};
const ORDER = {
  id: 5, uid: 7, city_id: 3, category_name: null, status: "open", goods_weight_kg: 100, initial_fare: 1500,
  bargain_start_at: new Date("2026-10-27T11:00:00Z"), expires_at: new Date("2026-10-27T20:00:00Z"),
};
const RIDER = { id: 11, status: 1, a_status: 1, city_id: 3, vehicle: "Tata Ace", first_name: "Ravi" };

beforeEach(() => {
  jest.resetAllMocks();
  settings.isEnabled.mockResolvedValue(true);
  settings.getBounds.mockResolvedValue({ minFare: 50, maxFare: 500000, maxWindowHours: 24 });
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([ORDER]);
  prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3 });
  prisma.tbl_rider.findUnique.mockResolvedValue(RIDER);
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  prisma.pkg_category.findMany.mockResolvedValue([{ cat_name: "Tata Ace", max_load_kg: 750 }]);
  prisma.customise_order.create.mockResolvedValue({ ...ORDER, id: 5, status: "scheduled" });
  prisma.customise_dismissal.findMany.mockResolvedValue([]);
  prisma.customise_offer.create.mockResolvedValue({ id: 90 });
  prisma.customise_offer.updateMany.mockResolvedValue({ count: 0 });
  prisma.customise_event.findFirst.mockResolvedValue(null);
});

describe("createOrder", () => {
  it("refuses everything while the kill switch is off", async () => {
    settings.isEnabled.mockResolvedValue(false);
    expect(await service.createOrder(7, BODY, { now: NOW })).toMatchObject({ ok: false, msg: "Customise Order is not available" });
    expect(prisma.customise_order.create).not.toHaveBeenCalled();
  });

  it("returns every validation message and writes nothing for an invalid order", async () => {
    const out = await service.createOrder(7, { ...BODY, goods: { description: "Sofa", quantity: 1 } }, { now: NOW });
    expect(out.ok).toBe(false);
    expect(out.errors).toContain("Goods weight is required");
    expect(prisma.customise_order.create).not.toHaveBeenCalled();
  });

  it("saves a future-start order as scheduled with its stops and a created event", async () => {
    const out = await service.createOrder(7, { ...BODY, stops: [{ lat: 22.71, lng: 75.81, address: "S1", goods_desc: "Boxes" }] }, { now: NOW });
    expect(out).toEqual({ ok: true, order_id: 5 });
    expect(prisma.customise_order.create.mock.calls[0][0].data).toMatchObject({ uid: 7, city_id: 3, status: "scheduled", initial_fare: 1500 });
    expect(prisma.customise_order_stop.createMany.mock.calls[0][0].data[0]).toMatchObject({ order_id: 5, seq: 1, goods_desc: "Boxes" });
    expect(prisma.customise_event.create.mock.calls[0][0].data).toMatchObject({ order_id: 5, type: "created" });
  });

  it("opens an order whose start time is now", async () => {
    prisma.customise_order.create.mockResolvedValue({ ...ORDER, status: "open" });
    await service.createOrder(7, { ...BODY, bargain_start_at: NOW.toISOString() }, { now: NOW });
    expect(prisma.customise_order.create.mock.calls[0][0].data.status).toBe("open");
  });
});

describe("driverCounter", () => {
  it("writes nothing once the order has expired", async () => {
    const out = await service.driverCounter(5, 11, 1200, { now: new Date("2026-10-27T20:00:00Z") });
    expect(out).toMatchObject({ ok: false });
    expect(prisma.customise_offer.create).not.toHaveBeenCalled();
  });

  it("writes nothing before the bargaining start", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, bargain_start_at: new Date("2026-10-27T13:00:00Z") }]);
    expect((await service.driverCounter(5, 11, 1200, { now: NOW })).ok).toBe(false);
    expect(prisma.customise_offer.create).not.toHaveBeenCalled();
  });

  it("supersedes the driver's earlier active offer, keeps it, and tells the customer", async () => {
    const out = await service.driverCounter(5, 11, 1200, { now: NOW });
    expect(out).toMatchObject({ ok: true, offer_id: 90 });
    expect(prisma.customise_offer.updateMany).toHaveBeenCalledWith({
      where: { order_id: 5, rider_id: 11, status: "active" }, data: { status: "superseded", decided_at: NOW },
    });
    expect(prisma.customise_offer.create.mock.calls[0][0].data).toMatchObject({ order_id: 5, rider_id: 11, kind: "counter", amount: 1200, status: "active" });
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "customise:offer", expect.objectContaining({ order_id: 5, amount: 1200 }));
  });

  it("rejects an amount outside the fare bounds", async () => {
    expect((await service.driverCounter(5, 11, 10, { now: NOW })).ok).toBe(false);
    expect((await service.driverCounter(5, 11, "abc", { now: NOW })).ok).toBe(false);
  });

  it("rejects a driver whose vehicle cannot carry the goods", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, goods_weight_kg: 900 }]);
    const out = await service.driverCounter(5, 11, 1200, { now: NOW });
    expect(out.ok).toBe(false);
    expect(prisma.customise_offer.create).not.toHaveBeenCalled();
  });
});

describe("driverAccept", () => {
  it("records the accept at the customer's fare and converts the order", async () => {
    convertService.convert.mockResolvedValue({ ok: true, pkg_order_id: 321 });
    const out = await service.driverAccept(5, 11, { now: NOW });
    expect(prisma.customise_offer.create.mock.calls[0][0].data).toMatchObject({ kind: "accept", amount: 1500 });
    expect(convertService.convert).toHaveBeenCalledWith(5, 90);
    expect(out).toMatchObject({ ok: true, pkg_order_id: 321 });
  });

  it("withdraws the offer when conversion fails (for example the driver is busy)", async () => {
    convertService.convert.mockResolvedValue({ ok: false, msg: "Driver already has an active trip" });
    const out = await service.driverAccept(5, 11, { now: NOW });
    expect(out).toMatchObject({ ok: false, msg: "Driver already has an active trip" });
    expect(prisma.customise_offer.updateMany).toHaveBeenLastCalledWith({ where: { id: 90, status: "active" }, data: { status: "withdrawn", decided_at: NOW } });
  });
});

describe("driverDismiss", () => {
  it("is idempotent per order and driver and voids the driver's active offer", async () => {
    await service.driverDismiss(5, 11, { now: NOW });
    await service.driverDismiss(5, 11, { now: NOW });
    expect(prisma.customise_dismissal.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.customise_dismissal.upsert.mock.calls[0][0].where).toEqual({ order_id_rider_id: { order_id: 5, rider_id: 11 } });
    expect(prisma.customise_offer.updateMany).toHaveBeenCalledWith({ where: { order_id: 5, rider_id: 11, status: "active" }, data: { status: "withdrawn", decided_at: NOW } });
  });
});

describe("listOffers", () => {
  it("denies someone who does not own the order", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, uid: 7 });
    expect((await service.listOffers(5, 999)).ok).toBe(false);
    expect(prisma.customise_offer.findMany).not.toHaveBeenCalled();
  });

  it("returns the owner's active offers with the driver's name, newest per driver", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, uid: 7 });
    prisma.customise_offer.findMany.mockResolvedValue([{ id: 90, rider_id: 11, amount: 1200, kind: "counter", status: "active", created_at: NOW }]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 11, first_name: "Ravi", vehicle: "Tata Ace" }]);
    const out = await service.listOffers(5, 7);
    expect(out.offers[0]).toMatchObject({ offer_id: 90, driver_name: "Ravi", amount: 1200, vehicle: "Tata Ace" });
  });
});

describe("customerRejectOffer / customerCancel", () => {
  it("marks only that offer rejected and leaves the order open", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, uid: 7 });
    prisma.customise_offer.findFirst.mockResolvedValue({ id: 90, order_id: 5, rider_id: 11, status: "active" });
    const out = await service.customerRejectOffer(5, 7, 90, { now: NOW });
    expect(out.ok).toBe(true);
    expect(prisma.customise_offer.updateMany).toHaveBeenCalledWith({ where: { id: 90, status: "active" }, data: { status: "rejected_by_customer", decided_at: NOW } });
    expect(prisma.customise_order.updateMany).not.toHaveBeenCalled();
  });

  it("cancels an unassigned order, voids its offers and tells the drivers who bid", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, status: "open" }]);
    prisma.customise_offer.findMany.mockResolvedValue([{ rider_id: 11 }]);
    const out = await service.customerCancel(5, 7, { now: NOW });
    expect(out.ok).toBe(true);
    expect(prisma.customise_order.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: "cancelled" } });
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(11, "customise:closed", { order_id: 5, reason: "cancelled" });
  });

  it("refuses to cancel an order that is already converted", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, status: "converted" }]);
    expect((await service.customerCancel(5, 7, { now: NOW })).ok).toBe(false);
  });
});

describe("expireDue / notifyEligible", () => {
  it("expires due orders and voids their offers", async () => {
    prisma.customise_order.findMany.mockResolvedValue([{ id: 5, uid: 7 }]);
    prisma.customise_offer.findMany.mockResolvedValue([{ rider_id: 11 }]);
    expect(await service.expireDue(NOW)).toBe(1);
    expect(prisma.customise_order.updateMany).toHaveBeenCalledWith({ where: { id: 5, status: { in: ["open", "scheduled"] } }, data: { status: "expired" } });
    expect(prisma.customise_offer.updateMany).toHaveBeenCalledWith({ where: { order_id: 5, status: "active" }, data: { status: "void", decided_at: NOW } });
  });

  it("notifies an eligible driver once per order", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([RIDER]);
    await service.notifyEligible(ORDER, { now: NOW });
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(11, "customise:new", expect.objectContaining({ order_id: 5 }));
    dispatchManager.emitDriverEvent.mockClear();
    prisma.customise_event.findFirst.mockResolvedValue({ id: 1 });
    await service.notifyEligible(ORDER, { now: NOW });
    expect(dispatchManager.emitDriverEvent).not.toHaveBeenCalled();
  });
});

describe("listOpenForDriver", () => {
  it("lists only started, unexpired, eligible, undismissed orders and counts them", async () => {
    prisma.customise_order.findMany.mockResolvedValue([ORDER, { ...ORDER, id: 6 }, { ...ORDER, id: 7, goods_weight_kg: 900 }]);
    prisma.customise_dismissal.findMany.mockResolvedValue([{ order_id: 6 }]);
    prisma.customise_order_stop.findMany.mockResolvedValue([]);
    prisma.customise_offer.findMany.mockResolvedValue([]);
    const out = await service.listOpenForDriver(11, { now: NOW });
    expect(out.orders.map((o) => o.order_id)).toEqual([5]);
    expect(out.count).toBe(1);
    expect(prisma.customise_order.findMany.mock.calls[0][0].where).toMatchObject({ status: "open", bargain_start_at: { lte: NOW }, expires_at: { gt: NOW }, city_id: 3 });
  });

  it("returns zero while the feature is off", async () => {
    settings.isEnabled.mockResolvedValue(false);
    expect(await service.listOpenForDriver(11, { now: NOW })).toEqual({ ok: true, orders: [], count: 0 });
  });
});

describe("customer views", () => {
  it("lists only the caller's own orders with offer counts", async () => {
    prisma.customise_order.findMany.mockResolvedValue([{ ...ORDER, id: 5 }]);
    prisma.customise_offer.findMany.mockResolvedValue([{ order_id: 5 }, { order_id: 5 }]);
    const out = await service.myOrders(7);
    expect(prisma.customise_order.findMany.mock.calls[0][0].where).toEqual({ uid: 7 });
    expect(out.orders[0]).toMatchObject({ order_id: 5, offer_count: 2 });
  });

  it("denies the detail of someone else's order", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ ...ORDER, uid: 7 });
    expect((await service.getOrder(5, 999)).ok).toBe(false);
  });
});

describe("customerAcceptOffer", () => {
  it("refuses an offer id that is not an active offer on the caller's own order (no cross-order conversion)", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, uid: 7 });
    prisma.customise_offer.findFirst.mockResolvedValue(null);
    const out = await service.customerAcceptOffer(5, 7, 4242);
    expect(out.ok).toBe(false);
    expect(prisma.customise_offer.findFirst).toHaveBeenCalledWith({ where: { id: 4242, order_id: 5, status: "active" } });
    expect(convertService.convert).not.toHaveBeenCalled();
  });

  it("converts the chosen active offer for the owner", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, uid: 7 });
    prisma.customise_offer.findFirst.mockResolvedValue({ id: 90, order_id: 5, status: "active" });
    convertService.convert.mockResolvedValue({ ok: true, pkg_order_id: 321 });
    expect(await service.customerAcceptOffer(5, 7, 90)).toEqual({ ok: true, pkg_order_id: 321 });
    expect(convertService.convert).toHaveBeenCalledWith(5, 90);
  });
});

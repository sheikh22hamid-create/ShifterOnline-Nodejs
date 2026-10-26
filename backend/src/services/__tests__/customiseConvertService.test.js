jest.mock("../../config/db", () => ({
  $executeRaw: jest.fn(),
  tbl_rider: { findUnique: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  pkg_category: { findMany: jest.fn() },
  pkg_order: { count: jest.fn(), findUnique: jest.fn() },
  customise_order: { updateMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  customise_order_stop: { findMany: jest.fn() },
  customise_offer: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  customise_event: { create: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), emitDriverEvent: jest.fn(), emitDirectAssign: jest.fn() }));
jest.mock("../tripLifecycle", () => ({ acceptOrder: jest.fn() }));
jest.mock("../../controllers/orderController", () => ({ createOrderCore: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const tripLifecycle = require("../tripLifecycle");
const { createOrderCore } = require("../../controllers/orderController");
const { convert } = require("../customiseConvertService");

const NOW = new Date("2026-10-27T12:00:00Z");
const ORDER = {
  id: 5, uid: 7, city_id: 3, status: "open", p_lat: "22.7", p_lng: "75.8", p_address: "A", d_lat: "22.75", d_lng: "75.9", d_address: "B",
  goods_desc: "Sofa", goods_qty: 2, goods_weight_kg: "120", p_method_id: 1, pkg_order_id: null, agreed_offer_id: null,
};
const OFFER = { id: 90, order_id: 5, rider_id: 11, amount: "1400", status: "active" };
const RIDER = { id: 11, status: 1, a_status: 1, vehicle: "Tata Ace", first_name: "Ravi", last_name: "K", fmobile: "99", vehicle_no: "MP09" };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.customise_order.updateMany.mockResolvedValue({ count: 1 });
  prisma.customise_order.findUnique.mockResolvedValue(ORDER);
  prisma.customise_offer.findFirst.mockResolvedValue(OFFER);
  prisma.customise_offer.updateMany.mockResolvedValue({ count: 1 });
  prisma.customise_offer.findMany.mockResolvedValue([]);
  prisma.customise_order_stop.findMany.mockResolvedValue([]);
  prisma.tbl_rider.findUnique.mockResolvedValue(RIDER);
  prisma.pkg_order.count.mockResolvedValue(0);
  prisma.pkg_category.findMany.mockResolvedValue([{ id: 2, cat_name: "Tata Ace" }]);
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, city_id: "3", sort_order: 1 }]);
  prisma.$executeRaw.mockResolvedValue(1);
  createOrderCore.mockResolvedValue({ ok: true, order: { id: 321 } });
  tripLifecycle.acceptOrder.mockResolvedValue({ success: true });
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 321, uid: 7, rid: 11, order_status: 1, o_status: "Processing" });
});

const lastStatusUpdate = () => prisma.customise_order.update.mock.calls.map((c) => c[0].data.status);

describe("convert", () => {
  it("creates one ride at the agreed fare, assigns the driver, links both ways and closes the other offers", async () => {
    const out = await convert(5, 90, { now: NOW });
    expect(out).toEqual({ ok: true, pkg_order_id: 321 });
    expect(createOrderCore).toHaveBeenCalledTimes(1);
    expect(createOrderCore.mock.calls[0][0]).toMatchObject({
      uid: 7, category: "Tata Ace", deliveryTypeIds: [6], bookingType: 1, agreedFare: 1400, skipDispatch: true, customiseOrderId: 5, cityId: 3,
    });
    expect(tripLifecycle.acceptOrder).toHaveBeenCalledWith(321, 11);
    expect(prisma.customise_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "converted", agreed_fare: 1400, agreed_rider_id: 11, agreed_offer_id: 90, pkg_order_id: 321 },
    });
    expect(prisma.customise_offer.updateMany).toHaveBeenCalledWith({ where: { id: 90 }, data: { status: "accepted", decided_at: NOW } });
    expect(prisma.customise_offer.updateMany).toHaveBeenCalledWith({ where: { order_id: 5, status: "active" }, data: { status: "void", decided_at: NOW } });
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:assigned", expect.objectContaining({ order_id: 321, rider_id: 11, customise_order_id: 5 }));
  });

  it("claims with the server clock, so an expired or not-yet-started order can never convert", async () => {
    await convert(5, 90, { now: NOW });
    expect(prisma.customise_order.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 5, status: "open", bargain_start_at: { lte: NOW }, expires_at: { gt: NOW } }, data: { status: "converting" },
    });
  });

  it("loses the race quietly: no ride is created when the claim finds the order already taken", async () => {
    prisma.customise_order.updateMany.mockResolvedValue({ count: 0 });
    prisma.customise_order.findUnique.mockResolvedValue({ ...ORDER, status: "converting" });
    const out = await convert(5, 90, { now: NOW });
    expect(out).toMatchObject({ ok: false, msg: "This order is no longer available" });
    expect(createOrderCore).not.toHaveBeenCalled();
  });

  it("a repeated accept of the same offer returns the ride already created", async () => {
    prisma.customise_order.updateMany.mockResolvedValue({ count: 0 });
    prisma.customise_order.findUnique.mockResolvedValue({ ...ORDER, status: "converted", pkg_order_id: 321, agreed_offer_id: 90 });
    expect(await convert(5, 90, { now: NOW })).toEqual({ ok: true, pkg_order_id: 321 });
    expect(createOrderCore).not.toHaveBeenCalled();
  });

  it("rejects an offer that belongs to another order or is no longer active, and reopens the order", async () => {
    prisma.customise_offer.findFirst.mockResolvedValue(null);
    const out = await convert(5, 999, { now: NOW });
    expect(out.ok).toBe(false);
    expect(prisma.customise_offer.findFirst).toHaveBeenCalledWith({ where: { id: 999, order_id: 5, status: "active" } });
    expect(createOrderCore).not.toHaveBeenCalled();
    expect(lastStatusUpdate()).toEqual(["open"]);
  });

  it("reopens the order when the driver already has an active trip", async () => {
    prisma.pkg_order.count.mockResolvedValue(1);
    const out = await convert(5, 90, { now: NOW });
    expect(out).toMatchObject({ ok: false, msg: "Driver already has an active trip" });
    expect(createOrderCore).not.toHaveBeenCalled();
    expect(lastStatusUpdate()).toEqual(["open"]);
  });

  it("reopens the order when there is no rate card for the driver's vehicle in the city", async () => {
    prisma.tbl_package.findMany.mockResolvedValue([]);
    const out = await convert(5, 90, { now: NOW });
    expect(out).toMatchObject({ ok: false, msg: "No rate card for this vehicle in your city" });
    expect(lastStatusUpdate()).toEqual(["open"]);
  });

  it("cancels the ride it just created and reopens the order when the driver cannot be assigned", async () => {
    tripLifecycle.acceptOrder.mockResolvedValue({ success: false, msg: "Order already taken or cancelled" });
    const out = await convert(5, 90, { now: NOW });
    expect(out.ok).toBe(false);
    const sql = prisma.$executeRaw.mock.calls.map((c) => String(c[0].join("?")));
    expect(sql.some((q) => q.includes("o_status = 'Cancelled'"))).toBe(true);
    expect(lastStatusUpdate()).toEqual(["open"]);
    expect(prisma.customise_offer.updateMany).not.toHaveBeenCalledWith({ where: { id: 90 }, data: { status: "accepted", decided_at: NOW } });
  });

  it("reopens the order when the ride could not be created", async () => {
    createOrderCore.mockResolvedValue({ ok: false, code: "VALIDATION", msg: "bad coordinates" });
    expect(await convert(5, 90, { now: NOW })).toMatchObject({ ok: false, msg: "bad coordinates" });
    expect(lastStatusUpdate()).toEqual(["open"]);
  });

  it("never uses the customer's wallet-prepay payment method for a negotiated ride", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ ...ORDER, p_method_id: -2 });
    await convert(5, 90, { now: NOW });
    expect(createOrderCore.mock.calls[0][0].pMethodId).toBe(1);
  });
});

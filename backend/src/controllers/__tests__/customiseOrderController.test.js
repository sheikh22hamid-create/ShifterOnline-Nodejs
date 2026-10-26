jest.mock("../../config/db", () => ({
  customise_order: { findMany: jest.fn(), findUnique: jest.fn() },
  customise_order_stop: { findMany: jest.fn() },
  customise_offer: { findMany: jest.fn() },
  customise_event: { findMany: jest.fn() },
  customise_order_timer: { findMany: jest.fn() },
  customise_cancel_fee: { findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../services/customiseCancelPolicy", () => ({ getPolicy: jest.fn(), savePolicy: jest.fn(), assertValid: jest.fn() }));
jest.mock("../../services/customiseOrderSettings", () => ({ isEnabled: jest.fn() }));
jest.mock("../../services/customiseOrderService", () => ({
  createOrder: jest.fn(), myOrders: jest.fn(), getOrder: jest.fn(), listOffers: jest.fn(), customerAcceptOffer: jest.fn(),
  customerRejectOffer: jest.fn(), customerCancel: jest.fn(), listOpenForDriver: jest.fn(), driverAccept: jest.fn(),
  driverCounter: jest.fn(), driverDismiss: jest.fn(),
}));

const prisma = require("../../config/db");
const settings = require("../../services/customiseOrderSettings");
const cancelPolicy = require("../../services/customiseCancelPolicy");
const service = require("../../services/customiseOrderService");
const controller = require("../customiseOrderController");

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

beforeEach(() => {
  jest.resetAllMocks();
  settings.isEnabled.mockResolvedValue(true);
});

describe("customer endpoints", () => {
  it("answers Result:false with the feature's message while the switch is off", async () => {
    settings.isEnabled.mockResolvedValue(false);
    const res = makeRes();
    await controller.create({ body: { user_id: 7 } }, res);
    expect(res.json).toHaveBeenCalledWith({ Result: false, msg: "Customise Order is not available" });
    expect(service.createOrder).not.toHaveBeenCalled();
  });

  it("requires the caller's user id", async () => {
    const res = makeRes();
    await controller.create({ body: {} }, res);
    expect(res.json).toHaveBeenCalledWith({ Result: false, msg: "user_id is required" });
  });

  it("passes the caller's id with the body and returns the new order id", async () => {
    service.createOrder.mockResolvedValue({ ok: true, order_id: 5 });
    const res = makeRes();
    await controller.create({ body: { user_id: 7, initial_fare: 1500 } }, res);
    expect(service.createOrder).toHaveBeenCalledWith(7, { user_id: 7, initial_fare: 1500 });
    expect(res.json).toHaveBeenCalledWith({ Result: true, order_id: 5 });
  });

  it("denies the offers of someone else's order (service says not found)", async () => {
    service.listOffers.mockResolvedValue({ ok: false, msg: "Order not found" });
    const res = makeRes();
    await controller.offers({ body: { user_id: 999, order_id: 5 } }, res);
    expect(res.json).toHaveBeenCalledWith({ Result: false, msg: "Order not found" });
  });
});

describe("driver endpoints", () => {
  it("count returns the badge number", async () => {
    service.listOpenForDriver.mockResolvedValue({ ok: true, orders: [{}, {}], count: 2 });
    const res = makeRes();
    await controller.driverCount({ body: { rider_id: 11 } }, res);
    expect(res.json).toHaveBeenCalledWith({ Result: true, count: 2 });
  });

  it("counter forwards rider, order and amount", async () => {
    service.driverCounter.mockResolvedValue({ ok: true, offer_id: 90 });
    const res = makeRes();
    await controller.driverCounter({ body: { rider_id: 11, order_id: 5, amount: 1200 } }, res);
    expect(service.driverCounter).toHaveBeenCalledWith(5, 11, 1200);
    expect(res.json).toHaveBeenCalledWith({ Result: true, offer_id: 90 });
  });
});

describe("admin endpoints", () => {
  it("scopes the list to the admin's own city", async () => {
    prisma.customise_order.findMany.mockResolvedValue([]);
    prisma.customise_offer.findMany.mockResolvedValue([]);
    prisma.tbl_user.findMany.mockResolvedValue([]);
    const res = makeRes();
    await controller.adminList({ scopedCityId: 3, query: {} }, res);
    expect(prisma.customise_order.findMany.mock.calls[0][0].where).toMatchObject({ city_id: 3 });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: [] }));
  });

  it("refuses the detail of an order in another city", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, city_id: 9 });
    const res = makeRes();
    await controller.adminDetail({ params: { id: "5" }, scopedCityId: 3 }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("admin detail timers", () => {
  it("returns the recorded timer segments with the extra charges", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, city_id: 3 });
    prisma.customise_order_stop.findMany.mockResolvedValue([]);
    prisma.customise_offer.findMany.mockResolvedValue([]);
    prisma.customise_event.findMany.mockResolvedValue([]);
    prisma.customise_cancel_fee.findMany.mockResolvedValue([]);
    prisma.pkg_order.findMany.mockResolvedValue([]);
    prisma.customise_order_timer.findMany.mockResolvedValue([{ segment: "pickup_load", selected_min: 30, elapsed_seconds: 2400, billed_seconds: 600, charge: "20.00" }]);
    const res = makeRes();
    await controller.adminDetail({ params: { id: "5" }, scopedCityId: 3 }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.data.timers).toEqual([expect.objectContaining({ segment: "pickup_load", charge: "20.00" })]);
    expect(prisma.customise_order_timer.findMany).toHaveBeenCalledWith({ where: { order_id: 5 }, orderBy: { id: "asc" } });
  });
});

describe("admin detail penalties", () => {
  it("returns the cancellation penalties actually applied, with the admin share", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, city_id: 3 });
    for (const m of ["customise_order_stop", "customise_offer", "customise_event", "customise_order_timer"]) prisma[m].findMany.mockResolvedValue([]);
    prisma.pkg_order.findMany.mockResolvedValue([]);
    prisma.customise_cancel_fee.findMany.mockResolvedValue([{ side: "driver", charge: "150.00", admin_share: "30.00", recipient_amount: "120.00" }]);
    const res = makeRes();
    await controller.adminDetail({ params: { id: "5" }, scopedCityId: 3 }, res);
    expect(res.json.mock.calls[0][0].data.fees).toEqual([expect.objectContaining({ side: "driver", admin_share: "30.00" })]);
    expect(prisma.customise_cancel_fee.findMany).toHaveBeenCalledWith({ where: { order_id: 5 }, orderBy: { id: "asc" } });
  });
});

describe("cancellation policy settings", () => {
  const body = {
    city_id: 99,
    driver: { mode: "special", fixed: 50, percent: 10, admin_share: 20 },
    customer: { mode: "normal", fixed: 0, percent: 0, admin_share: 0 },
  };

  it("reads both sides for the admin's own city", async () => {
    cancelPolicy.getPolicy.mockImplementation(async (side) => ({ mode: side === "driver" ? "special" : "normal", fixed: 50, percent: 10, adminSharePercent: 20 }));
    const res = makeRes();
    await controller.getSettings({ scopedCityId: 3 }, res);
    expect(cancelPolicy.getPolicy).toHaveBeenCalledWith("driver", 3);
    expect(cancelPolicy.getPolicy).toHaveBeenCalledWith("customer", 3);
    expect(res.json.mock.calls[0][0]).toMatchObject({ success: true, data: { city_id: 3, driver: { mode: "special", admin_share: 20 }, customer: { mode: "normal" } } });
  });

  it("saves into the admin's own city and ignores a city id in the body", async () => {
    const res = makeRes();
    await controller.saveSettings({ scopedCityId: 3, body }, res);
    expect(cancelPolicy.savePolicy).toHaveBeenCalledWith("driver", 3, { mode: "special", fixed: 50, percent: 10, adminSharePercent: 20 });
    expect(cancelPolicy.savePolicy).toHaveBeenCalledWith("customer", 3, expect.objectContaining({ mode: "normal" }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
  });

  it("a super admin without a city saves the global default", async () => {
    await controller.saveSettings({ scopedCityId: null, body }, makeRes());
    expect(cancelPolicy.savePolicy).toHaveBeenCalledWith("driver", null, expect.any(Object));
  });

  it("answers 400 with the reason for an invalid policy and saves NOTHING (not even the valid side)", async () => {
    cancelPolicy.assertValid.mockImplementation((p) => { if (p.mode === "normal") throw new Error("percentage must be between 0 and 100"); });
    const res = makeRes();
    await controller.saveSettings({ scopedCityId: 3, body }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "percentage must be between 0 and 100" });
    expect(cancelPolicy.savePolicy).not.toHaveBeenCalled();
  });
});

describe("admin detail rides (reassignment history)", () => {
  it("lists every ride made from the order, cancelled ones too, with the driver and the cancel reason", async () => {
    prisma.customise_order.findUnique.mockResolvedValue({ id: 5, city_id: 3 });
    for (const m of ["customise_order_stop", "customise_offer", "customise_event", "customise_order_timer", "customise_cancel_fee"]) prisma[m].findMany.mockResolvedValue([]);
    prisma.pkg_order.findMany.mockResolvedValue([
      { id: 321, rid: 11, o_status: "Cancelled", order_status: 4, cancel_reason: "Driver cancelled: breakdown", total_dcharge: 1000, advance_payment: "60", payment_status: 1, cancel_charge: 0 },
      { id: 340, rid: 12, o_status: "Completed", order_status: 5, cancel_reason: null, total_dcharge: 1100, advance_payment: "60", payment_status: 1, cancel_charge: 0 },
    ]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 11, first_name: "Ravi", vehicle: "Tata Ace" }, { id: 12, first_name: "Amit", vehicle: "Tata Ace" }]);
    const res = makeRes();
    await controller.adminDetail({ params: { id: "5" }, scopedCityId: 3 }, res);
    const rides = res.json.mock.calls[0][0].data.rides;
    expect(prisma.pkg_order.findMany.mock.calls[0][0].where).toEqual({ customise_order_id: 5 });
    expect(rides).toEqual([
      expect.objectContaining({ id: 321, driver_name: "Ravi", cancel_reason: "Driver cancelled: breakdown", o_status: "Cancelled" }),
      expect.objectContaining({ id: 340, driver_name: "Amit", o_status: "Completed" }),
    ]);
  });
});

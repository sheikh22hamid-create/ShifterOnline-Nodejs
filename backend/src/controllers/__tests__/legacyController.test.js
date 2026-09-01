jest.mock("../orderController", () => ({ createOrderCore: jest.fn() }));
jest.mock("../../services/tripLifecycle", () => ({ rejectOrder: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));
jest.mock("../../services/dispatchManager", () => ({ stopDispatch: jest.fn(), startDispatch: jest.fn() }));
jest.mock("../../services/pushNotifier", () => ({ notifyCustomerOrderAssigned: jest.fn().mockResolvedValue({ sent: true }) }));

const orderController = require("../orderController");
const legacyController = require("../legacyController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("legacyController.createOrder", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parses PHP's bracket-string delivery_type and passes radius_range/radius_charge through raw", async () => {
    orderController.createOrderCore.mockResolvedValue({ ok: true, order: { id: 501, booking_type: 1 } });

    const req = { body: { uid: "1", category: "Bike", delivery_type: "[6,7]", radius_range: "12", radius_charge: "2", plat: "28.7", plong: "77.1", dlat: "28.8", dlong: "77.2" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    // radius_range/radius_charge are NOT resolved here — orderController.createOrderCore
    // does that itself, since detecting the legacy app's field-swap quirk needs the
    // package's per_km_charge, which isn't available at this layer.
    expect(orderController.createOrderCore).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryTypeIds: [6, 7], radiusRangeRaw: "12", radiusChargeRaw: "2" })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", order_id: 501 }));
  });

  it("falls back through the legacy radius aliases when radius_range/radius_charge are both absent", async () => {
    orderController.createOrderCore.mockResolvedValue({ ok: true, order: { id: 502, booking_type: 1 } });

    const req = { body: { uid: "1", category: "Bike", delivery_type: "6", search_radius: "8" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(orderController.createOrderCore).toHaveBeenCalledWith(expect.objectContaining({ radiusKm: 8 }));
  });

  it("returns a soft failure JSON when delivery_type is empty, matching PHP's shape", async () => {
    const req = { body: { uid: "1", category: "Bike", delivery_type: "" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(orderController.createOrderCore).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ Result: false, msg: "delivery_type required" });
  });

  it("returns 'No package found' when createOrderCore reports INVALID_PACKAGES", async () => {
    orderController.createOrderCore.mockResolvedValue({ ok: false, code: "INVALID_PACKAGES", invalidPackageIds: [6] });

    const req = { body: { uid: "1", category: "Bike", delivery_type: "6" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(res.json).toHaveBeenCalledWith({ Result: false, msg: "No package found" });
  });
});

describe("legacyController.rejectOrder", () => {
  it("calls tripLifecycle.rejectOrder and returns {Result: true}", async () => {
    const tripLifecycle = require("../../services/tripLifecycle");
    const req = { body: { rider_id: "3", order_id: "42" } };
    const res = mockRes();

    await legacyController.rejectOrder(req, res);

    expect(tripLifecycle.rejectOrder).toHaveBeenCalledWith(42, 3);
    expect(res.json).toHaveBeenCalledWith({ Result: true });
  });

  it("returns 400 when rider_id or order_id is missing", async () => {
    const req = { body: { rider_id: "3" } };
    const res = mockRes();

    await legacyController.rejectOrder(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("legacyController.stopDispatch", () => {
  const prisma = require("../../config/db");
  const dispatchManager = require("../../services/dispatchManager");
  const pushNotifier = require("../../services/pushNotifier");

  beforeEach(() => jest.clearAllMocks());

  it("stops the dispatch cascade and returns {Result: true} when no rider is given (cancel path)", async () => {
    const req = { body: { order_id: "42", reason: "cancelled_by_user" } };
    const res = mockRes();

    await legacyController.stopDispatch(req, res);

    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(42, "cancelled_by_user");
    expect(pushNotifier.notifyCustomerOrderAssigned).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ Result: true });
  });

  it("also pushes an order-assigned notification to the customer when accepted_rider_id is given (accept path)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 42, uid: 9, otp: 1234 });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 3, first_name: "Deepak", last_name: "", fmobile: "999", vehicle_no: "MP-01" });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });

    const req = { body: { order_id: "42", reason: "accepted_by_other", accepted_rider_id: "3" } };
    const res = mockRes();

    await legacyController.stopDispatch(req, res);

    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(42, "accepted_by_other");
    expect(pushNotifier.notifyCustomerOrderAssigned).toHaveBeenCalledWith(
      "cust-tok",
      expect.objectContaining({ order_id: 42, rider_name: "Deepak", otp: 1234 })
    );
    expect(res.json).toHaveBeenCalledWith({ Result: true });
  });

  it("returns 400 when order_id is missing", async () => {
    const req = { body: {} };
    const res = mockRes();

    await legacyController.stopDispatch(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

jest.mock("../orderController", () => ({ createOrderCore: jest.fn() }));

const orderController = require("../orderController");
const legacyController = require("../legacyController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("legacyController.createOrder", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parses PHP's bracket-string delivery_type and resolves radius from radius_range", async () => {
    orderController.createOrderCore.mockResolvedValue({ ok: true, order: { id: 501, booking_type: 1 } });

    const req = { body: { uid: "1", category: "Bike", delivery_type: "[6,7]", radius_range: "12", plat: "28.7", plong: "77.1", dlat: "28.8", dlong: "77.2" } };
    const res = mockRes();

    await legacyController.createOrder(req, res);

    expect(orderController.createOrderCore).toHaveBeenCalledWith(
      expect.objectContaining({ deliveryTypeIds: [6, 7], radiusKm: 12 })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", order_id: 501 }));
  });

  it("falls back through the legacy radius aliases when radius_range is absent", async () => {
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

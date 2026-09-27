jest.mock("../../config/db", () => ({
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  tbl_package: { findMany: jest.fn(), findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  pkg_order_stops: { createMany: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]),
}));
jest.mock("../../services/dispatchManager", () => ({
  startDispatch: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require("../../config/db");
const orderController = require("../orderController");
const riderController = require("../riderController");
const pricingEngine = require("../../services/pricingEngine");
const dispatchManager = require("../../services/dispatchManager");

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe("Vehicle Body Type & Surcharge", () => {
  afterEach(() => jest.clearAllMocks());

  describe("riderController.setBodyType", () => {
    it("updates driver body type to covered", async () => {
      prisma.tbl_rider.update.mockResolvedValue({ id: 10, body_type: "covered" });
      const res = makeRes();
      await riderController.setBodyType({ body: { rider_id: 10, body_type: "covered" } }, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { body_type: "covered" },
      });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true, body_type: "covered" }));
    });

    it("rejects an invalid body type", async () => {
      const res = makeRes();
      await riderController.setBodyType({ body: { rider_id: 10, body_type: "invalid_type" } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    });
  });

  describe("orderController.createOrderCore with body_type", () => {
    it("stores body_type and covered_charge on the created order", async () => {
      prisma.app_settings.findFirst.mockResolvedValue({ setting_key: "covered_body_charge", setting_value: "50" });
      prisma.tbl_package.findMany.mockResolvedValue([
        { id: 6, sort_order: 1, min_charge: 50, per_km_charge: 10, title: "Standard" },
      ]);
      prisma.pkg_order.create.mockImplementation(({ data }) => Promise.resolve({ id: 123, ...data }));

      const result = await orderController.createOrderCore({
        uid: 1,
        category: "3 wheeler",
        deliveryTypeIds: [6],
        bookingType: 1,
        plat: "28.61",
        plong: "77.20",
        dlat: "28.65",
        dlong: "77.25",
        distance: 5,
        body_type: "covered",
      });

      expect(result.ok).toBe(true);
      expect(prisma.pkg_order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            body_type: "covered",
            covered_charge: 50,
          }),
        })
      );
      expect(dispatchManager.startDispatch).toHaveBeenCalled();
    });

    it("defaults to any and zero covered_charge when no body_type is specified", async () => {
      prisma.tbl_package.findMany.mockResolvedValue([
        { id: 6, sort_order: 1, min_charge: 50, per_km_charge: 10, title: "Standard" },
      ]);
      prisma.pkg_order.create.mockImplementation(({ data }) => Promise.resolve({ id: 124, ...data }));

      const result = await orderController.createOrderCore({
        uid: 1,
        category: "3 wheeler",
        deliveryTypeIds: [6],
        bookingType: 1,
        plat: "28.61",
        plong: "77.20",
        dlat: "28.65",
        dlong: "77.25",
        distance: 5,
      });

      expect(result.ok).toBe(true);
      expect(prisma.pkg_order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            body_type: "any",
            covered_charge: 0,
          }),
        })
      );
    });
  });

  describe("pricingEngine.getFareEstimate with body_type", () => {
    it("includes covered_body_charge and updates package estimated_fare when body_type is covered", async () => {
      prisma.app_settings.findFirst.mockResolvedValue({ setting_key: "covered_body_charge", setting_value: "40" });
      prisma.tbl_package.findMany.mockResolvedValue([
        { id: 6, cat_id: 24, title: "Standard", min_charge: 100, per_km_charge: 10, service_charge_percent: 0, night_charge_percent: 0 },
      ]);

      const estimate = await pricingEngine.getFareEstimate({
        cat_id: 24,
        plat: 28.61,
        plong: 77.20,
        dlat: 28.65,
        dlong: 77.25,
        body_type: "covered",
      });

      expect(estimate.Result).toBe(true);
      expect(estimate.body_type).toBe("covered");
      expect(estimate.covered_body_charge).toBe(40);
      expect(estimate.packages[0].covered_charge_amount).toBe(40);
    });
  });
});

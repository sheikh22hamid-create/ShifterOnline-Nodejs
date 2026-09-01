jest.mock("../../config/db", () => ({
  tbl_package: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  pkg_order: { create: jest.fn() },
}));
jest.mock("../../services/pricingEngine", () => ({ priceForPackage: jest.fn() }));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyNewOrder: jest.fn() }));
jest.mock("../../utils/geoDistance", () => ({ getRoadDistanceKm: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const dispatchManager = require("../../services/dispatchManager");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { createOrderCore } = require("../orderController");

describe("orderController.createOrderCore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 5 });
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 10 }]);
    pricingEngine.priceForPackage.mockReturnValue({ fare: 50, driverEarning: 40, commission: 5 });
    prisma.pkg_order.create.mockResolvedValue({ id: 501, booking_type: 1 });
  });

  const baseInput = {
    uid: 1,
    category: "Bike",
    deliveryTypeIds: [6],
    bookingType: 1,
    plat: 28.7,
    plong: 77.1,
    paddress: "A",
    pickName: "P",
    pmobile: "999",
    pickType: "",
    dlat: 28.8,
    dlong: 77.2,
    daddress: "B",
    dropName: "D",
    dmobile: "888",
    dropType: "",
    packageWeight: "2 Kg",
    packageCost: 100,
    description: "",
    pMethodId: 1,
    transactionId: "",
    extraMileCharge: 0,
    couId: 0,
    couAmt: 0,
    radiusKm: 10,
    cityId: 2,
    photos: null,
  };

  it("creates the order, prices it from the first tier package, and starts dispatch", async () => {
    const result = await createOrderCore(baseInput);

    expect(result.ok).toBe(true);
    expect(result.order.id).toBe(501);
    expect(pricingEngine.priceForPackage).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }), 5);
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(
      result.order,
      { fare: 50, driverEarning: 40, commission: 5, packageTitle: null }
    );
  });

  it("stores the provided photos string on the created order", async () => {
    await createOrderCore({ ...baseInput, photos: "images/pack_img/a.jpg,images/pack_img/b.jpg" });

    expect(prisma.pkg_order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ photos: "images/pack_img/a.jpg,images/pack_img/b.jpg" }) })
    );
  });

  it("fails validation when deliveryTypeIds is empty", async () => {
    const result = await createOrderCore({ ...baseInput, deliveryTypeIds: [] });

    expect(result.ok).toBe(false);
    expect(result.code).toBe("VALIDATION");
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it("fails with INVALID_PACKAGES when a requested package id doesn't exist", async () => {
    prisma.tbl_package.findMany.mockResolvedValue([]);

    const result = await createOrderCore(baseInput);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_PACKAGES");
    expect(result.invalidPackageIds).toEqual([6]);
  });

  describe("search radius resolution (legacy app field-swap quirk)", () => {
    // Confirmed against a real order dump (cust_api/last_order_debug.json):
    // the app sends the package's per-km RATE in radius_range and the
    // customer's actually-selected km radius in radius_charge.
    it("uses radiusChargeRaw when radiusRangeRaw exactly matches the package's per_km_charge (the swap)", async () => {
      prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 6.75 }]);

      await createOrderCore({ ...baseInput, radiusRangeRaw: 6.75, radiusChargeRaw: 1 });

      expect(prisma.pkg_order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ radius_range: 1 }) })
      );
    });

    it("uses radiusChargeRaw when radiusRangeRaw is implausibly large for a search radius (>20km)", async () => {
      await createOrderCore({ ...baseInput, radiusRangeRaw: 45, radiusChargeRaw: 3 });

      expect(prisma.pkg_order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ radius_range: 3 }) })
      );
    });

    it("uses radiusRangeRaw directly when it's a plausible km value and doesn't match the rate", async () => {
      await createOrderCore({ ...baseInput, radiusRangeRaw: 5, radiusChargeRaw: 0 });

      expect(prisma.pkg_order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ radius_range: 5 }) })
      );
    });

    it("falls back to radiusKm when neither raw field is usable", async () => {
      await createOrderCore({ ...baseInput, radiusKm: 8, radiusRangeRaw: undefined, radiusChargeRaw: undefined });

      expect(prisma.pkg_order.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ radius_range: 8 }) })
      );
    });
  });
});

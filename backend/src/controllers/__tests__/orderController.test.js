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
      { fare: 50, driverEarning: 40, commission: 5 }
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
});

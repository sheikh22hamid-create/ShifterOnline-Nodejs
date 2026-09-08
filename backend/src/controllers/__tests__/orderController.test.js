jest.mock("../../config/db", () => ({
  tbl_package: { findMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn() },
  $queryRaw: jest.fn(),
}));
jest.mock("../../services/pricingEngine", () => ({
  priceForPackage: jest.fn(),
  getActivePlanDiscount: jest.fn().mockResolvedValue(null),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyNewOrder: jest.fn() }));
jest.mock("../../utils/geoDistance", () => ({ getRoadDistanceKm: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const dispatchManager = require("../../services/dispatchManager");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { createOrderCore, createOrder, getOrderDetails } = require("../orderController");

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

  it("creates the order, prices it (no driver known yet, so zero radius charge) from the first tier package, and starts dispatch", async () => {
    const result = await createOrderCore(baseInput);

    expect(result.ok).toBe(true);
    expect(result.order.id).toBe(501);
    // radiusRangeKm=1 (not the customer's 10km search radius, baseInput.radiusKm)
    // — the real radius charge depends on whichever driver actually gets
    // dispatched/accepts, which isn't known yet at order-creation time.
    expect(pricingEngine.priceForPackage).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }), 5, 1, 0, null);
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(
      result.order,
      {
        fare: 50, driverEarning: 40, commission: 5, packageTitle: null,
        pkg: expect.objectContaining({ id: 6 }), discount: null,
      }
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

  it("dispatches cheapest-tier-first by sort_order even when delivery_type arrives out of order", async () => {
    // A client that sent Model 5, Model 1, Model 2 in that array order
    // previously caused the cascade to offer Model 5 first — tier order
    // must come from tbl_package.sort_order, never client array position.
    prisma.tbl_package.findMany.mockResolvedValue([
      { id: 34, per_km_charge: 10, sort_order: 5 }, // Model 5
      { id: 6, per_km_charge: 10, sort_order: 1 }, // Model 1
      { id: 7, per_km_charge: 10, sort_order: 2 }, // Model 2
    ]);

    const result = await createOrderCore({ ...baseInput, deliveryTypeIds: [34, 6, 7] });

    expect(result.ok).toBe(true);
    expect(pricingEngine.priceForPackage).toHaveBeenCalledWith(expect.objectContaining({ id: 6 }), 5, 1, 0, null);
    expect(prisma.pkg_order.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          delivery_type: 6,
          allowed_delivery_types: JSON.stringify([6, 7, 34]),
        }),
      })
    );
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

describe("orderController.createOrder (HTTP handler) — photos pass-through", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 5 });
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 10, sort_order: 1 }]);
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
    pricingEngine.priceForPackage.mockReturnValue({ fare: 50, driverEarning: 40, commission: 5 });
    prisma.pkg_order.create.mockResolvedValue({ id: 777, booking_type: 1 });
  });

  it("passes req.body.photos through to the created order instead of discarding it", async () => {
    const req = {
      body: {
        uid: 1, category: "Bike", delivery_type: [6], booking_type: 1,
        plat: 28.7, plong: 77.1, paddress: "A", pick_name: "P", pmobile: "999", pick_type: "",
        dlat: 28.8, dlong: 77.2, daddress: "B", drop_name: "D", dmobile: "888", drop_type: "",
        package_weight: "2 Kg", package_cost: 100, description: "",
        p_method_id: 1, transaction_id: "", extra_mile_charge: 0, cou_id: 0, cou_amt: 0,
        radius_km: 10, city_id: 2,
        photos: "images/order_photos/abc123.jpg",
      },
    };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await createOrder(req, res);

    expect(prisma.pkg_order.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ photos: "images/order_photos/abc123.jpg" }) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("orderController.getOrderDetails", () => {
  beforeEach(() => jest.clearAllMocks());

  const baseOrder = {
    id: 501, rid: 9, o_status: "Processing", order_status: 1, otp: 1234,
    total_dcharge: 150, d_charge: 130, payment_status: 0, is_rate: 0,
    distance: 5.2, extra_mile_charge: 0, cou_amt: 0, package_weight: 2,
    category: "Bike", booking_type: 1, schedule_date_time: null,
    description: "Fragile", photos: '["images/order/1.jpg","images/order/2.jpg"]',
    odate: new Date("2026-09-08T10:00:00.000Z"), ddate: null,
    pick_type: "Home", drop_type: "Office", pick_name: "Amit", drop_name: "Priya",
    paddress: "Pickup St", daddress: "Drop St", pmobile: "9990001111", dmobile: "9990002222",
  };
  const baseRider = {
    id: 9, first_name: "Rahul", last_name: "Sharma", fmobile: "8880001111",
    profile_picture: "images/rider/9.jpg", vehicle_no: "MP09AB1234", rlats: "22.7", rlongs: "75.8",
  };

  it("returns the full field set the app's TrackingWay screen renders, not just the minimal recovery set", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(baseOrder);
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: 20 }]);
    prisma.tbl_rider.findUnique.mockResolvedValue(baseRider);
    prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: 4.5 } });

    const req = { body: { uid: 1, order_id: 501 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getOrderDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const item = res.json.mock.calls[0][0].OrderProductList[0];
    expect(item).toMatchObject({
      order_id: 501,
      rider_name: "Rahul Sharma",
      rider_img: "images/rider/9.jpg",
      rider_star: "4.5",
      Order_Status: "Processing",
      distance: 5.2,
      package_weight: 2,
      category: "Bike",
      description: "Fragile",
      photos: ["images/order/1.jpg", "images/order/2.jpg"],
      order_deliver_date: null,
      pick_name: "Amit",
      drop_name: "Priya",
      customer_paddress: "Pickup St",
      customer_daddress: "Drop St",
      customer_pmobile: "9990001111",
      customer_dmobile: "9990002222",
      advance_payment: "20",
    });
  });

  // Prisma's enum client value for this status is the schema member name
  // (On_Route), not the "On Route" (space) string the app's status
  // switch/comparisons check for — must be translated, not passed through.
  it('maps the On_Route enum value to "On Route" for the app\'s status comparisons', async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ ...baseOrder, o_status: "On_Route" });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.tbl_rider.findUnique.mockResolvedValue(baseRider);
    prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: null } });

    const req = { body: { uid: 1, order_id: 501 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getOrderDetails(req, res);

    expect(res.json.mock.calls[0][0].OrderProductList[0].Order_Status).toBe("On Route");
  });

  it("falls back to comma-split parsing when photos isn't a JSON array string", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ ...baseOrder, photos: "images/order/1.jpg, images/order/2.jpg" });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.tbl_rider.findUnique.mockResolvedValue(baseRider);
    prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: null } });

    const req = { body: { uid: 1, order_id: 501 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getOrderDetails(req, res);

    expect(res.json.mock.calls[0][0].OrderProductList[0].photos).toEqual([
      "images/order/1.jpg", "images/order/2.jpg",
    ]);
  });

  it("returns 404 when the order doesn't belong to this uid", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null);

    const req = { body: { uid: 1, order_id: 999 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getOrderDetails(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

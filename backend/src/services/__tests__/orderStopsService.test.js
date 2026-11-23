jest.mock("../porterQuoteService", () => ({
  anchorFromOrder: (o) => (o && o.porter_quote && Number(o.porter_quote.fare) > 0 ? { ...o.porter_quote } : null),
  anchorForNewRoute: jest.fn(),
}));
jest.mock("../referralPointsRefund", () => ({ reconcileRideDiscountToFare: jest.fn().mockResolvedValue({}) }));
jest.mock("../../config/db", () => {
  const mockPrisma = {
    pkg_order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    pkg_order_stops: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    pkg_order_wait_timer: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    app_settings: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    driver_trip_event: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    tbl_rider: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };
  return mockPrisma;
});

jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn(),
  getAddStopSettings: jest.fn(),
}));

jest.mock("../dispatchManager", () => ({
  emitDriverEvent: jest.fn(),
  emitCustomerEvent: jest.fn(),
}));

jest.mock("../pushNotifier", () => ({
  notifyDriverStopAdded: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../sockets/adminSocket", () => ({
  notifyOrderStatusUpdate: jest.fn(),
}));

jest.mock("../../utils/geoDistance", () => ({
  getRoadDistanceKm: jest.fn(),
  getMultiStopDistanceKm: jest.fn(),
  haversineKm: jest.fn().mockReturnValue(5),
}));

const prisma = require("../../config/db");
const { reconcileRideDiscountToFare } = require("../referralPointsRefund");
const pricingEngine = require("../pricingEngine");
const dispatchManager = require("../dispatchManager");
const { getMultiStopDistanceKm } = require("../../utils/geoDistance");
const orderStopsService = require("../orderStopsService");

describe("orderStopsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pricingEngine.getAddStopSettings.mockResolvedValue({ maxExtraStops: 2, extraStopCharge: 10 });
    pricingEngine.priceForPackageId.mockResolvedValue({ fare: 220, driverEarning: 190, commission: 15 });
    getMultiStopDistanceKm.mockResolvedValue({ distanceKm: 16 });
    prisma.pkg_order_stops.findMany.mockResolvedValue([]);
    prisma.pkg_order_stops.create.mockResolvedValue({ id: 5 });
  });

  const baseOrder = {
    id: 101,
    uid: 55,
    rid: 22,
    order_status: 1,
    o_status: "Processing",
    plat: "28.5355",
    plong: "77.3910",
    dlat: "28.6000",
    dlong: "77.4000",
    distance: 10.2,
    d_charge: 150,
    total_dcharge: 150,
    delivery_type: 6,
    extra_mile_charge: 0,
  };

  describe("previewAddStop", () => {
    it("calculates the new route distance and fare with the stop appended", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);

      const preview = await orderStopsService.previewAddStop({
        uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1",
      });

      expect(preview.order_id).toBe(101);
      expect(preview.new_distance).toBe(16);
      expect(preview.new_fare).toBe(220);
    });

    it("rejects adding a stop once the max extra stops are already used", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order_stops.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]); // already at cap (2)

      await expect(
        orderStopsService.previewAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 3" })
      ).rejects.toThrow("MAX_STOPS_EXCEEDED");
    });

    it("rejects adding a stop once the trip is completed", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 4, o_status: "Completed" });

      await expect(
        orderStopsService.previewAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" })
      ).rejects.toThrow("ORDER_NOT_ACTIVE");
    });

    it("also rejects it when the driver has arrived at the drop but the drop OTP is not verified yet", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 3, o_status: "On_Route" });
      prisma.pkg_order_wait_timer.findFirst.mockResolvedValue({ drop_arrived_at: new Date(), drop_wait_start: null });

      await expect(
        orderStopsService.previewAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" })
      ).rejects.toThrow("ALREADY_AT_DROP");
    });

    it("rejects adding a stop on-route once the driver has reached the drop", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 3, o_status: "On_Route" });
      prisma.pkg_order_wait_timer.findFirst.mockResolvedValue({ drop_wait_start: new Date() });

      await expect(
        orderStopsService.previewAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" })
      ).rejects.toThrow("ALREADY_AT_DROP");
    });
  });

  describe("adding a stop while on route (order_status 3)", () => {
    const onRoute = { ...baseOrder, order_status: 3, o_status: "On_Route", d_charge: 200, total_dcharge: 200, commission: 15 };

    beforeEach(() => {
      prisma.pkg_order_wait_timer.findFirst.mockResolvedValue(null);
      prisma.pkg_order.findUnique.mockResolvedValue(onRoute);
      // zero-radius fare at the current 10.2km = 150 -> frozen radius amount = 200 - 150 = 50;
      // zero-radius fare on the new route = 260 -> new fare = 310
      pricingEngine.priceForPackageId
        .mockReset()
        .mockResolvedValueOnce({ fare: 150, commission: 15 })
        .mockResolvedValueOnce({ fare: 260, commission: 15 });
    });

    it("carries the frozen radius charge instead of repricing off the driver's live position", async () => {
      const preview = await orderStopsService.previewAddStop({
        uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1",
      });

      expect(preview.new_fare).toBe(310);
      expect(preview.fare_diff).toBe(110);
      // radius arg is 1 (zero radius) on both pricing calls
      expect(pricingEngine.priceForPackageId.mock.calls.every((c) => c[2] === 1)).toBe(true);
    });

    it("confirm saves the carried fare and appends the stop", async () => {
      prisma.pkg_order.update.mockResolvedValue({ ...onRoute, d_charge: 310, driver_earning: 310 });

      await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" });

      expect(prisma.pkg_order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ d_charge: 310, total_dcharge: 310, driver_earning: 310, extra_mile_charge: 10 }),
        })
      );
      expect(prisma.pkg_order_stops.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sequence: 1 }) })
      );
    });
  });

  describe("confirmAddStop", () => {
    it("inserts the stop, bumps extra_mile_charge by the per-stop rate, and updates fare", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order.update.mockResolvedValue({
        ...baseOrder, distance: 16, d_charge: 220, total_dcharge: 220, driver_earning: 190, commission: 15,
        extra_mile_charge: 10,
      });

      const result = await orderStopsService.confirmAddStop({
        uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1",
      });

      expect(result.new_fare).toBe(220);
      expect(prisma.pkg_order_stops.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ order_id: 101, sequence: 1, lat: "28.57", lng: "77.38", address: "Stop 1" }),
        })
      );
      expect(prisma.pkg_order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({ distance: 16, total_dcharge: 220, extra_mile_charge: 10 }),
        })
      );
      expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(
        55, "order:stop_added", expect.objectContaining({ order_id: "101", total: "220" })
      );
    });

    it("re-applies the ride-discount cap to the new fare after the stop is added", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order.update.mockResolvedValue({ ...baseOrder, total_dcharge: 220 });
      await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" });
      expect(reconcileRideDiscountToFare).toHaveBeenCalledWith(101, 220, prisma);
    });

    it("sequences a second stop after the first", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order_stops.findMany.mockResolvedValue([{ id: 1, sequence: 1, lat: "28.56", lng: "77.36" }]);
      prisma.pkg_order.update.mockResolvedValue({ ...baseOrder, extra_mile_charge: 10 });

      await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 2" });

      expect(prisma.pkg_order_stops.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sequence: 2 }) })
      );
    });

    it("gives each stop's driver_trip_event its own milestone so a second stop doesn't collide with driver_trip_event's (order_id, milestone) unique constraint", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order_stops.findMany.mockResolvedValue([{ id: 1, sequence: 1, lat: "28.56", lng: "77.36" }]);
      prisma.pkg_order.update.mockResolvedValue({ ...baseOrder, extra_mile_charge: 10 });

      await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 2" });

      // A shared "stop_added" milestone for every stop throws on the second
      // one (schema.prisma: driver_trip_event @@unique([order_id, milestone])) -
      // each stop needs its own milestone name.
      expect(prisma.driver_trip_event.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ milestone: "stop_added_2" }) })
      );
    });
  });
});

describe("orderStopsService — Porter anchor re-anchoring", () => {
  const { anchorForNewRoute } = require("../porterQuoteService");
  const anchored = {
    id: 101, uid: 55, rid: 22, order_status: 1, o_status: "Processing",
    plat: "28.5355", plong: "77.3910", dlat: "28.6000", dlong: "77.4000",
    distance: 10.2, d_charge: 150, total_dcharge: 150, delivery_type: 6, extra_mile_charge: 0,
    porter_quote: { fare: 300 }, city_id: 7, category: "3 Wheeler",
  };
  const oldAnchor = { fare: 300 };
  const newAnchor = { fare: 420, scaled: true };

  beforeEach(() => {
    jest.clearAllMocks();
    pricingEngine.getAddStopSettings.mockResolvedValue({ maxExtraStops: 2, extraStopCharge: 10 });
    pricingEngine.priceForPackageId.mockReset().mockResolvedValue({ fare: 430, driverEarning: 400, commission: 15 });
    getMultiStopDistanceKm.mockResolvedValue({ distanceKm: 16 });
    prisma.pkg_order_stops.findMany.mockResolvedValue([]);
    prisma.pkg_order_stops.create.mockResolvedValue({ id: 5 });
    prisma.pkg_order_wait_timer.findFirst.mockResolvedValue(null);
    anchorForNewRoute.mockResolvedValue(newAnchor);
  });

  it("re-anchors with the stop on the route and persists it with the new distance", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(anchored);
    prisma.pkg_order.update.mockResolvedValue({ ...anchored, driver_earning: 400 });
    await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" });
    expect(anchorForNewRoute).toHaveBeenCalledWith(anchored, {
      pickup: { lat: 28.5355, lng: 77.391 }, drop: { lat: 28.6, lng: 77.4 }, stops: [{ lat: 28.57, lng: 77.38 }], newDistanceKm: 16,
    });
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 16, 1, 10, 55, null, null, newAnchor);
    expect(prisma.pkg_order.update.mock.calls[0][0].data).toEqual(expect.objectContaining({ distance: 16, porter_quote: newAnchor }));
  });

  it("on route: implied radius uses the OLD anchor for the old route and the NEW anchor for the new route", async () => {
    const onRoute = { ...anchored, order_status: 3, o_status: "On_Route", d_charge: 350, total_dcharge: 350, commission: 15 };
    prisma.pkg_order.findUnique.mockResolvedValue(onRoute);
    pricingEngine.priceForPackageId.mockImplementation(async (_p, d, _r, _e, _u, _s, _m, a) => ({ fare: a === newAnchor ? 420 : a && a.fare === 300 ? 300 : 999, commission: 15 }));
    const preview = await orderStopsService.previewAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" });
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 10.2, 1, 0, 55, null, null, oldAnchor);
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 16, 1, 10, 55, null, null, newAnchor);
    expect(preview.new_fare).toBe(470); // 420 new zero-radius + (350 - 300) carried radius
  });

  it("unanchored order: no porter_quote write", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ ...anchored, porter_quote: null });
    prisma.pkg_order.update.mockResolvedValue({ ...anchored, driver_earning: 400 });
    await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" });
    expect(anchorForNewRoute).not.toHaveBeenCalled();
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 16, 1, 10, 55);
    expect(prisma.pkg_order.update.mock.calls[0][0].data).not.toHaveProperty("porter_quote");
  });
});

describe("orderStopsService — on-route re-anchor failure fails closed", () => {
  const { anchorForNewRoute } = require("../porterQuoteService");
  const { Prisma } = require("@prisma/client");
  const onRoute = {
    id: 101, uid: 55, rid: 22, order_status: 3, o_status: "On_Route",
    plat: "28.5355", plong: "77.3910", dlat: "28.6000", dlong: "77.4000",
    distance: 10.2, d_charge: 350, total_dcharge: 350, delivery_type: 6, extra_mile_charge: 0, commission: 15,
    porter_quote: { fare: 300 }, city_id: 7, category: "3 Wheeler",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    pricingEngine.getAddStopSettings.mockResolvedValue({ maxExtraStops: 2, extraStopCharge: 10 });
    getMultiStopDistanceKm.mockResolvedValue({ distanceKm: 16 });
    prisma.pkg_order_stops.findMany.mockResolvedValue([]);
    prisma.pkg_order_stops.create.mockResolvedValue({ id: 5 });
    prisma.pkg_order_wait_timer.findFirst.mockResolvedValue(null);
    prisma.pkg_order.findUnique.mockResolvedValue(onRoute);
    prisma.pkg_order.update.mockResolvedValue({ ...onRoute });
    anchorForNewRoute.mockResolvedValue(null);
    pricingEngine.priceForPackageId.mockReset().mockImplementation(async (_p, _d, _r, _e, _u, _s, _m, a) => ({ fare: a ? 300 : 260, commission: 15 }));
  });

  it("old route keeps the old anchor, new route uses the rate card, column cleared", async () => {
    await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" });
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 10.2, 1, 0, 55, null, null, { fare: 300 });
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 16, 1, 10, 55);
    const data = prisma.pkg_order.update.mock.calls[0][0].data;
    expect(data.d_charge).toBe(310); // 260 rate card + (350 - 300) carried radius
    expect(data.porter_quote).toBe(Prisma.DbNull);
  });
});

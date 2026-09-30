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

    it("rejects adding a stop once the trip is already on-route (order_status 3)", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 3, o_status: "On_Route" });

      await expect(
        orderStopsService.previewAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 1" })
      ).rejects.toThrow("ORDER_NOT_ACTIVE");
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

    it("sequences a second stop after the first", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order_stops.findMany.mockResolvedValue([{ id: 1, sequence: 1, lat: "28.56", lng: "77.36" }]);
      prisma.pkg_order.update.mockResolvedValue({ ...baseOrder, extra_mile_charge: 10 });

      await orderStopsService.confirmAddStop({ uid: 55, orderId: 101, lat: 28.57, lng: 77.38, address: "Stop 2" });

      expect(prisma.pkg_order_stops.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ sequence: 2 }) })
      );
    });
  });
});

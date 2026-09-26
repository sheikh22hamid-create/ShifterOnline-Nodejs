jest.mock("../../config/db", () => {
  const mockPrisma = {
    pkg_order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    pkg_order_stops: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    tbl_rider: {
      findUnique: jest.fn(),
    },
    driver_trip_event: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn((cb) => cb(mockPrisma)),
  };
  return mockPrisma;
});

jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn(),
}));

jest.mock("../dispatchManager", () => ({
  emitDriverEvent: jest.fn(),
  emitCustomerEvent: jest.fn(),
}));

jest.mock("../pushNotifier", () => ({
  notifyDriverDestinationUpdated: jest.fn().mockResolvedValue(true),
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
const pushNotifier = require("../pushNotifier");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const orderDestinationService = require("../orderDestinationService");

describe("orderDestinationService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 14.5 });
    pricingEngine.priceForPackageId.mockResolvedValue({
      fare: 195,
      driverEarning: 165,
      commission: 15.38,
    });
  });

  const mockActiveOrder = {
    id: 101,
    uid: 55,
    rid: 22,
    order_status: 1, // Accepted/processing
    o_status: "Processing",
    plat: "28.5355",
    plong: "77.3910",
    dlat: "28.6000",
    dlong: "77.4000",
    daddress: "Old Drop Address",
    distance: 10.2,
    d_charge: 150,
    total_dcharge: 150,
    delivery_type: 6,
    pickup_distance_km: 1.5,
    extra_mile_charge: 0,
  };

  describe("previewDestinationChange", () => {
    it("successfully calculates distance and fare difference for valid active order", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(mockActiveOrder);

      const preview = await orderDestinationService.previewDestinationChange({
        uid: 55,
        orderId: 101,
        newDlat: 28.65,
        newDlong: 77.45,
        newDaddress: "New Drop Address, Sector 62",
      });

      expect(preview.order_id).toBe(101);
      expect(preview.old_distance).toBe(10.2);
      expect(preview.new_distance).toBe(14.5);
      expect(preview.distance_diff).toBe(4.3);
      expect(preview.old_fare).toBe(150);
      expect(preview.new_fare).toBe(195);
      expect(preview.fare_diff).toBe(45);
      expect(preview.new_daddress).toBe("New Drop Address, Sector 62");
    });

    it("rejects non-existent order", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(null);

      await expect(
        orderDestinationService.previewDestinationChange({
          uid: 55,
          orderId: 999,
          newDlat: 28.65,
          newDlong: 77.45,
          newDaddress: "Valid Address",
        })
      ).rejects.toThrow("ORDER_NOT_FOUND");
    });

    it("rejects request from unauthorized user (wrong uid)", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(mockActiveOrder);

      await expect(
        orderDestinationService.previewDestinationChange({
          uid: 999, // Wrong UID
          orderId: 101,
          newDlat: 28.65,
          newDlong: 77.45,
          newDaddress: "Valid Address",
        })
      ).rejects.toThrow("FORBIDDEN");
    });

    it("rejects destination change if order is already completed or cancelled", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({
        ...mockActiveOrder,
        order_status: 5,
        o_status: "Completed",
      });

      await expect(
        orderDestinationService.previewDestinationChange({
          uid: 55,
          orderId: 101,
          newDlat: 28.65,
          newDlong: 77.45,
          newDaddress: "Valid Address",
        })
      ).rejects.toThrow("ORDER_NOT_ACTIVE");
    });

    it("rejects invalid coordinates", async () => {
      await expect(
        orderDestinationService.previewDestinationChange({
          uid: 55,
          orderId: 101,
          newDlat: "invalid",
          newDlong: 77.45,
          newDaddress: "Valid Address",
        })
      ).rejects.toThrow("INVALID_COORDINATES");
    });
  });

  describe("confirmDestinationChange", () => {
    it("updates order in transaction, emits socket events, and sends push to driver", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(mockActiveOrder);
      prisma.pkg_order.update.mockResolvedValue({
        ...mockActiveOrder,
        dlat: "28.65",
        dlong: "77.45",
        daddress: "New Drop Address, Sector 62",
        distance: 14.5,
        d_charge: 195,
        total_dcharge: 195,
        driver_earning: 165,
        commission: 15.38,
      });
      prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "test_driver_fcm_token" });

      const result = await orderDestinationService.confirmDestinationChange({
        uid: 55,
        orderId: 101,
        newDlat: 28.65,
        newDlong: 77.45,
        newDaddress: "New Drop Address, Sector 62",
      });

      expect(result.order_id).toBe(101);
      expect(result.new_fare).toBe(195);
      expect(result.fare_diff).toBe(45);

      // Verify DB update
      expect(prisma.pkg_order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({
            dlat: "28.65",
            dlong: "77.45",
            daddress: "New Drop Address, Sector 62",
            distance: 14.5,
            total_dcharge: 195,
          }),
        })
      );

      // Verify audit event creation
      expect(prisma.driver_trip_event.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            order_id: 101,
            rider_id: 22,
            milestone: "destination_updated",
          }),
        })
      );

      // Verify socket events emitted to driver and customer
      expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(
        22,
        "order:destination_updated",
        expect.objectContaining({
          order_id: "101",
          daddress: "New Drop Address, Sector 62",
          total: "195",
        })
      );
      expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(
        55,
        "order:destination_updated",
        expect.objectContaining({
          order_id: "101",
          total: "195",
        })
      );

      // Verify push notification
      expect(pushNotifier.notifyDriverDestinationUpdated).toHaveBeenCalledWith(
        "test_driver_fcm_token",
        101,
        "New Drop Address, Sector 62",
        195
      );
    });
  });
});

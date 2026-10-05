jest.mock("../referralPointsRefund", () => ({ reconcileRideDiscountToFare: jest.fn().mockResolvedValue({}) }));
jest.mock("../../config/db", () => {
  const mockPrisma = {
    pkg_order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    pkg_order_stops: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    pkg_order_wait_timer: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    tbl_rider: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    driver_trip_event: {
      create: jest.fn().mockResolvedValue({ id: 1 }),
      upsert: jest.fn().mockResolvedValue({ id: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
  notifyDriverPickupUpdated: jest.fn().mockResolvedValue(true),
}));

jest.mock("../../sockets/adminSocket", () => ({
  notifyOrderStatusUpdate: jest.fn(),
}));

jest.mock("../../utils/geoDistance", () => ({
  getRoadDistanceKm: jest.fn(),
  getMultiStopDistanceKm: jest.fn(),
  haversineKm: jest.fn().mockReturnValue(5),
}));

jest.mock("../../utils/pickupRelocateSettings", () => ({
  getPickupRelocateSettings: jest.fn().mockResolvedValue({
    ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0,
  }),
}));

const prisma = require("../../config/db");
const { reconcileRideDiscountToFare } = require("../referralPointsRefund");
const pricingEngine = require("../pricingEngine");
const dispatchManager = require("../dispatchManager");
const pushNotifier = require("../pushNotifier");
const { getRoadDistanceKm, haversineKm } = require("../../utils/geoDistance");
const orderPickupService = require("../orderPickupService");

describe("orderPickupService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getRoadDistanceKm.mockResolvedValue({ distanceKm: 8.5 });
    pricingEngine.priceForPackageId.mockResolvedValue({
      fare: 180,
      driverEarning: 150,
      commission: 15,
    });
    prisma.pkg_order_stops.findMany.mockResolvedValue([]);
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
  });

  const baseOrder = {
    id: 101,
    uid: 55,
    rid: 22,
    order_status: 1, // driver accepted, heading to pickup
    o_status: "Processing",
    plat: "28.5355",
    plong: "77.3910",
    dlat: "28.6000",
    dlong: "77.4000",
    paddress: "Old Pickup Address",
    distance: 10.2,
    d_charge: 150,
    total_dcharge: 150,
    delivery_type: 6,
    extra_mile_charge: 0,
  };

  describe("previewPickupChange", () => {
    it("calculates distance and fare difference for a valid active order", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);

      const preview = await orderPickupService.previewPickupChange({
        uid: 55,
        orderId: 101,
        newPlat: 28.6,
        newPlong: 77.45,
        newPaddress: "New Pickup Address",
      });

      expect(preview.order_id).toBe(101);
      expect(preview.new_distance).toBe(8.5);
      expect(preview.old_fare).toBe(150);
      expect(preview.new_fare).toBe(180);
      expect(preview.new_paddress).toBe("New Pickup Address");
    });

    it("rejects a pickup change once the driver has already picked up (order_status 3)", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 3, o_status: "On_Route" });

      await expect(
        orderPickupService.previewPickupChange({
          uid: 55, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
        })
      ).rejects.toThrow("ORDER_NOT_ACTIVE");
    });

    it("allows a pickup change while the driver is waiting at the old pickup (order_status 2)", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 2, o_status: "Pickup" });

      const preview = await orderPickupService.previewPickupChange({
        uid: 55, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
      });

      expect(preview.order_id).toBe(101);
    });

    it("rejects request from unauthorized user", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);

      await expect(
        orderPickupService.previewPickupChange({
          uid: 999, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
        })
      ).rejects.toThrow("FORBIDDEN");
    });
  });

  describe("confirmPickupChange", () => {
    it("updates plat/plong/paddress and fare when driver is still en route (order_status 1)", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order.update.mockResolvedValue({
        ...baseOrder, plat: "28.6", plong: "77.45", paddress: "New Pickup Address",
        distance: 8.5, d_charge: 180, total_dcharge: 180, driver_earning: 150, commission: 15,
      });

      const result = await orderPickupService.confirmPickupChange({
        uid: 55, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
      });

      expect(result.new_fare).toBe(180);
      expect(prisma.pkg_order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 101 },
          data: expect.objectContaining({
            plat: "28.6", plong: "77.45", paddress: "New Pickup Address", total_dcharge: 180,
          }),
        })
      );
      // Driver is still en route (order_status stayed 1) - no wait-timer touch needed.
      expect(prisma.pkg_order_wait_timer.update).not.toHaveBeenCalled();
    });

    it("re-applies the ride-discount cap to the new fare after a pickup change", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order.update.mockResolvedValue({ ...baseOrder, total_dcharge: 180 });
      await orderPickupService.confirmPickupChange({
        uid: 55, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
      });
      expect(reconcileRideDiscountToFare).toHaveBeenCalledWith(101, expect.any(Number), prisma);
    });

    it("banks accrued wait time and reverts to en-route when the driver had already arrived (order_status 2)", async () => {
      const waitStart = new Date(Date.now() - 90 * 1000); // arrived 90s ago
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 2, o_status: "Pickup" });
      prisma.pkg_order_wait_timer.findUnique.mockResolvedValue({
        order_id: 101, rid: 22, pickup_wait_start: waitStart, pickup_wait_end: null, pickup_wait_banked_seconds: 0,
      });
      prisma.pkg_order.update.mockResolvedValue({
        ...baseOrder, order_status: 1, o_status: "Processing",
        plat: "28.6", plong: "77.45", paddress: "New Pickup Address",
        distance: 8.5, d_charge: 180, total_dcharge: 180, driver_earning: 150, commission: 15,
      });

      await orderPickupService.confirmPickupChange({
        uid: 55, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
      });

      // Order reverts to "driver en route" so arrival-detection re-engages at the new point.
      expect(prisma.pkg_order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ order_status: 1, o_status: "Processing" }),
        })
      );
      // Wait timer cleared but the ~90s already waited is banked, not lost.
      expect(prisma.pkg_order_wait_timer.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { order_id_rid: { order_id: 101, rid: 22 } },
          data: expect.objectContaining({
            pickup_wait_start: null,
            pickup_wait_end: null,
            pickup_wait_banked_seconds: expect.any(Number),
          }),
        })
      );
      const bankedArg = prisma.pkg_order_wait_timer.update.mock.calls[0][0].data.pickup_wait_banked_seconds;
      expect(bankedArg).toBeGreaterThanOrEqual(89);
      // Stale "arrived" milestone event removed so re-arrival fires a fresh notification.
      expect(prisma.driver_trip_event.deleteMany).toHaveBeenCalledWith({
        where: { order_id: 101, milestone: "arrived" },
      });
    });

    it("records the pickup_updated milestone as an upsert so a second pickup change on the same order doesn't collide with driver_trip_event's (order_id, milestone) unique constraint", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(baseOrder);
      prisma.pkg_order.update.mockResolvedValue({
        ...baseOrder, plat: "28.6", plong: "77.45", paddress: "New Pickup Address",
        distance: 8.5, d_charge: 180, total_dcharge: 180, driver_earning: 150, commission: 15,
      });

      await orderPickupService.confirmPickupChange({
        uid: 55, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
      });

      // A plain .create() here throws on a second call for the same order
      // (schema.prisma: driver_trip_event @@unique([order_id, milestone])) -
      // must be an upsert so a repeated pickup change never 500s.
      expect(prisma.driver_trip_event.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { order_id_milestone: { order_id: 101, milestone: "pickup_updated" } },
        })
      );
      expect(prisma.driver_trip_event.create).not.toHaveBeenCalled();
    });

    it("rejects a pickup change once the driver has already picked up (order_status 3)", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ ...baseOrder, order_status: 3, o_status: "On_Route" });

      await expect(
        orderPickupService.confirmPickupChange({
          uid: 55, orderId: 101, newPlat: 28.6, newPlong: 77.45, newPaddress: "New Pickup Address",
        })
      ).rejects.toThrow("ORDER_NOT_ACTIVE");
    });

    it("does NOT bank/revert when the new pickup is within the small-move threshold", async () => {
      const { getPickupRelocateSettings } = require("../../utils/pickupRelocateSettings");
      // Original pickup at 28.6000/77.2000; new point ~90m away.
      haversineKm.mockReturnValueOnce(0.09);
      prisma.pkg_order.findUnique.mockResolvedValue({
        id: 101, uid: 22, rid: 22, order_status: 2, o_status: "Pickup",
        plat: "28.6000", plong: "77.2000", dlat: "28.7", dlong: "77.3",
        extra_mile_charge: 0, delivery_type: 1, distance: 5, total_dcharge: 100, d_charge: 100,
      });
      prisma.pkg_order_wait_timer.findUnique.mockResolvedValue({
        order_id: 101, rid: 22, pickup_wait_start: new Date(), pickup_wait_end: null, pickup_wait_banked_seconds: 0,
      });

      await orderPickupService.confirmPickupChange({
        uid: 22, orderId: 101, newPlat: "28.6008", newPlong: "77.2000", newPaddress: "Nearby spot",
      });

      expect(getPickupRelocateSettings).toHaveBeenCalled();
      expect(prisma.pkg_order.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.not.objectContaining({ order_status: 1 }),
      }));
      expect(prisma.pkg_order_wait_timer.update).not.toHaveBeenCalled();
      expect(prisma.driver_trip_event.deleteMany).not.toHaveBeenCalled();
    });

    it("still banks/reverts when the new pickup is beyond the small-move threshold", async () => {
      // ~1.1km away
      haversineKm.mockReturnValueOnce(1.1);
      prisma.pkg_order.findUnique.mockResolvedValue({
        id: 102, uid: 22, rid: 22, order_status: 2, o_status: "Pickup",
        plat: "28.6000", plong: "77.2000", dlat: "28.7", dlong: "77.3",
        extra_mile_charge: 0, delivery_type: 1, distance: 5, total_dcharge: 100, d_charge: 100,
      });
      prisma.pkg_order_wait_timer.findUnique.mockResolvedValue({
        order_id: 102, rid: 22, pickup_wait_start: new Date(), pickup_wait_end: null, pickup_wait_banked_seconds: 0,
      });

      await orderPickupService.confirmPickupChange({
        uid: 22, orderId: 102, newPlat: "28.6100", newPlong: "77.2000", newPaddress: "Far spot",
      });

      expect(prisma.pkg_order.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ order_status: 1, o_status: "Processing" }),
      }));
      expect(prisma.pkg_order_wait_timer.update).toHaveBeenCalled();
      expect(prisma.driver_trip_event.deleteMany).toHaveBeenCalled();
    });
  });
});

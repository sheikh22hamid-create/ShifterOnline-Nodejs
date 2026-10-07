jest.mock("../../config/db", () => ({
  pkg_order_wait_timer: { findUnique: jest.fn().mockResolvedValue(null) },
  driver_trip_progress: { findUnique: jest.fn().mockResolvedValue(null) },
  order_settlement: { findUnique: jest.fn().mockResolvedValue(null) },
  tbl_package: { findMany: jest.fn() },
  tbl_goods_type: { findFirst: jest.fn() },
  tbl_user: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn() },
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock("../../services/pricingEngine", () => ({
  priceForPackage: jest.fn(),
  getActivePlanDiscount: jest.fn().mockResolvedValue(null),
  getActiveCustomerPlan: jest.fn().mockResolvedValue(null),
  getSlabPricingConfig: jest.fn().mockResolvedValue({ slabRates: {}, modelMultipliers: null }),
  findVehicleSlabConfig: jest.fn().mockReturnValue(null),
  getBodyTypeCharge: jest.fn().mockResolvedValue(0),
  getCoveredBodyCharge: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyNewOrder: jest.fn() }));
jest.mock("../../utils/geoDistance", () => ({ getRoadDistanceKm: jest.fn() }));
jest.mock("../../services/orderDestinationService", () => ({ previewDestinationChange: jest.fn(), confirmDestinationChange: jest.fn() }));
jest.mock("../../services/orderPickupService", () => ({ previewPickupChange: jest.fn(), confirmPickupChange: jest.fn() }));
jest.mock("../../services/orderStopsService", () => ({ previewAddStop: jest.fn(), confirmAddStop: jest.fn() }));
jest.mock("../../services/receiverPayService", () => ({ validateBooking: jest.fn(), createForOrder: jest.fn() }));
jest.mock("../../services/freeBookingService", () => ({ checkEligibility: jest.fn(), createForOrder: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const receiverPayService = require("../../services/receiverPayService");
const freeBookingService = require("../../services/freeBookingService");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { createOrderCore, createOrder } = require("../orderController");

const input = {
  uid: 1, category: "Bike", deliveryTypeIds: [6], bookingType: 1, plat: 28.7, plong: 77.1,
  paddress: "A", pickName: "P", pmobile: "999", pickType: "", dlat: 28.8, dlong: 77.2, daddress: "B",
  dropName: "Ramesh", dmobile: "9876543210", dropType: "", packageWeight: "2 Kg", packageCost: 100,
  description: "", pMethodId: 2, transactionId: "", extraMileCharge: 0, couId: 0, couAmt: 0,
  radiusKm: 10, cityId: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  getRoadDistanceKm.mockResolvedValue({ distanceKm: 5 });
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 10, sort_order: 1 }]);
  prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
  pricingEngine.priceForPackage.mockReturnValue({ fare: 50, driverEarning: 40, commission: 5 });
  prisma.pkg_order.create.mockResolvedValue({ id: 777, booking_type: 1 });
  receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: null });
  freeBookingService.createForOrder.mockResolvedValue({ id: 1 });
});

describe("createOrderCore - free booking chance", () => {
  it("creates the order with free_booking true when eligible, searching pool first", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "eligible", cityId: 2, planId: 1, poolRiderId: 9 });
    const result = await createOrderCore({ ...input, freeBooking: true });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(true);
    expect(freeBookingService.createForOrder).toHaveBeenCalledWith(
      expect.objectContaining({ order: expect.objectContaining({ id: 777 }), check: expect.objectContaining({ outcome: "eligible" }) })
    );
  });

  it("still creates the order and sets up pool search when outcome is no_free_vehicle (chance active)", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "no_free_vehicle", cityId: 2, planId: 1, poolRiderId: null });
    const result = await createOrderCore({ ...input, freeBooking: true });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(true);
    expect(prisma.pkg_order.create).toHaveBeenCalled();
    expect(freeBookingService.createForOrder).toHaveBeenCalled();
  });

  it("creates a normal booking (free_booking false) when user is not eligible (e.g. scheduled or offer_off) without failing", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "offer_off", cityId: 2, planId: 1, poolRiderId: null });
    const result = await createOrderCore({ ...input, bookingType: 2, freeBooking: true });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(false);
    expect(freeBookingService.checkEligibility).toHaveBeenCalledWith(expect.objectContaining({ bookingType: 2, uid: 1, category: "Bike" }));
    expect(prisma.pkg_order.create).toHaveBeenCalled();
    expect(freeBookingService.createForOrder).not.toHaveBeenCalled();
  });

  it("a failing free-booking row write never fails the booking", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "eligible", cityId: 2, planId: 1, poolRiderId: 9 });
    freeBookingService.createForOrder.mockRejectedValue(new Error("db down"));
    const result = await createOrderCore({ ...input, freeBooking: true });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(false);
  });

  it("never touches the free-booking service for a normal booking", async () => {
    const result = await createOrderCore({ ...input });
    expect(result.ok).toBe(true);
    expect(result.order.free_booking).toBe(false);
    expect(freeBookingService.checkEligibility).not.toHaveBeenCalled();
  });
});

describe("createOrder HTTP handler - free booking chance", () => {
  const body = {
    uid: 1, category: "Bike", delivery_type: [6], booking_type: 1, plat: 28.7, plong: 77.1, paddress: "A",
    pick_name: "P", pmobile: "999", pick_type: "", dlat: 28.8, dlong: 77.2, daddress: "B", drop_name: "Ramesh",
    dmobile: "9876543210", drop_type: "", package_weight: "2 Kg", package_cost: 100, description: "",
    p_method_id: 2, transaction_id: "", extra_mile_charge: 0, cou_id: 0, cou_amt: 0, radius_km: 10, city_id: 2,
  };
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  it("returns HTTP 200 with free_booking true when eligible", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "eligible", cityId: 2, planId: 1, poolRiderId: 9 });
    const r = res();
    await createOrder({ body: { ...body, free_booking: true } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 777, free_booking: true }));
  });

  it("accepts free_booking as string 'true' and returns HTTP 200 with free_booking true", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "eligible", cityId: 2, planId: 1, poolRiderId: 9 });
    const r = res();
    await createOrder({ body: { ...body, free_booking: "true" } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 777, free_booking: true }));
  });

  it("returns HTTP 200 with free_booking false when offer is off", async () => {
    freeBookingService.checkEligibility.mockResolvedValue({ outcome: "offer_off", cityId: 2, planId: null, poolRiderId: null });
    const r = res();
    await createOrder({ body: { ...body, free_booking: true } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 777, free_booking: false }));
  });
});

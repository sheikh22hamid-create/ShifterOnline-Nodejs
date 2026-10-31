jest.mock("../../services/nextDaySettings", () => ({ getLiveTime: jest.fn().mockResolvedValue("07:00") }));
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
  resolveVehicleSlabConfig: jest.fn().mockResolvedValue(null),
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
jest.mock("../../services/orderSearchSettings", () => ({ getCitySettings: jest.fn(), getSearchView: jest.fn() }));
jest.mock("../../services/pickupCityService", () => ({ resolvePickupCityId: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const receiverPayService = require("../../services/receiverPayService");
const freeBookingService = require("../../services/freeBookingService");
const orderSearchSettings = require("../../services/orderSearchSettings");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { resolvePickupCityId } = require("../../services/pickupCityService");
const { createOrderCore } = require("../orderController");

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
  resolvePickupCityId.mockResolvedValue(null);
});

const system2 = { searchSystem: 2, searchRadiusKm: 7, driverSearchSeconds: 90, guaranteeEnabled: false, adminWindowMinutes: null, guaranteeReferralsRequired: 1 };

describe("createOrderCore - System 2 snapshot", () => {
  const createdData = () => prisma.pkg_order.create.mock.calls[0][0].data;

  it("stamps search_system 2, a deadline and the city radius on an instant booking", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    const before = Date.now();
    const result = await createOrderCore({ ...input });
    expect(result.ok).toBe(true);
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(2);
    const data = createdData();
    expect(data.search_system).toBe(2);
    expect(data.search_deadline_at).toBeInstanceOf(Date);
    const seconds = (data.search_deadline_at.getTime() - before) / 1000;
    expect(seconds).toBeGreaterThanOrEqual(89);
    expect(seconds).toBeLessThanOrEqual(92);
    expect(data.radius_range).toBe(7); // client sent radiusKm 10; the city radius wins
  });

  it("uses SEARCH_RADIUS_KM (not the client radius) when the System 2 city has no radius of its own", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue({ ...system2, searchRadiusKm: null });
    await createOrderCore({ ...input, radiusKm: 15 });
    expect(createdData().radius_range).toBe(require("../../config/constants").SEARCH_RADIUS_KM);
  });

  it("a System 1 city gets no snapshot", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue({ ...system2, searchSystem: 1 });
    await createOrderCore({ ...input });
    expect(createdData().search_system).toBeNull();
    expect(createdData().search_deadline_at).toBeNull();
    expect(createdData().radius_range).toBe(10);
  });

  it.each([2, 3])("a booking_type %i order in a System 2 city gets no snapshot and the settings are not even read", async (bookingType) => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    // Next Day Delivery (type 3) is premium-only; give the customer a plan so the order reaches create.
    pricingEngine.getActiveCustomerPlan.mockResolvedValue({ noAdvancePayment: true, subscriptionId: 1 });
    await createOrderCore({ ...input, bookingType });
    expect(createdData().search_system).toBeNull();
    expect(createdData().search_deadline_at).toBeNull();
    expect(orderSearchSettings.getCitySettings).not.toHaveBeenCalled();
    expect(resolvePickupCityId).not.toHaveBeenCalled();
  });
});

describe("createOrderCore - System 2 decided by the pickup city", () => {
  const createdData = () => prisma.pkg_order.create.mock.calls[0][0].data;
  const byCity = (map) => (cityId) => Promise.resolve(map[cityId] || { ...system2, searchSystem: 1 });

  it("customer city 2 (System 1) booking from a pickup in city 5 (System 2) gets System 2 and city_id 5", async () => {
    orderSearchSettings.getCitySettings.mockImplementation(byCity({ 2: { ...system2, searchSystem: 1 }, 5: system2 }));
    resolvePickupCityId.mockResolvedValue(5);
    const result = await createOrderCore({ ...input, cityId: undefined });
    expect(result.ok).toBe(true);
    expect(resolvePickupCityId).toHaveBeenCalledWith(input.plat, input.plong);
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(5);
    expect(createdData().search_system).toBe(2);
    expect(createdData().city_id).toBe(5);
  });

  it("customer city 5 (System 2) booking from a pickup in city 2 (System 1) gets System 1 and keeps its city_id", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 5 });
    orderSearchSettings.getCitySettings.mockImplementation(byCity({ 2: { ...system2, searchSystem: 1 }, 5: system2 }));
    resolvePickupCityId.mockResolvedValue(2);
    await createOrderCore({ ...input, cityId: undefined });
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(2);
    expect(createdData().search_system).toBeNull();
    expect(createdData().search_deadline_at).toBeNull();
    expect(createdData().city_id).toBe(5);
  });

  it("falls back to the customer's city when the pickup city cannot be resolved", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 5 });
    orderSearchSettings.getCitySettings.mockImplementation(byCity({ 5: system2 }));
    resolvePickupCityId.mockResolvedValue(null);
    await createOrderCore({ ...input, cityId: undefined });
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(5);
    expect(createdData().search_system).toBe(2);
    expect(createdData().city_id).toBe(5);
  });

  it("falls back to the customer's city when resolving the pickup city throws", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 5 });
    orderSearchSettings.getCitySettings.mockImplementation(byCity({ 5: system2 }));
    resolvePickupCityId.mockRejectedValue(new Error("db blip"));
    const result = await createOrderCore({ ...input, cityId: undefined });
    expect(result.ok).toBe(true);
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(5);
    expect(createdData().city_id).toBe(5);
  });
});

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
jest.mock("../../services/orderSearchSettings", () => ({ getCitySettings: jest.fn(), getSearchView: jest.fn() }));
jest.mock("../../services/pickupCityService", () => ({ resolvePickupCityId: jest.fn() }));
jest.mock("../../services/nextDaySettings", () => ({ getLiveTime: jest.fn().mockResolvedValue("07:00") }));

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
  orderSearchSettings.getCitySettings.mockResolvedValue({ searchSystem: 1 });
  // Next Day Delivery (type 3) is premium-only; give the customer a plan so the order reaches create.
  pricingEngine.getActiveCustomerPlan.mockResolvedValue({ noAdvancePayment: true, subscriptionId: 1 });
});

describe("createOrderCore - next-day arranging fields", () => {
  const createdData = () => prisma.pkg_order.create.mock.calls[0][0].data;

  it("stamps next_day_stage 'arranging' and next_day_live_at (live time on the trip day, IST) for booking_type 3", async () => {
    const result = await createOrderCore({ ...input, bookingType: 3 });
    expect(result.ok).toBe(true);
    const data = createdData();
    expect(data.next_day_stage).toBe("arranging");
    expect(data.next_day_live_at).toBeInstanceOf(Date);
    expect(data.next_day_live_at.toISOString()).toBe(`${data.schedule_date_time}T01:30:00.000Z`); // 07:00 IST
  });

  it.each([1, 2])("booking_type %i gets neither next-day key", async (bookingType) => {
    await createOrderCore({ ...input, bookingType, scheduleDateTime: "2099-01-01T10:00:00.000Z" });
    const data = createdData();
    expect(data).not.toHaveProperty("next_day_stage");
    expect(data).not.toHaveProperty("next_day_live_at");
  });
});

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

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const receiverPayService = require("../../services/receiverPayService");
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
  receiverPayService.createForOrder.mockResolvedValue({ id: 1 });
});

describe("createOrderCore - receiver pays", () => {
  it("refuses the booking when receiver-pay validation fails and creates nothing", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE", msg: "Receiver pays is not available right now." });
    const result = await createOrderCore({ ...input, receiverPays: true, receiverCommissionPercent: 3 });
    expect(result).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it("creates the receiver row with the locked percent and flags the order", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: { phone: "9876543210", percent: 3 } });
    const result = await createOrderCore({ ...input, receiverPays: true, receiverCommissionPercent: 3 });
    expect(receiverPayService.createForOrder).toHaveBeenCalledWith({ orderId: 777, uid: 1, phone: "9876543210", name: "Ramesh", percent: 3 });
    expect(result.order.receiver_pay).toBe(true);
  });

  it("does not touch the receiver service state when not requested", async () => {
    const result = await createOrderCore({ ...input });
    expect(receiverPayService.createForOrder).not.toHaveBeenCalled();
    expect(result.order.receiver_pay).toBeFalsy();
  });

  it("still books the ride (flag false) when the receiver row cannot be written", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: { phone: "9876543210", percent: 3 } });
    receiverPayService.createForOrder.mockRejectedValue(new Error("db down"));
    const result = await createOrderCore({ ...input, receiverPays: true, receiverCommissionPercent: 3 });
    expect(result.ok).toBe(true);
    expect(result.order.receiver_pay).toBe(false);
  });
});

describe("createOrder HTTP handler - receiver pays", () => {
  const body = {
    uid: 1, category: "Bike", delivery_type: [6], booking_type: 1, plat: 28.7, plong: 77.1, paddress: "A",
    pick_name: "P", pmobile: "999", pick_type: "", dlat: 28.8, dlong: 77.2, daddress: "B", drop_name: "Ramesh",
    dmobile: "9876543210", drop_type: "", package_weight: "2 Kg", package_cost: 100, description: "",
    p_method_id: 2, transaction_id: "", extra_mile_charge: 0, cou_id: 0, cou_amt: 0, radius_km: 10, city_id: 2,
  };
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  it("passes the body fields through and returns receiver_pay true", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: { phone: "9876543210", percent: 3 } });
    const r = res();
    await createOrder({ body: { ...body, receiver_pays: true, receiver_commission_percent: 3 } }, r);
    expect(receiverPayService.validateBooking).toHaveBeenCalledWith(
      expect.objectContaining({ receiverPays: true, commissionPercent: 3, dmobile: "9876543210", pMethodId: 2 })
    );
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 777, receiver_pay: true }));
  });

  it("maps RECEIVER_PAY_UNAVAILABLE to HTTP 400", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE", msg: "nope" });
    const r = res();
    await createOrder({ body: { ...body, receiver_pays: true } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});

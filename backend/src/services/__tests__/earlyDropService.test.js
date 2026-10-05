jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  tbl_user: { update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn() },
  pkg_order: { update: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  pkg_order_stops: { findMany: jest.fn() },
  driver_trip_progress: { findUnique: jest.fn() },
  driver_trip_event: { upsert: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../pricingEngine", () => ({ priceForPackageId: jest.fn() }));
jest.mock("../orderRouteRepricing", () => ({
  getDriverRealDistanceKm: jest.fn().mockResolvedValue(1),
  computeRouteDistanceKm: jest.fn(),
}));

const prisma = require("../../config/db");
const pricingEngine = require("../pricingEngine");
const { computeRouteDistanceKm } = require("../orderRouteRepricing");
const early = require("../earlyDropService");

const order = {
  id: 7, uid: 3, rid: 9, plat: "22.70", plong: "75.85", dlat: "22.80", dlong: "75.95",
  daddress: "Booked drop", delivery_type: 2, extra_mile_charge: 0,
  total_dcharge: 200, d_charge: 200, distance: 14, driver_earning: 180, commission: 10,
  p_method_id: 2, trans_id: "cash",
};

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.GOOGLE_MAPS_API_KEY;
  prisma.pkg_order_stops.findMany.mockResolvedValue([]);
  prisma.driver_trip_progress.findUnique.mockResolvedValue(null);
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.findMany.mockResolvedValue([]); // debit not linked -> plain fare difference
  prisma.pkg_order.findUnique.mockResolvedValue({ uid: 3, referral_points_used: 0, referral_points_amount: 0, cou_amt: 0 });
  prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
  prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, ride_discount_percent: 50, point_value: 1 });
  prisma.tbl_user.update.mockResolvedValue({ referral_points: 241 });
});

describe("earlyDropService", () => {
  it("only treats a position farther than the threshold from the booked drop as an early drop", () => {
    expect(early.isEarlyDrop(null)).toBe(false);
    expect(early.isEarlyDrop(early.EARLY_DROP_MIN_DISTANCE_M)).toBe(false);
    expect(early.isEarlyDrop(early.EARLY_DROP_MIN_DISTANCE_M + 1)).toBe(true);
    expect(early.distanceToDropM(order, { lat: 22.80, lng: 75.95 })).toBeLessThan(1);
    expect(early.distanceToDropM(order, { lat: 22.75, lng: 75.90 })).toBeGreaterThan(5000);
  });

  it("prefers the server's fresh GPS fix over the coordinates sent with the request", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: "22.75", rlongs: "75.90", rloc_updated_at: new Date() });
    expect(await early.resolveDriverPosition(9, 10, 10)).toEqual({ lat: 22.75, lng: 75.9 });
  });

  it("falls back to the reported position when the server fix is stale", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: "22.75", rlongs: "75.90", rloc_updated_at: new Date(Date.now() - 3600 * 1000) });
    expect(await early.resolveDriverPosition(9, 22.71, 75.86)).toEqual({ lat: 22.71, lng: 75.86 });
    expect(await early.resolveDriverPosition(9, "x", 75.86)).toBeNull();
  });

  it("re-prices for the actual distance, but never above the original fare", async () => {
    computeRouteDistanceKm.mockResolvedValue(6);
    pricingEngine.priceForPackageId.mockResolvedValue({ fare: 120, driverEarning: 108, commission: 10 });
    const cheaper = await early.computeEarlyDropFare(order, { lat: 22.75, lng: 75.9 });
    expect(cheaper).toMatchObject({ oldFare: 200, newFare: 120, newDistance: 6, driverEarning: 108 });

    pricingEngine.priceForPackageId.mockResolvedValue({ fare: 260, driverEarning: 240, commission: 10 });
    const capped = await early.computeEarlyDropFare(order, { lat: 22.75, lng: 75.9 });
    expect(capped).toMatchObject({ newFare: 200, driverEarning: 180 });
  });

  it("bills only the stops already completed", async () => {
    prisma.pkg_order_stops.findMany.mockResolvedValue([{ lat: "1", lng: "1" }, { lat: "2", lng: "2" }]);
    prisma.driver_trip_progress.findUnique.mockResolvedValue({ stop_step: 2 }); // stop 1 done, stop 2 not reached
    computeRouteDistanceKm.mockResolvedValue(5);
    pricingEngine.priceForPackageId.mockResolvedValue({ fare: 100, driverEarning: 90, commission: 10 });
    await early.computeEarlyDropFare(order, { lat: 22.75, lng: 75.9 });
    expect(computeRouteDistanceKm.mock.calls[0][0].stops).toEqual([{ lat: "1", lng: "1" }]);
  });

  it("applyEarlyDrop makes the point the drop, stores the new fare and keeps the booked drop for audit", async () => {
    computeRouteDistanceKm.mockResolvedValue(6);
    pricingEngine.priceForPackageId.mockResolvedValue({ fare: 120, driverEarning: 108, commission: 10 });

    const result = await early.applyEarlyDrop(order, 9, { lat: 22.75, lng: 75.9 }, 7000);

    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ dlat: "22.75", dlong: "75.9", distance: 6, d_charge: 120, total_dcharge: 120, driver_earning: 108 }),
    });
    const event = prisma.driver_trip_event.upsert.mock.calls[0][0];
    expect(event.create.milestone).toBe("early_drop");
    expect(event.create.payload.original_drop).toMatchObject({ lat: 22.8, lng: 75.95, address: "Booked drop" });
    expect(result).toMatchObject({ early_drop: true, old_fare: 200, new_fare: 120, fare_diff: 80 });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled(); // cash order: nothing to refund
  });

  it("refunds the fare difference once for a wallet-prepaid order", async () => {
    computeRouteDistanceKm.mockResolvedValue(6);
    pricingEngine.priceForPackageId.mockResolvedValue({ fare: 120, driverEarning: 108, commission: 10 });
    const walletOrder = { ...order, p_method_id: -2, trans_id: "wallet" };

    await early.applyEarlyDrop(walletOrder, 9, { lat: 22.75, lng: 75.9 }, 7000);

    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { wallet: { increment: 80 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: 80, type: "credit", payment_id: "early_drop_refund:7" }),
    });

    prisma.tbl_user.update.mockClear();
    prisma.tbl_wallet_history.findFirst.mockResolvedValue({ id: 1 }); // already refunded
    await early.applyEarlyDrop(walletOrder, 9, { lat: 22.75, lng: 75.9 }, 7000);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  describe("points / coupon used on the booking (order #468)", () => {
    const pointsOrder = (extra = {}) => ({
      ...order, total_dcharge: 652, d_charge: 652, driver_earning: 600, commission: 8.24, ...extra,
    });

    it("hands back the points the cheaper fare no longer allows", async () => {
      computeRouteDistanceKm.mockResolvedValue(0.1);
      pricingEngine.priceForPackageId.mockResolvedValue({ fare: 170, driverEarning: 156, commission: 8.24 });
      prisma.pkg_order.findUnique.mockResolvedValue({ uid: 3, referral_points_used: 326, referral_points_amount: 326, cou_amt: 0 });

      const result = await early.applyEarlyDrop(pointsOrder(), 9, { lat: 22.75, lng: 75.9 }, 7000);

      expect(result).toMatchObject({ old_fare: 652, new_fare: 170 });
      expect(prisma.pkg_order.updateMany).toHaveBeenCalledWith({
        where: { id: 7, referral_points_used: 326 },
        data: { referral_points_used: 85, referral_points_amount: 85 },
      });
      expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { referral_points: { increment: 241 } } });
    });

    it("wallet refund never exceeds what the customer actually paid from the wallet", async () => {
      computeRouteDistanceKm.mockResolvedValue(0.1);
      pricingEngine.priceForPackageId.mockResolvedValue({ fare: 170, driverEarning: 156, commission: 8.24 });
      // 652 fare, 326 points -> customer paid only 326 from the wallet.
      prisma.pkg_order.findUnique.mockResolvedValue({ uid: 3, referral_points_used: 326, referral_points_amount: 326, cou_amt: 0 });
      prisma.tbl_wallet_history.findMany.mockResolvedValue([{ amount: 326 }]);

      await early.applyEarlyDrop(pointsOrder({ p_method_id: -2, trans_id: "wallet" }), 9, { lat: 22.75, lng: 75.9 }, 7000);

      // stillPayable = 170 - 85 (points kept) = 85; refund = min(482, 326 - 85) = 241 (not 482)
      expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { wallet: { increment: 241 } } });
    });

    it("full-fare wallet payment with no points still refunds the whole fare difference", async () => {
      computeRouteDistanceKm.mockResolvedValue(6);
      pricingEngine.priceForPackageId.mockResolvedValue({ fare: 120, driverEarning: 108, commission: 10 });
      prisma.tbl_wallet_history.findMany.mockResolvedValue([{ amount: 200 }]);

      await early.applyEarlyDrop({ ...order, p_method_id: -2, trans_id: "wallet" }, 9, { lat: 22.75, lng: 75.9 }, 7000);

      expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { wallet: { increment: 80 } } });
    });
  });
});

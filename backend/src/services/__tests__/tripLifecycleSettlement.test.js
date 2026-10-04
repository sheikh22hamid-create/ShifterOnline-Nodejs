jest.mock("../../config/db", () => ({
  driver_trip_progress: { findUnique: jest.fn().mockResolvedValue(null) },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  pkg_order_interest: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
  tbl_order_requests: { updateMany: jest.fn(), findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn().mockResolvedValue({}) },
  order_status_history: { create: jest.fn() },
  pkg_order_wait_timer: { upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  app_settings: { findFirst: jest.fn().mockResolvedValue(null) },
  driver_duty_log: { updateMany: jest.fn() },
  monthly_driver_ledger: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
}));
jest.mock("../dispatchManager", () => ({
  stopDispatch: jest.fn(), recordModel1Outcome: jest.fn(), emitCustomerEvent: jest.fn(),
  emitDriverEvent: jest.fn(), startDispatch: jest.fn(), offerToInterestedRiders: jest.fn(),
}));
jest.mock("../lockManager", () => ({ releaseLock: jest.fn(), peekLock: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({
  isWalletPaidOrder: jest.fn(() => false), linkWalletPrepayment: jest.fn(), refundIfWalletPaid: jest.fn().mockResolvedValue(null),
}));
jest.mock("../driverTripService", () => ({ progressTrip: jest.fn().mockResolvedValue({}) }));
jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn(), getPackageById: jest.fn(), getActiveCustomerPlan: jest.fn().mockResolvedValue(null),
  commissionAmount: jest.fn((d, p) => Math.round(((Number(d) * Number(p)) / 100) * 100) / 100),
  getFirstTierPricingContext: jest.fn(),
}));
jest.mock("../pushNotifier", () => ({}));
jest.mock("../../utils/pickupRelocateSettings", () => ({ getPickupRelocateSettings: jest.fn().mockResolvedValue({}) }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../settlementSettings", () => ({ isSettlementEnabled: jest.fn() }));
jest.mock("../settlementService", () => ({ createForCompletedOrder: jest.fn() }));

const prisma = require("../../config/db");
const settlementSettings = require("../settlementSettings");
const settlementService = require("../settlementService");
const tripLifecycle = require("../tripLifecycle");

const order = (o = {}) => ({
  id: 297, uid: 5, rid: 1, city_id: 1, d_charge: 100, total_dcharge: 100, commission: 5,
  trans_id: "cash_payment", free_waiting_time: "0", wating_charge: "0", ...o,
});

describe("tripLifecycle.updateStatus('complete') — payment settlement hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    prisma.pkg_order.update.mockResolvedValue({});
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: 0 }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 0 });
    settlementSettings.isSettlementEnabled.mockResolvedValue(true);
    settlementService.createForCompletedOrder.mockResolvedValue({ id: 1 });
  });

  it("creates a settlement and defers the commission debit (regular driver, cash order, feature on)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    const result = await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith({
      orderId: 297, uid: 5, riderId: 1, cityId: 1, amountDue: 100, fare: 100, commissionAmount: 5, perTripCharge: 0, prepaidAmount: 0,
    });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed", settlement_pending: true });
  });

  it("nets advance / referral / coupon off the amount due and records them as prepaid", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ referral_points_amount: 10, cou_amt: 5 }));
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: 15 }]);
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
      expect.objectContaining({ amountDue: 70, prepaidAmount: 30 })
    );
  });

  it("falls back to the legacy commission debit when settlement creation throws (ride must still complete)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    settlementService.createForCompletedOrder.mockRejectedValue(new Error("db down"));
    const result = await tripLifecycle.updateStatus(297, 1, "complete");
    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { wallet_balance: { decrement: 5 } } });
  });

  it("does nothing new when the feature is off", async () => {
    settlementSettings.isSettlementEnabled.mockResolvedValue(false);
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    const result = await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { wallet_balance: { decrement: 5 } } });
  });

  it("creates no settlement when nothing is due in cash (prepaid covers the fare)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ referral_points_amount: 100 }));
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });

  it("creates no settlement for a non-cash order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ trans_id: "pay_abc123", p_method_id: 5 }));
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });

  it("creates no settlement for a Monthly Driver (own cash ledger)", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });
});

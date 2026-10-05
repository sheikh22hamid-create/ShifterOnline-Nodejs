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
  daily_driver_enrollment: { findFirst: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
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
jest.mock("../receiverPayService", () => ({ getActiveForOrder: jest.fn().mockResolvedValue(null), issueLink: jest.fn().mockResolvedValue({ sent: true }), close: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../receiverSettlementService", () => ({ declineReceiverPay: jest.fn().mockResolvedValue({ phase: "converted" }) }));
jest.mock("../receiverPaySettings",() => ({ getReceiverPaySettings: jest.fn().mockResolvedValue({ enabled: true, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 }) }));

const prisma = require("../../config/db");
const settlementSettings = require("../settlementSettings");
const settlementService = require("../settlementService");
const receiverPayService = require("../receiverPayService");
const tripLifecycle = require("../tripLifecycle");

const order = (o = {}) => ({
  id: 297, uid: 5, rid: 1, city_id: 1, d_charge: 100, total_dcharge: 100, commission: 5,
  trans_id: "cash_payment", free_waiting_time: "0", wating_charge: "0", payment_status: 1, ...o,
});

describe("tripLifecycle.updateStatus('complete') — payment settlement hook", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    prisma.pkg_order.update.mockResolvedValue({});
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: 0 }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 0 });
    prisma.daily_driver_enrollment.findFirst.mockResolvedValue(null);
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    settlementSettings.isSettlementEnabled.mockResolvedValue(true);
    settlementService.createForCompletedOrder.mockResolvedValue({ id: 1 });
    receiverPayService.getActiveForOrder.mockResolvedValue(null);
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

  it("does not double-debit when creation threw but the settlement row actually committed", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    settlementService.createForCompletedOrder.mockRejectedValue(new Error("connection lost after commit"));
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 9, order_id: 297 });
    const result = await tripLifecycle.updateStatus(297, 1, "complete");
    expect(prisma.order_settlement.findUnique).toHaveBeenCalledWith({ where: { order_id: 297 } });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed", settlement_pending: true });
  });

  it("still falls back to the legacy debit when the existence re-check itself fails", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    settlementService.createForCompletedOrder.mockRejectedValue(new Error("db down"));
    prisma.order_settlement.findUnique.mockRejectedValue(new Error("db still down"));
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

  it("float residue: fare 11.13 fully covered by advance 10 + referral 1.13 creates NO settlement", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ d_charge: 11.13, total_dcharge: 11.13, referral_points_amount: 1.13 }));
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: 10 }]);
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });

  it("passes amountDue rounded to 2 decimals (no float residue)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ d_charge: 33.33, total_dcharge: 33.33, referral_points_amount: 10.1 }));
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).toHaveBeenCalledTimes(1);
    expect(settlementService.createForCompletedOrder.mock.calls[0][0].amountDue).toBe(23.23);
  });

  it("creates no settlement for a Daily Driver exempt rider", async () => {
    prisma.daily_driver_enrollment.findFirst.mockResolvedValue({ id: 4 });
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    await tripLifecycle.updateStatus(297, 1, "complete");
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });

  it("never reads the feature flag for non-cash, monthly, daily or zero-due orders", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ trans_id: "pay_abc123", p_method_id: 5 }));
    await tripLifecycle.updateStatus(297, 1, "complete");

    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue(order());
    await tripLifecycle.updateStatus(297, 1, "complete");

    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 0 });
    prisma.daily_driver_enrollment.findFirst.mockResolvedValue({ id: 4 });
    await tripLifecycle.updateStatus(297, 1, "complete");

    prisma.daily_driver_enrollment.findFirst.mockResolvedValue(null);
    prisma.pkg_order.findUnique.mockResolvedValue(order({ referral_points_amount: 100 }));
    await tripLifecycle.updateStatus(297, 1, "complete");

    expect(settlementSettings.isSettlementEnabled).not.toHaveBeenCalled();
  });

  describe("receiver mode", () => {
    const rpRow = { id: 3, order_id: 297, commission_percent: "3.00", status: "active" };

    it("does not net the advance, passes markup + held advance, keeps the advance debit, and issues the link", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order({ referral_points_amount: 10, cou_amt: 5 }));
      prisma.$queryRaw.mockResolvedValue([{ advance_payment: 15 }]);
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountDue: 85, prepaidAmount: 15, receiver: { markup: 2.55, advanceHeld: 15 } })
      );
      expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { wallet: { decrement: 15 } } });
      expect(receiverPayService.issueLink).toHaveBeenCalledWith({ orderId: 297 });
    });

    it("advance 0: held advance is 0 and the full amount is due", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountDue: 100, prepaidAmount: 0, receiver: { markup: 3, advanceHeld: 0 } })
      );
    });

    it("advance larger than the amount: the held advance is only what was actually applied", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      prisma.$queryRaw.mockResolvedValue([{ advance_payment: 150 }]);
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountDue: 100, receiver: expect.objectContaining({ advanceHeld: 100 }) })
      );
    });

    it("a normal ride never carries a receiver key", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder.mock.calls[0][0]).not.toHaveProperty("receiver");
      expect(receiverPayService.issueLink).not.toHaveBeenCalled();
    });

    it("Monthly Driver: receiver row is closed and the ride runs the normal way", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 1 });
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
      expect(receiverPayService.close).toHaveBeenCalledWith(297, "not_applicable");
    });

    it("settlement creation failure closes the receiver row and falls back to the legacy path", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      settlementService.createForCompletedOrder.mockRejectedValue(new Error("db down"));
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed" });
      expect(receiverPayService.close).toHaveBeenCalledWith(297, "not_applicable");
    });

    it("row declined while completing: converts via system decline and sends no link", async () => {
      const rss = require("../receiverSettlementService");
      receiverPayService.getActiveForOrder.mockResolvedValueOnce(rpRow).mockResolvedValue(null);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toMatchObject({ success: true });
      expect(rss.declineReceiverPay).toHaveBeenCalledWith({ orderId: 297, actor: "system" });
      expect(receiverPayService.issueLink).not.toHaveBeenCalled();
    });

    it("re-read throws (transient DB error): treated as still active, no decline, link issued", async () => {
      const rss = require("../receiverSettlementService");
      receiverPayService.getActiveForOrder.mockResolvedValueOnce(rpRow).mockRejectedValueOnce(new Error("db blip"));
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toMatchObject({ success: true });
      expect(rss.declineReceiverPay).not.toHaveBeenCalled();
      expect(receiverPayService.issueLink).toHaveBeenCalledWith({ orderId: 297 });
    });

    it("a rejecting receiver-pay lookup is logged and the ride completes as a normal ride", async () => {
      const logger = require("../../utils/logger");
      receiverPayService.getActiveForOrder.mockRejectedValueOnce(new Error("db blip"));
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toMatchObject({ success: true });
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("297"), expect.anything());
      expect(settlementService.createForCompletedOrder.mock.calls[0][0].receiver).toBeUndefined();
      expect(receiverPayService.issueLink).not.toHaveBeenCalled();
    });

    it("system decline rejecting never fails the ride", async () => {
      const rss = require("../receiverSettlementService");
      receiverPayService.getActiveForOrder.mockResolvedValueOnce(rpRow).mockResolvedValue(null);
      rss.declineReceiverPay.mockRejectedValueOnce(new Error("convert failed"));
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toMatchObject({ success: true });
      expect(rss.declineReceiverPay).toHaveBeenCalledWith({ orderId: 297, actor: "system" });
    });

    it("row still active after create: no decline, link issued", async () => {
      const rss = require("../receiverSettlementService");
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(rss.declineReceiverPay).not.toHaveBeenCalled();
      expect(receiverPayService.issueLink).toHaveBeenCalledWith({ orderId: 297 });
    });

    it("a link failure never fails the completed ride", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      receiverPayService.issueLink.mockRejectedValue(new Error("whatsapp down"));
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toMatchObject({ success: true, settlement_pending: true });
    });
  });
});

jest.mock("../../config/db", () => ({
  pkg_order: { findMany: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  pkg_order_interest: { findMany: jest.fn(), deleteMany: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  tbl_notification: { create: jest.fn() },
  app_settings: { findFirst: jest.fn() },
}));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), emitDriverEvent: jest.fn(), stopDispatch: jest.fn() }));
jest.mock("../lockManager", () => ({}));
jest.mock("../pricingEngine", () => ({}));
jest.mock("../driverPlanService", () => ({}));
jest.mock("../dailyDriverCommissionExemption", () => ({}));
jest.mock("../referralRewardService", () => ({}));
jest.mock("../rewardPlanService", () => ({}));
jest.mock("../walletNotifier", () => ({}));
jest.mock("../../utils/trialOrderTracker", () => ({}));
jest.mock("../../sockets/adminSocket", () => ({}));
jest.mock("../../whatsapp/notifications", () => ({}));
jest.mock("../pushNotifier", () => ({
  notifyCustomerScheduleConfirm: jest.fn().mockResolvedValue({ sent: true }),
  notifyDriverScheduledCancelled: jest.fn().mockResolvedValue({ sent: true }),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const pushNotifier = require("../pushNotifier");
const tripLifecycle = require("../tripLifecycle");

const NOW = new Date("2026-09-30T10:00:00.000Z").getTime();

describe("scheduled ride confirmation prompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "30" });
    prisma.tbl_user.findUnique.mockResolvedValue({ name: "Asha", fcm_token: "tok" });
  });
  afterEach(() => jest.restoreAllMocks());

  it("asks the customer when the order is inside the admin-configured lead window", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([
      // booked yesterday, scheduled 20 min from NOW -> inside the 30 min window
      { id: 7, uid: 3, schedule_date_time: new Date(NOW + 20 * 60000).toISOString(), odate: new Date(NOW - 24 * 3600000) },
    ]);

    await tripLifecycle.sendScheduledOrderReminders();

    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 7 }, data: { user_reminder_sent: true, schedule_confirm_status: 1 },
    });
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(3, "order:schedule_confirm", expect.objectContaining({ order_id: "7" }));
    expect(pushNotifier.notifyCustomerScheduleConfirm).toHaveBeenCalledWith("tok", 7, expect.any(String));
  });

  it("does not ask while the order is still outside the lead window", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([
      { id: 8, uid: 3, schedule_date_time: new Date(NOW + 3 * 3600000).toISOString(), odate: new Date(NOW - 3600000) },
    ]);
    await tripLifecycle.sendScheduledOrderReminders();
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).not.toHaveBeenCalled();
  });

  it("does not ask for an order booked only just inside the window (just marks it handled)", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([
      { id: 9, uid: 3, schedule_date_time: new Date(NOW + 20 * 60000).toISOString(), odate: new Date(NOW - 60000) },
    ]);
    await tripLifecycle.sendScheduledOrderReminders();
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { user_reminder_sent: true } });
    expect(dispatchManager.emitCustomerEvent).not.toHaveBeenCalled();
  });

  it("uses the admin-configured minutes, not a hardcoded lead", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "5" });
    prisma.pkg_order.findMany.mockResolvedValue([
      { id: 10, uid: 3, schedule_date_time: new Date(NOW + 20 * 60000).toISOString(), odate: new Date(NOW - 24 * 3600000) },
    ]);
    await tripLifecycle.sendScheduledOrderReminders();
    expect(dispatchManager.emitCustomerEvent).not.toHaveBeenCalled();
  });

  it("continue keeps the booking and marks it confirmed", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 7, uid: 3, booking_type: 2, o_status: "Pending" });
    const result = await tripLifecycle.respondToScheduleConfirmation(3, 7, "continue");
    expect(result.success).toBe(true);
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { schedule_confirm_status: 2 } });
  });

  it("rejects an unknown action and a non-scheduled order", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 7, uid: 3, booking_type: 2, o_status: "Pending" });
    expect((await tripLifecycle.respondToScheduleConfirmation(3, 7, "maybe")).success).toBe(false);
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 8, uid: 3, booking_type: 1, o_status: "Pending" });
    expect((await tripLifecycle.respondToScheduleConfirmation(3, 8, "continue")).success).toBe(false);
  });

  it("releaseScheduledInterest removes pre-accepted drivers and tells them", async () => {
    prisma.pkg_order_interest.findMany.mockResolvedValue([{ rider_id: 5 }, { rider_id: 6 }]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 5, fcm_token: "a" }, { id: 6, fcm_token: "b" }]);

    await tripLifecycle.releaseScheduledInterest(7);

    expect(prisma.pkg_order_interest.deleteMany).toHaveBeenCalledWith({ where: { order_id: 7 } });
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledTimes(2);
    expect(pushNotifier.notifyDriverScheduledCancelled).toHaveBeenCalledWith("a", 7);
    expect(pushNotifier.notifyDriverScheduledCancelled).toHaveBeenCalledWith("b", 7);
  });

  it("releaseScheduledInterest is a no-op when no driver had pre-accepted", async () => {
    prisma.pkg_order_interest.findMany.mockResolvedValue([]);
    await tripLifecycle.releaseScheduledInterest(7);
    expect(prisma.pkg_order_interest.deleteMany).not.toHaveBeenCalled();
  });
});

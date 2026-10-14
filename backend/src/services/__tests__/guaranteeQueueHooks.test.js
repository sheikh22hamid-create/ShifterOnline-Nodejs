jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  booking_guarantee_case: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  booking_guarantee_audit: { create: jest.fn().mockResolvedValue({}) },
  tbl_package: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn(), updateMany: jest.fn() },
  order_status_history: { create: jest.fn().mockResolvedValue({}) },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock("../bookingGuaranteeSettings", () => ({ getAssignWindowMinutes: jest.fn().mockResolvedValue(15) }));
jest.mock("../orderSearchSettings", () => ({
  getCitySettings: jest.fn().mockResolvedValue({ searchSystem: 1, guaranteeEnabled: true, adminWindowMinutes: null, guaranteeReferralsRequired: 1 }),
}));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn().mockResolvedValue(null) }));
jest.mock("../referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn().mockResolvedValue(0) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn(), notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../guaranteeQueueService", () => ({ onCaseOpened: jest.fn().mockResolvedValue({ queued: true }), onCaseClosed: jest.fn().mockResolvedValue(1) }));
jest.mock("../guaranteeQueueSettings", () => ({ getQueueSettings: jest.fn().mockResolvedValue({ execQueueEnabled: false }) }));

const prisma = require("../../config/db");
const queueSettings = require("../guaranteeQueueSettings");
const adminSocket = require("../../sockets/adminSocket");
const queue =require("../guaranteeQueueService");
const svc = require("../bookingGuaranteeService");

const order = { id: 500, uid: 7, city_id: 3, rid: 0, order_status: 0 };
beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.booking_guarantee_audit.create.mockResolvedValue({});
});

describe("open hook", () => {
  it("stores the order's city on the case and calls onCaseOpened once, after the case exists", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "100.00" }]);
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    await svc.openForExhaustedOrder(order, [10]);
    expect(prisma.booking_guarantee_case.create.mock.calls[0][0].data.city_id).toBe(3);
    expect(queue.onCaseOpened).toHaveBeenCalledTimes(1);
    expect(queue.onCaseOpened.mock.calls[0][1]).toBe(3);
  });
  it("a failing queue hook never stops the case from being held", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "100.00" }]);
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    queue.onCaseOpened.mockRejectedValueOnce(new Error("queue down"));
    await expect(svc.openForExhaustedOrder(order, [10])).resolves.toBe(true);
  });
  it.each([[true], [false]])("the broadcast alert carries queue=%s from the city's queue setting", async (on) => {
    queueSettings.getQueueSettings.mockResolvedValueOnce({ execQueueEnabled: on });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "100.00" }]);
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    await svc.openForExhaustedOrder(order, [10]);
    expect(queueSettings.getQueueSettings).toHaveBeenCalledWith(3);
    const extra = adminSocket.notifyDispatchAlert.mock.calls[0][3];
    expect(extra).toEqual(expect.objectContaining({ kind: "booking_guarantee", amount: 100, queue: on }));
  });
  it("does not call the queue when the guarantee does not apply (city off)", async () => {
    require("../orderSearchSettings").getCitySettings.mockResolvedValueOnce({ guaranteeEnabled: false });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(false);
    expect(queue.onCaseOpened).not.toHaveBeenCalled();
  });
});

describe("close hooks", () => {
  it("closeOnAssign ends ownership only for queued cases and never blocks the close", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 1, order_id: 500, queue_state: "assigned", status: "resolved_assigned" });
    expect(await svc.closeOnAssign(500, 9)).toBe(true);
    expect(queue.onCaseClosed).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), "resolved_assigned");

    queue.onCaseClosed.mockClear();
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 2, order_id: 501, queue_state: null, status: "resolved_assigned" });
    expect(await svc.closeOnAssign(501, 9)).toBe(true);
    expect(queue.onCaseClosed).not.toHaveBeenCalled();

    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ id: 3, order_id: 502, queue_state: "assigned", status: "cancelled" });
    queue.onCaseClosed.mockRejectedValueOnce(new Error("boom"));
    expect(await svc.closeOnCancel(502, "admin_cancelled", 9)).toBe(true);
  });
});

describe("expireCase with a failing queue hook", () => {
  it("still finishes the expiry (refunds) and returns true when onCaseClosed rejects for a queued case", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({
      id: 1, order_id: 500, uid: 7, status: "expired_compensated", selected_package_ids: "[10,20]", compensation_package_id: 20,
      compensation_amount: "100.00", deadline_at: new Date("2026-10-07T10:00:00Z"), wallet_history_id: null, refunds_done_at: null,
      queue_state: "assigned", owner_admin_id: 9, city_id: 3,
    });
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 777 });
    prisma.tbl_user.update.mockResolvedValue({});
    prisma.booking_guarantee_case.update.mockResolvedValue({});
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, uid: 7, city_id: 3, p_method_id: -2 });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7, fcm_token: "tok" });
    queue.onCaseClosed.mockRejectedValueOnce(new Error("queue down"));
    const walletPrepayment = require("../walletPrepaymentRefund");

    await expect(svc.expireCase(1)).resolves.toBe(true);
    expect(queue.onCaseClosed).toHaveBeenCalledTimes(1);
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalled(); // finishExpiry ran after the failed hook
  });
});

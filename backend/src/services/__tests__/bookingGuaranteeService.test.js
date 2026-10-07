jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  booking_guarantee_case: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  booking_guarantee_audit: { create: jest.fn().mockResolvedValue({}) },
  tbl_package: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn(), updateMany: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
}));
jest.mock("../bookingGuaranteeSettings", () => ({ getAssignWindowMinutes: jest.fn().mockResolvedValue(15) }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn().mockResolvedValue(null) }));
jest.mock("../referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn().mockResolvedValue(0) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const adminSocket = require("../../sockets/adminSocket");
const walletPrepayment = require("../walletPrepaymentRefund");
const { refundReferralPointsForOrder } = require("../referralPointsRefund");
const walletNotifier = require("../walletNotifier");
const pushNotifier = require("../pushNotifier");
const svc = require("../bookingGuaranteeService");

const order = { id: 500, uid: 7, city_id: 3, rid: 0, order_status: 0 };
const caseRow = (o = {}) => ({
  id: 1, order_id: 500, uid: 7, status: "open", selected_package_ids: "[10,20]", compensation_package_id: 20,
  compensation_amount: "100.00", deadline_at: new Date("2026-10-07T10:00:00Z"), wallet_history_id: null, refunds_done_at: null, ...o,
});
const auditEvents = () => prisma.booking_guarantee_audit.create.mock.calls.map(([a]) => a.data.event);

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.booking_guarantee_audit.create.mockResolvedValue({});
});

describe("openForExhaustedOrder", () => {
  it("opens a case with the highest selected model's amount frozen, alerts admin and the customer", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([
      { id: 10, sort_order: 1, no_driver_compensation: "0.00" },
      { id: 20, sort_order: 2, no_driver_compensation: "100.00" },
    ]);
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));

    const held = await svc.openForExhaustedOrder(order, [10, 20]);

    expect(held).toBe(true);
    const data = prisma.booking_guarantee_case.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ order_id: 500, uid: 7, status: "open", selected_package_ids: "[10,20]", compensation_package_id: 20, compensation_amount: 100 });
    expect(data.deadline_at.getTime() - Date.now()).toBeGreaterThan(14 * 60 * 1000);
    expect(data.deadline_at.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60 * 1000);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(500, 3, svc.ALERT_MESSAGE, expect.objectContaining({ kind: "booking_guarantee", amount: 100 }));
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:guarantee_pending", expect.objectContaining({ order_id: "500", amount: 100 }));
    expect(auditEvents()).toEqual(["opened", "admin_alerted"]);
  });

  it("an already-open case keeps holding the order without a second alert", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow());
    expect(await svc.openForExhaustedOrder(order, [10, 20])).toBe(true);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("an already-closed case does not hold the order", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ status: "expired_compensated" }));
    expect(await svc.openForExhaustedOrder(order, [10, 20])).toBe(false);
  });

  it("losing the unique-key race (P2002) still holds the order, with no duplicate alert", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([]);
    prisma.booking_guarantee_case.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("selected models with no compensation configured still open a case for the alert/window (amount 0)", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "0.00" }]);
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    expect(prisma.booking_guarantee_case.create.mock.calls[0][0].data.compensation_amount).toBe(0);
  });
});

describe("closeOnAssign / closeOnCancel", () => {
  it("assign closes an open case as resolved_assigned and audits the admin", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ status: "resolved_assigned" }));
    expect(await svc.closeOnAssign(500, 9)).toBe(true);
    expect(prisma.booking_guarantee_case.updateMany).toHaveBeenCalledWith({
      where: { order_id: 500, status: "open" },
      data: expect.objectContaining({ status: "resolved_assigned", resolved_by_admin_id: 9 }),
    });
    expect(auditEvents()).toEqual(["admin_assigned"]);
  });
  it("assign on an order with no open case is a no-op", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.closeOnAssign(500, 9)).toBe(false);
    expect(prisma.booking_guarantee_audit.create).not.toHaveBeenCalled();
  });
  it("customer cancel closes the case as cancelled with no payment", async () => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ status: "cancelled" }));
    expect(await svc.closeOnCancel(500, "customer_cancelled")).toBe(true);
    expect(auditEvents()).toEqual(["customer_cancelled"]);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("expireCase", () => {
  const setupExpiry = ({ amount = "100.00", cancelCount = 1, flipCount = 1, dup = null } = {}) => {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: flipCount });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ compensation_amount: amount, status: "expired_compensated" }));
    prisma.pkg_order.updateMany.mockResolvedValue({ count: cancelCount });
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(dup);
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 777 });
    prisma.tbl_user.update.mockResolvedValue({});
    prisma.booking_guarantee_case.update.mockResolvedValue({});
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, uid: 7, p_method_id: -2 });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "tok" });
  };

  it("cancels the order, credits the frozen amount once, refunds the fare, and tells the customer", async () => {
    setupExpiry();
    expect(await svc.expireCase(1)).toBe(true);

    expect(prisma.pkg_order.updateMany).toHaveBeenCalledWith({
      where: { id: 500, rid: 0, order_status: 0 },
      data: { o_status: "Cancelled", cancel_reason: "No driver found", order_status: 4 },
    });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 100 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 7, amount: 100, type: "credit", wallet_type: "user", order_id: 500, payment_id: "booking_guarantee_credit:500" }),
    });
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledWith(expect.objectContaining({ id: 500 }), { note: "no driver found" });
    expect(refundReferralPointsForOrder).toHaveBeenCalledWith(500);
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:no_driver_found", { order_id: "500", compensation_amount: 100 });
    expect(pushNotifier.notifyCustomerNoDriverFound).toHaveBeenCalledWith("tok", 500, 100);
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "credit", amount: 100 }));
    expect(prisma.booking_guarantee_case.update).toHaveBeenCalledWith({ where: { id: 1 }, data: expect.objectContaining({ refunds_done_at: expect.any(Date) }) });
    expect(auditEvents()).toEqual(expect.arrayContaining(["expired", "wallet_credited", "refunds_processed"]));
  });

  it("losing the race (case no longer open) moves no money", async () => {
    setupExpiry({ flipCount: 0 });
    expect(await svc.expireCase(1)).toBe(false);
    expect(prisma.pkg_order.updateMany).not.toHaveBeenCalled();
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).not.toHaveBeenCalled();
  });

  it("an order already cancelled/assigned by another path: no compensation, case closed as cancelled", async () => {
    setupExpiry({ cancelCount: 0 });
    expect(await svc.expireCase(1)).toBe(false);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.booking_guarantee_case.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "cancelled" } });
    expect(auditEvents()).toContain("order_already_closed");
  });

  it("zero compensation: order still cancelled, refunds run, no wallet credit", async () => {
    setupExpiry({ amount: "0.00" });
    expect(await svc.expireCase(1)).toBe(true);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:no_driver_found", { order_id: "500", compensation_amount: 0 });
  });

  it("a wallet row with the idempotency key already present is never credited twice", async () => {
    setupExpiry({ dup: { id: 555 } });
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("pays the FROZEN amount even if package config changed since (config is never re-read)", async () => {
    setupExpiry({ amount: "100.00" });
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 20, sort_order: 2, no_driver_compensation: "9999.00" }]);
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 100 } } });
    expect(prisma.tbl_package.findMany).not.toHaveBeenCalled();
  });
});

describe("expireDue", () => {
  it("expires every overdue open case, then repairs expired cases whose refunds never ran", async () => {
    prisma.booking_guarantee_case.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }]) // due open cases
      .mockResolvedValueOnce([caseRow({ id: 3, status: "expired_compensated", wallet_history_id: 9, compensation_amount: "100.00" })]); // repair
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 0 }); // both due cases already taken by another worker
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, uid: 7, p_method_id: -2 });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "tok" });
    prisma.booking_guarantee_case.update.mockResolvedValue({});

    await svc.expireDue(new Date());

    expect(prisma.booking_guarantee_case.findMany.mock.calls[0][0].where).toMatchObject({ status: "open", deadline_at: { lte: expect.any(Date) } });
    expect(prisma.booking_guarantee_case.findMany.mock.calls[1][0].where).toMatchObject({ status: "expired_compensated", refunds_done_at: null });
    // repair pass re-ran the idempotent refunds and reported the already-credited amount
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledTimes(1);
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:no_driver_found", { order_id: "500", compensation_amount: 100 });
  });

  it("one failing case does not stop the rest", async () => {
    prisma.booking_guarantee_case.findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([]);
    prisma.$transaction.mockRejectedValueOnce(new Error("db down")).mockImplementationOnce((cb) => cb(prisma));
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.expireDue(new Date())).resolves.toBeUndefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe("quote / getView", () => {
  it("quote returns the highest selected model's amount from enabled packages", async () => {
    prisma.tbl_package.findMany.mockResolvedValue([
      { id: 10, sort_order: 1, no_driver_compensation: "0" },
      { id: 20, sort_order: 2, no_driver_compensation: "100" },
    ]);
    expect(await svc.quote(["10", 20, 20, "x", -1])).toEqual({ packageId: 20, amount: 100 });
    expect(prisma.tbl_package.findMany.mock.calls[0][0].where).toEqual({ id: { in: [10, 20] }, status: 1 });
  });
  it("quote with no valid ids is 0 and never queries", async () => {
    expect(await svc.quote([])).toEqual({ packageId: null, amount: 0 });
    expect(prisma.tbl_package.findMany).not.toHaveBeenCalled();
  });
  it("getView of an open case is pending with its deadline", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow());
    expect(await svc.getView({ id: 500 })).toEqual({ state: "pending", amount: 100, deadline_at: "2026-10-07T10:00:00.000Z" });
  });
  it("getView of a still-searching order (no case) previews the amount", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 20, sort_order: 2, no_driver_compensation: "100" }]);
    expect(await svc.getView({ id: 500, rid: 0, order_status: 0, allowed_delivery_types: "[20]" })).toEqual({ state: "none", amount: 100, deadline_at: null });
  });
  it("getView never throws", async () => {
    prisma.booking_guarantee_case.findUnique.mockRejectedValue(new Error("table missing"));
    expect(await svc.getView({ id: 500 })).toEqual({ state: "none", amount: 0, deadline_at: null });
  });
});

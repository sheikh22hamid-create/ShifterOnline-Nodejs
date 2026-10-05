jest.mock("../../config/db", () => ({
  order_receiver_pay: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverPaySettings", () => ({
  isReceiverPayAvailable: jest.fn(),
  getReceiverPaySettings: jest.fn(),
}));

const prisma = require("../../config/db");
const settings = require("../receiverPaySettings");
const svc = require("../receiverPayService");

const ok = { receiverPays: true, commissionPercent: 3, dmobile: "98765 43210", pMethodId: 2, transactionId: "" };

beforeEach(() => {
  jest.clearAllMocks();
  settings.isReceiverPayAvailable.mockResolvedValue(true);
  settings.getReceiverPaySettings.mockResolvedValue({ enabled: true, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });
});

describe("receiverPayService.validateBooking", () => {
  it("is a no-op when receiver pays is not requested", async () => {
    expect(await svc.validateBooking({ ...ok, receiverPays: false })).toEqual({ ok: true, value: null });
    expect(settings.isReceiverPayAvailable).not.toHaveBeenCalled();
  });
  it("accepts a cash order, normalises the phone and keeps the percent", async () => {
    expect(await svc.validateBooking(ok)).toEqual({ ok: true, value: { phone: "9876543210", percent: 3 } });
  });
  it("accepts a cash order identified by transaction id", async () => {
    const r = await svc.validateBooking({ ...ok, pMethodId: 5, transactionId: "cash_payment" });
    expect(r.ok).toBe(true);
  });
  it("rejects when the feature is unavailable", async () => {
    settings.isReceiverPayAvailable.mockResolvedValue(false);
    expect(await svc.validateBooking(ok)).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
  });
  it("rejects non-cash orders", async () => {
    expect(await svc.validateBooking({ ...ok, pMethodId: 5, transactionId: "pay_abc" })).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
  });
  it("rejects wallet-paid orders", async () => {
    expect(await svc.validateBooking({ ...ok, pMethodId: -2, transactionId: "wallet_1" })).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
  });
  it("rejects a missing or short receiver number", async () => {
    expect(await svc.validateBooking({ ...ok, dmobile: "" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await svc.validateBooking({ ...ok, dmobile: "12345" })).toMatchObject({ ok: false, code: "VALIDATION" });
  });
  it("rejects a percent above the admin maximum", async () => {
    expect(await svc.validateBooking({ ...ok, commissionPercent: 6 })).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("receiverPayService.createForOrder / getActiveForOrder / close / getConfig", () => {
  it("creates an active row with the locked percent", async () => {
    prisma.order_receiver_pay.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    const row = await svc.createForOrder({ orderId: 77, uid: 5, phone: "9876543210", name: "Ramesh", percent: 3 });
    expect(prisma.order_receiver_pay.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order_id: 77, uid: 5, receiver_phone: "9876543210", receiver_name: "Ramesh", commission_percent: 3, status: "active" }),
    });
    expect(row.id).toBe(1);
  });
  it("getActiveForOrder only returns active rows", async () => {
    prisma.order_receiver_pay.findFirst.mockResolvedValue({ id: 1 });
    await svc.getActiveForOrder(77);
    expect(prisma.order_receiver_pay.findFirst).toHaveBeenCalledWith({ where: { order_id: 77, status: "active" } });
  });
  it("close only moves an active row", async () => {
    prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
    await svc.close(77, "not_applicable");
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({
      where: { order_id: 77, status: "active" },
      data: expect.objectContaining({ status: "closed" }),
    });
  });
  it("getConfig exposes the booker-facing limits", async () => {
    settings.getReceiverPaySettings.mockResolvedValue({ enabled: true, maxPercent: 10, maxAmount: 50, linkTtlHours: 24 });
    expect(await svc.getConfig()).toEqual({ enabled: true, max_percent: 10, max_amount: 50 });
  });
});

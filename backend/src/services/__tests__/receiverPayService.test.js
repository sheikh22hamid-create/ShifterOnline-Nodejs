jest.mock("../../config/db", () => ({
  order_receiver_pay: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../whatsapp/notifications", () => ({ sendWhatsAppNotification: jest.fn() }));
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

const notifications = require("../../whatsapp/notifications");

describe("receiverPayService.issueLink", () => {
  const rpRow = (o = {}) => ({ id: 1, order_id: 77, status: "active", receiver_phone: "9876543210", link_sent_at: null, link_send_count: 0, ...o });
  const settlementRow = (o = {}) => ({ id: 4, order_id: 77, payer: "receiver", status: "pending", amount_due: 90, receiver_markup: 2.7, ...o });

  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow());
    prisma.order_settlement.findUnique.mockResolvedValue(settlementRow());
    prisma.order_receiver_pay.update.mockResolvedValue({});
    notifications.sendWhatsAppNotification.mockResolvedValue(true);
  });
  afterAll(() => { delete process.env.PUBLIC_BASE_URL; });

  it("stores only the token hash + expiry, WhatsApps the link with the exact breakup", async () => {
    const { sent, link } = await svc.issueLink({ orderId: 77 });
    const token = link.replace("https://api.example.test/pay/", "");
    const data = prisma.order_receiver_pay.update.mock.calls[0][0].data;
    expect(data.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.token_hash).not.toContain(token);
    expect(data.token_expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(data.link_send_count).toEqual({ increment: 1 });
    const [phone, text] = notifications.sendWhatsAppNotification.mock.calls[0];
    expect(phone).toBe("9876543210");
    expect(text).toContain("92.70");
    expect(text).toContain(link);
    expect(sent).toBe(true);
  });
  it("reports sent=false (but still returns the link) when WhatsApp is not ready", async () => {
    notifications.sendWhatsAppNotification.mockResolvedValue(false);
    const out = await svc.issueLink({ orderId: 77 });
    expect(out.sent).toBe(false);
    expect(out.link).toContain("/pay/");
  });
  it("a WhatsApp rejection yields sent=false with the link instead of throwing", async () => {
    notifications.sendWhatsAppNotification.mockRejectedValue(new Error("wa down"));
    const out = await svc.issueLink({ orderId: 77 });
    expect(out.sent).toBe(false);
    expect(out.link).toContain("/pay/");
    expect(require("../../utils/logger").warn).toHaveBeenCalled();
  });
  it("refuses when the receiver row is not active", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ status: "declined" }));
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });
  it("refuses when the settlement is not a pending receiver settlement", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlementRow({ status: "paid_online" }));
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlementRow({ payer: "customer" }));
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
  });
  it("refuses when PUBLIC_BASE_URL is not configured", async () => {
    delete process.env.PUBLIC_BASE_URL;
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it("resend is rate limited to once a minute and capped at 10", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ link_sent_at: new Date(Date.now() - 10 * 1000), link_send_count: 1 }));
    await expect(svc.issueLink({ orderId: 77, resend: true })).rejects.toMatchObject({ code: "TOO_SOON" });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ link_sent_at: new Date(Date.now() - 120 * 1000), link_send_count: 10 }));
    await expect(svc.issueLink({ orderId: 77, resend: true })).rejects.toMatchObject({ code: "LINK_LIMIT" });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ link_sent_at: new Date(Date.now() - 120 * 1000), link_send_count: 1 }));
    await expect(svc.issueLink({ orderId: 77, resend: true })).resolves.toMatchObject({ sent: true });
  });
});

describe("receiverPayService.mintLink", () => {
  const row = (o = {}) => ({ id: 3, order_id: 50, status: "active", receiver_phone: "9876543210", link_send_count: 2, link_sent_at: new Date(), ...o });
  const settlement = (o = {}) => ({ payer: "receiver", status: "pending", amount_due: 100, receiver_markup: 3, ...o });
  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = "https://api.example.com";
    settings.getReceiverPaySettings.mockResolvedValue({ linkTtlHours: 24 });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(row());
    prisma.order_settlement.findUnique.mockResolvedValue(settlement());
    prisma.order_receiver_pay.update.mockResolvedValue({});
  });
  it("rotates the pay token, returns the /pay link and neither counts a send nor sends WhatsApp", async () => {
    const { link } = await svc.mintLink({ orderId: 50 });
    expect(link).toMatch(/^https:\/\/api\.example\.com\/pay\/[A-Za-z0-9_-]{43}$/);
    const data = prisma.order_receiver_pay.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ token_hash: expect.any(String), token_expires_at: expect.any(Date) });
    expect(data).not.toHaveProperty("link_send_count");
    expect(data).not.toHaveProperty("link_sent_at");
    const { sendWhatsAppNotification } = require("../../whatsapp/notifications");
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });
  it("NOT_ACTIVE when the row is missing or not active", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(row({ status: "paid" }));
    await expect(svc.mintLink({ orderId: 50 })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });
  it("NOT_PAYABLE when nothing is pending for the receiver", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ payer: "customer" }));
    await expect(svc.mintLink({ orderId: 50 })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    expect(prisma.order_receiver_pay.update).not.toHaveBeenCalled();
  });
  it("NOT_CONFIGURED without PUBLIC_BASE_URL, before touching the token", async () => {
    delete process.env.PUBLIC_BASE_URL;
    await expect(svc.mintLink({ orderId: 50 })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(prisma.order_receiver_pay.update).not.toHaveBeenCalled();
  });
});


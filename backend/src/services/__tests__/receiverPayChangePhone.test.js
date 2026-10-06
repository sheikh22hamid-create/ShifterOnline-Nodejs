jest.mock("../../config/db", () => ({
  $transaction: jest.fn((ops) => Promise.all(ops)),
  order_receiver_pay: { findUnique: jest.fn(), update: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
  pkg_order: { findUnique: jest.fn(), update: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../whatsapp/notifications", () => ({ sendWhatsAppNotification: jest.fn() }));
jest.mock("../receiverTrackMessage", () => ({ syncReceiverPhone: jest.fn().mockResolvedValue({ rotated: false }) }));
jest.mock("../receiverPaySettings", () => ({
  isReceiverPayAvailable: jest.fn(),
  getReceiverPaySettings: jest.fn(),
}));

const prisma = require("../../config/db");
const settings = require("../receiverPaySettings");
const { sendWhatsAppNotification } = require("../../whatsapp/notifications");
const trackMsg = require("../receiverTrackMessage");
const svc = require("../receiverPayService");

const rpRow = (o = {}) => ({ id: 3, order_id: 50, uid: 7, receiver_phone: "9876500000", status: "active", link_send_count: 0, link_sent_at: null, ...o });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PUBLIC_BASE_URL = "https://api.example.com";
  settings.getReceiverPaySettings.mockResolvedValue({ linkTtlHours: 24 });
  const current = rpRow();
  prisma.order_receiver_pay.findUnique.mockImplementation(() => Promise.resolve({ ...current }));
  prisma.order_receiver_pay.update.mockImplementation(({ data }) => { Object.assign(current, data); return Promise.resolve({}); });
  prisma.order_settlement.findUnique.mockResolvedValue(null);
  prisma.pkg_order.findUnique.mockResolvedValue({ o_status: "Processing" });
  prisma.pkg_order.update.mockResolvedValue({});
  sendWhatsAppNotification.mockResolvedValue(true);
});

describe("receiverPayService.changeReceiverPhone", () => {
  it("before completion: updates the receiver row and the drop contact, sends nothing", async () => {
    const out = await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "+91 98765 43210" });
    expect(out).toEqual({ changed: true, link_sent: null, link: null });
    expect(prisma.order_receiver_pay.update).toHaveBeenCalledWith({ where: { id: 3 }, data: expect.objectContaining({ receiver_phone: "9876543210" }) });
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 50 }, data: { dmobile: "9876543210" } });
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });

  it("while the receiver payment is pending: mints a fresh link and WhatsApps it to the NEW number", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue({ order_id: 50, payer: "receiver", status: "pending", amount_due: 100, receiver_markup: 3 });
    const out = await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "9876543210" });
    expect(out).toMatchObject({ changed: true, link_sent: true });
    expect(sendWhatsAppNotification).toHaveBeenCalledWith("9876543210", expect.stringContaining("/pay/"));
    // the token rotation (old link dies) is the second update on the row
    expect(prisma.order_receiver_pay.update).toHaveBeenCalledWith({ where: { id: 3 }, data: expect.objectContaining({ token_hash: expect.any(String) }) });
  });

  it("hands the link back when WhatsApp cannot deliver it", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue({ order_id: 50, payer: "receiver", status: "pending", amount_due: 100, receiver_markup: 3 });
    sendWhatsAppNotification.mockResolvedValue(false);
    const out = await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "9876543210" });
    expect(out).toMatchObject({ changed: true, link_sent: false, link: expect.stringContaining("/pay/") });
  });

  it("the same number is a no-op", async () => {
    expect(await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "98765 00000" })).toEqual({ changed: false, link_sent: null, link: null });
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
  });

  it("rejects an invalid number", async () => {
    await expect(svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "12345" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(prisma.order_receiver_pay.update).not.toHaveBeenCalled();
  });

  it("only the booker can change it", async () => {
    await expect(svc.changeReceiverPhone({ orderId: 50, uid: 8, phone: "9876543210" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.order_receiver_pay.update).not.toHaveBeenCalled();
  });

  it("an admin (no uid) may change it", async () => {
    expect((await svc.changeReceiverPhone({ orderId: 50, phone: "9876543210" })).changed).toBe(true);
  });

  it("refuses when the receiver payment is no longer active", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ status: "declined" }));
    await expect(svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "9876543210" })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
    await expect(svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "9876543210" })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });

  it("refuses on a cancelled order", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ o_status: "Cancelled" });
    await expect(svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "9876543210" })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });

  it("refuses once the payment is settled or taken over", async () => {
    for (const s of [{ payer: "receiver", status: "cash_received" }, { payer: "customer", status: "pending" }]) {
      prisma.order_settlement.findUnique.mockResolvedValue({ order_id: 50, ...s });
      await expect(svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "9876543210" })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    }
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
  });
});

describe("receiverPayService.changeReceiverPhone keeps the tracking link in step", () => {
  it("rotates the tracking link to the new number after saving it", async () => {
    await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "98765 43210" });
    expect(trackMsg.syncReceiverPhone).toHaveBeenCalledWith(50, "9876543210");
  });
  it("does nothing for the tracking link when the number did not change", async () => {
    await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "98765 00000" });
    expect(trackMsg.syncReceiverPhone).not.toHaveBeenCalled();
  });
});

jest.mock("../../config/db", () => ({
  order_settlement: { findUnique: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
}));
jest.mock("../settlementService", () => {
  class SettlementError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return {
    SettlementError,
    STATUS: { PENDING: "pending", CASH_RECEIVED: "cash_received", PAID_ONLINE: "paid_online", DISPUTED: "disputed", WAIVED: "waived", CUSTOMER_OWES: "customer_owes" },
    createOnlineOrder: jest.fn(),
    settleOnline: jest.fn(),
  };
});

const prisma = require("../../config/db");
const settlementService = require("../settlementService");
const token = require("../senderPayToken");
const service = require("../senderPayService");

const OLD_ENV = process.env;
beforeEach(() => {
  jest.clearAllMocks();
  process.env = { ...OLD_ENV, JWT_SECRET: "test-secret", PUBLIC_BASE_URL: "https://api.example.com/" };
});
afterAll(() => { process.env = OLD_ENV; });

const settlement = (o = {}) => ({ order_id: 55, uid: 7, rid: 9, status: "pending", payer: "customer", amount_due: "350.00", ...o });
const tokenFor = (orderId = 55, opts) => token.mint(orderId, opts);

describe("senderPayToken", () => {
  it("round-trips the order id and rejects tampering", () => {
    const t = tokenFor(55);
    expect(token.verify(t)).toMatchObject({ orderId: 55 });
    expect(token.verify(t.replace(/^55\./, "56."))).toBeNull();
    expect(token.verify(t.slice(0, -2) + "xx")).toBeNull();
    expect(token.verify("garbage")).toBeNull();
  });
  it("a token signed with another secret does not verify", () => {
    const t = tokenFor(55);
    process.env.JWT_SECRET = "other-secret";
    expect(token.verify(t)).toBeNull();
  });
  it("mints nothing without a secret", () => {
    process.env.JWT_SECRET = "";
    delete process.env.SENDER_PAY_SECRET;
    expect(token.mint(55)).toBeNull();
  });
});

describe("buildLink", () => {
  it("builds a /pay/s/<token> link, or null without a base url", () => {
    expect(service.buildLink(55)).toMatch(/^https:\/\/api\.example\.com\/pay\/s\/55\.\d+\.[A-Za-z0-9_-]{43}$/);
    delete process.env.PUBLIC_BASE_URL;
    expect(service.buildLink(55)).toBeNull();
  });
});

describe("getPublicState", () => {
  it("payable: amount and trip summary from the settlement", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlement());
    prisma.pkg_order.findUnique.mockResolvedValue({ paddress: "Vijay Nagar", daddress: "Bhawarkua" });
    prisma.tbl_rider.findUnique.mockResolvedValue({ first_name: "Suresh Patel" });
    expect(await service.getPublicState(tokenFor())).toMatchObject({
      state: "payable", order_id: 55, amount_due: 350, total: 350, markup: 0, driver_first_name: "Suresh", pickup: "Vijay Nagar", drop: "Bhawarkua",
    });
  });
  it("paid, receiver_pending, closed and expired", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ status: "paid_online" }));
    expect(await service.getPublicState(tokenFor())).toEqual({ state: "paid" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ status: "cash_received" }));
    expect(await service.getPublicState(tokenFor())).toEqual({ state: "paid" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ payer: "receiver" }));
    expect(await service.getPublicState(tokenFor())).toEqual({ state: "receiver_pending" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlement({ status: "disputed" }));
    expect(await service.getPublicState(tokenFor())).toEqual({ state: "closed" });
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    expect(await service.getPublicState(tokenFor())).toEqual({ state: "closed" });
    expect(await service.getPublicState(tokenFor(55, { ttlMs: -1000 }))).toEqual({ state: "expired" });
  });
  it("a forged token is an INVALID_LINK and never reads the db", async () => {
    await expect(service.getPublicState("55.1999999999999." + "a".repeat(43))).rejects.toMatchObject({ code: "INVALID_LINK" });
    expect(prisma.order_settlement.findUnique).not.toHaveBeenCalled();
  });
});

describe("createOrderByToken / settleByToken", () => {
  it("creates the Razorpay order for the settlement's own customer", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlement());
    settlementService.createOnlineOrder.mockResolvedValue({ razorpay_order_id: "order_1" });
    expect(await service.createOrderByToken(tokenFor())).toEqual({ razorpay_order_id: "order_1" });
    expect(settlementService.createOnlineOrder).toHaveBeenCalledWith({ orderId: 55, uid: 7 });
  });
  it("refuses to start payment on an expired link", async () => {
    await expect(service.createOrderByToken(tokenFor(55, { ttlMs: -1000 }))).rejects.toMatchObject({ code: "LINK_EXPIRED" });
    expect(settlementService.createOnlineOrder).not.toHaveBeenCalled();
  });
  it("still records a verified payment after the link expired", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlement());
    settlementService.settleOnline.mockResolvedValue({ settlement: {} });
    await service.settleByToken({ token: tokenFor(55, { ttlMs: -1000 }), paymentId: "pay_1", razorpayOrderId: "order_1", signature: "sig" });
    expect(settlementService.settleOnline).toHaveBeenCalledWith({ orderId: 55, uid: 7, paymentId: "pay_1", razorpayOrderId: "order_1", signature: "sig" });
  });
  it("no settlement means nothing to pay", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    await expect(service.createOrderByToken(tokenFor())).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

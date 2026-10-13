jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/senderPayService", () => ({
  getPublicState: jest.fn(), createOrderByToken: jest.fn(), settleByToken: jest.fn(),
}));

const svc = require("../../services/senderPayService");
const { SettlementError } = require("../../services/settlementService");
const c = require("../senderPayController");

const TOKEN = `55.1999999999999.${"t".repeat(43)}`;
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() });

beforeEach(() => jest.clearAllMocks());

describe("senderPayController", () => {
  it("rejects a malformed token with 404 before touching the service", async () => {
    const r = res();
    await c.state({ params: { token: "../etc/passwd" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(svc.getPublicState).not.toHaveBeenCalled();
  });
  it("state, order and verify pass through", async () => {
    svc.getPublicState.mockResolvedValue({ state: "payable", total: 350 });
    let r = res();
    await c.state({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "payable", total: 350 });

    svc.createOrderByToken.mockResolvedValue({ razorpay_order_id: "order_1" });
    r = res();
    await c.createOrder({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, razorpay_order_id: "order_1" });

    svc.settleByToken.mockResolvedValue({});
    r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p", razorpay_order_id: "o", razorpay_signature: "s" } }, r);
    expect(svc.settleByToken).toHaveBeenCalledWith({ token: TOKEN, paymentId: "p", razorpayOrderId: "o", signature: "s" });
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "paid" });
  });
  it("verify needs all three Razorpay fields", async () => {
    const r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.settleByToken).not.toHaveBeenCalled();
  });
  it("maps INVALID_LINK to 404 and other settlement errors to 400", async () => {
    svc.getPublicState.mockRejectedValue(new SettlementError("INVALID_LINK", "bad"));
    let r = res();
    await c.state({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    svc.createOrderByToken.mockRejectedValue(new SettlementError("LINK_EXPIRED", "old"));
    r = res();
    await c.createOrder({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
  it("serves the page without a Decline control", () => {
    const r = res();
    c.page({ params: { token: TOKEN } }, r);
    const html = r.send.mock.calls[0][0];
    expect(html).toContain('"/api/pay/s/"');
    expect(html).not.toContain('$("decline").hidden = false');
  });
});

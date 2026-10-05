jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/receiverSettlementService", () => ({
  getPublicState: jest.fn(), createOrderByToken: jest.fn(), settleByReceiver: jest.fn(), declineByToken: jest.fn(),
}));

const svc = require("../../services/receiverSettlementService");
const { SettlementError } = require("../../services/settlementService");
const c = require("../receiverPayController");

const TOKEN = "t".repeat(43);
const res = () => { const r = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() }; return r; };

beforeEach(() => jest.clearAllMocks());

describe("receiverPayController", () => {
  it("rejects a malformed token with 404 before touching the service", async () => {
    const r = res();
    await c.state({ params: { token: "../etc/passwd" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(svc.getPublicState).not.toHaveBeenCalled();
  });
  it("state: returns the public state", async () => {
    svc.getPublicState.mockResolvedValue({ state: "payable", total: 92.7 });
    const r = res();
    await c.state({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "payable", total: 92.7 });
  });
  it("unknown token -> 404 with a neutral message", async () => {
    svc.getPublicState.mockRejectedValue(new SettlementError("INVALID_LINK", "This payment link is not valid."));
    const r = res();
    await c.state({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ success: false, code: "INVALID_LINK", message: "This payment link is not valid." });
  });
  it("order: returns the Razorpay order", async () => {
    svc.createOrderByToken.mockResolvedValue({ razorpay_order_id: "order_1", amount_paise: 9270, currency: "INR", key_id: "k" });
    const r = res();
    await c.createOrder({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, razorpay_order_id: "order_1", amount_paise: 9270, currency: "INR", key_id: "k" });
  });
  it("verify: requires all three Razorpay fields", async () => {
    const r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.settleByReceiver).not.toHaveBeenCalled();
  });
  it("verify: settles and reports paid", async () => {
    svc.settleByReceiver.mockResolvedValue({ settlement: {} });
    const r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p", razorpay_order_id: "o", razorpay_signature: "s" } }, r);
    expect(svc.settleByReceiver).toHaveBeenCalledWith({ token: TOKEN, paymentId: "p", razorpayOrderId: "o", signature: "s" });
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "paid" });
  });
  it("service business errors become 400 with their code", async () => {
    svc.settleByReceiver.mockRejectedValue(new SettlementError("PAYMENT_VERIFICATION_FAILED", "Payment Verification Failed!"));
    const r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p", razorpay_order_id: "o", razorpay_signature: "s" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: "PAYMENT_VERIFICATION_FAILED" }));
  });
  it("unexpected errors become a generic 500 with no detail", async () => {
    svc.declineByToken.mockRejectedValue(new Error("secret db detail"));
    const r = res();
    await c.decline({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(r.json.mock.calls[0][0])).not.toContain("secret");
  });
  it("decline: reports closed", async () => {
    svc.declineByToken.mockResolvedValue({ phase: "converted" });
    const r = res();
    await c.decline({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "closed" });
  });
  it("page: serves HTML with no-store / no-referrer / noindex headers, and 404 for a malformed token", async () => {
    const r = res();
    c.page({ params: { token: TOKEN } }, r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" }));
    expect(r.send).toHaveBeenCalledWith(expect.stringContaining("<!doctype html>"));
    const bad = res();
    c.page({ params: { token: "x" } }, bad);
    expect(bad.status).toHaveBeenCalledWith(404);
  });
});

describe("receiverPayPage", () => {
  const { PAGE_HTML } = require("../receiverPayPage");
  it("handles verify failures safely and never uses innerHTML", () => {
    expect(PAGE_HTML).toContain("We could not confirm your payment");
    expect(PAGE_HTML).toContain(".catch(verifyFailed)");
    expect(PAGE_HTML).not.toContain("innerHTML");
  });
  it("locks Pay and Decline after any failed verify outcome", () => {
    const start = PAGE_HTML.indexOf("/verify");
    const end = PAGE_HTML.indexOf("modal:", start);
    const verifyBlock = PAGE_HTML.slice(start, end);
    expect(verifyBlock).toContain(".catch(verifyFailed)");
    expect(verifyBlock).toContain("verifyFailed()");
    expect(verifyBlock).not.toContain("PAYMENT_VERIFICATION_FAILED");
    expect(verifyBlock).not.toMatch(/disabled = false/);
    expect(PAGE_HTML).toContain("var locked = false");
    expect(PAGE_HTML).toContain("disabled = locked");
  });
  it("only re-enables buttons for an /order failure", () => {
    expect(PAGE_HTML).toContain("if (!o.success) {");
  });
});

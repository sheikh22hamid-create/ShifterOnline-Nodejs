jest.mock("../logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
const logger = require("../logger");
const { createRazorpayOrder } = require("../razorpayOrders");

describe("createRazorpayOrder", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; delete global.fetch; });

  it("fails cleanly when keys are not configured", async () => {
    delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET;
    expect(await createRazorpayOrder({ amountRupees: 50, receipt: "r1" })).toEqual({ ok: false, reason: expect.stringContaining("not configured") });
  });

  it("posts the amount in paise and returns the order id", async () => {
    process.env.RAZORPAY_KEY_ID = "id"; process.env.RAZORPAY_KEY_SECRET = "secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "order_X", amount: 5050, currency: "INR" }) });
    const result = await createRazorpayOrder({ amountRupees: 50.5, receipt: "settle_9" });
    expect(result).toEqual({ ok: true, id: "order_X", amountPaise: 5050, currency: "INR" });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://api.razorpay.com/v1/orders");
    expect(JSON.parse(init.body)).toEqual({ amount: 5050, currency: "INR", receipt: "settle_9" });
  });

  it("surfaces Razorpay's own error message", async () => {
    process.env.RAZORPAY_KEY_ID = "id"; process.env.RAZORPAY_KEY_SECRET = "secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({ error: { description: "Amount too low" } }) });
    expect(await createRazorpayOrder({ amountRupees: 0.5, receipt: "r" })).toEqual({ ok: false, reason: "Amount too low" });
  });

  it("returns a generic failure and logs when fetch rejects (network error or timeout)", async () => {
    process.env.RAZORPAY_KEY_ID = "id"; process.env.RAZORPAY_KEY_SECRET = "secret";
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
    expect(await createRazorpayOrder({ amountRupees: 50, receipt: "r" })).toEqual({ ok: false, reason: "Could not reach the payment gateway. Try again." });
    expect(logger.error).toHaveBeenCalled();
  });

  it("does not throw on a non-JSON error body", async () => {
    process.env.RAZORPAY_KEY_ID = "id"; process.env.RAZORPAY_KEY_SECRET = "secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } });
    expect(await createRazorpayOrder({ amountRupees: 50, receipt: "r" })).toEqual({ ok: false, reason: "Payment gateway error. Try again." });
  });

  it("sends a request timeout signal", async () => {
    process.env.RAZORPAY_KEY_ID = "id"; process.env.RAZORPAY_KEY_SECRET = "secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "order_X", amount: 5000, currency: "INR" }) });
    await createRazorpayOrder({ amountRupees: 50, receipt: "r" });
    expect(global.fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

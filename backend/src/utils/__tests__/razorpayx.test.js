jest.mock("../logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
const crypto = require("crypto");
const rx = require("../razorpayx");

const ENV = {
  RAZORPAYX_KEY_ID: "kid",
  RAZORPAYX_KEY_SECRET: "ksecret",
  RAZORPAYX_ACCOUNT_NUMBER: "2323230000000001",
  RAZORPAYX_WEBHOOK_SECRET: "whsec",
};

describe("razorpayx client", () => {
  const OLD = { ...process.env };
  beforeEach(() => { Object.assign(process.env, ENV); });
  afterEach(() => { process.env = { ...OLD }; delete global.fetch; });

  describe("toPaise", () => {
    it("converts rupees to integer paise", () => {
      expect(rx.toPaise("2.00")).toBe(200);
      expect(rx.toPaise(99.99)).toBe(9999);
      expect(rx.toPaise(0.29)).toBe(29);
    });
  });

  describe("isConfigured", () => {
    it("is true only when all three vars are set", () => {
      expect(rx.isConfigured()).toBe(true);
      for (const k of ["RAZORPAYX_KEY_ID", "RAZORPAYX_KEY_SECRET", "RAZORPAYX_ACCOUNT_NUMBER"]) {
        const saved = process.env[k];
        delete process.env[k];
        expect(rx.isConfigured()).toBe(false);
        process.env[k] = saved;
      }
    });
  });

  describe("isWebhookConfigured", () => {
    it("is true only when RAZORPAYX_WEBHOOK_SECRET is set", () => {
      expect(rx.isWebhookConfigured()).toBe(true);
      delete process.env.RAZORPAYX_WEBHOOK_SECRET;
      expect(rx.isWebhookConfigured()).toBe(false);
    });
  });

  describe("verifyWebhookSignature", () => {
    const body = Buffer.from('{"event":"payout.processed"}');
    const sign = (b, s = "whsec") => crypto.createHmac("sha256", s).update(b).digest("hex");
    it("accepts a correctly signed body", () => {
      expect(rx.verifyWebhookSignature(body, sign(body))).toBe(true);
    });
    it("rejects tampered body, missing signature, unset secret, wrong length", () => {
      expect(rx.verifyWebhookSignature(Buffer.from('{"event":"x"}'), sign(body))).toBe(false);
      expect(rx.verifyWebhookSignature(body, undefined)).toBe(false);
      expect(rx.verifyWebhookSignature(body, "abc")).toBe(false);
      delete process.env.RAZORPAYX_WEBHOOK_SECRET;
      expect(rx.verifyWebhookSignature(body, sign(body))).toBe(false);
    });
  });

  describe("createPayout", () => {
    const okBody = { id: "pout_1", status: "processing", utr: null, fund_account_id: "fa_1", amount: 200 };
    const okResp = { ok: true, status: 200, json: async () => okBody };

    it("posts the exact payload for UPI", async () => {
      global.fetch = jest.fn().mockResolvedValue(okResp);
      const r = await rx.createPayout({ fundAccountId: "fa_1", amountRupees: "2.00", method: "upi", referenceId: "wd-5" });
      expect(r).toEqual({ ok: true, id: "pout_1", status: "processing", utr: null });
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe("https://api.razorpay.com/v1/payouts");
      expect(init.method).toBe("POST");
      expect(init.headers["X-Payout-Idempotency"]).toBe("wd-5");
      expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("kid:ksecret").toString("base64")}`);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.parse(init.body)).toEqual({
        account_number: "2323230000000001",
        fund_account_id: "fa_1",
        amount: 200,
        currency: "INR",
        mode: "UPI",
        purpose: "payout",
        queue_if_low_balance: false,
        reference_id: "wd-5",
        narration: "Shifter driver payout",
      });
    });

    it.each([
      ["fund_account_id differs", { fund_account_id: "fa_other" }],
      ["amount differs", { amount: 20000 }],
      ["fund_account_id missing", { fund_account_id: undefined }],
      ["amount missing", { amount: undefined }],
    ])("a 2xx whose %s is a non-definitive failure", async (_label, patch) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ...okBody, ...patch }) });
      const r = await rx.createPayout({ fundAccountId: "fa_1", amountRupees: "2.00", method: "upi", referenceId: "wd-5" });
      expect(r).toMatchObject({ ok: false, definitive: false });
      expect(r.reason).toContain("did not match");
      expect(r.reason).toContain("pout_1");
    });

    it("uses IMPS for bank", async () => {
      global.fetch = jest.fn().mockResolvedValue(okResp);
      await rx.createPayout({ fundAccountId: "fa_1", amountRupees: 99.99, method: "bank", referenceId: "wd-6" });
      const body = JSON.parse(global.fetch.mock.calls[0][1].body);
      expect(body.mode).toBe("IMPS");
      expect(body.amount).toBe(9999);
    });

    it("classifies a 400 as definitive with Razorpay's description", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { description: "Invalid VPA" } }) });
      expect(await rx.createPayout({ fundAccountId: "fa_1", amountRupees: 2, method: "upi", referenceId: "wd-5" }))
        .toEqual({ ok: false, definitive: true, reason: "Invalid VPA" });
    });

    it.each([408, 409, 429])("treats %i as non-definitive even with a Razorpay error body", async (status) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status, json: async () => ({ error: { description: "secret detail" } }) });
      const r = await rx.createPayout({ fundAccountId: "fa_1", amountRupees: 2, method: "upi", referenceId: "wd-5" });
      expect(r).toMatchObject({ ok: false, definitive: false });
    });

    // An unauthenticated / forbidden request cannot have created a payout.
    it.each([
      [401, { error: { description: "secret detail" } }],
      [403, { error: { description: "secret detail" } }],
      [401, null],
      [403, { message: "proxy said no" }],
    ])("treats %i as definitive (body %j) with a fixed reason", async (status, body) => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status, json: async () => body });
      const r = await rx.createPayout({ fundAccountId: "fa_1", amountRupees: 2, method: "upi", referenceId: "wd-5" });
      expect(r).toEqual({ ok: false, definitive: true, reason: "RazorpayX rejected our credentials or permissions" });
    });

    it("treats a 400 without an error object as non-definitive", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ message: "WAF block" }) });
      expect(await rx.createPayout({ fundAccountId: "fa_1", amountRupees: 2, method: "upi", referenceId: "wd-5" }))
        .toMatchObject({ ok: false, definitive: false });
    });

    it("never returns ok:true without an id on 2xx", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "processing" }) });
      expect(await rx.createContact({ name: "Ravi Kumar", mobile: "9", referenceId: "r" })).toMatchObject({ ok: false, definitive: false });
      expect(await rx.createFundAccount({ contactId: "c", method: "upi", upiId: "a@b" })).toMatchObject({ ok: false, definitive: false });
      expect(await rx.createPayout({ fundAccountId: "fa_1", amountRupees: 2, method: "upi", referenceId: "wd-5" })).toMatchObject({ ok: false, definitive: false });
    });

    it("classifies 5xx, network error and non-JSON body as non-definitive", async () => {
      const args = { fundAccountId: "fa_1", amountRupees: 2, method: "upi", referenceId: "wd-5" };
      global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: { description: "boom" } }) });
      expect(await rx.createPayout(args)).toMatchObject({ ok: false, definitive: false });
      global.fetch = jest.fn().mockRejectedValue(new Error("ECONNRESET"));
      expect(await rx.createPayout(args)).toMatchObject({ ok: false, definitive: false });
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("x"); } });
      expect(await rx.createPayout(args)).toMatchObject({ ok: false, definitive: false });
    });
  });

  describe("createContact / createFundAccount / fetchPayout", () => {
    it("creates a contact", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "cont_1" }) });
      expect(await rx.createContact({ name: "Ravi Kumar", mobile: "9000090000", referenceId: "drv-1" })).toEqual({ ok: true, id: "cont_1" });
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe("https://api.razorpay.com/v1/contacts");
      expect(JSON.parse(init.body)).toEqual({ name: "Ravi Kumar", contact: "9000090000", type: "vendor", reference_id: "drv-1" });
    });

    it("creates a UPI fund account", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "fa_1" }) });
      expect(await rx.createFundAccount({ contactId: "cont_1", method: "upi", upiId: "a@upi" })).toEqual({ ok: true, id: "fa_1" });
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe("https://api.razorpay.com/v1/fund_accounts");
      expect(JSON.parse(init.body)).toEqual({ contact_id: "cont_1", account_type: "vpa", vpa: { address: "a@upi" } });
    });

    it("creates a bank fund account", async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: "fa_2" }) });
      await rx.createFundAccount({ contactId: "cont_1", method: "bank", accountName: "Ravi Kumar", accountNumber: "1234567890", ifsc: "HDFC0000001" });
      expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
        contact_id: "cont_1",
        account_type: "bank_account",
        bank_account: { name: "Ravi Kumar", ifsc: "HDFC0000001", account_number: "1234567890" },
      });
    });

    it("fetches a payout", async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true, status: 200,
        json: async () => ({ id: "pout_1", status: "failed", utr: null, reference_id: "wd-5", status_details: { description: "Beneficiary bank offline" } }),
      });
      expect(await rx.fetchPayout("pout_1")).toEqual({
        ok: true, id: "pout_1", status: "failed", utr: null, failureReason: "Beneficiary bank offline", referenceId: "wd-5",
      });
      const [url, init] = global.fetch.mock.calls[0];
      expect(url).toBe("https://api.razorpay.com/v1/payouts/pout_1");
      expect(init.method).toBe("GET");
    });
  });

  describe("when not configured", () => {
    it("every network function returns non-definitive failure without calling fetch", async () => {
      delete process.env.RAZORPAYX_KEY_ID;
      global.fetch = jest.fn();
      const expected = { ok: false, definitive: false, reason: "RazorpayX is not configured" };
      expect(await rx.createContact({ name: "n", mobile: "1", referenceId: "r" })).toEqual(expected);
      expect(await rx.createFundAccount({ contactId: "c", method: "upi", upiId: "a@b" })).toEqual(expected);
      expect(await rx.createPayout({ fundAccountId: "f", amountRupees: 1, method: "upi", referenceId: "r" })).toEqual(expected);
      expect(await rx.fetchPayout("p")).toEqual(expected);
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});

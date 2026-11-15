jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const provider = require("../gstProvider");

const GSTIN = "27AAPFU0939F1ZV";
const ENV = { GST_API_URL: "https://gst.example/lookup?gstin={gstin}&key={key}", GST_API_KEY: "s3cr3t key" };
const answer = (status, body) => jest.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, json: async () => body });
const taxpayer = {
  gstin: GSTIN, lgnm: "ABC TRADERS PRIVATE LIMITED", tradeNam: "ABC Traders", sts: "Active",
  pradr: { addr: { bno: "12", st: "MG Road", loc: "Andheri", dst: "Mumbai", pncd: "400053" } },
};

describe("not configured", () => {
  it("reports unavailable and never calls out", async () => {
    const fetchImpl = jest.fn();
    expect(await provider.lookup(GSTIN, { env: {}, fetchImpl })).toEqual({ outcome: "unavailable", reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("request", () => {
  it("fills {gstin} and {key} into the URL (url-encoded) and asks for JSON", async () => {
    const fetchImpl = answer(200, { taxpayerInfo: taxpayer });
    await provider.lookup(GSTIN, { env: ENV, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`https://gst.example/lookup?gstin=${GSTIN}&key=s3cr3t%20key`);
    expect(init.method).toBe("GET");
    expect(init.headers.accept).toBe("application/json");
  });

  it("supports a header key and a POST body template", async () => {
    const fetchImpl = answer(200, taxpayer);
    await provider.lookup(GSTIN, {
      env: { GST_API_URL: "https://gst.example/v1/verify", GST_API_METHOD: "post", GST_API_KEY: "K1", GST_API_HEADERS: '{"x-api-key":"{key}"}', GST_API_BODY: '{"id_number":"{gstin}"}' },
      fetchImpl,
    });
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.headers["x-api-key"]).toBe("K1");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.body).toBe(`{"id_number":"${GSTIN}"}`);
  });
});

describe("outcomes", () => {
  it("verified: legal name, address and state come back (any GSTN-style envelope)", async () => {
    for (const body of [taxpayer, { taxpayerInfo: taxpayer }, { data: taxpayer }]) {
      const out = await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, body) });
      expect(out.outcome).toBe("verified");
      expect(out.details).toMatchObject({ gstin: GSTIN, legal_name: "ABC TRADERS PRIVATE LIMITED", trade_name: "ABC Traders", state: "Maharashtra", pincode: "400053" });
    }
  });

  it("invalid: the provider says the GSTIN does not exist", async () => {
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(404, { message: "not found" }) })).outcome).toBe("invalid");
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(422, {}) })).outcome).toBe("invalid");
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, { error: true, message: "Invalid GSTIN" }) })).outcome).toBe("invalid");
  });

  it("invalid: a cancelled or suspended registration", async () => {
    const out = await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, { ...taxpayer, sts: "Cancelled" }) });
    expect(out).toMatchObject({ outcome: "invalid", reason: "inactive" });
  });

  it("unavailable, never 'invalid': our account or the provider is the problem", async () => {
    for (const status of [401, 402, 403, 429, 500, 503]) {
      expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(status, { message: "invalid key" }) })).outcome).toBe("unavailable");
    }
    // a 200 that complains about the key / credits is not a verdict on the GSTIN either
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, { error: true, message: "Invalid API key" }) })).outcome).toBe("unavailable");
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, { message: "Insufficient credits balance" }) })).outcome).toBe("unavailable");
  });

  it("unavailable on a network error, a timeout, an unreadable answer or an answer for another GSTIN", async () => {
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: jest.fn().mockRejectedValue(new Error("ECONNRESET")) })).outcome).toBe("unavailable");
    const aborted = jest.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(await provider.lookup(GSTIN, { env: ENV, fetchImpl: aborted })).toEqual({ outcome: "unavailable", reason: "timeout" });
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, { hello: "world" }) })).outcome).toBe("unavailable");
    expect((await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, { ...taxpayer, gstin: "07AAGFF2194N1Z1" }) })).outcome).toBe("unavailable");
  });

  it("a GSTIN is never reported verified without a legal name", async () => {
    const out = await provider.lookup(GSTIN, { env: ENV, fetchImpl: answer(200, { gstin: GSTIN, sts: "Active" }) });
    expect(out.outcome).not.toBe("verified");
  });
});

jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../services/gstService", () => ({
  verify: jest.fn(), getProfile: jest.fn(), removeProfile: jest.fn(), publicDetails: (r) => ({ gstin: r.gstin, legal_name: r.legal_name }),
}));

const gstService = require("../../services/gstService");
const ctrl = require("../gstController");

const res = () => { const r = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };
const body = (r) => r.json.mock.calls[0][0];

beforeEach(() => jest.clearAllMocks());

describe("verify", () => {
  it("valid: returns the verified details and that they were saved", async () => {
    gstService.verify.mockResolvedValue({ ok: true, saved: true, details: { gstin: "27AAPFU0939F1ZV", legal_name: "ABC" } });
    const r = res();
    await ctrl.verify({ body: { uid: 31, gstin: "27AAPFU0939F1ZV" } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ Result: "true", valid: true, saved: true, details: { legal_name: "ABC" } });
    expect(gstService.verify).toHaveBeenCalledWith(31, "27AAPFU0939F1ZV");
  });

  it("a wrong GSTIN is a normal 200 answer with valid:false and no details to autofill", async () => {
    gstService.verify.mockResolvedValue({ ok: false, code: "INVALID", message: "This GSTIN could not be found." });
    const r = res();
    await ctrl.verify({ body: { uid: 31, gstin: "x" } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ Result: "false", valid: false, code: "INVALID" });
    expect(body(r).details).toBeUndefined();
  });

  it("a provider outage is a 503 the app can word as 'try later / book without GST'", async () => {
    gstService.verify.mockResolvedValue({ ok: false, code: "UNAVAILABLE", message: "We could not verify the GSTIN right now. You can still book without GST details." });
    const r = res();
    await ctrl.verify({ body: { uid: 31, gstin: "27AAPFU0939F1ZV" } }, r);
    expect(r.status).toHaveBeenCalledWith(503);
    expect(body(r)).toMatchObject({ valid: false, code: "UNAVAILABLE" });
  });

  it("needs a uid", async () => {
    for (const bad of [undefined, 0, "abc", -3]) {
      const r = res();
      await ctrl.verify({ body: { uid: bad, gstin: "27AAPFU0939F1ZV" } }, r);
      expect(r.status).toHaveBeenCalledWith(400);
    }
    expect(gstService.verify).not.toHaveBeenCalled();
  });

  it("each customer is limited per hour (paid provider), without affecting other customers", async () => {
    gstService.verify.mockResolvedValue({ ok: true, saved: true, details: { gstin: "g", legal_name: "n" } });
    for (let i = 0; i < ctrl.LIMIT_PER_HOUR; i += 1) {
      const r = res();
      await ctrl.verify({ body: { uid: 500, gstin: "27AAPFU0939F1ZV" } }, r);
      expect(r.status).toHaveBeenCalledWith(200);
    }
    const blocked = res();
    await ctrl.verify({ body: { uid: 500, gstin: "27AAPFU0939F1ZV" } }, blocked);
    expect(blocked.status).toHaveBeenCalledWith(429);
    const other = res();
    await ctrl.verify({ body: { uid: 501, gstin: "27AAPFU0939F1ZV" } }, other);
    expect(other.status).toHaveBeenCalledWith(200);
  });
});

describe("profile and remove are scoped to the asking uid", () => {
  it("profile returns only that uid's saved details, or null", async () => {
    gstService.getProfile.mockResolvedValue({ gstin: "27AAPFU0939F1ZV", legal_name: "ABC" });
    const r = res();
    await ctrl.profile({ body: { uid: 31 } }, r);
    expect(gstService.getProfile).toHaveBeenCalledWith(31);
    expect(body(r).details).toMatchObject({ gstin: "27AAPFU0939F1ZV" });
    gstService.getProfile.mockResolvedValue(null);
    const none = res();
    await ctrl.profile({ body: { uid: 32 } }, none);
    expect(body(none).details).toBeNull();
  });

  it("remove forgets that uid's details only", async () => {
    gstService.removeProfile.mockResolvedValue(true);
    const r = res();
    await ctrl.remove({ body: { uid: 31 } }, r);
    expect(gstService.removeProfile).toHaveBeenCalledWith(31);
    expect(body(r)).toMatchObject({ Result: "true" });
  });

  it("both need a uid", async () => {
    const a = res();
    const b = res();
    await ctrl.profile({ body: {} }, a);
    await ctrl.remove({ body: {} }, b);
    expect(a.status).toHaveBeenCalledWith(400);
    expect(b.status).toHaveBeenCalledWith(400);
  });
});

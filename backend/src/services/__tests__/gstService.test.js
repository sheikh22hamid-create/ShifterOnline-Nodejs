jest.mock("../../config/db", () => ({ $queryRaw: jest.fn(), $executeRaw: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../gstProvider", () => ({ lookup: jest.fn() }));

const prisma = require("../../config/db");
const provider = require("../gstProvider");
const gst = require("../gstService");

const GSTIN = "27AAPFU0939F1ZV";
const OTHER = "07AAGFF2194N1Z1";
const DETAILS = { gstin: GSTIN, legal_name: "ABC TRADERS PRIVATE LIMITED", trade_name: "ABC Traders", address: "12, MG Road, Mumbai", state: "Maharashtra", state_code: "27", pincode: "400053", status: "Active", active: true };
const row = (o = {}) => ({ gstin: GSTIN, legal_name: DETAILS.legal_name, trade_name: DETAILS.trade_name, address: DETAILS.address, state: "Maharashtra", state_code: "27", pincode: "400053", gst_status: "Active", verified_at: new Date(), ...o });

const sqlText = (call) => (Array.isArray(call[0]) ? call[0].join("?") : String(call[0])).replace(/\s+/g, " ");

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$queryRaw.mockResolvedValue([]);
  prisma.$executeRaw.mockResolvedValue(1);
});

describe("verify", () => {
  it("a wrongly formatted number never reaches the provider", async () => {
    const out = await gst.verify(7, "27AAPFU0939F1ZW");
    expect(out).toMatchObject({ ok: false, code: "INVALID_FORMAT" });
    expect(provider.lookup).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("valid: details come back and are saved to THIS customer's profile and the cache", async () => {
    provider.lookup.mockResolvedValue({ outcome: "verified", details: DETAILS });
    const out = await gst.verify(7, " 27aapfu0939f1zv ");
    expect(out).toMatchObject({ ok: true, source: "provider", saved: true, details: { gstin: GSTIN, legal_name: "ABC TRADERS PRIVATE LIMITED", state: "Maharashtra" } });
    expect(provider.lookup).toHaveBeenCalledWith(GSTIN);
    const profileWrite = prisma.$executeRaw.mock.calls.find((c) => sqlText(c).includes("customer_gst_profile"));
    expect(profileWrite.slice(1)[0]).toBe(7); // uid is the first bound value
    expect(prisma.$executeRaw.mock.calls.some((c) => sqlText(c).includes("gst_verification_cache"))).toBe(true);
  });

  it("invalid / inactive: nothing is returned for autofill and nothing is saved", async () => {
    provider.lookup.mockResolvedValue({ outcome: "invalid", reason: "not_found" });
    expect(await gst.verify(7, GSTIN)).toMatchObject({ ok: false, code: "INVALID" });
    provider.lookup.mockResolvedValue({ outcome: "invalid", reason: "inactive", details: DETAILS });
    const inactive = await gst.verify(7, GSTIN);
    expect(inactive).toMatchObject({ ok: false, code: "INACTIVE" });
    expect(inactive.details).toBeUndefined();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("provider unavailable: says so (the customer can still book), saves nothing", async () => {
    provider.lookup.mockResolvedValue({ outcome: "unavailable", reason: "timeout" });
    const out = await gst.verify(7, GSTIN);
    expect(out).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    expect(out.message).toMatch(/still book without GST/);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("a fresh cache entry saves a paid lookup", async () => {
    prisma.$queryRaw.mockResolvedValue([row()]);
    const out = await gst.verify(8, GSTIN);
    expect(out).toMatchObject({ ok: true, source: "cache", saved: true });
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("a stale cache entry (older than a day) is looked up again", async () => {
    prisma.$queryRaw.mockResolvedValue([row({ verified_at: new Date(Date.now() - 25 * 3600 * 1000) })]);
    provider.lookup.mockResolvedValue({ outcome: "verified", details: DETAILS });
    expect((await gst.verify(8, GSTIN)).source).toBe("provider");
  });

  it("a verified GSTIN is still returned when only the profile save fails", async () => {
    provider.lookup.mockResolvedValue({ outcome: "verified", details: DETAILS });
    prisma.$executeRaw.mockImplementation((strings) => (strings.join("?").includes("customer_gst_profile") ? Promise.reject(new Error("no table")) : Promise.resolve(1)));
    expect(await gst.verify(7, GSTIN)).toMatchObject({ ok: true, saved: false });
  });
});

describe("a customer's saved details are only theirs", () => {
  it("getProfile asks for that uid only", async () => {
    prisma.$queryRaw.mockResolvedValue([row()]);
    expect(await gst.getProfile(7)).toMatchObject({ gstin: GSTIN });
    expect(prisma.$queryRaw.mock.calls[0][1]).toBe(7);
    expect(sqlText(prisma.$queryRaw.mock.calls[0])).toMatch(/WHERE uid = \?/);
  });

  it("no profile -> null (nothing to autofill)", async () => {
    expect(await gst.getProfile(9)).toBeNull();
  });

  it("a missing table degrades to 'no details', never an error", async () => {
    prisma.$queryRaw.mockRejectedValue(new Error("Table doesn't exist"));
    expect(await gst.getProfile(7)).toBeNull();
    expect(await gst.getOrderGst(42)).toBeNull();
    expect(await gst.resolveStored(7, GSTIN)).toBeNull();
  });
});

describe("resolveStored (booking: no provider call)", () => {
  it("uses the customer's own profile when the typed GSTIN is theirs", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([row()]);
    expect(await gst.resolveStored(7, GSTIN)).toMatchObject({ gstin: GSTIN, legal_name: DETAILS.legal_name });
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("a different GSTIN than the profile's falls back to the cache only, else nothing", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([row({ gstin: OTHER })]).mockResolvedValueOnce([]);
    expect(await gst.resolveStored(7, GSTIN)).toBeNull();
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it("a malformed GSTIN resolves to nothing without touching the database", async () => {
    expect(await gst.resolveStored(7, "nonsense")).toBeNull();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe("order snapshot", () => {
  it("is written once and never overwritten", async () => {
    expect(await gst.attachToOrder(42, 7, DETAILS)).toBe(true);
    const sql = sqlText(prisma.$executeRaw.mock.calls[0]);
    expect(sql).toContain("INSERT INTO order_gst_detail");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE order_id = order_id");
  });

  it("a failed snapshot never throws into booking", async () => {
    prisma.$executeRaw.mockRejectedValue(new Error("boom"));
    expect(await gst.attachToOrder(42, 7, DETAILS)).toBe(false);
  });

  it("getOrderGst returns the saved details", async () => {
    prisma.$queryRaw.mockResolvedValue([row()]);
    expect(await gst.getOrderGst(42)).toMatchObject({ gstin: GSTIN, legal_name: DETAILS.legal_name, state: "Maharashtra" });
  });
});

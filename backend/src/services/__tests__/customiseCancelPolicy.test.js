jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn(), upsert: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const policy = require("../customiseCancelPolicy");

beforeEach(() => jest.resetAllMocks());

describe("penaltyOf", () => {
  it("is fixed plus the percentage of the agreed fare, split between admin and the other party", () => {
    expect(policy.penaltyOf({ mode: "special", fixed: 50, percent: 10, adminSharePercent: 20 }, 1000))
      .toEqual({ charge: 150, adminShare: 30, recipientAmount: 120 });
  });

  it("always adds up to the charge to the cent", () => {
    const out = policy.penaltyOf({ mode: "special", fixed: 0, percent: 3.33, adminSharePercent: 33.33 }, 999);
    expect(out.adminShare + out.recipientAmount).toBeCloseTo(out.charge, 10);
    for (const v of [out.charge, out.adminShare, out.recipientAmount]) expect(Math.abs(v * 100 - Math.round(v * 100))).toBeLessThan(1e-9);
  });

  it("never exceeds the agreed fare", () => {
    expect(policy.penaltyOf({ mode: "special", fixed: 900, percent: 50, adminSharePercent: 0 }, 1000).charge).toBe(1000);
  });

  it("is zero for Normal mode (the caller keeps the rate-card fee) and for an all-zero Special policy", () => {
    expect(policy.penaltyOf({ mode: "normal", fixed: 50, percent: 10, adminSharePercent: 20 }, 1000)).toEqual({ charge: 0, adminShare: 0, recipientAmount: 0 });
    expect(policy.penaltyOf({ mode: "special", fixed: 0, percent: 0, adminSharePercent: 50 }, 1000)).toEqual({ charge: 0, adminShare: 0, recipientAmount: 0 });
  });

  it("gives the whole charge to admin at a 100% share and clamps an out-of-range share", () => {
    expect(policy.penaltyOf({ mode: "special", fixed: 100, percent: 0, adminSharePercent: 100 }, 1000)).toEqual({ charge: 100, adminShare: 100, recipientAmount: 0 });
    expect(policy.penaltyOf({ mode: "special", fixed: 100, percent: 0, adminSharePercent: 250 }, 1000).recipientAmount).toBe(0);
    expect(policy.penaltyOf({ mode: "special", fixed: 100, percent: 0, adminSharePercent: -5 }, 1000).adminShare).toBe(0);
  });

  it("never produces NaN for a missing fare or junk numbers", () => {
    const out = policy.penaltyOf({ mode: "special", fixed: "x", percent: undefined, adminSharePercent: null }, undefined);
    expect(out).toEqual({ charge: 0, adminShare: 0, recipientAmount: 0 });
  });
});

describe("getPolicy", () => {
  const rows = (o) => Object.entries(o).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));

  it("prefers the city's own settings over the global ones", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      customise_cancel_driver_mode: "normal", customise_cancel_driver_mode_city_3: "special",
      customise_cancel_driver_fixed_city_3: "40", customise_cancel_driver_percent_city_3: "5", customise_cancel_driver_admin_share_city_3: "25",
    }));
    expect(await policy.getPolicy("driver", 3)).toEqual({ mode: "special", fixed: 40, percent: 5, adminSharePercent: 25 });
  });

  it("falls back to the global setting, then to Normal when nothing is configured", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ customise_cancel_customer_mode: "special", customise_cancel_customer_fixed: "10" }));
    expect(await policy.getPolicy("customer", 9)).toMatchObject({ mode: "special", fixed: 10, percent: 0, adminSharePercent: 0 });
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await policy.getPolicy("customer", 9)).toEqual({ mode: "normal", fixed: 0, percent: 0, adminSharePercent: 0 });
  });

  it("treats an unreadable or garbled configuration as Normal", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db"));
    expect((await policy.getPolicy("driver", 3)).mode).toBe("normal");
    prisma.app_settings.findMany.mockResolvedValue(rows({ customise_cancel_driver_mode: "banana" }));
    expect((await policy.getPolicy("driver", 3)).mode).toBe("normal");
  });
});

describe("savePolicy", () => {
  it("stores the four values under the city's keys", async () => {
    await policy.savePolicy("customer", 3, { mode: "special", fixed: 25, percent: 7.5, adminSharePercent: 40 });
    const keys = prisma.app_settings.upsert.mock.calls.map((c) => c[0].where.setting_key).sort();
    expect(keys).toEqual([
      "customise_cancel_customer_admin_share_city_3", "customise_cancel_customer_fixed_city_3",
      "customise_cancel_customer_mode_city_3", "customise_cancel_customer_percent_city_3",
    ]);
  });

  it.each([
    [{ mode: "weird", fixed: 0, percent: 0, adminSharePercent: 0 }],
    [{ mode: "special", fixed: -1, percent: 0, adminSharePercent: 0 }],
    [{ mode: "special", fixed: 0, percent: 101, adminSharePercent: 0 }],
    [{ mode: "special", fixed: 0, percent: 0, adminSharePercent: 150 }],
  ])("rejects invalid policy %j and writes nothing", async (bad) => {
    await expect(policy.savePolicy("driver", 3, bad)).rejects.toThrow();
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown side", async () => {
    await expect(policy.savePolicy("admin", 3, { mode: "normal", fixed: 0, percent: 0, adminSharePercent: 0 })).rejects.toThrow();
  });
});

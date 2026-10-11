jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn(), upsert: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");

beforeEach(() => {
  jest.clearAllMocks();
  settings._resetCache();
});

describe("getTierSettings", () => {
  it("defaults everything off with the default ladder and a 100% cancel penalty", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await settings.getTierSettings()).toEqual({
      tieredEnabled: false, penaltyEnabled: false, ladder: [5, 10, 20, 50, 100], cancelPenaltyPct: 100,
    });
  });

  it("reads the four keys", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "tiered_dispatch_enabled", setting_value: "1" },
      { setting_key: "tier_penalty_enabled", setting_value: "true" },
      { setting_key: "tier_penalty_ladder", setting_value: "2,4,8" },
      { setting_key: "tier_cancel_penalty_pct", setting_value: "25" },
    ]);
    expect(await settings.getTierSettings()).toEqual({
      tieredEnabled: true, penaltyEnabled: true, ladder: [2, 4, 8], cancelPenaltyPct: 25,
    });
  });

  it("fails closed (everything off) when the DB read throws", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    const s = await settings.getTierSettings();
    expect(s.tieredEnabled).toBe(false);
    expect(s.penaltyEnabled).toBe(false);
  });

  it("caches for a few seconds so every offer does not hit the DB", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    await settings.getTierSettings();
    await settings.getTierSettings();
    expect(prisma.app_settings.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("saveTierSettings", () => {
  beforeEach(() => {
    prisma.app_settings.upsert.mockResolvedValue({});
    prisma.app_settings.findMany.mockResolvedValue([]);
  });

  it("upserts only the provided keys", async () => {
    await settings.saveTierSettings({ tieredEnabled: true, ladder: "5,10" });
    const keys = prisma.app_settings.upsert.mock.calls.map((c) => c[0].where.setting_key).sort();
    expect(keys).toEqual(["tier_penalty_ladder", "tiered_dispatch_enabled"]);
    const ladderCall = prisma.app_settings.upsert.mock.calls.find((c) => c[0].where.setting_key === "tier_penalty_ladder");
    expect(ladderCall[0].update.setting_value).toBe("5,10");
  });

  it("rejects a ladder with a value outside 1-100 (400)", async () => {
    await expect(settings.saveTierSettings({ ladder: "5,150" })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });

  it("rejects a cancel penalty outside 0-100 (400)", async () => {
    await expect(settings.saveTierSettings({ cancelPenaltyPct: 120 })).rejects.toMatchObject({ statusCode: 400 });
  });
});

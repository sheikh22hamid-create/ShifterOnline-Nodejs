jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn(), upsert: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../porterLiveSettings");

beforeEach(() => {
  jest.resetAllMocks();
  settings._resetCacheForTests();
});
const row = (v) => ({ setting_key: "porter_live_pricing", setting_value: typeof v === "string" ? v : JSON.stringify(v) });

describe("getConfig", () => {
  const DEFAULTS = { enabled: false, cityIds: [], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: {} };
  it("defaults when no row", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await settings.getConfig()).toEqual(DEFAULTS);
  });
  it("reads values and clamps timeout/cache", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7], timeout_ms: 99999, cache_minutes: 500 }));
    expect(await settings.getConfig()).toEqual({ enabled: true, cityIds: [7], timeoutMs: 4000, cacheMinutes: 60, appAdjustPct: {} });
    settings._resetCacheForTests();
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7], timeout_ms: 100, cache_minutes: 0 }));
    expect(await settings.getConfig()).toMatchObject({ timeoutMs: 500, cacheMinutes: 1 });
  });
  it("defaults on invalid JSON", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row("{nope"));
    expect(await settings.getConfig()).toEqual(DEFAULTS);
  });
  it("defaults when prisma throws", async () => {
    prisma.app_settings.findFirst.mockRejectedValue(new Error("db"));
    expect(await settings.getConfig()).toEqual(DEFAULTS);
  });
});

describe("isActiveForCity", () => {
  it("true only when enabled and city listed", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7] }));
    expect(await settings.isActiveForCity(7)).toBe(true);
    expect(await settings.isActiveForCity(8)).toBe(false);
    expect(await settings.isActiveForCity(null)).toBe(false);
    settings._resetCacheForTests();
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: false, city_ids: [7] }));
    expect(await settings.isActiveForCity(7)).toBe(false);
  });
});

describe("saveConfig", () => {
  it("rejects invalid input without writing", async () => {
    await expect(settings.saveConfig({ enabled: true, cityIds: ["x"], timeoutMs: 3000, cacheMinutes: 10 })).rejects.toThrow();
    await expect(settings.saveConfig({ enabled: true, cityIds: [1], timeoutMs: "abc", cacheMinutes: 10 })).rejects.toThrow();
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });
  it("rejects a timeout above 4000 ms", async () => {
    await expect(settings.saveConfig({ enabled: true, cityIds: [1], timeoutMs: 4001, cacheMinutes: 10 })).rejects.toThrow(/4000/);
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
    prisma.app_settings.upsert.mockResolvedValue({});
    await expect(settings.saveConfig({ enabled: true, cityIds: [1], timeoutMs: 4000, cacheMinutes: 10 })).resolves.toMatchObject({ timeoutMs: 4000 });
  });
  it("upserts snake_case JSON", async () => {
    prisma.app_settings.upsert.mockResolvedValue({});
    const cfg = await settings.saveConfig({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 });
    expect(cfg).toEqual({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: {} });
    expect(prisma.app_settings.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.app_settings.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ setting_key: "porter_live_pricing" });
    expect(JSON.parse(arg.create.setting_value)).toEqual({ enabled: true, city_ids: [7], timeout_ms: 3000, cache_minutes: 10, app_adjust_pct: {} });
  });
});

describe("getConfig cache", () => {
  it("serves the parsed config from memory for 30 s, then reloads", async () => {
    const now = jest.spyOn(Date, "now");
    let t = 1_000_000;
    now.mockImplementation(() => t);
    try {
      prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7] }));
      expect((await settings.getConfig()).enabled).toBe(true);
      prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: false, city_ids: [7] }));
      t += 29_000;
      expect((await settings.getConfig()).enabled).toBe(true);
      expect(await settings.isActiveForCity(7)).toBe(true);
      expect(prisma.app_settings.findFirst).toHaveBeenCalledTimes(1);
      t += 2_000;
      expect((await settings.getConfig()).enabled).toBe(false);
      expect(prisma.app_settings.findFirst).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });
  it("returns a copy, so callers cannot mutate the cached config", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7] }));
    const a = await settings.getConfig();
    a.cityIds.push(99);
    a.enabled = false;
    expect(await settings.getConfig()).toEqual({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: {} });
  });
  it("saveConfig invalidates the cache", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: false, city_ids: [] }));
    expect((await settings.getConfig()).enabled).toBe(false);
    prisma.app_settings.upsert.mockResolvedValue({});
    await settings.saveConfig({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 });
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7] }));
    expect((await settings.getConfig()).enabled).toBe(true);
    // 3 reads: first getConfig + saveConfig's preserve-on-omit read of app_adjust_pct + the reload after invalidation.
    expect(prisma.app_settings.findFirst).toHaveBeenCalledTimes(3);
  });
});

describe("appAdjustPct", () => {
  it("getConfig parses app_adjust_pct and drops invalid entries", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(
      row({ enabled: true, city_ids: [7], app_adjust_pct: { 91: 20, 1: 28.5, 126: "7", 0: 5, "-3": 10, 97: 999, 133: "x" } }),
    );
    const cfg = await settings.getConfig();
    // keeps valid positive ids with 0..90 percent (rounded to 2dp); drops id<=0, >90, and non-numeric
    expect(cfg.appAdjustPct).toEqual({ 91: 20, 1: 28.5, 126: 7 });
  });
  it("getConfig returns empty map when app_adjust_pct absent", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7] }));
    expect((await settings.getConfig()).appAdjustPct).toEqual({});
  });
  it("saveConfig persists app_adjust_pct and echoes it back", async () => {
    prisma.app_settings.upsert.mockResolvedValue({});
    const cfg = await settings.saveConfig({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: { 91: 20, 1: 28 } });
    expect(cfg.appAdjustPct).toEqual({ 91: 20, 1: 28 });
    const arg = prisma.app_settings.upsert.mock.calls[0][0];
    expect(JSON.parse(arg.create.setting_value).app_adjust_pct).toEqual({ 91: 20, 1: 28 });
  });
  it("saveConfig gives empty app_adjust_pct when omitted and nothing is stored", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    prisma.app_settings.upsert.mockResolvedValue({});
    const cfg = await settings.saveConfig({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 });
    expect(cfg.appAdjustPct).toEqual({});
  });
  it("saveConfig keeps the stored app_adjust_pct when the field is omitted (no accidental wipe)", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7], app_adjust_pct: { 91: 20, 1: 28 } }));
    prisma.app_settings.upsert.mockResolvedValue({});
    const cfg = await settings.saveConfig({ enabled: false, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 });
    expect(cfg.appAdjustPct).toEqual({ 91: 20, 1: 28 });
    const arg = prisma.app_settings.upsert.mock.calls[0][0];
    expect(JSON.parse(arg.create.setting_value).app_adjust_pct).toEqual({ 91: 20, 1: 28 });
  });
  it("saveConfig clears app_adjust_pct on an explicit empty object", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7], app_adjust_pct: { 91: 20 } }));
    prisma.app_settings.upsert.mockResolvedValue({});
    const cfg = await settings.saveConfig({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: {} });
    expect(cfg.appAdjustPct).toEqual({});
  });
  it("saveConfig rejects a percent above 90 or below 0 without writing", async () => {
    await expect(settings.saveConfig({ enabled: true, cityIds: [1], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: { 91: 91 } })).rejects.toThrow(/90/);
    await expect(settings.saveConfig({ enabled: true, cityIds: [1], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: { 91: -1 } })).rejects.toThrow();
    await expect(settings.saveConfig({ enabled: true, cityIds: [1], timeoutMs: 3000, cacheMinutes: 10, appAdjustPct: [20] })).rejects.toThrow();
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });
  it("getConfig returns a deep copy of appAdjustPct, so callers cannot mutate the cache", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7], app_adjust_pct: { 91: 20 } }));
    const a = await settings.getConfig();
    a.appAdjustPct[91] = 99;
    a.appAdjustPct[1] = 50;
    expect((await settings.getConfig()).appAdjustPct).toEqual({ 91: 20 });
  });
});

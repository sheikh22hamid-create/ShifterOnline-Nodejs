jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn(), upsert: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../porterLiveSettings");

beforeEach(() => jest.resetAllMocks());
const row = (v) => ({ setting_key: "porter_live_pricing", setting_value: typeof v === "string" ? v : JSON.stringify(v) });

describe("getConfig", () => {
  const DEFAULTS = { enabled: false, cityIds: [], timeoutMs: 3000, cacheMinutes: 10 };
  it("defaults when no row", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await settings.getConfig()).toEqual(DEFAULTS);
  });
  it("reads values and clamps timeout/cache", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(row({ enabled: true, city_ids: [7], timeout_ms: 99999, cache_minutes: 500 }));
    expect(await settings.getConfig()).toEqual({ enabled: true, cityIds: [7], timeoutMs: 10000, cacheMinutes: 60 });
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
  it("upserts snake_case JSON", async () => {
    prisma.app_settings.upsert.mockResolvedValue({});
    const cfg = await settings.saveConfig({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 });
    expect(cfg).toEqual({ enabled: true, cityIds: [7], timeoutMs: 3000, cacheMinutes: 10 });
    expect(prisma.app_settings.upsert).toHaveBeenCalledTimes(1);
    const arg = prisma.app_settings.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ setting_key: "porter_live_pricing" });
    expect(JSON.parse(arg.create.setting_value)).toEqual({ enabled: true, city_ids: [7], timeout_ms: 3000, cache_minutes: 10 });
  });
});

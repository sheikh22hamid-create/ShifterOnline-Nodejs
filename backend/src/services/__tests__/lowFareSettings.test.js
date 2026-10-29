jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn(), findMany: jest.fn(), upsert: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../lowFareSettings");

beforeEach(() => jest.resetAllMocks());

describe("isEnabled", () => {
  it.each([[null, false], [{ setting_value: "" }, false], [{ setting_value: "0" }, false], [{ setting_value: "1" }, true], [{ setting_value: "On" }, true]])(
    "setting %j -> %s", async (row, expected) => {
      prisma.app_settings.findFirst.mockResolvedValue(row);
      expect(await settings.isEnabled()).toBe(expected);
    },
  );
  it("fails closed when the setting cannot be read", async () => {
    prisma.app_settings.findFirst.mockRejectedValue(new Error("db"));
    expect(await settings.isEnabled()).toBe(false);
  });
});

describe("getConfig", () => {
  const rows = (o) => Object.entries(o).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
  it("has safe defaults", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await settings.getConfig()).toEqual({ discountPercent: 20, maxDaysAhead: 7, maxWindowHours: 12 });
  });
  it("reads configured values, clamps the discount to 0..50 and ignores junk", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ low_fare_discount_percent: "75", low_fare_max_days_ahead: "3", low_fare_max_window_hours: "abc" }));
    expect(await settings.getConfig()).toEqual({ discountPercent: 50, maxDaysAhead: 3, maxWindowHours: 12 });
  });
  it("accepts a zero discount (an admin may run a promotion at full Model-1 price)", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ low_fare_discount_percent: "0" }));
    expect((await settings.getConfig()).discountPercent).toBe(0);
  });
  it("falls back to defaults on a read error", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db"));
    expect((await settings.getConfig()).discountPercent).toBe(20);
  });
});

describe("saveConfig", () => {
  it("stores the three values", async () => {
    await settings.saveConfig({ discountPercent: 25, maxDaysAhead: 5, maxWindowHours: 8 });
    expect(prisma.app_settings.upsert.mock.calls.map((c) => [c[0].where.setting_key, c[0].update.setting_value]).sort()).toEqual([
      ["low_fare_discount_percent", "25"], ["low_fare_max_days_ahead", "5"], ["low_fare_max_window_hours", "8"],
    ]);
  });
  it.each([
    [{ discountPercent: 51, maxDaysAhead: 5, maxWindowHours: 8 }],
    [{ discountPercent: -1, maxDaysAhead: 5, maxWindowHours: 8 }],
    [{ discountPercent: 10, maxDaysAhead: 0, maxWindowHours: 8 }],
    [{ discountPercent: 10, maxDaysAhead: 31, maxWindowHours: 8 }],
    [{ discountPercent: 10, maxDaysAhead: 5, maxWindowHours: 25 }],
  ])("rejects %j and writes nothing", async (bad) => {
    await expect(settings.saveConfig(bad)).rejects.toThrow();
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
  });
});

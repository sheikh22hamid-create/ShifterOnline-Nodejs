jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn(), findMany: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../customiseOrderSettings");

beforeEach(() => jest.clearAllMocks());

describe("isEnabled", () => {
  it.each([[null, false], [{ setting_value: "" }, false], [{ setting_value: "0" }, false], [{ setting_value: "1" }, true], [{ setting_value: "true" }, true], [{ setting_value: "ON" }, true]])(
    "setting %j -> %s", async (row, expected) => {
      prisma.app_settings.findFirst.mockResolvedValue(row);
      expect(await settings.isEnabled()).toBe(expected);
    },
  );
  it("fails closed when the setting cannot be read", async () => {
    prisma.app_settings.findFirst.mockRejectedValue(new Error("db down"));
    expect(await settings.isEnabled()).toBe(false);
  });
});

describe("getBounds", () => {
  it("uses safe defaults when nothing is configured", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await settings.getBounds()).toEqual({ minFare: 50, maxFare: 500000, maxWindowHours: 24 });
  });
  it("reads configured values and ignores junk", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "customise_min_fare", setting_value: "100" },
      { setting_key: "customise_max_window_hours", setting_value: "abc" },
    ]);
    expect(await settings.getBounds()).toEqual({ minFare: 100, maxFare: 500000, maxWindowHours: 24 });
  });
  it("falls back to defaults on a read error", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db"));
    expect(await settings.getBounds()).toEqual({ minFare: 50, maxFare: 500000, maxWindowHours: 24 });
  });
});

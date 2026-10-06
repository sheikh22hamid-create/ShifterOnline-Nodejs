jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const prisma = require("../../config/db");
const s = require("../receiverTrackSettings");

const row = (v) => [{ setting_key: "receiver_tracking_enabled", setting_value: v }];

describe("isTrackingEnabled", () => {
  beforeEach(() => jest.clearAllMocks());
  it("is ON when the row is missing or empty", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await s.isTrackingEnabled()).toBe(true);
    prisma.app_settings.findMany.mockResolvedValue(row(""));
    expect(await s.isTrackingEnabled()).toBe(true);
  });
  it("is ON for 1/true", async () => {
    prisma.app_settings.findMany.mockResolvedValue(row("1"));
    expect(await s.isTrackingEnabled()).toBe(true);
    prisma.app_settings.findMany.mockResolvedValue(row("true"));
    expect(await s.isTrackingEnabled()).toBe(true);
  });
  it.each(["0", "false", "OFF", " no "])("is OFF for %p", async (v) => {
    prisma.app_settings.findMany.mockResolvedValue(row(v));
    expect(await s.isTrackingEnabled()).toBe(false);
  });
  it("fails closed when the setting cannot be read", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    expect(await s.isTrackingEnabled()).toBe(false);
  });
});

describe("getMapConfig", () => {
  it("has no tiles without a key", () => {
    expect(s.getMapConfig({})).toMatchObject({ tileUrl: null });
  });
  it("builds the MapTiler raster URL with the default style", () => {
    const c = s.getMapConfig({ MAPTILER_KEY: "abcdEFGH1234" });
    expect(c.tileUrl).toBe("https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abcdEFGH1234");
    expect(c.attribution).toContain("MapTiler");
    expect(c.attribution).toContain("OpenStreetMap");
  });
  it("uses a valid custom style, ignores an invalid one", () => {
    expect(s.getMapConfig({ MAPTILER_KEY: "abcdEFGH1234", MAPTILER_STYLE: "basic-v2" }).tileUrl).toContain("/maps/basic-v2/");
    expect(s.getMapConfig({ MAPTILER_KEY: "abcdEFGH1234", MAPTILER_STYLE: "../x" }).tileUrl).toContain("/maps/streets-v2/");
  });
  it("rejects a key with unsafe characters", () => {
    expect(s.getMapConfig({ MAPTILER_KEY: 'ab"><script>' }).tileUrl).toBeNull();
    expect(s.getMapConfig({ MAPTILER_KEY: "short" }).tileUrl).toBeNull();
  });
});

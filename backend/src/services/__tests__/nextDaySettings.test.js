jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn(), upsert: jest.fn().mockResolvedValue({}) } }));
const prisma = require("../../config/db");
const s = require("../nextDaySettings");

beforeEach(() => jest.clearAllMocks());

it("defaults to 60 seconds and 14:00", async () => {
  prisma.app_settings.findFirst.mockResolvedValue(null);
  expect(await s.getOfferSeconds()).toBe(60);
  expect(await s.getLiveTime()).toBe("14:00");
});
it("reads stored values and ignores corrupt ones", async () => {
  prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "90" });
  expect(await s.getOfferSeconds()).toBe(90);
  prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "abc" });
  expect(await s.getOfferSeconds()).toBe(60);
  prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "99:99" });
  expect(await s.getLiveTime()).toBe("14:00");
});
describe("daily driver discount percent", () => {
  it("defaults to 10 and ignores corrupt or out-of-range stored values", async () => {
    prisma.app_settings.findFirst.mockResolvedValueOnce(null);
    expect(await s.getDiscountPercent()).toBe(10);
    prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "15" });
    expect(await s.getDiscountPercent()).toBe(15);
    prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: "7.5" });
    expect(await s.getDiscountPercent()).toBe(7.5);
    for (const bad of ["abc", "-1", "51", ""]) {
      prisma.app_settings.findFirst.mockResolvedValueOnce({ setting_value: bad });
      expect(await s.getDiscountPercent()).toBe(10);
    }
  });
  it("accepts 0 to 50 on write and rejects the rest without writing", async () => {
    expect(await s.setDiscountPercent("0")).toBe(0);
    expect(await s.setDiscountPercent(50)).toBe(50);
    expect(await s.setDiscountPercent("12.5")).toBe(12.5);
    prisma.app_settings.upsert.mockClear();
    for (const bad of [-1, 50.01, "abc", "", null, undefined, NaN, "1e1"]) {
      await expect(s.setDiscountPercent(bad)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(prisma.app_settings.upsert).not.toHaveBeenCalled();
    expect(s.validateDiscountPercent("20")).toBe(20);
  });
});

it("validates on write", async () => {
  await expect(s.setOfferSeconds(5)).rejects.toMatchObject({ statusCode: 400 });
  await expect(s.setOfferSeconds(601)).rejects.toMatchObject({ statusCode: 400 });
  await expect(s.setLiveTime("2pm")).rejects.toMatchObject({ statusCode: 400 });
  expect(await s.setOfferSeconds("75")).toBe(75);
  expect(await s.setLiveTime("13:30")).toBe("13:30");
});

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
it("validates on write", async () => {
  await expect(s.setOfferSeconds(5)).rejects.toMatchObject({ statusCode: 400 });
  await expect(s.setOfferSeconds(601)).rejects.toMatchObject({ statusCode: 400 });
  await expect(s.setLiveTime("2pm")).rejects.toMatchObject({ statusCode: 400 });
  expect(await s.setOfferSeconds("75")).toBe(75);
  expect(await s.setLiveTime("13:30")).toBe("13:30");
});

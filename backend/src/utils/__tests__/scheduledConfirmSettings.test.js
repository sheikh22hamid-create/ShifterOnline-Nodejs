jest.mock("../logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../config/db", () => ({ app_settings: { findFirst: jest.fn() } }));

const prisma = require("../../config/db");
const { getScheduledMinAdvanceMinutes, getScheduledConfirmLeadMinutes, getScheduledConfirmLeadMs } = require("../scheduledConfirmSettings");

const setting = (value) => prisma.app_settings.findFirst.mockResolvedValue(value === null ? null : { setting_value: value });
beforeEach(() => jest.clearAllMocks());

describe("getScheduledMinAdvanceMinutes", () => {
  it.each([["10", 10], ["25", 25], ["20.4", 20]])("uses the admin value %p -> %p", async (raw, expected) => {
    setting(raw);
    expect(await getScheduledMinAdvanceMinutes()).toBe(expected);
    expect(prisma.app_settings.findFirst).toHaveBeenCalledWith({ where: { setting_key: "scheduled_min_advance_minutes" } });
  });

  it.each([null, "", "abc", "0", "-5"])("falls back to the 45-minute default for %p", async (raw) => {
    setting(raw);
    expect(await getScheduledMinAdvanceMinutes()).toBe(45);
  });

  it("falls back to the default when the settings table cannot be read", async () => {
    prisma.app_settings.findFirst.mockRejectedValue(new Error("db down"));
    expect(await getScheduledMinAdvanceMinutes()).toBe(45);
  });
});

describe("getScheduledConfirmLeadMinutes (driver app Priority Dispatch Window)", () => {
  it("is the admin's Confirmation popup lead time in minutes", async () => {
    setting("20");
    expect(await getScheduledConfirmLeadMinutes()).toBe(20);
    expect(await getScheduledConfirmLeadMs()).toBe(20 * 60 * 1000);
  });

  it("falls back to the 30-minute default when unset", async () => {
    setting(null);
    expect(await getScheduledConfirmLeadMinutes()).toBe(30);
  });
});

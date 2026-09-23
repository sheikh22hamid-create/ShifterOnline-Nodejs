jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn() },
}));
const prisma = require("../../config/db");
const {
  getModel1MissLimit,
  MODEL1_MISS_LIMIT_KEY,
  getModel1SuspensionHours,
  MODEL1_SUSPENSION_HOURS_KEY,
} = require("../model1SuspensionSettings");

describe("model1SuspensionSettings.getModel1MissLimit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the configured integer value", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_MISS_LIMIT_KEY, setting_value: "8" });
    expect(await getModel1MissLimit()).toBe(8);
    expect(prisma.app_settings.findFirst).toHaveBeenCalledWith({ where: { setting_key: MODEL1_MISS_LIMIT_KEY } });
  });

  it("defaults to 5 when no admin setting exists yet", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await getModel1MissLimit()).toBe(5);
  });

  it("defaults to 5 when the stored value is empty, non-numeric, or non-positive", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_MISS_LIMIT_KEY, setting_value: "" });
    expect(await getModel1MissLimit()).toBe(5);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_MISS_LIMIT_KEY, setting_value: "not-a-number" });
    expect(await getModel1MissLimit()).toBe(5);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_MISS_LIMIT_KEY, setting_value: "0" });
    expect(await getModel1MissLimit()).toBe(5);
  });
});

describe("model1SuspensionSettings.getModel1SuspensionHours", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the configured numeric value", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_SUSPENSION_HOURS_KEY, setting_value: "48" });
    expect(await getModel1SuspensionHours()).toBe(48);
    expect(prisma.app_settings.findFirst).toHaveBeenCalledWith({ where: { setting_key: MODEL1_SUSPENSION_HOURS_KEY } });
  });

  it("defaults to 24 when no admin setting exists yet", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await getModel1SuspensionHours()).toBe(24);
  });

  it("defaults to 24 when the stored value is empty, non-numeric, or non-positive", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_SUSPENSION_HOURS_KEY, setting_value: "" });
    expect(await getModel1SuspensionHours()).toBe(24);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_SUSPENSION_HOURS_KEY, setting_value: "not-a-number" });
    expect(await getModel1SuspensionHours()).toBe(24);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: MODEL1_SUSPENSION_HOURS_KEY, setting_value: "-1" });
    expect(await getModel1SuspensionHours()).toBe(24);
  });
});

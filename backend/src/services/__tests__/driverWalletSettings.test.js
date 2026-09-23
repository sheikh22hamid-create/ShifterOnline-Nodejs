jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn() },
}));
const prisma = require("../../config/db");
const { getDriverMaxDueLimit, DRIVER_MAX_DUE_LIMIT_KEY, getDriverMinWithdrawalAmount, DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY } = require("../driverWalletSettings");

describe("driverWalletSettings.getDriverMaxDueLimit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the configured numeric value", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MAX_DUE_LIMIT_KEY, setting_value: "150" });
    expect(await getDriverMaxDueLimit()).toBe(150);
    expect(prisma.app_settings.findFirst).toHaveBeenCalledWith({ where: { setting_key: DRIVER_MAX_DUE_LIMIT_KEY } });
  });

  it("defaults to 100 when no admin setting exists yet", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await getDriverMaxDueLimit()).toBe(100);
  });

  it("defaults to 100 when the stored value is empty or non-numeric", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MAX_DUE_LIMIT_KEY, setting_value: "" });
    expect(await getDriverMaxDueLimit()).toBe(100);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MAX_DUE_LIMIT_KEY, setting_value: "not-a-number" });
    expect(await getDriverMaxDueLimit()).toBe(100);
  });
});

describe("driverWalletSettings.getDriverMinWithdrawalAmount", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the configured numeric value", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY, setting_value: "500" });
    expect(await getDriverMinWithdrawalAmount()).toBe(500);
    expect(prisma.app_settings.findFirst).toHaveBeenCalledWith({ where: { setting_key: DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY } });
  });

  it("defaults to 0 (no minimum) when no admin setting exists yet, preserving today's behavior", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await getDriverMinWithdrawalAmount()).toBe(0);
  });

  it("defaults to 0 when the stored value is empty or non-numeric", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY, setting_value: "" });
    expect(await getDriverMinWithdrawalAmount()).toBe(0);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MIN_WITHDRAWAL_AMOUNT_KEY, setting_value: "not-a-number" });
    expect(await getDriverMinWithdrawalAmount()).toBe(0);
  });
});

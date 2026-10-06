const prisma = require("../../config/db");
const {
  getAdvancePaymentTimeoutMinutes,
  getAdvancePaymentTimeoutSeconds,
  getCachedAdvancePaymentTimeoutSeconds,
} = require("../advancePaymentTimeout");
const { getAdvancePaymentTimerInfo } = require("../advancePaymentTimer");

jest.mock("../../config/db", () => ({
  app_settings: {
    findFirst: jest.fn(),
  },
}));

describe("advancePaymentTimeout utility", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns default 2 minutes when setting does not exist in app_settings", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    const minutes = await getAdvancePaymentTimeoutMinutes();
    expect(minutes).toBe(2);
    expect(prisma.app_settings.findFirst).toHaveBeenCalledWith({
      where: { setting_key: "advance_payment_timeout_minutes" },
    });
  });

  it("returns configured minutes when set in app_settings", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "5" });
    const minutes = await getAdvancePaymentTimeoutMinutes();
    expect(minutes).toBe(5);

    const seconds = await getAdvancePaymentTimeoutSeconds();
    expect(seconds).toBe(300);
  });

  it("falls back to default if setting is invalid or non-positive", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "-1" });
    const minutes = await getAdvancePaymentTimeoutMinutes();
    expect(minutes).toBe(2);

    prisma.app_settings.findFirst.mockResolvedValue({ setting_value: "abc" });
    const minutesInvalid = await getAdvancePaymentTimeoutMinutes();
    expect(minutesInvalid).toBe(2);
  });

  it("getAdvancePaymentTimerInfo respects custom or cached timeout seconds", () => {
    const order = {
      advance_payment: "100.00",
      payment_status: 0,
      order_status: 1,
      accept_time: new Date().toISOString(),
    };

    // Custom 5 min = 300 seconds
    const info = getAdvancePaymentTimerInfo(order, 300);
    expect(info.advance_timeout_seconds).toBe(300);
    expect(info.is_advance_payment_required).toBe(true);
    expect(info.remaining_seconds).toBeGreaterThan(0);
  });
});

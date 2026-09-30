jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn() },
}));
const prisma = require("../../config/db");
const { getPickupRelocateSettings } = require("../pickupRelocateSettings");

describe("getPickupRelocateSettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns defaults when no admin settings exist", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    const settings = await getPickupRelocateSettings();
    expect(settings).toEqual({
      ceilingMinutes: 35,
      smallMoveThresholdM: 200,
      otpMismatchFlagM: 500,
      driverCompensation: 0,
    });
  });

  it("uses admin-configured values when present", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "pickup_relocate_ceiling_minutes", setting_value: "45" },
      { setting_key: "pickup_small_move_threshold_m", setting_value: "150" },
      { setting_key: "pickup_otp_mismatch_flag_m", setting_value: "600" },
      { setting_key: "pickup_timeout_driver_compensation", setting_value: "25" },
    ]);
    const settings = await getPickupRelocateSettings();
    expect(settings).toEqual({
      ceilingMinutes: 45,
      smallMoveThresholdM: 150,
      otpMismatchFlagM: 600,
      driverCompensation: 25,
    });
  });

  it("falls back to defaults for unparseable or non-positive values", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "pickup_relocate_ceiling_minutes", setting_value: "not-a-number" },
      { setting_key: "pickup_small_move_threshold_m", setting_value: "-5" },
    ]);
    const settings = await getPickupRelocateSettings();
    expect(settings.ceilingMinutes).toBe(35);
    expect(settings.smallMoveThresholdM).toBe(200);
  });

  it("returns defaults if the DB read fails", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    const settings = await getPickupRelocateSettings();
    expect(settings).toEqual({
      ceilingMinutes: 35,
      smallMoveThresholdM: 200,
      otpMismatchFlagM: 500,
      driverCompensation: 0,
    });
  });
});

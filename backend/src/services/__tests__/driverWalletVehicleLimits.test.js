jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn(), findMany: jest.fn() },
}));
const prisma = require("../../config/db");
const {
  getDriverMaxDueLimit,
  getDriverMinWithdrawalAmount,
  getDriverWalletLimits,
  driverMaxDueLimitVehicleKey,
  driverMinWithdrawalVehicleKey,
} = require("../driverWalletSettings");

// app_settings as a plain object; both readers are served from it.
function seed(settings) {
  prisma.app_settings.findFirst.mockImplementation(async ({ where }) =>
    where.setting_key in settings ? { setting_key: where.setting_key, setting_value: settings[where.setting_key] } : null);
  prisma.app_settings.findMany.mockImplementation(async ({ where }) =>
    where.setting_key.in.filter((k) => k in settings).map((k) => ({ setting_key: k, setting_value: settings[k] })));
}

describe("vehicle-wise driver wallet limits", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses each vehicle type's own minimum balance and negative limit", async () => {
    seed({
      driver_min_withdrawal_amount: "50", driver_max_due_limit: "100",
      driver_min_withdrawal_amount_vehicle_bike: "100", driver_max_due_limit_vehicle_bike: "100",
      driver_min_withdrawal_amount_vehicle_three_wheeler: "300", driver_max_due_limit_vehicle_three_wheeler: "200",
      driver_min_withdrawal_amount_vehicle_four_wheeler: "500", driver_max_due_limit_vehicle_four_wheeler: "300",
    });
    expect(await getDriverWalletLimits("Bike")).toEqual({ minBalance: 100, negativeLimit: 100 });
    expect(await getDriverWalletLimits("Three Wheeler")).toEqual({ minBalance: 300, negativeLimit: 200 });
    expect(await getDriverWalletLimits("Four Wheeler")).toEqual({ minBalance: 500, negativeLimit: 300 });
  });

  it("falls back to the global value for a vehicle type with none of its own, or a blank one", async () => {
    seed({ driver_min_withdrawal_amount: "50", driver_max_due_limit: "120", driver_min_withdrawal_amount_vehicle_bike: "  " });
    expect(await getDriverMinWithdrawalAmount("Bike")).toBe(50);
    expect(await getDriverMinWithdrawalAmount("Mini Truck")).toBe(50);
    expect(await getDriverMaxDueLimit("Mini Truck")).toBe(120);
  });

  it("treats an explicit 0 on a vehicle as 0, not as unset", async () => {
    seed({ driver_min_withdrawal_amount: "50", driver_min_withdrawal_amount_vehicle_bike: "0" });
    expect(await getDriverMinWithdrawalAmount("Bike")).toBe(0);
  });

  it("keeps today's defaults (no minimum, 100 negative) when nothing is configured, and with no vehicle", async () => {
    seed({});
    expect(await getDriverWalletLimits("Bike")).toEqual({ minBalance: 0, negativeLimit: 100 });
    seed({ driver_min_withdrawal_amount: "40" });
    expect(await getDriverMinWithdrawalAmount(null)).toBe(40);
    expect(await getDriverMinWithdrawalAmount(undefined)).toBe(40);
  });

  it("builds the per-vehicle keys the admin Settings page writes", () => {
    expect(driverMaxDueLimitVehicleKey("Three Wheeler")).toBe("driver_max_due_limit_vehicle_three_wheeler");
    expect(driverMinWithdrawalVehicleKey("Pick-up / Tempo")).toBe("driver_min_withdrawal_amount_vehicle_pick_up_tempo");
    // No vehicle: a key that can never hold a value.
    expect(driverMaxDueLimitVehicleKey("")).toBe("driver_max_due_limit_vehicle_");
  });
});

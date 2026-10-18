jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn() } }));

const prisma = require("../../config/db");
const { getAutoVerificationSettings, vehicleSlug } = require("../driverVerificationSettings");

const rows = (obj) => Object.entries(obj).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
const BASE = { auto_verification: "1", auto_verification_charge_old: "199" };

beforeEach(() => jest.clearAllMocks());

describe("vehicleSlug", () => {
  it("normalises names the same way the admin page does", () => {
    expect(vehicleSlug("Three Wheeler")).toBe("three_wheeler");
    expect(vehicleSlug("E-Rickshaw")).toBe("e_rickshaw");
    expect(vehicleSlug("  Tata Ace (4W) ")).toBe("tata_ace_4w");
    expect(vehicleSlug("")).toBe("");
  });
});

describe("getAutoVerificationSettings", () => {
  it("uses the per-vehicle charge for that vehicle only", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      ...BASE,
      auto_verification_charge_vehicle_bike: "49",
      auto_verification_charge_vehicle_four_wheeler: "299",
    }));
    expect((await getAutoVerificationSettings({ vehicle: "Bike" })).charge).toBe(49);
    expect((await getAutoVerificationSettings({ vehicle: "Four Wheeler" })).charge).toBe(299);
    // E-Rickshaw has no fee set: it must not pick up Bike's or Four Wheeler's fee.
    expect((await getAutoVerificationSettings({ vehicle: "E-Rickshaw" })).charge).toBe(0);
  });

  it("treats an explicit 0 as free, not as unset", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ ...BASE, auto_verification_charge_vehicle_bike: "0" }));
    expect((await getAutoVerificationSettings({ vehicle: "Bike" })).charge).toBe(0);
  });

  it("treats a blank or invalid fee, and no vehicle, as free", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      ...BASE,
      auto_verification_charge_vehicle_bike: "",
      auto_verification_charge_vehicle_three_wheeler: "abc",
      auto_verification_charge_vehicle_e_rickshaw: "-5",
    }));
    expect((await getAutoVerificationSettings({ vehicle: "Bike" })).charge).toBe(0);
    expect((await getAutoVerificationSettings({ vehicle: "Three Wheeler" })).charge).toBe(0);
    expect((await getAutoVerificationSettings({ vehicle: "E-Rickshaw" })).charge).toBe(0);
    expect((await getAutoVerificationSettings()).charge).toBe(0);
  });

  it("hides the global strikethrough price when it is not above the vehicle's charge", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      ...BASE,
      auto_verification_charge_vehicle_bike: "49",
      auto_verification_charge_vehicle_four_wheeler: "299",
    }));
    expect((await getAutoVerificationSettings({ vehicle: "Bike" })).chargeOld).toBe(199);
    expect((await getAutoVerificationSettings({ vehicle: "Four Wheeler" })).chargeOld).toBe(0);
    // A vehicle with no fee set is free, so the strikethrough is hidden for it too.
    expect((await getAutoVerificationSettings({ vehicle: "Other" })).chargeOld).toBe(0);
  });
});

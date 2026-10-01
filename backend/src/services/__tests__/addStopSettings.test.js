jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn() },
  pkg_category: { findFirst: jest.fn() },
}));
const prisma = require("../../config/db");
const { getAddStopSettings } = require("../pricingEngine");

describe("getAddStopSettings (global + per-vehicle override)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "max_extra_stops", setting_value: "5" },
      { setting_key: "extra_stop_charge", setting_value: "10" },
    ]);
    prisma.pkg_category.findFirst.mockResolvedValue(null);
  });

  it("uses the global settings when no vehicle is given", async () => {
    expect(await getAddStopSettings()).toEqual({ maxExtraStops: 5, extraStopCharge: 10 });
    expect(prisma.pkg_category.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to the global values when the vehicle has no override", async () => {
    prisma.pkg_category.findFirst.mockResolvedValue({ max_extra_stops: null, extra_stop_charge: null });
    expect(await getAddStopSettings("Bike")).toEqual({ maxExtraStops: 5, extraStopCharge: 10 });
  });

  it("applies the vehicle's own limit and charge (by name or id)", async () => {
    prisma.pkg_category.findFirst.mockResolvedValue({ max_extra_stops: 1, extra_stop_charge: "30.00" });
    expect(await getAddStopSettings("Bike")).toEqual({ maxExtraStops: 1, extraStopCharge: 30 });
    expect(prisma.pkg_category.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { cat_name: "Bike" } }));
    await getAddStopSettings(7);
    expect(prisma.pkg_category.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 7 } }));
  });

  it("a vehicle override of 0 stops disables add-stop for that vehicle", async () => {
    prisma.pkg_category.findFirst.mockResolvedValue({ max_extra_stops: 0, extra_stop_charge: null });
    expect((await getAddStopSettings("Scooter")).maxExtraStops).toBe(0);
  });

  it("can override only one of the two values", async () => {
    prisma.pkg_category.findFirst.mockResolvedValue({ max_extra_stops: 3, extra_stop_charge: null });
    expect(await getAddStopSettings("Mini Truck")).toEqual({ maxExtraStops: 3, extraStopCharge: 10 });
  });

  it("falls back to the globals if the category lookup fails", async () => {
    prisma.pkg_category.findFirst.mockRejectedValue(new Error("db down"));
    expect(await getAddStopSettings("Bike")).toEqual({ maxExtraStops: 5, extraStopCharge: 10 });
  });
});

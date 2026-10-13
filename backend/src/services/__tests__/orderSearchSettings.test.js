jest.mock("../../config/db", () => ({
  city_order_settings: { findUnique: jest.fn(), upsert: jest.fn() },
  tbl_city: { findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const svc = require("../orderSearchSettings");

beforeEach(() => {
  jest.clearAllMocks();
  svc._resetCache();
});

describe("getCitySettings", () => {
  it("returns the defaults when the city has no row", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue(null);
    const s = await svc.getCitySettings(3);
    expect(s.searchSystem).toBe(1);
    expect(s.guaranteeEnabled).toBe(false);
  });

  it("reads a stored row", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({
      city_id: 3, search_system: 2, search_radius_km: "8.00", driver_search_seconds: 90, guarantee_enabled: 1,
      admin_window_minutes: 20, guarantee_referrals_required: 2,
    });
    expect(await svc.getCitySettings(3)).toEqual({
      searchSystem: 2, searchRadiusKm: 8, driverSearchSeconds: 90, guaranteeEnabled: true, adminWindowMinutes: 20, guaranteeReferralsRequired: 2,
      guaranteeStartTime: null, guaranteeEndTime: null,
    });
  });

  it("fails closed to System 1 / guarantee off when the read throws (e.g. table missing)", async () => {
    prisma.city_order_settings.findUnique.mockRejectedValue(new Error("P2021 table missing"));
    const s = await svc.getCitySettings(3);
    expect(s.searchSystem).toBe(1);
    expect(s.guaranteeEnabled).toBe(false);
  });

  it("fails closed when the Prisma model itself is undefined (client not regenerated)", async () => {
    const saved = prisma.city_order_settings;
    prisma.city_order_settings = undefined;
    try {
      const s = await svc.getCitySettings(3);
      expect(s.searchSystem).toBe(1);
    } finally {
      prisma.city_order_settings = saved;
    }
  });

  it.each([null, undefined, 0, "abc", -4])("a missing or invalid city id (%p) gives the defaults without a query", async (cityId) => {
    const s = await svc.getCitySettings(cityId);
    expect(s.searchSystem).toBe(1);
    expect(prisma.city_order_settings.findUnique).not.toHaveBeenCalled();
  });

  it("caches a city for a few seconds and re-reads when asked fresh", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue(null);
    await svc.getCitySettings(3);
    await svc.getCitySettings(3);
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(1);
    await svc.getCitySettings(3, { fresh: true });
    expect(prisma.city_order_settings.findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("saveCitySettings", () => {
  it("upserts only the validated keys, stamps the admin and returns fresh settings", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    prisma.city_order_settings.upsert.mockResolvedValue({});
    prisma.city_order_settings.findUnique.mockResolvedValue({
      city_id: 3, search_system: 2, driver_search_seconds: 120, guarantee_enabled: 0, guarantee_referrals_required: 1,
    });
    const out = await svc.saveCitySettings({ cityId: 3, input: { searchSystem: 2, driverSearchSeconds: 120 }, adminId: 9 });
    expect(prisma.city_order_settings.upsert).toHaveBeenCalledWith({
      where: { city_id: 3 },
      update: { search_system: 2, driver_search_seconds: 120, updated_by: 9 },
      create: { city_id: 3, search_system: 2, driver_search_seconds: 120, updated_by: 9 },
    });
    expect(out.searchSystem).toBe(2);
    expect(out.driverSearchSeconds).toBe(120);
  });

  it("rejects invalid input with a 400 and writes nothing", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    await expect(svc.saveCitySettings({ cityId: 3, input: { driverSearchSeconds: 5 }, adminId: 9 })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.city_order_settings.upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown city with a 400", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue(null);
    await expect(svc.saveCitySettings({ cityId: 99, input: { searchSystem: 2 }, adminId: 9 })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.city_order_settings.upsert).not.toHaveBeenCalled();
  });

  it("a save drops the cached value so the next read is fresh", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    prisma.city_order_settings.upsert.mockResolvedValue({});
    prisma.city_order_settings.findUnique.mockResolvedValueOnce(null).mockResolvedValue({ city_id: 3, search_system: 2 });
    await svc.getCitySettings(3);
    await svc.saveCitySettings({ cityId: 3, input: { searchSystem: 2 }, adminId: 1 });
    expect((await svc.getCitySettings(3)).searchSystem).toBe(2);
  });
});

describe("getSearchView", () => {
  const order = { id: 5, uid: 7, city_id: 3, search_system: 2, search_deadline_at: new Date("2026-10-12T10:01:30.000Z") };

  it("a System 1 order has no deadline and no guarantee", async () => {
    expect(await svc.getSearchView({ id: 1, uid: 7, city_id: 3, search_system: null })).toEqual({ system: 1, deadline_at: null, guarantee: "off" });
  });

  it("a System 2 order carries its deadline and the city's guarantee state", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 1 });
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
    expect(await svc.getSearchView(order)).toEqual({ system: 2, deadline_at: "2026-10-12T10:01:30.000Z", guarantee: "on" });
  });

  it("reports locked when the customer is guarantee-locked", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 1 });
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: true });
    expect((await svc.getSearchView(order)).guarantee).toBe("locked");
  });

  it("reports off when the city has the guarantee disabled", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 0 });
    expect((await svc.getSearchView(order)).guarantee).toBe("off");
  });

  it("never throws: a failing user lookup still returns the deadline", async () => {
    prisma.city_order_settings.findUnique.mockResolvedValue({ city_id: 3, search_system: 2, guarantee_enabled: 1 });
    prisma.tbl_user.findUnique.mockRejectedValue(new Error("db down"));
    const view = await svc.getSearchView(order);
    expect(view.system).toBe(2);
    expect(view.deadline_at).toBe("2026-10-12T10:01:30.000Z");
  });
});

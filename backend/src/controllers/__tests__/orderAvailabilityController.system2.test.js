jest.mock("../../config/db", () => ({
  service_zone: { findMany: jest.fn() },
  tbl_city: { findUnique: jest.fn(), findFirst: jest.fn() },
  tbl_user_plan_subscription: { findFirst: jest.fn() },
  tbl_premium_plan: { findUnique: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  pkg_category: { findMany: jest.fn() },
  setting: { findFirst: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  $queryRaw: jest.fn(),
}));
jest.mock("../../services/geofenceService", () => ({ isInsideZone: jest.fn() }));
jest.mock("../../services/orderSearchSettings", () => ({ getCitySettings: jest.fn() }));

const prisma = require("../../config/db");
const { isInsideZone } = require("../../services/geofenceService");
const orderSearchSettings = require("../../services/orderSearchSettings");
const { availableVehicles } = require("../orderAvailabilityController");

const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

function stubCommonLookups() {
  prisma.service_zone.findMany.mockResolvedValue([{ id: 1, city_id: 1 }]);
  isInsideZone.mockReturnValue(true);
  prisma.tbl_city.findUnique.mockResolvedValue({ id: 1, title: "Indore" });
  prisma.tbl_user_plan_subscription.findFirst.mockResolvedValue(null);
  prisma.tbl_package.findMany.mockResolvedValue([
    { id: 10, cat_id: 1, city_id: "0", title: "Bike", user_detail_image: null, start_time: new Date(0), end_time: new Date(0), night_charge_percent: 0, min_charge: 30, service_charge_percent: 0 },
  ]);
  prisma.pkg_category.findMany.mockResolvedValue([{ id: 1, cat_name: "Bike", cat_img: null }]);
  prisma.setting.findFirst.mockResolvedValue({ currency: "INR" });
  prisma.app_settings.findFirst.mockResolvedValue(null);
}

const system2 = { searchSystem: 2, searchRadiusKm: 7, driverSearchSeconds: 90, guaranteeEnabled: false, adminWindowMinutes: null, guaranteeReferralsRequired: 1 };
const system1 = { ...system2, searchSystem: 1, searchRadiusKm: null };
const body = (extra = {}) => ({ body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now", ...extra } });

beforeEach(() => {
  jest.clearAllMocks();
  stubCommonLookups();
});

describe("availableVehicles in a System 2 city", () => {
  it("shows every category as available even with no drivers nearby, using the city radius", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    prisma.$queryRaw.mockResolvedValue([]);
    const res = makeRes();
    await availableVehicles(body(), res);
    const p = res.json.mock.calls[0][0];
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(1);
    expect(p.vehicles[0].available).toBe(true);
    expect(p.vehicles[0].is_available).toBe(1);
    expect(p.vehicles[0].reason_unavailable).toBeNull();
    expect(p.categories[0].available).toBe(true);
    expect(p.search_radius_km).toBe(7);
    expect(p.search_system).toBe(2);
    expect(p.driver_search_seconds).toBe(90);
    expect(p.data.search_system).toBe(2);
    expect(p.data.driver_search_seconds).toBe(90);
    expect(p.radius_suggestion).toBeNull();
  });

  it("keeps a pickup ETA when a driver really is nearby", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    prisma.$queryRaw.mockResolvedValue([{ rider_id: 1, distance_km: 2 }]);
    const res = makeRes();
    await availableVehicles(body(), res);
    const v = res.json.mock.calls[0][0].vehicles[0];
    expect(v.available).toBe(true);
    expect(v.live_supply).toBe("good");
    expect(v.estimated_pickup_minutes).toBeGreaterThan(0);
  });

  it("uses SEARCH_RADIUS_KM (not the client radius) when the System 2 city has no radius of its own", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue({ ...system2, searchRadiusKm: null });
    prisma.$queryRaw.mockResolvedValue([]);
    const res = makeRes();
    await availableVehicles(body(), res);
    const p = res.json.mock.calls[0][0];
    expect(p.search_system).toBe(2);
    expect(p.search_radius_km).toBe(require("../../config/constants").SEARCH_RADIUS_KM);
  });

  it("a scheduled booking in a System 2 city behaves as before (no forced availability, no city radius)", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system2);
    prisma.$queryRaw.mockResolvedValue([]);
    const res = makeRes();
    await availableVehicles(body({ booking_type: "scheduled" }), res);
    const p = res.json.mock.calls[0][0];
    expect(p.search_system).toBe(1);
    expect(p.search_radius_km).toBe(4);
  });
});

describe("availableVehicles in a System 1 city", () => {
  it("is unchanged: no drivers means unavailable, with a System 1 marker", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(system1);
    prisma.$queryRaw.mockResolvedValue([]);
    const res = makeRes();
    await availableVehicles(body(), res);
    const p = res.json.mock.calls[0][0];
    expect(p.vehicles[0].available).toBe(false);
    expect(p.search_system).toBe(1);
    expect(p.search_radius_km).toBe(4);
  });
});

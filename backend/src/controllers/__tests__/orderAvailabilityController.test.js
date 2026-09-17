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

const prisma = require("../../config/db");
const { isInsideZone } = require("../../services/geofenceService");
const { availableVehicles } = require("../orderAvailabilityController");
const { RADIUS_SUGGESTION_MAX_KM } = require("../../config/constants");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

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

describe("orderAvailabilityController.availableVehicles radius_suggestion", () => {
  beforeEach(() => jest.clearAllMocks());

  it("suggests a wider radius when a driver exists just outside the requested one", async () => {
    stubCommonLookups();
    // 1st $queryRaw: normal countNearbyOnlineDrivers at requested radius (4km) - no rows.
    // 2nd $queryRaw: widened check at RADIUS_SUGGESTION_MAX_KM - one driver 8.4km away.
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ rider_id: 9, distance_km: 8.4 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.vehicles[0].available).toBe(false);
    expect(payload.radius_suggestion).toEqual({
      shown: true,
      current_radius_km: 4,
      suggested_radius_km: 9,
      message: "No drivers found within 4 km. Try increasing your search radius to 9 km for a better chance of finding a driver.",
    });
    expect(payload.data.radius_suggestion).toEqual(payload.radius_suggestion);
  });

  it("does not suggest widening when no driver exists even at the wider cap", async () => {
    stubCommonLookups();
    prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.radius_suggestion).toBeNull();
  });

  it("skips the widened check once a vehicle is already available", async () => {
    stubCommonLookups();
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.radius_suggestion).toBeNull();
  });

  it("skips the widened check once already searching at the suggestion cap", async () => {
    stubCommonLookups();
    prisma.$queryRaw.mockResolvedValueOnce([]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: RADIUS_SUGGESTION_MAX_KM, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const payload = res.json.mock.calls[0][0];
    expect(payload.radius_suggestion).toBeNull();
  });
});

describe("orderAvailabilityController.availableVehicles vehicle detail specs/notes", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads max load/dimensions from the category row instead of a hardcoded table", async () => {
    stubCommonLookups();
    prisma.pkg_category.findMany.mockResolvedValue([{
      id: 1, cat_name: "Bike", cat_img: null,
      max_load_kg: 20, dim_length: 1.5, dim_width: 1, dim_height: 1, dim_unit: "ft",
      detail_image: "images/category/bike_detail.png",
    }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const payload = res.json.mock.calls[0][0];
    const category = payload.categories[0];
    expect(category.max_load_kg).toBe(20);
    expect(category.max_dimensions).toBe("1.5 x 1 x 1 ft");
    expect(category.detail_image).toBe("images/category/bike_detail.png");
  });

  it("omits max_dimensions when any dimension is unset, without fabricating a value", async () => {
    stubCommonLookups();
    prisma.pkg_category.findMany.mockResolvedValue([{
      id: 1, cat_name: "Bike", cat_img: null,
      max_load_kg: null, dim_length: null, dim_width: null, dim_height: null, dim_unit: null,
      detail_image: null,
    }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const category = res.json.mock.calls[0][0].categories[0];
    expect(category.max_load_kg).toBeNull();
    expect(category.max_dimensions).toBeNull();
  });

  it("surfaces the global vehicle_detail_notes list from app_settings", async () => {
    stubCommonLookups();
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: "vehicle_detail_notes", setting_value: "Note one.\nNote two." });
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.vehicle_detail_notes).toEqual(["Note one.", "Note two."]);
    expect(payload.data.vehicle_detail_notes).toEqual(["Note one.", "Note two."]);
  });

  it("returns an empty notes list when the setting is unset", async () => {
    stubCommonLookups();
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    expect(res.json.mock.calls[0][0].vehicle_detail_notes).toEqual([]);
  });
});

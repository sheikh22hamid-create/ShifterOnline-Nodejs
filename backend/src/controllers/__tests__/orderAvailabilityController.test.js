jest.mock("../../config/db", () => ({
  service_zone: { findMany: jest.fn() },
  tbl_city: { findUnique: jest.fn(), findFirst: jest.fn() },
  tbl_user_plan_subscription: { findFirst: jest.fn() },
  tbl_premium_plan: { findUnique: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  pkg_category: { findMany: jest.fn() },
  setting: { findFirst: jest.fn() },
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

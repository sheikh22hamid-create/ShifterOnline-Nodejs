jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
}));

const prisma = require("../../config/db");
const { getDriverRealDistanceKm } = require("../orderRouteRepricing");

describe("getDriverRealDistanceKm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 1 (unknown-location default) when no driver is assigned yet", async () => {
    const result = await getDriverRealDistanceKm(0, 28.6, 77.4);
    expect(result).toBe(1);
    expect(prisma.tbl_rider.findUnique).not.toHaveBeenCalled();
  });

  it("returns haversine distance when the driver's location fix is fresh", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      rlats: "28.6000",
      rlongs: "77.4000",
      rloc_updated_at: new Date(), // just now
    });

    const result = await getDriverRealDistanceKm(22, 28.6139, 77.2090);

    expect(result).toBeGreaterThan(0);
  });

  it("returns 1 when the driver's location fix is stale beyond the freshness window", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      rlats: "28.6000",
      rlongs: "77.4000",
      rloc_updated_at: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes old
    });

    const result = await getDriverRealDistanceKm(22, 28.6139, 77.2090);

    expect(result).toBe(1);
  });

  it("returns 1 when the driver has never sent a location fix", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({
      rlats: null,
      rlongs: null,
      rloc_updated_at: null,
    });

    const result = await getDriverRealDistanceKm(22, 28.6139, 77.2090);

    expect(result).toBe(1);
  });
});

describe("computeRouteDistanceKm", () => {
  jest.mock("../../utils/geoDistance", () => ({
    getRoadDistanceKm: jest.fn(),
    getMultiStopDistanceKm: jest.fn(),
    haversineKm: jest.fn(),
  }));

  it("uses direct road distance when there are no stops", async () => {
    jest.resetModules();
    jest.doMock("../../utils/geoDistance", () => ({
      getRoadDistanceKm: jest.fn().mockResolvedValue({ distanceKm: 12.3 }),
      getMultiStopDistanceKm: jest.fn(),
      haversineKm: jest.fn(),
    }));
    const { computeRouteDistanceKm } = require("../orderRouteRepricing");

    const result = await computeRouteDistanceKm({
      plat: 28.5, plong: 77.3, stops: [], dlat: 28.6, dlong: 77.4,
    });

    expect(result).toBe(12.3);
  });

  it("routes through stops in order when stops are present", async () => {
    jest.resetModules();
    const getMultiStopDistanceKm = jest.fn().mockResolvedValue({ distanceKm: 20 });
    jest.doMock("../../utils/geoDistance", () => ({
      getRoadDistanceKm: jest.fn(),
      getMultiStopDistanceKm,
      haversineKm: jest.fn(),
    }));
    const { computeRouteDistanceKm } = require("../orderRouteRepricing");

    const result = await computeRouteDistanceKm({
      plat: 28.5, plong: 77.3,
      stops: [{ lat: "28.55", lng: "77.35" }],
      dlat: 28.6, dlong: 77.4,
    });

    expect(result).toBe(20);
    expect(getMultiStopDistanceKm).toHaveBeenCalledWith([
      { lat: 28.5, lng: 77.3 },
      { lat: 28.55, lng: 77.35 },
      { lat: 28.6, lng: 77.4 },
    ]);
  });
});

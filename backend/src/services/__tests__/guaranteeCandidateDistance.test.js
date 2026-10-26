jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  guarantee_candidate_distance: { upsert: jest.fn(async ({ create }) => create), findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const d = require("../guaranteeCandidateDistance");

const CAND = { id: 7, case_id: 1, order_id: 9, rider_id: 44 };
const PICKUP = { lat: "22.7196", lng: "75.8577" };
const NOW = new Date("2026-10-26T10:00:00Z");
const road = (m) => async () => m;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: null, rlongs: null, rloc_updated_at: null, a_status: 0, status: 1 });
});

describe("formatDistance", () => {
  it("shows metres below 1 km and one-decimal kilometres above", () => {
    expect(d.formatDistance(350)).toEqual({ value: 350, unit: "m", text: "350 m" });
    expect(d.formatDistance(999.4).text).toBe("999 m");
    expect(d.formatDistance(1200).text).toBe("1.2 km");
    expect(d.formatDistance(4500).text).toBe("4.5 km");
    expect(d.formatDistance(12000).text).toBe("12.0 km");
  });
});

describe("measure", () => {
  it("prefers the road distance and labels it road", async () => {
    expect(await d.measure({ lat: 22.73, lng: 75.86 }, { lat: 22.7196, lng: 75.8577 }, { roadFn: road(1800) })).toEqual({ distance_m: 1800, kind: "road" });
  });
  it("falls back to the straight line, labelled straight, when no road distance", async () => {
    const out = await d.measure({ lat: 22.7286, lng: 75.8577 }, { lat: 22.7196, lng: 75.8577 }, { roadFn: async () => null });
    expect(out.kind).toBe("straight");
    expect(out.distance_m).toBeGreaterThan(950);
    expect(out.distance_m).toBeLessThan(1050);
  });
});

describe("computeAndStore", () => {
  it("uses the partner-reported location when the driver's app has none, and keeps the approximate flag", async () => {
    const row = await d.computeAndStore({ candidate: CAND, orderPickup: PICKUP, reported: { lat: 22.73, lng: 75.86, approx: true, source: "partner" }, deps: { roadFn: road(1500) }, now: NOW });
    expect(row).toMatchObject({ candidate_id: 7, order_id: 9, rider_id: 44, location_source: "partner", location_approx: true, distance_m: 1500, distance_unit: "km", distance_kind: "road", computed_at: NOW });
  });

  it("prefers a fresh location from the driver's own app over the partner's", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: "22.7210", rlongs: "75.8590", rloc_updated_at: new Date(NOW - 30 * 1000), a_status: 1, status: 1 });
    const row = await d.computeAndStore({ candidate: CAND, orderPickup: PICKUP, reported: { lat: 22.9, lng: 75.9 }, deps: { roadFn: road(350) }, now: NOW });
    expect(row).toMatchObject({ location_source: "shifter_app", location_approx: false, distance_m: 350, distance_unit: "m" });
    expect(Number(row.driver_lat)).toBeCloseTo(22.721, 3);
  });

  it("ignores a stale or offline app location", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: "22.7210", rlongs: "75.8590", rloc_updated_at: new Date(NOW - 10 * 60 * 1000), a_status: 1, status: 1 });
    expect(await d.computeAndStore({ candidate: CAND, orderPickup: PICKUP, reported: null, deps: { roadFn: road(1) }, now: NOW })).toBeNull();
    prisma.tbl_rider.findUnique.mockResolvedValue({ rlats: "22.7210", rlongs: "75.8590", rloc_updated_at: new Date(NOW - 1000), a_status: 0, status: 1 });
    expect(await d.computeAndStore({ candidate: CAND, orderPickup: PICKUP, reported: null, deps: { roadFn: road(1) }, now: NOW })).toBeNull();
  });

  it("stores nothing (distance unavailable) when there is no reliable location or no usable pickup", async () => {
    expect(await d.computeAndStore({ candidate: CAND, orderPickup: PICKUP, reported: null, now: NOW })).toBeNull();
    expect(await d.computeAndStore({ candidate: CAND, orderPickup: PICKUP, reported: { lat: 0, lng: 0 }, now: NOW })).toBeNull();
    expect(await d.computeAndStore({ candidate: CAND, orderPickup: { lat: "", lng: "" }, reported: { lat: 22.7, lng: 75.8 }, now: NOW })).toBeNull();
    expect(prisma.guarantee_candidate_distance.upsert).not.toHaveBeenCalled();
  });

  it("computeSafely swallows a storage failure", async () => {
    prisma.guarantee_candidate_distance.upsert.mockRejectedValueOnce(new Error("table missing"));
    expect(await d.computeSafely({ candidate: CAND, orderPickup: PICKUP, reported: { lat: 22.73, lng: 75.86 }, deps: { roadFn: road(10) }, now: NOW })).toBeNull();
  });
});

describe("present / loadMany", () => {
  it("presents a row for the UI and keeps null as unavailable", () => {
    expect(d.present(null)).toBeNull();
    expect(d.present({ distance_m: 1200, distance_kind: "straight", location_approx: true, location_source: "partner", location_at: null, computed_at: NOW }))
      .toMatchObject({ text: "1.2 km", kind: "straight", approximate: true, source: "partner" });
  });
  it("returns an empty map when the table is not there yet", async () => {
    prisma.guarantee_candidate_distance.findMany.mockRejectedValueOnce(new Error("P2021"));
    expect((await d.loadMany([1, 2])).size).toBe(0);
  });
});

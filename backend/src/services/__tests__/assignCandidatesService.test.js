jest.mock("../../config/db", () => ({ tbl_rider: { findMany: jest.fn() } }));
jest.mock("../whatsappTrialSettings", () => ({ eligibility: jest.fn() }));

const prisma = require("../../config/db");
const whatsappTrialSettings = require("../whatsappTrialSettings");
const svc = require("../assignCandidatesService");

const NOW = new Date("2026-11-17T12:00:00Z").getTime();
// Pickup in Kota (city 2); radius 5 km.
const order = { id: 1027, city_id: 2, category: "Bike", plat: "25.1800", plong: "75.8300", radius_range: 5 };
const rider = (o) => ({
  id: 1, full_name: "A", fmobile: "9000000001", vehicle: "Bike", vehicle_no: null, city_id: 2, status: 1, a_status: 1,
  wallet_balance: "0", trial_status: "none", rlats: null, rlongs: null, rloc_updated_at: null, ...o,
});
const near = { rlats: "25.1850", rlongs: "75.8350" }; // ~0.7 km
const far = { rlats: "22.7196", rlongs: "75.8577" }; // Indore, ~275 km

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  whatsappTrialSettings.eligibility.mockResolvedValue({ eligible: true, reason: null, whatsapp_orders_done: 2 });
});
afterEach(() => Date.now.mockRestore());

describe("listCandidates", () => {
  it("All: same-city online drivers plus other-city online drivers near the pickup (fresh location)", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([
      rider({ id: 1 }),
      rider({ id: 2, city_id: 1, ...near, rloc_updated_at: new Date(NOW - 30 * 1000) }),
      rider({ id: 3, city_id: 1, ...far, rloc_updated_at: new Date(NOW - 30 * 1000) }),
      rider({ id: 4, city_id: 1, ...near, rloc_updated_at: new Date(NOW - 10 * 60 * 1000) }), // stale
    ]);
    const rows = await svc.listCandidates(order, { source: "all" });
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(whatsappTrialSettings.eligibility).not.toHaveBeenCalled(); // no Trial Driver among them
    expect(rows[0]).toMatchObject({ other_city: true, online: true });
    expect(rows[0].distance_km).toBeCloseTo(0.7, 0);
    const where = prisma.tbl_rider.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ status: 1, vehicle: "Bike", a_status: 1 });
  });

  it("Trial: active Trial Drivers, offline too; other-city ones need a location within 24 h near the pickup", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([
      rider({ id: 5, city_id: 1, trial_status: "active", a_status: 0, ...near, rloc_updated_at: new Date(NOW - 3 * 3600 * 1000) }),
      rider({ id: 6, city_id: 1, trial_status: "active", a_status: 0, ...near, rloc_updated_at: new Date(NOW - 30 * 3600 * 1000) }),
      rider({ id: 7, city_id: 2, trial_status: "active", a_status: 0 }),
    ]);
    const rows = await svc.listCandidates(order, { source: "trial" });
    expect(rows.map((r) => r.id)).toEqual([5, 7]);
    expect(rows[0].whatsapp).toEqual({ eligible: true, reason: null, whatsapp_orders_done: 2 });
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where).toMatchObject({ trial_status: "active" });
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where.a_status).toBeUndefined();
  });

  it("passes the search text to name / mobile / plate", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    await svc.listCandidates(order, { source: "all", search: "637" });
    expect(prisma.tbl_rider.findMany.mock.calls[0][0].where.OR).toHaveLength(3);
  });
});

describe("isNearPickup", () => {
  it("true within the order radius with a location under 24 h old", () => {
    expect(svc.isNearPickup(order, rider({ ...near, rloc_updated_at: new Date(NOW - 3600 * 1000) }))).toBe(true);
    expect(svc.isNearPickup(order, rider({ ...far, rloc_updated_at: new Date(NOW) }))).toBe(false);
    expect(svc.isNearPickup(order, rider({ ...near, rloc_updated_at: new Date(NOW - 25 * 3600 * 1000) }))).toBe(false);
    expect(svc.isNearPickup(order, rider({}))).toBe(false);
  });
});

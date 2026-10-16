jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  tbl_rider: { findUnique: jest.fn() },
}));

const prisma = require("../../config/db");
const { listPerformance, getDriverDetail } = require("../adminDriverPerformanceController");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const row = (over = {}) => ({
  rider_id: 1, rider_name: "A", rider_mobile: "9", city_id: 1,
  offered: 10n, accepted: 8n, rejected: 1n, skipped: 1n, completed: 6n, cancelled: 1n,
  penalty_count: 2n, penalty_gross: "100.00", penalty_waived: "40.00", last_activity: new Date(),
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe("listPerformance", () => {
  test("computes rates, net penalty and score from the aggregated counts", async () => {
    prisma.$queryRaw.mockResolvedValue([row()]);
    const res = mockRes();
    await listPerformance({ user: { role: "superadmin" }, query: { tier: "free" } }, res);
    const { data } = res.json.mock.calls[0][0];
    const d = data.drivers[0];
    expect(d.offered).toBe(10);
    expect(d.acceptance_rate).toBe(80);
    expect(d.completion_rate).toBe(75);
    expect(d.penalty_total).toBe(60); // 100 gross - 40 waived
    expect(d.score).toBe(78);
    expect(d.status).toBe("Good");
    expect(data.totals.offered).toBe(10);
    expect(data.filters.tier).toBe("free");
  });

  test("sorts best score first by default and ignores an invalid tier", async () => {
    prisma.$queryRaw.mockResolvedValue([
      row({ rider_id: 1, accepted: 2n, completed: 0n }),
      row({ rider_id: 2, accepted: 10n, rejected: 0n, skipped: 0n, completed: 10n }),
    ]);
    const res = mockRes();
    await listPerformance({ user: { role: "superadmin" }, query: { tier: "bogus" } }, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.drivers.map((x) => x.rider_id)).toEqual([2, 1]);
    expect(data.filters.tier).toBeNull();
  });

  test("a city admin without a city is refused", async () => {
    const res = mockRes();
    await listPerformance({ user: { role: "admin", city_id: null }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("getDriverDetail", () => {
  test("a city admin cannot open a driver from another city", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 5, full_name: "X", fmobile: "1", city_id: 2 });
    const res = mockRes();
    await getDriverDetail({ user: { role: "admin", city_id: 1 }, query: {}, params: { riderId: "5" } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test("returns events and penalties for the driver", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 5, full_name: "X", fmobile: "1", city_id: 1 });
    prisma.$queryRaw
      .mockResolvedValueOnce([{ id: 9n, order_id: 77n, tier: "free", event: "rejected", created_at: new Date() }])
      .mockResolvedValueOnce([{ id: 3n, order_id: 77n, tier: "free", amount: "50.00", status: "collected" }]);
    const res = mockRes();
    await getDriverDetail({ user: { role: "superadmin" }, query: {}, params: { riderId: "5" } }, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data.events[0]).toMatchObject({ id: 9, order_id: 77, event: "rejected" });
    expect(data.penalties[0]).toMatchObject({ id: 3, order_id: 77 });
  });

  test("rejects a non-numeric driver id", async () => {
    const res = mockRes();
    await getDriverDetail({ user: { role: "superadmin" }, query: {}, params: { riderId: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

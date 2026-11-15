jest.mock("../../config/db", () => ({ $queryRaw: jest.fn() }));

const prisma = require("../../config/db");
const { pkgStats, buyStats } = require("../driverEarningsStats");

const sqlOf = (call) => (Array.isArray(call[0]) ? call[0].join("?") : String(call[0])).replace(/\s+/g, " ");

beforeEach(() => jest.clearAllMocks());

describe("pkgStats (Today's / month's completed rides)", () => {
  const from = new Date("2026-11-15T00:00:00Z");
  const to = new Date("2026-11-16T00:00:00Z");

  it("counts a ride only when it is Completed and never when it is Cancelled", async () => {
    prisma.$queryRaw.mockResolvedValue([{ total_order: 2, earning: 120.5 }]);
    const out = await pkgStats(9, from, to);
    expect(out).toEqual({ total_order: 2, earning: 120.5 });
    const sql = sqlOf(prisma.$queryRaw.mock.calls[0]);
    // completed = o_status 'completed' or order_status 5 ...
    expect(sql).toContain("LOWER(TRIM(o_status)) = 'completed' OR order_status = 5");
    // ... and the old bug (order_status 4 = CANCELLED counted as completed) is gone, with explicit cancel guards
    expect(sql).not.toMatch(/OR order_status = 4/);
    expect(sql).toContain("NOT IN ('cancelled', 'cancel')");
    expect(sql).toContain("COALESCE(order_status, 0) <> 4");
    // scoped to this driver and the requested window
    expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([9, from, to]);
  });

  it("an empty result is zero, not undefined", async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await pkgStats(9, from, to)).toEqual({ total_order: 0, earning: 0 });
  });
});

describe("buyStats", () => {
  it("counts only Completed buy orders: flow_id 4 is a cancel and flow_id 5 is still in progress", async () => {
    prisma.$queryRaw.mockResolvedValue([{ total_order: 1, earning: 40 }]);
    await buyStats(9, new Date(), new Date());
    const sql = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(sql).toContain("LOWER(TRIM(o_status)) = 'completed'");
    expect(sql).not.toMatch(/flow_id/);
  });
});

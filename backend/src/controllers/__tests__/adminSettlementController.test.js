jest.mock("../../config/db", () => ({
  order_settlement: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  order_settlement_event: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock("../../services/settlementService", () => {
  class SettlementError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return { SettlementError, adminResolve: jest.fn(), publicView: jest.fn((s) => s) };
});

const prisma = require("../../config/db");
const svc = require("../../services/settlementService");
const c = require("../adminSettlementController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const json = (r) => r.json.mock.calls[0][0];
const NOW = Date.now();

describe("adminSettlementController.list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order_settlement.count.mockResolvedValue(1);
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 7, name: "Asha", mobile: 9876543210 }]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, full_name: "Ravi K", first_name: "Ravi", last_name: "K", fmobile: "8888800000" }]);
    prisma.order_settlement.findMany.mockResolvedValue([{
      id: 1, order_id: 50, uid: 7, rid: 9, status: "pending", amount_due: 85, fare: 100, method: null,
      pending_since: new Date(NOW - 20 * 60000), escalated_at: null, dispute_reason: null, dispute_raised_by: null,
    }]);
  });

  it("maps filters to where clauses", async () => {
    for (const [status, where] of [
      ["pending", { status: "pending" }],
      ["unsettled", { status: "pending", escalated_at: { not: null } }],
      ["disputed", { status: "disputed" }],
      ["resolved", { status: { in: ["cash_received", "paid_online", "waived", "customer_owes"] } }],
      ["all", {}],
    ]) {
      prisma.order_settlement.findMany.mockClear();
      await c.list({ query: { status } }, res());
      expect(prisma.order_settlement.findMany.mock.calls[0][0].where).toEqual(where);
    }
  });

  it("filters by rider and customer and paginates", async () => {
    await c.list({ query: { status: "pending", rider_id: "9", user_id: "7", page: "2", limit: "10" } }, res());
    const args = prisma.order_settlement.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ status: "pending", rid: 9, uid: 7 });
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
  });

  it("returns names, minutes pending and the escalated flag", async () => {
    const r = res();
    await c.list({ query: { status: "pending" } }, r);
    expect(json(r)).toMatchObject({
      success: true,
      pagination: { page: 1, limit: 25, total: 1 },
      data: [{ id: 1, order_id: 50, status: "pending", amount_due: 85, customer_name: "Asha", rider_name: "Ravi K", escalated: false }],
    });
    expect(json(r).data[0].minutes_pending).toBeGreaterThanOrEqual(20);
  });
});

describe("adminSettlementController.detail", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns settlement, oldest-first events and the order", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 1, order_id: 50, uid: 7, rid: 9 });
    prisma.order_settlement_event.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, paddress: "A", daddress: "B", d_charge: 100, total_dcharge: 100, commission: 10 });
    const r = res();
    await c.detail({ params: { id: "1" } }, r);
    expect(prisma.order_settlement_event.findMany).toHaveBeenCalledWith({ where: { settlement_id: 1 }, orderBy: { id: "asc" } });
    expect(json(r).data).toMatchObject({ settlement: { id: 1 }, events: [{ id: 1 }, { id: 2 }], order: { id: 50 } });
  });

  it("404s an unknown settlement", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    const r = res();
    await c.detail({ params: { id: "99" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});

describe("adminSettlementController.resolve", () => {
  beforeEach(() => jest.clearAllMocks());

  it("resolves with the logged-in admin's id", async () => {
    svc.adminResolve.mockResolvedValue({ settlement: { id: 1, status: "waived" } });
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "Goodwill" }, user: { id: 3 } }, r);
    expect(svc.adminResolve).toHaveBeenCalledWith({ settlementId: 1, adminId: 3, outcome: "waived", note: "Goodwill" });
    expect(json(r)).toMatchObject({ success: true, data: { settlement: { status: "waived" } } });
  });

  it("maps business errors to 400 (404 for NOT_FOUND)", async () => {
    svc.adminResolve.mockRejectedValue(new svc.SettlementError("NOTE_REQUIRED", "A note is required"));
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived" }, user: { id: 3 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(json(r)).toMatchObject({ success: false, code: "NOTE_REQUIRED" });

    svc.adminResolve.mockRejectedValue(new svc.SettlementError("NOT_FOUND", "none"));
    const r2 = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 } }, r2);
    expect(r2.status).toHaveBeenCalledWith(404);
  });

  it("unexpected errors are 500", async () => {
    svc.adminResolve.mockRejectedValue(new Error("boom"));
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
  });
});

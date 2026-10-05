jest.mock("../../config/db", () => ({
  order_settlement: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
  order_settlement_event: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
  order_receiver_pay: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock("../../services/settlementService", () => {
  class SettlementError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return { SettlementError, adminResolve: jest.fn(), publicView: jest.fn((s) => s) };
});

jest.mock("../../services/receiverSettlementService", () => ({ declineReceiverPay: jest.fn() }));

const prisma = require("../../config/db");
const receiverSettlementService = require("../../services/receiverSettlementService");
const svc = require("../../services/settlementService");
const logger = require("../../utils/logger");
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

  it("city-bound admin: adds city_id and merges with other filters; superadmin is unscoped", async () => {
    await c.list({ query: { status: "pending", rider_id: "9" }, scopedCityId: 3 }, res());
    expect(prisma.order_settlement.findMany.mock.calls[0][0].where).toEqual({ status: "pending", rid: 9, city_id: 3 });
    prisma.order_settlement.findMany.mockClear();
    await c.list({ query: { status: "pending" }, scopedCityId: null }, res());
    expect(prisma.order_settlement.findMany.mock.calls[0][0].where).toEqual({ status: "pending" });
  });

  it("rejects bad rider_id / user_id filters with 400 INVALID_ID", async () => {
    for (const q of [{ rider_id: "abc" }, { user_id: "0" }, { rider_id: "1.5" }, { user_id: "-2" }]) {
      const r = res();
      await c.list({ query: q }, r);
      expect(r.status).toHaveBeenCalledWith(400);
      expect(json(r)).toMatchObject({ code: "INVALID_ID" });
    }
    expect(prisma.order_settlement.findMany).not.toHaveBeenCalled();
  });

  it("rejects unknown / prototype status values with 400; missing status means all", async () => {
    for (const status of ["toString", "__proto__", "bogus"]) {
      const r = res();
      await c.list({ query: { status } }, r);
      expect(r.status).toHaveBeenCalledWith(400);
      expect(json(r)).toMatchObject({ success: false, code: "INVALID_STATUS" });
    }
    expect(prisma.order_settlement.findMany).not.toHaveBeenCalled();
    await c.list({ query: {} }, res());
    expect(prisma.order_settlement.findMany.mock.calls[0][0].where).toEqual({});
  });

  it("caps the page number", async () => {
    await c.list({ query: { page: "99999999999", limit: "10" } }, res());
    expect(prisma.order_settlement.findMany.mock.calls[0][0].skip).toBe(99999 * 10);
  });

  it("skips name lookups when there are no rows", async () => {
    prisma.order_settlement.findMany.mockResolvedValue([]);
    prisma.order_settlement.count.mockResolvedValue(0);
    const r = res();
    await c.list({ query: {} }, r);
    expect(prisma.tbl_user.findMany).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.findMany).not.toHaveBeenCalled();
    expect(json(r).data).toEqual([]);
  });

  it("unexpected errors are 500 and logged", async () => {
    prisma.order_settlement.findMany.mockRejectedValue(new Error("db"));
    const r = res();
    await c.list({ query: {} }, r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(json(r)).toEqual({ success: false, message: "Internal server error" });
    expect(logger.error).toHaveBeenCalled();
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

  it("rejects invalid ids with 400 INVALID_ID and makes no DB call", async () => {
    for (const id of ["abc", "0", "-1", "1.5"]) {
      const r = res();
      await c.detail({ params: { id } }, r);
      expect(r.status).toHaveBeenCalledWith(400);
      expect(json(r)).toMatchObject({ success: false, code: "INVALID_ID" });
    }
    expect(prisma.order_settlement.findUnique).not.toHaveBeenCalled();
  });

  it("city-bound admin: 404 for another city's settlement, 200 for own; superadmin sees all", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 1, order_id: 50, city_id: 3 });
    prisma.order_settlement_event.findMany.mockResolvedValue([]);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50 });
    const other = res();
    await c.detail({ params: { id: "1" }, scopedCityId: 5 }, other);
    expect(other.status).toHaveBeenCalledWith(404);
    const own = res();
    await c.detail({ params: { id: "1" }, scopedCityId: 3 }, own);
    expect(own.status).toHaveBeenCalledWith(200);
    const sup = res();
    await c.detail({ params: { id: "1" }, scopedCityId: null }, sup);
    expect(sup.status).toHaveBeenCalledWith(200);
  });

  it("404s an unknown settlement", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    const r = res();
    await c.detail({ params: { id: "99" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});

describe("adminSettlementController.detail - receiver_pay", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 4, order_id: 50, city_id: 1, payer: "receiver", status: "pending" });
    prisma.order_settlement_event.findMany.mockResolvedValue([]);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, paddress: "A", daddress: "B", d_charge: 100, total_dcharge: 100, commission: 10, o_status: "Completed" });
  });

  it("returns the receiver row without the token hash or razorpay id", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({
      receiver_phone: "9876543210", receiver_name: "Ramesh", commission_percent: "3.00", status: "active",
      declined_by: null, declined_at: null, link_sent_at: new Date("2026-10-05T10:00:00Z"), link_send_count: 1,
      token_expires_at: new Date("2026-10-06T10:00:00Z"), token_hash: "a".repeat(64), razorpay_order_id: "order_X",
    });
    const r = res();
    await c.detail({ params: { id: "4" }, scopedCityId: null }, r);
    expect(json(r).data.receiver_pay).toMatchObject({ receiver_phone: "9876543210", receiver_name: "Ramesh", commission_percent: 3, status: "active", link_send_count: 1 });
    expect(JSON.stringify(json(r))).not.toContain("token_hash");
    expect(JSON.stringify(json(r))).not.toContain("order_X");
    expect(prisma.order_receiver_pay.findUnique.mock.calls[0][0].select.token_hash).toBeUndefined();
  });

  it("returns receiver_pay: null when there is no row", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
    const r = res();
    await c.detail({ params: { id: "4" }, scopedCityId: null }, r);
    expect(json(r).data.receiver_pay).toBeNull();
  });

  it("still returns the detail (receiver_pay null) when the receiver lookup throws", async () => {
    prisma.order_receiver_pay.findUnique.mockRejectedValue(new Error("table missing"));
    const r = res();
    await c.detail({ params: { id: "4" }, scopedCityId: null }, r);
    expect(json(r).success).toBe(true);
    expect(json(r).data.receiver_pay).toBeNull();
  });

  it("still returns the detail when the Prisma model is missing entirely", async () => {
    const saved = prisma.order_receiver_pay;
    delete prisma.order_receiver_pay;
    const r = res();
    await c.detail({ params: { id: "4" }, scopedCityId: null }, r);
    prisma.order_receiver_pay = saved;
    expect(json(r).success).toBe(true);
    expect(json(r).data.receiver_pay).toBeNull();
  });
});

describe("adminSettlementController.resolve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 1, city_id: 3 });
  });

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
    expect(json(r)).toEqual({ success: false, message: "Internal server error" });
    expect(logger.error).toHaveBeenCalled();
  });

  it("401s when there is no logged-in user and does not call the service", async () => {
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" } }, r);
    expect(r.status).toHaveBeenCalledWith(401);
    expect(json(r)).toEqual({ success: false, message: "Unauthorized" });
    expect(svc.adminResolve).not.toHaveBeenCalled();
  });

  it("rejects invalid ids with 400 INVALID_ID before any DB or service call", async () => {
    for (const id of ["abc", "0", "-1", "1.5"]) {
      const r = res();
      await c.resolve({ params: { id }, body: { outcome: "waived", note: "x" }, user: { id: 3 } }, r);
      expect(r.status).toHaveBeenCalledWith(400);
      expect(json(r)).toMatchObject({ success: false, code: "INVALID_ID" });
    }
    expect(prisma.order_settlement.findUnique).not.toHaveBeenCalled();
    expect(svc.adminResolve).not.toHaveBeenCalled();
  });

  it("city-bound admin: 404 for another city's settlement without calling adminResolve", async () => {
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 }, scopedCityId: 5 }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(svc.adminResolve).not.toHaveBeenCalled();
  });

  it("city-bound admin: 404 for a missing settlement", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 }, scopedCityId: 3 }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(svc.adminResolve).not.toHaveBeenCalled();
  });

  it("city-bound admin resolves own city's settlement; superadmin resolves any", async () => {
    svc.adminResolve.mockResolvedValue({ settlement: { id: 1, status: "waived" } });
    const r = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 }, scopedCityId: 3 }, r);
    expect(svc.adminResolve).toHaveBeenCalledTimes(1);
    const r2 = res();
    await c.resolve({ params: { id: "1" }, body: { outcome: "waived", note: "x" }, user: { id: 3 }, scopedCityId: null }, r2);
    expect(svc.adminResolve).toHaveBeenCalledTimes(2);
  });
});
describe("adminSettlementController receiver-pay", () => {
  beforeEach(() => jest.clearAllMocks());

  it("list exposes the receiver-pay fields", async () => {
    const row = { id: 4, order_id: 50, uid: 7, rid: 9, city_id: 1, status: "pending", amount_due: 90, fare: 100, method: null,
      pending_since: new Date(), escalated_at: null, dispute_reason: null, dispute_raised_by: null,
      payer: "receiver", receiver_markup: 2.7, advance_held: 20, reversal_shortfall: 0 };
    prisma.order_settlement.findMany.mockResolvedValue([row]);
    prisma.order_settlement.count.mockResolvedValue(1);
    prisma.tbl_user.findMany.mockResolvedValue([]);
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    const r = res();
    await c.list({ query: {}, scopedCityId: null }, r);
    expect(json(r).data[0]).toMatchObject({ payer: "receiver", receiver_markup: 2.7, advance_held: 20, reversal_shortfall: 0 });
  });

  it("convertToCustomer converts a receiver settlement as admin", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 4, order_id: 50, city_id: 1 });
    receiverSettlementService.declineReceiverPay.mockResolvedValue({ phase: "converted", settlement: { id: 4 } });
    const r = res();
    await c.convertToCustomer({ params: { id: "4" }, user: { id: 1 }, scopedCityId: null }, r);
    expect(receiverSettlementService.declineReceiverPay).toHaveBeenCalledWith({ orderId: 50, actor: "admin", actorId: 1 });
    expect(r.json).toHaveBeenCalledWith({ success: true, data: { phase: "converted", settlement: { id: 4 } } });
  });

  it("convertToCustomer respects city scope", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue({ id: 4, order_id: 50, city_id: 2 });
    const r = res();
    await c.convertToCustomer({ params: { id: "4" }, user: { id: 1 }, scopedCityId: 1 }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(receiverSettlementService.declineReceiverPay).not.toHaveBeenCalled();
  });
});

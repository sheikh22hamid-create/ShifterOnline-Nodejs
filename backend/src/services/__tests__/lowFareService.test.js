jest.mock("../../config/db", () => ({
  pkg_order: { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findMany: jest.fn() },
  order_status_history: { findMany: jest.fn() },
  low_fare_view: { findMany: jest.fn(), createMany: jest.fn() },
  $executeRaw: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitDriverEvent: jest.fn(), emitCustomerEvent: jest.fn() }));
jest.mock("../tripLifecycle", () => ({ acceptOrder: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn() }));
jest.mock("../walletAdvanceService", () => ({ refundWalletAdvanceIfAny: jest.fn() }));
jest.mock("../referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn() }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const tripLifecycle = require("../tripLifecycle");
const service = require("../lowFareService");
const walletPrepayment = require("../walletPrepaymentRefund");
const walletAdvance = require("../walletAdvanceService");
const { refundReferralPointsForOrder } = require("../referralPointsRefund");

const NOW = new Date("2026-10-28T09:00:00Z");
const RIDER = { id: 7, status: 1, a_status: 1, verification_status: "approved", vehicle: "Tata Ace" };
const ORDER = {
  id: 100, uid: 3, booking_type: 3, next_day_stage: "low_fare", category: "Tata Ace", rid: 0, order_status: 0, o_status: "Pending",
  next_day_live_at: new Date("2026-10-28T08:30:00Z"), next_day_live_until: new Date("2026-10-28T10:30:00Z"),
};

beforeEach(() => {
  jest.resetAllMocks();
  prisma.tbl_rider.findUnique.mockResolvedValue(RIDER);
  prisma.tbl_rider.findMany.mockResolvedValue([{ id: 7 }, { id: 8 }, { id: 9 }]);
  prisma.pkg_order.findMany.mockResolvedValue([]);
  prisma.pkg_order.findUnique.mockResolvedValue(ORDER);
  prisma.pkg_order.count.mockResolvedValue(0);
  prisma.order_status_history.findMany.mockResolvedValue([]);
  prisma.low_fare_view.findMany.mockResolvedValue([]);
  prisma.$executeRaw.mockResolvedValue(1);
  tripLifecycle.acceptOrder.mockResolvedValue({ success: true });
  walletPrepayment.refundIfWalletPaid.mockResolvedValue(undefined);
  walletAdvance.refundWalletAdvanceIfAny.mockResolvedValue(undefined);
  refundReferralPointsForOrder.mockResolvedValue(undefined);
});

describe("listForDriver / countForDriver", () => {
  it("lists open orders for the driver's own vehicle only, flagging unread ones", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ ...ORDER, id: 100 }, { ...ORDER, id: 101 }]);
    prisma.low_fare_view.findMany.mockResolvedValue([{ order_id: 101 }]);
    const out = await service.listForDriver(7, NOW);
    expect(out.map((o) => [o.id, o.unread])).toEqual([[100, true], [101, false]]);
    const where = prisma.pkg_order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ category: "Tata Ace", next_day_stage: "low_fare", rid: 0, o_status: "Pending", next_day_live_at: { lte: NOW }, next_day_live_until: { gt: NOW } });
  });

  it("hides an order this driver cancelled before", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ ...ORDER, id: 100 }, { ...ORDER, id: 101 }]);
    prisma.order_status_history.findMany.mockResolvedValue([{ order_id: 100 }]);
    expect((await service.listForDriver(7, NOW)).map((o) => o.id)).toEqual([101]);
  });

  it("hides an order outside its window even if the query returned it", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ ...ORDER, next_day_live_until: new Date("2026-10-28T09:00:00Z") }]);
    expect(await service.listForDriver(7, NOW)).toEqual([]);
  });

  it("lists nothing for an unapproved driver", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ ...RIDER, verification_status: "pending" });
    expect(await service.listForDriver(7, NOW)).toEqual([]);
    expect(prisma.pkg_order.findMany).not.toHaveBeenCalled();
  });

  it("counts only unread orders and fails closed to 0", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ ...ORDER, id: 100 }, { ...ORDER, id: 101 }]);
    prisma.low_fare_view.findMany.mockResolvedValue([{ order_id: 101 }]);
    expect(await service.countForDriver(7, NOW)).toBe(1);
    prisma.pkg_order.findMany.mockRejectedValue(new Error("db"));
    expect(await service.countForDriver(7, NOW)).toBe(0);
  });
});

describe("markSeen", () => {
  it("stores each valid order id once", async () => {
    await service.markSeen(7, [100, "101", 100, "x", -2]);
    expect(prisma.low_fare_view.createMany).toHaveBeenCalledWith({ data: [{ rider_id: 7, order_id: 100 }, { rider_id: 7, order_id: 101 }], skipDuplicates: true });
  });
  it("does nothing for an empty list", async () => {
    await service.markSeen(7, []);
    expect(prisma.low_fare_view.createMany).not.toHaveBeenCalled();
  });
});

describe("accept", () => {
  it("claims the order and assigns the driver through acceptOrder, then closes it for the others", async () => {
    const out = await service.accept(100, 7, NOW);
    expect(out).toEqual({ ok: true, order_id: 100 });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tripLifecycle.acceptOrder).toHaveBeenCalledWith(100, 7);
    await new Promise((r) => setImmediate(r));
    const closed = dispatchManager.emitDriverEvent.mock.calls.filter((c) => c[1] === "lowfare:closed").map((c) => c[0]).sort();
    expect(closed).toEqual([8, 9]);
  });

  it("answers 'Already Attended' when another driver won the claim, and assigns nobody", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.pkg_order.findUnique.mockResolvedValueOnce(ORDER).mockResolvedValueOnce({ rid: 8, o_status: "Processing" });
    expect(await service.accept(100, 7, NOW)).toEqual({ ok: false, msg: "Already Attended" });
    expect(tripLifecycle.acceptOrder).not.toHaveBeenCalled();
  });

  it("refuses outside the window (the claim matches no row) as no longer available", async () => {
    prisma.$executeRaw.mockResolvedValue(0);
    prisma.pkg_order.findUnique.mockResolvedValueOnce(ORDER).mockResolvedValueOnce({ rid: 0, o_status: "Pending" });
    expect(await service.accept(100, 7, new Date("2026-10-28T10:30:00Z"))).toEqual({ ok: false, msg: "This order is no longer available" });
    expect(tripLifecycle.acceptOrder).not.toHaveBeenCalled();
  });

  it("the claim itself carries the window bounds, so the server clock decides, not the screen", async () => {
    await service.accept(100, 7, NOW);
    const sql = prisma.$executeRaw.mock.calls[0][0].join("?");
    expect(sql).toMatch(/rid = 0/);
    expect(sql).toMatch(/next_day_live_at <= \?/);
    expect(sql).toMatch(/next_day_live_until > \?/);
  });

  it("hands the order back when assignment fails, so someone else can still take it", async () => {
    tripLifecycle.acceptOrder.mockResolvedValue({ success: false, msg: "boom" });
    const out = await service.accept(100, 7, NOW);
    expect(out.ok).toBe(false);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(prisma.$executeRaw.mock.calls[1][0].join("?")).toMatch(/SET rid = 0, order_status = 0, o_status = 'Pending'/);
  });

  it.each([
    ["a different vehicle", () => prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, category: "Pickup 8ft" }), "This order is for a different vehicle"],
    ["an order they cancelled", () => prisma.order_status_history.findMany.mockResolvedValue([{ order_id: 100 }]), "You cancelled this order earlier"],
    ["an active trip", () => prisma.pkg_order.count.mockResolvedValue(1), "You already have an active trip"],
    ["offline", () => prisma.tbl_rider.findUnique.mockResolvedValue({ ...RIDER, a_status: 0 }), "Go online to accept this order"],
    ["an old-style next-day order", () => prisma.pkg_order.findUnique.mockResolvedValue({ ...ORDER, next_day_stage: "arranging" }), "This order is no longer available"],
  ])("refuses %s before touching the order", async (_label, arrange, msg) => {
    arrange();
    expect(await service.accept(100, 7, NOW)).toEqual({ ok: false, msg });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("notifyNew", () => {
  it("pings the eligible online drivers of the category except those who cancelled this order", async () => {
    prisma.order_status_history.findMany.mockResolvedValue([{ rider_id: 8 }]);
    await service.notifyNew({ id: 100, category: "Tata Ace" });
    expect(dispatchManager.emitDriverEvent.mock.calls.map((c) => c[0]).sort()).toEqual([7, 9]);
    expect(dispatchManager.emitDriverEvent).toHaveBeenCalledWith(7, "lowfare:new", { order_id: 100 });
  });
});

describe("expireDue", () => {
  it("cancels each unassigned order whose window ended, once, and tells the customer", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 100, uid: 3 }, { id: 101, uid: 4 }]);
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    expect(await service.expireDue(NOW)).toBe(1);
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledTimes(1);
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(3, "order:cancelled", expect.objectContaining({ order_id: 100, reason: service.EXPIRE_REASON }));
    const where = prisma.pkg_order.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ next_day_stage: "low_fare", rid: 0, o_status: "Pending", next_day_live_until: { lte: NOW } });
  });

  it("refunds a wallet-paid fare, a wallet advance and referral points for an order it cancels, and only for that one", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 100, uid: 3 }, { id: 101, uid: 4 }]);
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    await service.expireDue(NOW);
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledTimes(1);
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledWith(expect.objectContaining({ id: 100 }), { note: "no driver found" });
    expect(walletAdvance.refundWalletAdvanceIfAny).toHaveBeenCalledWith(100);
    expect(refundReferralPointsForOrder).toHaveBeenCalledWith(100);
  });

  it("a failing refund does not stop the others or the customer's notification", async () => {
    prisma.pkg_order.findMany.mockResolvedValue([{ id: 100, uid: 3 }]);
    walletPrepayment.refundIfWalletPaid.mockRejectedValue(new Error("wallet down"));
    expect(await service.expireDue(NOW)).toBe(1);
    expect(walletAdvance.refundWalletAdvanceIfAny).toHaveBeenCalled();
    expect(refundReferralPointsForOrder).toHaveBeenCalled();
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledTimes(1);
  });
});

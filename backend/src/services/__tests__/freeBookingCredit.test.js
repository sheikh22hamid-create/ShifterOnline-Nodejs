jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  tbl_user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  free_booking_pool: { findMany: jest.fn() },
  free_booking_order: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../pricingEngine", () => ({ getActiveCustomerPlan: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue() }));
jest.mock("../customerInbox", () => ({ saveCustomerNotification: jest.fn().mockResolvedValue() }));
jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-06T10:00:00Z") }));

const { Prisma } = require("@prisma/client");
const prisma = require("../../config/db");
const walletNotifier = require("../walletNotifier");
const customerInbox = require("../customerInbox");
const logger = require("../../utils/logger");
const svc = require("../freeBookingService");

function makeTx({ row, locked = false, order = { o_status: "Completed", rid: 9 }, settlement = null, duplicate = null } = {}) {
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce(row ? [{ id: row.id, user_id: row.user_id }] : [])
      .mockResolvedValueOnce([{ free_booking_locked: locked ? 1 : 0 }]),
    free_booking_order: { findUnique: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) },
    pkg_order: { findUnique: jest.fn().mockResolvedValue(order) },
    order_settlement: { findUnique: jest.fn().mockResolvedValue(settlement) },
    tbl_wallet_history: { findFirst: jest.fn().mockResolvedValue(duplicate), create: jest.fn().mockResolvedValue({ id: 77 }) },
    tbl_user: { update: jest.fn().mockResolvedValue({}) },
  };
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}
const pendingRow = (o = {}) => ({
  id: 5, order_id: 50, user_id: 7, status: "FREE_BOOKING_REWARD_PENDING",
  accepted_in_pool: true, pool_rider_id: 9, actual_fare: "500.00", ...o,
});

beforeEach(() => jest.resetAllMocks());

describe("tryCredit", () => {
  it("credits the full fare, locks the user and records the history id", async () => {
    const tx = makeTx({ row: pendingRow() });
    const out = await svc.tryCredit(50);
    expect(out).toEqual({ credited: true, action: "credit" });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: expect.objectContaining({ wallet: { increment: 500 }, free_booking_locked: true, free_booking_just_unlocked: false }),
    });
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 7, amount: 500, type: "credit", wallet_type: "user", order_id: 50, payment_id: "free_booking_credit:50" }),
    });
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: "FREE_BOOKING_REWARD_CREDITED", credit_amount: 500, wallet_history_id: 77 }),
    });
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "credit", amount: 500 }));
    expect(logger.info).toHaveBeenCalledWith("free-booking order=50 FREE_BOOKING_REWARD_PENDING->FREE_BOOKING_REWARD_CREDITED reason=- amount=500");
  });

  it("credits the full invoice even when a coupon or points paid part of it (spec: actual fare)", async () => {
    const tx = makeTx({ row: pendingRow({ actual_fare: "320.50" }) });
    await svc.tryCredit(50);
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ wallet: { increment: 320.5 } }) });
  });

  it("credits when a settlement exists and is cash_received / paid_online", async () => {
    const tx = makeTx({ row: pendingRow(), settlement: { status: "paid_online" } });
    expect((await svc.tryCredit(50)).credited).toBe(true);
    expect(tx.tbl_user.update).toHaveBeenCalled();
  });

  it("treats a missing settlement table (P2021) as no settlement and credits", async () => {
    const tx = makeTx({ row: pendingRow() });
    tx.order_settlement.findUnique.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("x", { code: "P2021", clientVersion: "test" }));
    expect(await svc.tryCredit(50)).toEqual({ credited: true, action: "credit" });
    expect(tx.tbl_user.update).toHaveBeenCalled();
  });

  it.each([
    ["a generic error", () => new Error("conn lost")],
    ["P2022", () => new Prisma.PrismaClientKnownRequestError("x", { code: "P2022", clientVersion: "test" })],
  ])("does not credit when the settlement lookup fails with %s", async (_n, mk) => {
    const tx = makeTx({ row: pendingRow() });
    tx.order_settlement.findUnique.mockRejectedValue(mk());
    expect(await svc.tryCredit(50)).toEqual({ credited: false, action: "error" });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("is idempotent: an existing history row means no second credit", async () => {
    const tx = makeTx({ row: pendingRow(), duplicate: { id: 1 } });
    const out = await svc.tryCredit(50);
    expect(out.credited).toBe(false);
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("repairs an open row whose history row already exists, without touching the wallet or locking the user again", async () => {
    const tx = makeTx({ row: pendingRow(), duplicate: { id: 31, amount: "500.00" } });
    const out = await svc.tryCredit(50);
    expect(out).toEqual({ credited: false, action: "duplicate" });
    expect(tx.free_booking_order.update).toHaveBeenCalledTimes(1);
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: "FREE_BOOKING_REWARD_CREDITED", credit_amount: 500, wallet_history_id: 31, credited_at: expect.any(Date) },
    });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(walletNotifier.notifyCustomerWalletTransaction).not.toHaveBeenCalled();
  });

  it("takes the free_booking_order lock first, then the tbl_user lock (both FOR UPDATE)", async () => {
    const tx = makeTx({ row: pendingRow() });
    await svc.tryCredit(50);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const sql = (i) => tx.$queryRaw.mock.calls[i][0].join("?");
    expect(sql(0)).toMatch(/free_booking_order/);
    expect(sql(0)).toMatch(/FOR UPDATE/);
    expect(sql(1)).toMatch(/tbl_user/);
    expect(sql(1)).toMatch(/FOR UPDATE/);
  });

  it("waits while the settlement is pending: nothing is written", async () => {
    const tx = makeTx({ row: pendingRow(), settlement: { status: "pending" } });
    expect(await svc.tryCredit(50)).toEqual({ credited: false, action: "wait" });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.free_booking_order.update).not.toHaveBeenCalled();
  });

  it("voids a waived settlement as payment_failed and does not credit", async () => {
    const tx = makeTx({ row: pendingRow(), settlement: { status: "waived" } });
    expect(await svc.tryCredit(50)).toEqual({ credited: false, action: "void" });
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "payment_failed" },
    });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith("free-booking order=50 FREE_BOOKING_REWARD_PENDING->FREE_BOOKING_NOT_ELIGIBLE reason=payment_failed amount=-");
  });

  it("voids as vehicle_changed when another driver finished the trip", async () => {
    const tx = makeTx({ row: pendingRow(), order: { o_status: "Completed", rid: 10 } });
    expect((await svc.tryCredit(50)).action).toBe("void");
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "vehicle_changed" },
    });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });

  it("voids as cancelled", async () => {
    const tx = makeTx({ row: pendingRow({ status: "FREE_BOOKING_CONFIRMED", actual_fare: null }), order: { o_status: "Cancelled", rid: 9 } });
    await svc.tryCredit(50);
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "cancelled" },
    });
  });

  it("a second concurrent free order for a user locked in between is voided as locked, not credited", async () => {
    const tx = makeTx({ row: pendingRow(), locked: true });
    await svc.tryCredit(50);
    expect(tx.free_booking_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "locked" },
    });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });

  it("skips an order that is not a free booking", async () => {
    makeTx({ row: null });
    expect(await svc.tryCredit(50)).toEqual({ credited: false, action: "skip" });
  });

  it("never throws: a DB error is logged and reported as not credited", async () => {
    prisma.$transaction.mockRejectedValue(new Error("deadlock"));
    expect((await svc.tryCredit(50)).credited).toBe(false);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("markCompleted", () => {
  it("moves CONFIRMED to REWARD_PENDING with the fare, then tries the credit", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    makeTx({ row: pendingRow() });
    const out = await svc.markCompleted({ orderId: 50, finalTotal: 500.004 });
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "FREE_BOOKING_CONFIRMED" },
      data: expect.objectContaining({ status: "FREE_BOOKING_REWARD_PENDING", actual_fare: 500 }),
    });
    expect(out.credited).toBe(true);
  });
  it("logs the CONFIRMED -> REWARD_PENDING transition with the amount", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    makeTx({ row: pendingRow() });
    await svc.markCompleted({ orderId: 50, finalTotal: 500 });
    expect(logger.info).toHaveBeenCalledWith("free-booking order=50 FREE_BOOKING_CONFIRMED->FREE_BOOKING_REWARD_PENDING reason=- amount=500");
  });
  it.each([["undefined", undefined], ["null", null], ["NaN", NaN], ["garbage string", "abc"]])(
    "writes nothing and logs an error when finalTotal is %s (never voids a booking as zero_fare)",
    async (_n, finalTotal) => {
      expect(await svc.markCompleted({ orderId: 50, finalTotal })).toEqual({ credited: false });
      expect(prisma.free_booking_order.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalled();
    }
  );
  it("does nothing for an order that is not a CONFIRMED free booking", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.markCompleted({ orderId: 50, finalTotal: 500 })).toEqual({ credited: false });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("recordAcceptance", () => {
  const confirmed = { id: 5, user_id: 7, city_id: 3, status: "FREE_BOOKING_CONFIRMED" };
  it("stores the pool rider who accepted", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(confirmed);
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }]);
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    await svc.recordAcceptance(50, 9);
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: "FREE_BOOKING_CONFIRMED" },
      data: { pool_rider_id: 9, accepted_in_pool: true },
    });
    expect(logger.info).toHaveBeenCalledWith("free-booking order=50 FREE_BOOKING_CONFIRMED->FREE_BOOKING_CONFIRMED reason=pool_driver_accepted amount=-");
  });
  it("does nothing more when a concurrent void won the race (updateMany count 0)", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(confirmed);
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }]);
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 0 });
    await svc.recordAcceptance(50, 9);
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();
    expect(customerInbox.saveCustomerNotification).not.toHaveBeenCalled();
  });
  it("sends no notification when the non-pool void loses the race (voidRow count 0)", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(confirmed);
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }]);
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 0 });
    await svc.recordAcceptance(50, 99);
    expect(customerInbox.saveCustomerNotification).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
  it("voids the booking and tells the customer when a non-pool driver accepted", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(confirmed);
    prisma.free_booking_pool.findMany.mockResolvedValue([{ rider_id: 9 }]);
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    await svc.recordAcceptance(50, 99);
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: { in: ["FREE_BOOKING_CONFIRMED", "FREE_BOOKING_REWARD_PENDING"] } },
      data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "vehicle_changed" },
    });
    expect(customerInbox.saveCustomerNotification).toHaveBeenCalledWith(7, expect.any(String), expect.any(String));
    expect(logger.info).toHaveBeenCalledWith("free-booking order=50 open->FREE_BOOKING_NOT_ELIGIBLE reason=vehicle_changed amount=-");
  });
  it("ignores orders that are not CONFIRMED free bookings", async () => {
    prisma.free_booking_order.findUnique.mockResolvedValue(null);
    await svc.recordAcceptance(50, 9);
    expect(prisma.free_booking_order.update).not.toHaveBeenCalled();
  });
});

describe("fallbackToNormalDispatch", () => {
  it("flips CONFIRMED to NOT_ELIGIBLE (pool_unavailable) atomically and notifies", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.free_booking_order.findUnique.mockResolvedValue({ user_id: 7 });
    expect(await svc.fallbackToNormalDispatch(50)).toBe(true);
    expect(prisma.free_booking_order.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "FREE_BOOKING_CONFIRMED" },
      data: { status: "FREE_BOOKING_NOT_ELIGIBLE", not_eligible_reason: "pool_unavailable" },
    });
    expect(customerInbox.saveCustomerNotification).toHaveBeenCalled();
  });
  it.each([
    ["the notification", () => { customerInbox.saveCustomerNotification.mockRejectedValue(new Error("inbox down")); }],
    ["the user lookup", () => { prisma.free_booking_order.findUnique.mockRejectedValue(new Error("db blip")); }],
  ])("still returns true after the flip when %s fails (order must continue as normal)", async (_n, arrange) => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.free_booking_order.findUnique.mockResolvedValue({ user_id: 7 });
    arrange();
    expect(await svc.fallbackToNormalDispatch(50)).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });
  it("returns false for a normal order", async () => {
    prisma.free_booking_order.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.fallbackToNormalDispatch(50)).toBe(false);
  });
});

describe("lock and unlock", () => {
  it("unlockForReferral only flips a locked user", async () => {
    prisma.tbl_user.updateMany.mockResolvedValue({ count: 1 });
    expect(await svc.unlockForReferral(7)).toBe(true);
    expect(prisma.tbl_user.updateMany).toHaveBeenCalledWith({
      where: { id: 7, free_booking_locked: true },
      data: { free_booking_locked: false, free_booking_just_unlocked: true },
    });
  });
  it("unlockForReferral is a no-op for a user who is not locked", async () => {
    prisma.tbl_user.updateMany.mockResolvedValue({ count: 0 });
    expect(await svc.unlockForReferral(7)).toBe(false);
  });
  it("setUserLock(true) stamps locked_at; setUserLock(false) clears both flags", async () => {
    await svc.setUserLock(7, true);
    expect(prisma.tbl_user.update).toHaveBeenLastCalledWith({
      where: { id: 7 }, data: expect.objectContaining({ free_booking_locked: true, free_booking_just_unlocked: false, free_booking_locked_at: expect.any(Date) }),
    });
    await svc.setUserLock(7, false);
    expect(prisma.tbl_user.update).toHaveBeenLastCalledWith({
      where: { id: 7 }, data: { free_booking_locked: false, free_booking_just_unlocked: false },
    });
  });
});

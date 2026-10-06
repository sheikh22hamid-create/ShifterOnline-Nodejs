jest.mock("../../config/db", () => ({
  $queryRaw: jest.fn(),
  $transaction: jest.fn(),
  tbl_user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  free_booking_pool: { findMany: jest.fn() },
  free_booking_order: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
}));
jest.mock("../pricingEngine", () => ({ getActiveCustomerPlan: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue() }));
jest.mock("../customerInbox", () => ({ saveCustomerNotification: jest.fn().mockResolvedValue() }));
jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-06T10:00:00Z") }));

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
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
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

  it("is idempotent: an existing history row means no second credit", async () => {
    const tx = makeTx({ row: pendingRow(), duplicate: { id: 1 } });
    const out = await svc.tryCredit(50);
    expect(out.credited).toBe(false);
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("waits while the settlement is pending: nothing is written", async () => {
    const tx = makeTx({ row: pendingRow(), settlement: { status: "pending" } });
    expect(await svc.tryCredit(50)).toEqual({ credited: false, action: "wait" });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.free_booking_order.update).not.toHaveBeenCalled();
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
    await svc.recordAcceptance(50, 9);
    expect(prisma.free_booking_order.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { pool_rider_id: 9, accepted_in_pool: true } });
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

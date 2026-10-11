jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  driver_tier_penalty_counter: { upsert: jest.fn(), findUnique: jest.fn() },
  driver_tier_penalty: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-11T10:00:00Z") }));
jest.mock("../tieredDispatchSettings", () => ({ getTierSettings: jest.fn() }));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { REJECTED: "rejected", SKIPPED: "skipped", SUPERSEDED: "superseded", PENALTY: "penalty", PENALTY_WAIVED: "penalty_waived", COUNTER_RESET: "counter_reset" },
  logEvent: jest.fn().mockResolvedValue(null),
}));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue() }));
jest.mock("../pushNotifier", () => ({ notifyDriverTierPenalty: jest.fn().mockResolvedValue() }));

const { Prisma } = require("@prisma/client");
const prisma = require("../../config/db");
const settings = require("../tieredDispatchSettings");
const events = require("../driverOrderEventService");
const walletNotifier = require("../walletNotifier");
const pushNotifier = require("../pushNotifier");
const svc = require("../tierPenaltyService");

const ON = { tieredEnabled: true, penaltyEnabled: true, ladder: [5, 10, 20, 50, 100], cancelPenaltyPct: 100 };

function makeTx({ existing = null, misses = 1, total = 500, dutyLog = null, history = null, orderState = {} } = {}) {
  const tx = {
    driver_tier_penalty: {
      findFirst: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 70, ...data })),
    },
    pkg_order: { findUnique: jest.fn().mockResolvedValue({ total_dcharge: total, rid: 0, order_status: 0, o_status: "Pending", ...orderState }) },
    driver_tier_penalty_counter: { upsert: jest.fn().mockResolvedValue({ misses }) },
    daily_driver_duty_log: { findFirst: jest.fn().mockResolvedValue(dutyLog) },
    tbl_rider: { update: jest.fn().mockResolvedValue({}) },
    tbl_wallet_history: { create: jest.fn().mockResolvedValue({ id: 5 }), findFirst: jest.fn().mockResolvedValue(history) },
  };
  prisma.$transaction.mockImplementation(async (fn) => fn(tx));
  return tx;
}

beforeEach(() => {
  jest.clearAllMocks();
  settings.getTierSettings.mockResolvedValue(ON);
  prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "tok" });
  // The order is still open (unassigned, pending) unless a test says otherwise.
  prisma.pkg_order.findUnique.mockResolvedValue({ rid: 0, order_status: 0, o_status: "Pending" });
});

describe("onMiss", () => {
  it("an order someone else already took: no penalty, counter untouched, logged as superseded and not as a skip", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ rid: 14, order_status: 1, o_status: "Processing" });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" });
    expect(res).toEqual({ applied: false, ignored: true });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "superseded", tier: "free" }));
    expect(events.logEvent).not.toHaveBeenCalledWith(expect.objectContaining({ event: "skipped" }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("an order the customer cancelled is ignored the same way", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ rid: 0, order_status: 4, o_status: "Cancelled" });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "daily" });
    expect(res).toEqual({ applied: false, ignored: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("if the order is taken between the pre-check and the penalty transaction the counter still does not move", async () => {
    const tx = makeTx({ orderState: { rid: 14, order_status: 1, o_status: "Processing" } });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res).toMatchObject({ applied: false, ignored: true });
    expect(tx.driver_tier_penalty_counter.upsert).not.toHaveBeenCalled();
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("normal tier: logs the event, never penalises", async () => {
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: null });
    expect(res.applied).toBe(false);
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ tier: "normal", event: "skipped" }));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("penalties switched off: logs, no penalty", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, penaltyEnabled: false });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res.applied).toBe(false);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("free tier, first miss: 5% of the order total debited from the wallet at once", async () => {
    const tx = makeTx({ misses: 1, total: 500 });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" });
    expect(res).toMatchObject({ applied: true, missNo: 1, pct: 5, amount: 25, status: "collected" });
    expect(tx.driver_tier_penalty.create.mock.calls[0][0].data).toMatchObject({
      rider_id: 9, order_id: 50, tier: "free", kind: "miss", event: "skipped", miss_no: 1, pct: 5, base_amount: 500, amount: 25, status: "collected",
    });
    expect(tx.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 25 } } });
    expect(tx.tbl_wallet_history.create.mock.calls[0][0].data).toMatchObject({
      user_id: 9, amount: 25, type: "debit", wallet_type: "driver", order_id: 50, payment_id: "tier_penalty:50:9:miss",
    });
    expect(walletNotifier.notifyDriverWalletTransaction).toHaveBeenCalled();
    expect(pushNotifier.notifyDriverTierPenalty).toHaveBeenCalledWith("tok", expect.objectContaining({ amount: 25, pct: 5, nextPct: 10, deferred: false }));
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "penalty", penaltyPct: 5, penaltyAmount: 25, missNo: 1 }));
  });

  it("the 5th and later misses are 100%", async () => {
    makeTx({ misses: 5, total: 200 });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res).toMatchObject({ missNo: 5, pct: 100, amount: 200 });
    makeTx({ misses: 9, total: 200 });
    expect((await svc.onMiss({ orderId: 51, riderId: 9, event: "rejected", stage: "free" })).pct).toBe(100);
  });

  it("daily tier with a punched-in enrollment: deferred to settlement, wallet untouched", async () => {
    const tx = makeTx({ misses: 2, total: 400, dutyLog: { enrollment_id: 33 } });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "daily" });
    expect(res).toMatchObject({ applied: true, pct: 10, amount: 40, status: "pending_daily" });
    expect(tx.driver_tier_penalty.create.mock.calls[0][0].data.enrollment_id).toBe(33);
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
    expect(walletNotifier.notifyDriverWalletTransaction).not.toHaveBeenCalled();
    expect(pushNotifier.notifyDriverTierPenalty).toHaveBeenCalledWith("tok", expect.objectContaining({ deferred: true }));
  });

  it("a second event for the same offer (reject after timeout) adds no penalty and does not touch the counter", async () => {
    const tx = makeTx({ existing: { id: 70 } });
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "rejected", stage: "free" });
    expect(res).toMatchObject({ applied: false, duplicate: true });
    expect(tx.driver_tier_penalty_counter.upsert).not.toHaveBeenCalled();
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("a concurrent duplicate (unique violation) is reported as duplicate, not an error", async () => {
    prisma.$transaction.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" }));
    const res = await svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" });
    expect(res).toMatchObject({ applied: false, duplicate: true });
  });

  it("never throws on an unexpected failure", async () => {
    prisma.$transaction.mockRejectedValue(new Error("db down"));
    await expect(svc.onMiss({ orderId: 50, riderId: 9, event: "skipped", stage: "free" })).resolves.toMatchObject({ applied: false, error: true });
  });
});

describe("applyCancelPenalty", () => {
  it("charges the configured cancel percentage and does not use the ladder counter", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, cancelPenaltyPct: 40 });
    const tx = makeTx({ total: 300 });
    const res = await svc.applyCancelPenalty({ orderId: 50, riderId: 9, tier: "free" });
    expect(res).toMatchObject({ applied: true, pct: 40, amount: 120, status: "collected" });
    expect(tx.driver_tier_penalty_counter.upsert).not.toHaveBeenCalled();
    expect(tx.driver_tier_penalty.create.mock.calls[0][0].data).toMatchObject({ kind: "cancel", event: "cancel_approved", miss_no: null });
  });

  it("is skipped when penalties are off", async () => {
    settings.getTierSettings.mockResolvedValue({ ...ON, penaltyEnabled: false });
    expect(await svc.applyCancelPenalty({ orderId: 50, riderId: 9, tier: "free" })).toMatchObject({ applied: false });
  });
});

describe("previewForOffer", () => {
  it("is zero for the normal tier and when penalties are off", async () => {
    expect(await svc.previewForOffer({ riderId: 9, stage: null, order: { total_dcharge: 500 } })).toEqual({ pct: 0, amount: 0 });
    settings.getTierSettings.mockResolvedValue({ ...ON, penaltyEnabled: false });
    expect(await svc.previewForOffer({ riderId: 9, stage: "free", order: { total_dcharge: 500 } })).toEqual({ pct: 0, amount: 0 });
  });

  it("previews the NEXT miss: counter + 1", async () => {
    prisma.driver_tier_penalty_counter.findUnique.mockResolvedValue({ misses: 2 });
    expect(await svc.previewForOffer({ riderId: 9, stage: "free", order: { total_dcharge: 500 } })).toEqual({ pct: 20, amount: 100 });
    prisma.driver_tier_penalty_counter.findUnique.mockResolvedValue(null);
    expect(await svc.previewForOffer({ riderId: 9, stage: "daily", order: { total_dcharge: 500 } })).toEqual({ pct: 5, amount: 25 });
  });
});

describe("waive", () => {
  it("a collected penalty is credited back to the wallet once", async () => {
    const tx = {
      driver_tier_penalty: { findUnique: jest.fn().mockResolvedValue({ id: 70, rider_id: 9, order_id: 50, status: "collected", amount: 25, tier: "free" }), update: jest.fn().mockResolvedValue({}) },
      tbl_wallet_history: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      tbl_rider: { update: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    expect(await svc.waive({ penaltyId: 70, adminId: 1 })).toEqual({ waived: true });
    expect(tx.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 25 } } });
    expect(tx.tbl_wallet_history.create.mock.calls[0][0].data).toMatchObject({ type: "credit", payment_id: "tier_penalty_waive:70", amount: 25 });
    expect(tx.driver_tier_penalty.update.mock.calls[0][0].data).toMatchObject({ status: "waived", waived_by: 1 });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "penalty_waived" }));
  });

  it("a pending_daily penalty is just marked waived, no wallet change", async () => {
    const tx = {
      driver_tier_penalty: { findUnique: jest.fn().mockResolvedValue({ id: 71, rider_id: 9, order_id: 50, status: "pending_daily", amount: 40, tier: "daily" }), update: jest.fn().mockResolvedValue({}) },
      tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
      tbl_rider: { update: jest.fn() },
    };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    await svc.waive({ penaltyId: 71, adminId: 1 });
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
    expect(tx.driver_tier_penalty.update.mock.calls[0][0].data.status).toBe("waived");
  });

  it("waiving twice is a no-op, a missing penalty is a 404", async () => {
    const tx = { driver_tier_penalty: { findUnique: jest.fn().mockResolvedValue({ id: 70, status: "waived" }) } };
    prisma.$transaction.mockImplementation(async (fn) => fn(tx));
    expect(await svc.waive({ penaltyId: 70, adminId: 1 })).toEqual({ alreadyWaived: true });
    tx.driver_tier_penalty.findUnique.mockResolvedValue(null);
    await expect(svc.waive({ penaltyId: 99, adminId: 1 })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe("settlePendingForEnrollment", () => {
  it("collects every pending penalty of the enrollment from the wallet in one decrement and ledgers each", async () => {
    const tx = {
      driver_tier_penalty: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, order_id: 50, amount: 40, event: "skipped" },
          { id: 2, order_id: 51, amount: 60, event: "rejected" },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
      tbl_rider: { update: jest.fn().mockResolvedValue({}) },
      tbl_wallet_history: { create: jest.fn().mockResolvedValue({}) },
      daily_driver_ledger: { createMany: jest.fn().mockResolvedValue({}) },
    };
    const total = await svc.settlePendingForEnrollment(tx, { enrollmentId: 33, riderId: 9 });
    expect(total).toBe(100);
    expect(tx.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(tx.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 100 } } });
    expect(tx.driver_tier_penalty.update).toHaveBeenCalledTimes(2);
    expect(tx.daily_driver_ledger.createMany.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ rider_id: 9, enrollment_id: 33, order_id: 50, entry_type: "PENALTY_DEDUCTION", amount: 40, balance_effect: "DEBIT" }),
      expect.objectContaining({ rider_id: 9, enrollment_id: 33, order_id: 51, entry_type: "PENALTY_DEDUCTION", amount: 60, balance_effect: "DEBIT" }),
    ]);
  });

  it("does nothing when there are no pending penalties", async () => {
    const tx = { driver_tier_penalty: { findMany: jest.fn().mockResolvedValue([]) }, tbl_rider: { update: jest.fn() } };
    expect(await svc.settlePendingForEnrollment(tx, { enrollmentId: 33, riderId: 9 })).toBe(0);
    expect(tx.tbl_rider.update).not.toHaveBeenCalled();
  });
});

describe("resetCounter", () => {
  it("zeroes the rider's counter for the tier and logs it", async () => {
    prisma.driver_tier_penalty_counter.upsert.mockResolvedValue({});
    await svc.resetCounter({ riderId: 9, tier: "free", adminId: 1 });
    expect(prisma.driver_tier_penalty_counter.upsert).toHaveBeenCalledWith({
      where: { rider_id_tier: { rider_id: 9, tier: "free" } },
      update: { misses: 0 },
      create: { rider_id: 9, tier: "free", misses: 0 },
    });
    expect(events.logEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "counter_reset", riderId: 9 }));
  });
});

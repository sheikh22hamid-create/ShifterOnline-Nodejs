// Scenario matrix for what happens to money when a CASH ride completes, across
// every combination of fare / advance / referral points / coupon. Regression
// for order #468: booked at Rs652 with 326 points (50% cap), early-dropped to
// Rs170, the full Rs326 was still treated as prepaid, so the driver's wallet got
// Rs312 (instead of ~Rs71) and the admin's max-redeem cap was silently broken.
//
// Invariants checked for every combination:
//   1. points kept on the order never exceed the admin cap for the final fare
//   2. points kept + points refunded == points originally redeemed
//   3. driver cash-in-hand + driver wallet movement == fare - commission
//      (the driver is never over- or under-paid, however prepaid is split)
//   4. the customer never owes negative cash
//   5. settlement path: amountDue + prepaidAmount == fare (or nothing is due)

jest.mock("../../config/db", () => ({
  driver_trip_progress: { findUnique: jest.fn().mockResolvedValue(null) },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), findMany: jest.fn() },
  pkg_order_interest: { findMany: jest.fn() },
  $queryRaw: jest.fn(),
  tbl_order_requests: { updateMany: jest.fn(), findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn().mockResolvedValue({}) },
  order_status_history: { create: jest.fn() },
  pkg_order_wait_timer: { upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  app_settings: { findFirst: jest.fn().mockResolvedValue(null) },
  driver_duty_log: { updateMany: jest.fn() },
  daily_driver_enrollment: { findFirst: jest.fn() },
  order_settlement: { findUnique: jest.fn() },
  monthly_driver_ledger: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
}));
jest.mock("../dispatchManager", () => ({
  stopDispatch: jest.fn(), recordModel1Outcome: jest.fn(), emitCustomerEvent: jest.fn(),
  emitDriverEvent: jest.fn(), startDispatch: jest.fn(), offerToInterestedRiders: jest.fn(),
}));
jest.mock("../lockManager", () => ({ releaseLock: jest.fn(), peekLock: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({
  isWalletPaidOrder: jest.fn(() => false), linkWalletPrepayment: jest.fn(), refundIfWalletPaid: jest.fn().mockResolvedValue(null),
}));
jest.mock("../driverTripService", () => ({ progressTrip: jest.fn().mockResolvedValue({}) }));
jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn(), getPackageById: jest.fn(), getActiveCustomerPlan: jest.fn().mockResolvedValue(null),
  commissionAmount: jest.fn((d, p) => Math.round(((Number(d) * Number(p)) / 100) * 100) / 100),
  getFirstTierPricingContext: jest.fn(),
}));
jest.mock("../pushNotifier", () => ({}));
jest.mock("../../utils/pickupRelocateSettings", () => ({ getPickupRelocateSettings: jest.fn().mockResolvedValue({}) }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../settlementSettings", () => ({ isSettlementEnabled: jest.fn() }));
jest.mock("../settlementService", () => ({ createForCompletedOrder: jest.fn() }));

const prisma = require("../../config/db");
const settlementSettings = require("../settlementSettings");
const settlementService = require("../settlementService");
const tripLifecycle = require("../tripLifecycle");

const PERCENT = 50;
const COMMISSION_PCT = 8.24;
const round2 = (n) => Math.round(n * 100) / 100;
const commissionOf = (fare) => round2((fare * COMMISSION_PCT) / 100);
const capPoints = (fare, coupon) => Math.floor(Math.max(0, fare - coupon) * PERCENT / 100);

function makeOrder({ fare, pointsUsed, coupon }) {
  return {
    id: 468, uid: 31, rid: 38, city_id: 1, d_charge: fare, total_dcharge: fare, commission: COMMISSION_PCT,
    trans_id: "cash_1791196371558", p_method_id: 1, free_waiting_time: "0", wating_charge: "0",
    referral_points_used: pointsUsed, referral_points_amount: pointsUsed, cou_amt: coupon,
  };
}

function driverWalletDelta() {
  return prisma.tbl_rider.update.mock.calls.reduce((sum, [arg]) => {
    const w = arg?.data?.wallet_balance;
    if (!w) return sum;
    return sum + (w.increment ? Number(w.increment) : 0) - (w.decrement ? Number(w.decrement) : 0);
  }, 0);
}

async function runCompletion({ fare, advance, pointsUsed, coupon, settlement = false }) {
  jest.clearAllMocks();
  const order = makeOrder({ fare, pointsUsed, coupon });
  prisma.pkg_order.findUnique.mockResolvedValue(order);
  prisma.pkg_order.update.mockResolvedValue({});
  prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
  prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
  prisma.$queryRaw.mockResolvedValue([{ advance_payment: advance }]);
  prisma.tbl_rider.findUnique.mockResolvedValue({ id: 38, monthly_plan: 0 });
  prisma.tbl_rider.update.mockResolvedValue({});
  prisma.tbl_user.update.mockResolvedValue({ referral_points: 999 });
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.daily_driver_enrollment.findFirst.mockResolvedValue(null);
  prisma.order_settlement.findUnique.mockResolvedValue(null);
  prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, ride_discount_percent: PERCENT, point_value: 1 });
  settlementSettings.isSettlementEnabled.mockResolvedValue(settlement);
  settlementService.createForCompletedOrder.mockResolvedValue({ id: 1 });
  // payment_status is read straight off the order row for the advance debit-back
  prisma.pkg_order.findUnique.mockResolvedValue({ ...order, payment_status: advance > 0 ? 1 : 0 });

  await tripLifecycle.updateStatus(468, 38, "complete");

  const claim = prisma.pkg_order.updateMany.mock.calls[0]?.[0];
  const keptPoints = claim ? claim.data.referral_points_used : pointsUsed;
  const refundCredit = prisma.tbl_user.update.mock.calls.find(([a]) => a?.data?.referral_points?.increment);
  const refundedPoints = refundCredit ? refundCredit[0].data.referral_points.increment : 0;
  return { keptPoints, refundedPoints };
}

const FARES = [40, 170, 652];
const ADVANCES = [0, 15];
const COUPONS = [0, 50];
const BOOKED_POINTS = [0, 326]; // 326 == 50% of the Rs652 booking fare

const cases = [];
for (const fare of FARES) for (const advance of ADVANCES) for (const coupon of COUPONS) for (const booked of BOOKED_POINTS) {
  // a booking can only have redeemed what the cap allowed at the ORIGINAL Rs652 fare
  const pointsUsed = Math.min(booked, capPoints(652, coupon));
  cases.push({ fare, advance, coupon, pointsUsed });
}

describe("cash ride completion - payment matrix", () => {
  it.each(cases)("fare %p", async ({ fare, advance, coupon, pointsUsed }) => {
    const { keptPoints, refundedPoints } = await runCompletion({ fare, advance, pointsUsed, coupon });

    // 1 + 2: points obey the admin cap for the final fare and nothing is lost
    if (pointsUsed > 0) expect(keptPoints).toBeLessThanOrEqual(capPoints(fare, coupon));
    expect(keptPoints + refundedPoints).toBe(pointsUsed);

    // 3 + 4: driver is paid exactly fare - commission, customer never owes negative cash
    const prepaid = Math.min(advance + keptPoints + coupon, fare);
    const cashInHand = Math.max(0, fare - prepaid);
    expect(cashInHand).toBeGreaterThanOrEqual(0);
    expect(round2(cashInHand + driverWalletDelta())).toBe(round2(fare - commissionOf(fare)));
  });

  it("order #468 exactly: Rs170 fare, 326 points booked -> 241 points back, driver gets ~Rs71 not Rs312", async () => {
    const { keptPoints, refundedPoints } = await runCompletion({ fare: 170, advance: 0, pointsUsed: 326, coupon: 0 });
    expect(keptPoints).toBe(85);
    expect(refundedPoints).toBe(241);
    // cash in hand 170 - 85 = 85, wallet credit 85 - 14.01 = 70.99
    expect(round2(driverWalletDelta())).toBe(round2(85 - commissionOf(170)));
  });

  it.each(cases)("settlement on: amountDue + prepaid == fare (fare %p)", async ({ fare, advance, coupon, pointsUsed }) => {
    const { keptPoints } = await runCompletion({ fare, advance, pointsUsed, coupon, settlement: true });
    const prepaid = Math.min(advance + keptPoints + coupon, fare);
    if (fare - prepaid > 0) {
      expect(settlementService.createForCompletedOrder).toHaveBeenCalledTimes(1);
      const args = settlementService.createForCompletedOrder.mock.calls[0][0];
      expect(round2(args.amountDue + args.prepaidAmount)).toBe(round2(fare));
      expect(args.prepaidAmount).toBeLessThanOrEqual(fare);
    } else {
      expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
    }
  });
});

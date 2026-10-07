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
//   6. advance taken back from the customer's wallet never exceeds what the ride
//      needed after points/coupon (surplus advance stays with the customer)
//   7. customer pays the fare exactly once: advance applied + cash + points +
//      coupon == fare

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
  sumWalletPrepayment: jest.fn().mockResolvedValue(0),
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
  const walletDebit = prisma.tbl_user.update.mock.calls.find(([a]) => a?.data?.wallet?.decrement);
  const advanceDebitBack = walletDebit ? Number(walletDebit[0].data.wallet.decrement) : 0;
  return { keptPoints, refundedPoints, advanceDebitBack };
}

const FARES = [40, 170, 652];
const ADVANCES = [0, 15, 60]; // 60 is bigger than the Rs40 fare: advance can exceed the fare
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
    const { keptPoints, refundedPoints, advanceDebitBack } = await runCompletion({ fare, advance, pointsUsed, coupon });

    // 1 + 2: points obey the admin cap for the final fare and nothing is lost
    if (pointsUsed > 0) expect(keptPoints).toBeLessThanOrEqual(capPoints(fare, coupon));
    expect(keptPoints + refundedPoints).toBe(pointsUsed);

    // 3 + 4: driver is paid exactly fare - commission, customer never owes negative cash
    const prepaid = Math.min(advance + keptPoints + coupon, fare);
    const cashInHand = Math.max(0, fare - prepaid);
    expect(cashInHand).toBeGreaterThanOrEqual(0);
    expect(round2(cashInHand + driverWalletDelta())).toBe(round2(fare - commissionOf(fare)));

    // 6 + 7: the customer pays the fare exactly once. Advance taken back out of
    // their wallet + cash + points + coupon == fare, and an advance bigger than
    // what the ride needed is never taken in full (the surplus stays in the wallet).
    expect(advanceDebitBack).toBeLessThanOrEqual(advance);
    const pointsAndCoupon = Math.min(keptPoints + coupon, fare);
    expect(round2(advanceDebitBack + cashInHand + pointsAndCoupon)).toBe(fare);
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

// Wallet-paid rides (p_method_id -2, trans_id "wallet_*"): the customer's wallet
// was debited the fare at booking, so the platform holds the money and the
// driver collects NO cash. Before this fix nothing ever credited the driver
// (orders #424, #392, #391 ... all had zero driver wallet credit), so drivers
// were never paid for wallet-paid rides.
describe("wallet-paid ride completion", () => {
  const walletPrepayment = require("../walletPrepaymentRefund");

  async function runWalletCompletion({ fare = 347, commission = 8.07, monthly = 0, daily = false, advance = 0, replay = false, walletPaidIn = 0, topupDone = false } = {}) {
    jest.clearAllMocks();
    walletPrepayment.isWalletPaidOrder.mockReturnValue(true);
    walletPrepayment.sumWalletPrepayment.mockResolvedValue(walletPaidIn);
    const order = {
      id: 424, uid: 31, rid: 38, city_id: 1, d_charge: fare, total_dcharge: fare, commission,
      trans_id: "wallet_1791137609444", p_method_id: -2, free_waiting_time: "0", wating_charge: "0",
      referral_points_used: 0, referral_points_amount: 0, cou_amt: 0, payment_status: advance > 0 ? 1 : 0,
    };
    prisma.pkg_order.findUnique.mockResolvedValue(order);
    prisma.pkg_order.update.mockResolvedValue({});
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: advance }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 38, monthly_plan: monthly });
    prisma.tbl_rider.update.mockResolvedValue({});
    prisma.tbl_wallet_history.findFirst.mockImplementation(async ({ where }) =>
      (where.payment_id.startsWith("wallet_order_topup") ? (topupDone ? { id: 2 } : null) : (replay ? { id: 1 } : null)));
    prisma.tbl_user.update.mockResolvedValue({});
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, ride_discount_percent: PERCENT, point_value: 1 });
    prisma.daily_driver_enrollment.findFirst.mockResolvedValue(daily ? { id: 4 } : null);
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    settlementSettings.isSettlementEnabled.mockResolvedValue(true);
    await tripLifecycle.updateStatus(424, 38, "complete");
    walletPrepayment.isWalletPaidOrder.mockReturnValue(false);
  }

  it("credits the driver fare - commission, once, and creates no cash settlement", async () => {
    await runWalletCompletion();
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 38 }, data: { wallet_balance: { increment: round2(347 - commissionOfPct(347, 8.07)) } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 38, type: "credit", wallet_type: "driver", order_id: 424, payment_id: "wallet_order_credit:424",
        amount: round2(347 - commissionOfPct(347, 8.07)),
      }),
    });
    expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
  });

  it("is idempotent: a retried complete never credits twice", async () => {
    await runWalletCompletion({ replay: true });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("credits nothing extra for a Monthly Driver or an exempt Daily Driver (they have their own ledger)", async () => {
    await runWalletCompletion({ monthly: 1 });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    await runWalletCompletion({ daily: true });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("zero commission still pays the driver the whole fare", async () => {
    await runWalletCompletion({ fare: 40, commission: 0 });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 38 }, data: { wallet_balance: { increment: 40 } } });
  });

  it("fare went up after booking: the extra is taken from the customer's wallet, once, and the driver is paid the new fare", async () => {
    await runWalletCompletion({ fare: 400, commission: 8, walletPaidIn: 347 }); // booked at 347, now 400
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 31 }, data: { wallet: { decrement: 53 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 31, type: "debit", wallet_type: "user", amount: 53, payment_id: "wallet_order_topup:424" }),
    });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 38 }, data: { wallet_balance: { increment: round2(400 - commissionOfPct(400, 8)) } } });
  });

  it("no extra wallet debit when the booking payment already covered the fare", async () => {
    await runWalletCompletion({ fare: 347, commission: 8, walletPaidIn: 347 });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("no extra wallet debit after an early drop (customer paid more than the new fare)", async () => {
    await runWalletCompletion({ fare: 170, commission: 8, walletPaidIn: 347 });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("extra-fare debit is idempotent on a retried complete", async () => {
    await runWalletCompletion({ fare: 400, commission: 8, walletPaidIn: 347, topupDone: true });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("booking debit never linked to the order (paid amount unknown): no wallet debit", async () => {
    await runWalletCompletion({ fare: 400, commission: 8, walletPaidIn: 0 });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("a cash order is untouched by the wallet branch", async () => {
    await runCompletion({ fare: 170, advance: 0, pointsUsed: 0, coupon: 0 });
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ payment_id: expect.stringContaining("wallet_order_credit") }) });
  });
});

function commissionOfPct(fare, pct) {
  return round2((fare * pct) / 100);
}


describe("advance payment adjustment at completion", () => {
  async function completeWith({ fare, advance, paymentStatus = 1, razorpayId = null, applied = false, appliedAmount = null, pointsUsed = 0 }) {
    jest.clearAllMocks();
    const order = { ...makeOrder({ fare, pointsUsed, coupon: 0 }), payment_status: paymentStatus, razorpay_payment_id: razorpayId };
    prisma.pkg_order.findUnique.mockResolvedValue(order);
    prisma.pkg_order.update.mockResolvedValue({});
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([{ advance_payment: advance }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 38, monthly_plan: 0 });
    prisma.tbl_rider.update.mockResolvedValue({});
    prisma.tbl_user.update.mockResolvedValue({ referral_points: 999 });
    prisma.tbl_wallet_history.findFirst.mockImplementation(async ({ where }) =>
      (where.payment_id === "advance_apply:468" && applied ? { id: 7, ...(appliedAmount != null ? { amount: appliedAmount } : {}) } : null));
    prisma.daily_driver_enrollment.findFirst.mockResolvedValue(null);
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ referral_enabled: true, ride_discount_percent: PERCENT, point_value: 1 });
    settlementSettings.isSettlementEnabled.mockResolvedValue(false);
    await tripLifecycle.updateStatus(468, 38, "complete");
    const walletDebits = prisma.tbl_user.update.mock.calls.filter(([a]) => a?.data?.wallet?.decrement).map(([a]) => a.data.wallet.decrement);
    const historyDebit = prisma.tbl_wallet_history.create.mock.calls.map(([a]) => a.data).find((d) => d.payment_id === "advance_apply:468");
    const walletCredits = prisma.tbl_user.update.mock.calls.filter(([a]) => a?.data?.wallet?.increment).map(([a]) => a.data.wallet.increment);
    return { walletDebits, historyDebit, walletCredits };
  }

  it("advance already debited at payment time (paid from the wallet): completion does not debit it again", async () => {
    const { walletDebits, walletCredits } = await completeWith({ fare: 170, advance: 100, applied: true, appliedAmount: 100 });
    expect(walletDebits).toEqual([]);
    expect(walletCredits).toEqual([]); // the whole Rs100 was needed by the Rs170 ride, no surplus
  });

  it("wallet-paid advance bigger than the fare: the surplus is handed back, once", async () => {
    const { walletDebits, walletCredits } = await completeWith({ fare: 40, advance: 60, applied: true, appliedAmount: 60 });
    expect(walletDebits).toEqual([]);
    expect(walletCredits).toEqual([20]); // Rs60 debited at payment, only Rs40 needed
  });

  it("normal ride: the whole advance is applied to the fare and taken back from the customer's wallet once", async () => {
    const { walletDebits, historyDebit } = await completeWith({ fare: 170, advance: 15 });
    expect(walletDebits).toEqual([15]);
    expect(historyDebit).toMatchObject({ amount: 15, type: "debit", wallet_type: "user", order_id: 468 });
    expect(driverWalletDelta()).toBeCloseTo(15 - commissionOf(170) > 0 ? 15 - commissionOf(170) : -(commissionOf(170) - 15), 2);
  });

  it("advance bigger than the fare: only the fare is applied, the surplus stays in the customer's wallet", async () => {
    const { walletDebits, historyDebit } = await completeWith({ fare: 40, advance: 60 });
    expect(walletDebits).toEqual([40]);
    expect(historyDebit.amount).toBe(40);
    expect(historyDebit.remark).toMatch(/surplus advance/);
    // driver collects nothing in cash and is credited fare - commission
    expect(round2(driverWalletDelta())).toBe(round2(40 - commissionOf(40)));
  });

  it("advance + points: the advance is trimmed first, never the platform-absorbed points", async () => {
    // Rs60 fare, booked points 30 (50% cap), Rs50 advance -> advance applied = 60 - 30 = 30
    const { walletDebits } = await completeWith({ fare: 60, advance: 50, pointsUsed: 30 });
    expect(walletDebits).toEqual([30]);
  });

  it("a retried complete never takes the advance back twice", async () => {
    const { walletDebits } = await completeWith({ fare: 170, advance: 15, applied: true });
    expect(walletDebits).toEqual([]);
  });

  it("no advance due: nothing is taken from the customer's wallet", async () => {
    const { walletDebits } = await completeWith({ fare: 170, advance: 0, paymentStatus: 0 });
    expect(walletDebits).toEqual([]);
  });

  it("advance never captured (payment_status 0, no gateway id): it is NOT treated as collected", async () => {
    const { walletDebits } = await completeWith({ fare: 170, advance: 15, paymentStatus: 0 });
    expect(walletDebits).toEqual([]);
    // driver collects the FULL fare in cash and owes only commission - no platform-funded credit
    expect(round2(driverWalletDelta())).toBe(round2(-commissionOf(170)));
  });

  it("advance captured through a legacy path (gateway id stored, flag still 0) still counts", async () => {
    const { walletDebits } = await completeWith({ fare: 170, advance: 15, paymentStatus: 0, razorpayId: "pay_legacy" });
    expect(walletDebits).toEqual([15]);
  });
});

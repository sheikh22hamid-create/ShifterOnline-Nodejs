// Cancel x advance x payment-method x referral-points matrix for every cancel
// path that moves money (customer cancel, driver cancel, OTP no-show).
//
// Invariants, for every combination:
//   1. referral points are handed back exactly once (and not at all when none
//      were used)
//   2. the customer's wallet is only ever debited the cancellation charge: never
//      the advance (it is the customer's own money, already in their wallet),
//      never more than the charge, never anything on a driver-fault cancel
//   3. an unpaid advance means a customer-side cancel is free
//   4. a wallet-paid fare is always routed through refundIfWalletPaid
//   5. retrying the same cancel moves no further money
jest.mock("../referralPointsRefund", () => ({
  ...jest.requireActual("../referralPointsRefund"),
  reconcileRideDiscountToFare: jest.fn().mockResolvedValue({}),
}));
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
  tbl_referral_point_log: { create: jest.fn().mockResolvedValue({}) },
  order_status_history: { create: jest.fn() },
  pkg_order_wait_timer: { upsert: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
  app_settings: { findFirst: jest.fn().mockResolvedValue(null) },
}));
jest.mock("../dispatchManager", () => ({
  stopDispatch: jest.fn(), recordModel1Outcome: jest.fn(), emitCustomerEvent: jest.fn(),
  emitDriverEvent: jest.fn(), startDispatch: jest.fn(), offerToInterestedRiders: jest.fn(),
}));
jest.mock("../lockManager", () => ({ releaseLock: jest.fn(), peekLock: jest.fn() }));
jest.mock("../bookingGuaranteeService", () => ({
  closeOnAssign: jest.fn().mockResolvedValue(true),
  closeOnCancel: jest.fn().mockResolvedValue(true),
}));
jest.mock("../walletPrepaymentRefund", () => ({
  isWalletPaidOrder: jest.fn(() => false), linkWalletPrepayment: jest.fn(), refundIfWalletPaid: jest.fn().mockResolvedValue(null),
  sumWalletPrepayment: jest.fn().mockResolvedValue(0),
}));
jest.mock("../walletNotifier", () => ({
  notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined),
  notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../driverTripService", () => ({ progressTrip: jest.fn().mockResolvedValue({}) }));
jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn(), getPackageById: jest.fn(), getActiveCustomerPlan: jest.fn().mockResolvedValue(null),
  commissionAmount: jest.fn(), getFirstTierPricingContext: jest.fn(),
}));
jest.mock("../pushNotifier", () => new Proxy({}, { get: () => jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../../utils/pickupRelocateSettings", () => ({
  getPickupRelocateSettings: jest.fn().mockResolvedValue({ ceilingMinutes: 35, smallMoveThresholdM: 200, otpMismatchFlagM: 500, driverCompensation: 0 }),
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../pricingEngine");
const walletPrepayment = require("../walletPrepaymentRefund");
const tripLifecycle = require("../tripLifecycle");

const CHARGE = 50; // cancellation_charge_customer
const ADVANCE = 60; // deliberately different from the charge
const FARE_PAID = 347; // wallet-paid booking debit

const customerDebits = () => prisma.tbl_user.update.mock.calls.filter(([a]) => a?.data?.wallet?.decrement).map(([a]) => Number(a.data.wallet.decrement));
const customerCredits = () => prisma.tbl_user.update.mock.calls.filter(([a]) => a?.data?.wallet?.increment).map(([a]) => Number(a.data.wallet.increment));
const pointRefunds = () => prisma.tbl_user.update.mock.calls.filter(([a]) => a?.data?.referral_points?.increment).map(([a]) => Number(a.data.referral_points.increment));
const sum = (a) => a.reduce((x, y) => x + y, 0);

function orderRow({ walletPaid, points, advanceState }) {
  return {
    id: 297, uid: 7, rid: 11, delivery_type: 6,
    p_method_id: walletPaid ? -2 : 1, trans_id: walletPaid ? "wallet_1" : "cash_1",
    advance_payment: advanceState === "none" ? "0" : String(ADVANCE),
    payment_status: advanceState === "paid" ? 1 : 0,
    razorpay_payment_id: advanceState === "paid" ? "pay_1" : null,
    referral_points_used: points,
    order_status: 2, o_status: "Pickup",
  };
}

function baseMocks(row, walletPaid) {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (arg) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  prisma.pkg_order.findFirst.mockResolvedValue(row);
  prisma.pkg_order.findUnique.mockResolvedValue(row);
  prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
  prisma.pkg_order.update.mockResolvedValue({});
  prisma.$queryRaw.mockResolvedValue([row]);
  prisma.$executeRaw.mockResolvedValue(1);
  prisma.tbl_user.update.mockResolvedValue({ referral_points: 99, wallet: 100 });
  prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: null });
  prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: null });
  prisma.tbl_rider.update.mockResolvedValue({});
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
  prisma.order_status_history.create.mockResolvedValue({});
  prisma.pkg_order_wait_timer.updateMany.mockResolvedValue({ count: 1 });
  pricingEngine.getPackageById.mockResolvedValue({
    cancellation_charge_customer: CHARGE, cancellation_charge_driver: 0, driver_cancel_user_earning: 0, driver_earning: 0,
  });
  pricingEngine.getActiveCustomerPlan.mockResolvedValue(null);
  walletPrepayment.refundIfWalletPaid.mockResolvedValue(walletPaid ? { refunded: FARE_PAID - CHARGE, paid: FARE_PAID } : null);
}

const COMBOS = [];
for (const walletPaid of [false, true]) {
  for (const points of [0, 40]) {
    for (const advanceState of ["none", "unpaid", "paid"]) {
      // a wallet-paid booking never carries an advance (finalizeAcceptedOrder zeroes it)
      if (walletPaid && advanceState !== "none") continue;
      COMBOS.push({ walletPaid, points, advanceState });
    }
  }
}

describe.each(COMBOS)("cancel payment matrix %j", (combo) => {
  const { walletPaid, points, advanceState } = combo;

  it("customer cancels after a driver accepted", async () => {
    const row = orderRow(combo);
    baseMocks(row, walletPaid);
    await tripLifecycle.customerCancel(7, 297, "changed my mind");

    expect(pointRefunds()).toEqual(points > 0 ? [points] : []); // 1
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledTimes(1); // 4
    const debits = customerDebits();
    expect(debits).not.toContain(ADVANCE); // 2
    expect(sum(debits)).toBeLessThanOrEqual(CHARGE);
    if (advanceState === "unpaid") expect(sum(debits)).toBe(0); // 3
    else if (walletPaid) expect(sum(debits)).toBe(0); // netted inside the refund credit
    else expect(sum(debits)).toBe(CHARGE);
    if (walletPaid) expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledWith(row, { deduct: CHARGE });

    // 5. a retry (the cancel UPDATE matches no row any more) moves nothing
    const before = prisma.tbl_user.update.mock.calls.length;
    prisma.$executeRaw.mockResolvedValue(0);
    expect(await tripLifecycle.customerCancel(7, 297, "again")).toEqual({ success: false, msg: "Order cannot be cancelled" });
    expect(prisma.tbl_user.update.mock.calls.length).toBe(before);
  });

  it("driver cancels (driver's fault)", async () => {
    const row = orderRow(combo);
    baseMocks(row, walletPaid);
    await tripLifecycle.driverCancel(297, 11, "breakdown");

    expect(pointRefunds()).toEqual(points > 0 ? [points] : []); // 1
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledTimes(1); // 4
    expect(customerDebits()).toEqual([]); // 2: never charged for the driver's cancel
    expect(customerCredits()).toEqual([]); // the advance already sits in the wallet - not credited twice
    if (walletPaid) expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledWith(expect.objectContaining({ id: 297 }), { note: "driver cancelled" });

    // 5. retry on the already cancelled order
    const before = prisma.tbl_user.update.mock.calls.length;
    prisma.$queryRaw.mockResolvedValue([{ ...row, rid: 0, order_status: 4, o_status: "Cancelled" }]);
    await tripLifecycle.driverCancel(297, 11, "again");
    expect(prisma.tbl_user.update.mock.calls.length).toBe(before);
  });

  it("customer no-show at pickup (OTP timeout)", async () => {
    if (advanceState === "unpaid") return; // a driver cannot be at pickup while the advance is unpaid
    const row = orderRow(combo);
    baseMocks(row, walletPaid);
    await tripLifecycle.cancelOverduePickup(297, 11);

    expect(pointRefunds()).toEqual(points > 0 ? [points] : []); // 1
    expect(walletPrepayment.refundIfWalletPaid).toHaveBeenCalledTimes(1); // 4
    const debits = customerDebits();
    expect(debits).not.toContain(ADVANCE); // 2
    expect(sum(debits)).toBeLessThanOrEqual(CHARGE);
    expect(sum(debits)).toBe(walletPaid ? 0 : CHARGE);

    const before = prisma.tbl_user.update.mock.calls.length;
    prisma.$executeRaw.mockResolvedValue(0);
    await tripLifecycle.cancelOverduePickup(297, 11);
    expect(prisma.tbl_user.update.mock.calls.length).toBe(before); // 5
  });
});

describe("advance-payment timeout cancel", () => {
  it.each([0, 40])("unpaid advance, points %p: the customer is never charged and points come back once", async (points) => {
    const row = { ...orderRow({ walletPaid: false, points, advanceState: "unpaid" }), accept_time: new Date(Date.now() - 600000), order_status: 1 };
    baseMocks(row, false);
    await tripLifecycle.cancelExpiredAdvancePayment(297);
    expect(customerDebits()).toEqual([]);
    expect(pointRefunds()).toEqual(points > 0 ? [points] : []);
  });

  it("an advance paid in the meantime is not cancelled (the guarded UPDATE matches no row)", async () => {
    const row = orderRow({ walletPaid: false, points: 40, advanceState: "paid" });
    baseMocks(row, false);
    prisma.$executeRaw.mockResolvedValue(0);
    await tripLifecycle.cancelExpiredAdvancePayment(297);
    expect(pointRefunds()).toEqual([]);
    expect(customerDebits()).toEqual([]);
  });
});

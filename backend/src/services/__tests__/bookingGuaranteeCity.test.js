jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  booking_guarantee_case: { findUnique: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  booking_guarantee_audit: { create: jest.fn().mockResolvedValue({}) },
  tbl_package: { findMany: jest.fn() },
  pkg_order: { findUnique: jest.fn(), updateMany: jest.fn() },
  order_status_history: { create: jest.fn().mockResolvedValue({}) },
  tbl_user: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_referral: { count: jest.fn() },
}));
jest.mock("../bookingGuaranteeSettings", () => ({ getAssignWindowMinutes: jest.fn().mockResolvedValue(15) }));
jest.mock("../orderSearchSettings", () => ({ getCitySettings: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn() }));
jest.mock("../walletPrepaymentRefund", () => ({ refundIfWalletPaid: jest.fn().mockResolvedValue(null) }));
jest.mock("../referralPointsRefund", () => ({ refundReferralPointsForOrder: jest.fn().mockResolvedValue(0) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn(), notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const orderSearchSettings = require("../orderSearchSettings");
const settings = require("../bookingGuaranteeSettings");
const adminSocket = require("../../sockets/adminSocket");
const svc = require("../bookingGuaranteeService");

const order = { id: 500, uid: 7, city_id: 3, rid: 0, order_status: 0 };
const city = (extra = {}) => ({
  searchSystem: 2, searchRadiusKm: null, driverSearchSeconds: 60, guaranteeEnabled: true, adminWindowMinutes: null, guaranteeReferralsRequired: 1, ...extra,
});
const caseRow = (o = {}) => ({
  id: 1, order_id: 500, uid: 7, status: "open", selected_package_ids: "[10]", compensation_package_id: 10,
  compensation_amount: "100.00", deadline_at: new Date("2026-10-12T10:00:00Z"), wallet_history_id: null, refunds_done_at: null, ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.booking_guarantee_audit.create.mockResolvedValue({});
  prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: false });
  orderSearchSettings.getCitySettings.mockResolvedValue(city());
});

describe("openForExhaustedOrder: city gating", () => {
  beforeEach(() => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(null);
    prisma.tbl_package.findMany.mockResolvedValue([{ id: 10, sort_order: 1, no_driver_compensation: "100.00" }]);
    prisma.booking_guarantee_case.create.mockImplementation(async ({ data }) => ({ id: 1, ...data }));
  });

  it("does not open a case when the city has the guarantee off", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ guaranteeEnabled: false }));
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(false);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
    expect(orderSearchSettings.getCitySettings).toHaveBeenCalledWith(3);
  });

  it("does not open a case for a guarantee-locked customer", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ guarantee_locked: true });
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(false);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("uses the city's admin window when set", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ adminWindowMinutes: 30 }));
    const before = Date.now();
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    const created = prisma.booking_guarantee_case.create.mock.calls[0][0].data;
    expect(Math.round((created.deadline_at.getTime() - before) / 60000)).toBe(30);
    expect(settings.getAssignWindowMinutes).not.toHaveBeenCalled();
  });

  it("falls back to the global window when the city has none", async () => {
    const before = Date.now();
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    const created = prisma.booking_guarantee_case.create.mock.calls[0][0].data;
    expect(Math.round((created.deadline_at.getTime() - before) / 60000)).toBe(15);
  });

  it("still returns true for a case that is already open", async () => {
    prisma.booking_guarantee_case.findUnique.mockResolvedValue({ status: "open" });
    expect(await svc.openForExhaustedOrder(order, [10])).toBe(true);
    expect(prisma.booking_guarantee_case.create).not.toHaveBeenCalled();
  });
});

describe("expireCase: the lock", () => {
  function arrangeExpiry(amount) {
    prisma.booking_guarantee_case.updateMany.mockResolvedValue({ count: 1 });
    prisma.booking_guarantee_case.findUnique.mockResolvedValue(caseRow({ compensation_amount: amount }));
    prisma.pkg_order.updateMany.mockResolvedValue({ count: 1 });
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, city_id: 3 });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 7 });
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 99 });
    prisma.booking_guarantee_case.update.mockResolvedValue({});
  }

  it("locks the customer in the same step as a compensation credit", async () => {
    arrangeExpiry("100.00");
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { wallet: { increment: 100 }, guarantee_locked: true, guarantee_locked_at: expect.any(Date) },
    });
  });

  it("does not lock the customer when the compensation is zero", async () => {
    arrangeExpiry("0.00");
    await svc.expireCase(1);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("unlockForReferral", () => {
  const lockedAt = new Date("2026-10-12T09:00:00Z");
  beforeEach(() => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, guarantee_locked: true, guarantee_locked_at: lockedAt });
    prisma.tbl_user.updateMany.mockResolvedValue({ count: 1 });
  });

  it("does nothing for a customer who is not locked", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 3, guarantee_locked: false, guarantee_locked_at: null });
    expect(await svc.unlockForReferral(7)).toBe(false);
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
  });

  it("unlocks once enough referrals completed after the lock", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ guaranteeReferralsRequired: 2 }));
    prisma.tbl_referral.count.mockResolvedValue(2);
    expect(await svc.unlockForReferral(7)).toBe(true);
    expect(prisma.tbl_referral.count).toHaveBeenCalledWith({
      where: { referrer_id: 7, referrer_type: "USER", status: "completed", verified_at: { gte: lockedAt } },
    });
    expect(prisma.tbl_user.updateMany).toHaveBeenCalledWith({ where: { id: 7, guarantee_locked: true }, data: { guarantee_locked: false } });
  });

  it("stays locked while the count is below the city's requirement", async () => {
    orderSearchSettings.getCitySettings.mockResolvedValue(city({ guaranteeReferralsRequired: 2 }));
    prisma.tbl_referral.count.mockResolvedValue(1);
    expect(await svc.unlockForReferral(7)).toBe(false);
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
  });
});

describe("setUserLock", () => {
  it("locks with a timestamp", async () => {
    await svc.setUserLock(7, true);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { guarantee_locked: true, guarantee_locked_at: expect.any(Date) },
    });
  });

  it("unlocks", async () => {
    await svc.setUserLock(7, false);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { guarantee_locked: false } });
  });
});

jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn() },
  tbl_user: { findUnique: jest.fn() },
  customise_order: { update: jest.fn() },
  customise_dismissal: { upsert: jest.fn() },
  customise_event: { create: jest.fn(), count: jest.fn() },
  customise_cancel_fee: { create: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), emitDriverEvent: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyCustomerCustomiseRelisted: jest.fn().mockResolvedValue() }));
jest.mock("../customiseOrderService", () => ({ notifyEligible: jest.fn().mockResolvedValue(1), logEvent: jest.fn().mockResolvedValue() }));
jest.mock("../customiseCancelPolicy", () => ({ getPolicy: jest.fn(), penaltyOf: jest.requireActual("../customiseCancelPolicy").penaltyOf }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const orderService = require("../customiseOrderService");
const policy = require("../customiseCancelPolicy");
const svc = require("../customiseCancelService");

const NOW = new Date("2026-10-27T12:00:00Z");
const ORDER = { id: 5, uid: 7, city_id: 3, status: "converted", pkg_order_id: 321, agreed_rider_id: 11, agreed_fare: 1000, expires_at: new Date("2026-10-27T20:00:00Z") };

beforeEach(() => {
  jest.resetAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([ORDER]);
  prisma.customise_event.count.mockResolvedValue(1);
  prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "tok" });
  orderService.notifyEligible.mockResolvedValue(1);
  orderService.logEvent.mockResolvedValue();
});

describe("rideInfo", () => {
  it("is null for an ordinary ride", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ customise_order_id: null, total_dcharge: 100, city_id: 3 });
    expect(await svc.rideInfo(321)).toBeNull();
  });
  it("returns the Customise link, agreed fare and city for a Customise ride", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ customise_order_id: 5, total_dcharge: "1000", city_id: 3 });
    expect(await svc.rideInfo(321)).toEqual({ customiseOrderId: 5, agreedFare: 1000, cityId: 3 });
  });
  it("is null (normal handling) when the ride cannot be read", async () => {
    prisma.pkg_order.findUnique.mockRejectedValue(new Error("db"));
    expect(await svc.rideInfo(321)).toBeNull();
  });
});

describe("feeFor", () => {
  const ride = { customiseOrderId: 5, agreedFare: 1000, cityId: 3 };
  it("says 'use the rate-card fee' for a Normal policy", async () => {
    policy.getPolicy.mockResolvedValue({ mode: "normal", fixed: 0, percent: 0, adminSharePercent: 0 });
    expect(await svc.feeFor({ side: "driver", ride })).toEqual({ special: false });
  });
  it("computes the Special charge and its split", async () => {
    policy.getPolicy.mockResolvedValue({ mode: "special", fixed: 50, percent: 10, adminSharePercent: 20 });
    expect(await svc.feeFor({ side: "customer", ride })).toMatchObject({ special: true, charge: 150, adminShare: 30, recipientAmount: 120, fixed: 50, percent: 10 });
    expect(policy.getPolicy).toHaveBeenCalledWith("customer", 3);
  });
});

describe("recordFee", () => {
  const row = { orderId: 5, rideId: 321, side: "driver", mode: "special", payerId: 11, recipientId: 7, agreedFare: 1000, fixed: 50, percent: 10, charge: 150, adminShare: 30, recipientAmount: 120, reason: "x" };
  it("writes one audit row", async () => {
    await svc.recordFee(prisma, row);
    expect(prisma.customise_cancel_fee.create.mock.calls[0][0].data).toMatchObject({ order_id: 5, ride_id: 321, side: "driver", charge: 150, admin_share: 30, recipient_amount: 120 });
  });
  it("ignores a repeat for the same ride and side", async () => {
    prisma.customise_cancel_fee.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(svc.recordFee(prisma, row)).resolves.toBeUndefined();
  });
});

describe("afterDriverCancel", () => {
  const args = { customiseOrderId: 5, riderId: 11, rideId: 321, now: NOW };

  it("reopens the order, keeps the cancelling driver out, and tells the customer and the other drivers", async () => {
    const out = await svc.afterDriverCancel(args);
    expect(out).toEqual({ ok: true, relisted: true });
    await new Promise((resolve) => setImmediate(resolve)); // the customer/driver notifications run after the cancel returns
    expect(prisma.customise_dismissal.upsert).toHaveBeenCalledWith({ where: { order_id_rider_id: { order_id: 5, rider_id: 11 } }, create: { order_id: 5, rider_id: 11 }, update: {} });
    expect(prisma.customise_order.update).toHaveBeenCalledWith({
      where: { id: 5 }, data: { status: "open", agreed_fare: null, agreed_rider_id: null, agreed_offer_id: null, pkg_order_id: null },
    });
    expect(orderService.logEvent).toHaveBeenCalledWith(prisma, 5, "driver_cancelled", 11, expect.objectContaining({ pkg_order_id: 321, relisted: true }));
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "customise:relisted", { order_id: 5 });
    expect(orderService.notifyEligible).toHaveBeenCalledWith(expect.objectContaining({ id: 5, status: "open" }), { now: NOW, round: 1 });
  });

  it("does not relist an order whose expiry has passed; it expires instead", async () => {
    const out = await svc.afterDriverCancel({ ...args, now: new Date("2026-10-27T20:00:00Z") });
    expect(out).toEqual({ ok: true, relisted: false });
    expect(prisma.customise_order.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: "expired" } });
    expect(orderService.notifyEligible).not.toHaveBeenCalled();
  });

  it("is a no-op the second time (double tap) and for a ride that is not the order's current one", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, status: "open", pkg_order_id: null, agreed_rider_id: null }]);
    expect(await svc.afterDriverCancel(args)).toEqual({ ok: false, relisted: false });
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, pkg_order_id: 999 }]);
    expect(await svc.afterDriverCancel(args)).toEqual({ ok: false, relisted: false });
    expect(prisma.customise_order.update).not.toHaveBeenCalled();
  });

  it("never relists an order the customer already cancelled", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, status: "cancelled" }]);
    expect(await svc.afterDriverCancel(args)).toEqual({ ok: false, relisted: false });
  });

  it("never throws, even when the database fails", async () => {
    prisma.$transaction.mockRejectedValue(new Error("db"));
    await expect(svc.afterDriverCancel(args)).resolves.toEqual({ ok: false, relisted: false });
  });
});

describe("afterCustomerCancel", () => {
  it("closes the order for good; it is never relisted", async () => {
    const out = await svc.afterCustomerCancel({ customiseOrderId: 5, rideId: 321, now: NOW });
    expect(out).toEqual({ ok: true });
    expect(prisma.customise_order.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: "cancelled" } });
    expect(orderService.logEvent).toHaveBeenCalledWith(prisma, 5, "customer_cancelled_after_assignment", 11, expect.objectContaining({ pkg_order_id: 321 }));
    expect(orderService.notifyEligible).not.toHaveBeenCalled();
  });
  it("ignores a ride that is not the order's current one", async () => {
    prisma.$queryRaw.mockResolvedValue([{ ...ORDER, pkg_order_id: 999 }]);
    expect(await svc.afterCustomerCancel({ customiseOrderId: 5, rideId: 321, now: NOW })).toEqual({ ok: false });
  });
});

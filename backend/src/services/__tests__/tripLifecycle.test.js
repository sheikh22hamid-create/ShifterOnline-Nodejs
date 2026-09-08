jest.mock("../../config/db", () => ({
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
  $queryRaw: jest.fn(),
  tbl_order_requests: { updateMany: jest.fn(), findFirst: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn() },
  order_status_history: { create: jest.fn() },
  pkg_order_wait_timer: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
}));

jest.mock("../dispatchManager", () => ({
  stopDispatch: jest.fn(),
  recordModel1Outcome: jest.fn(),
  emitCustomerEvent: jest.fn(),
  startDispatch: jest.fn(),
}));
jest.mock("../lockManager", () => ({ releaseLock: jest.fn(), peekLock: jest.fn() }));
jest.mock("../pricingEngine", () => ({
  priceForPackageId: jest.fn().mockResolvedValue({ pkg: {}, fare: 24.78, driverEarning: 42, commission: 5, radiusCharge: 0 }),
  getPackageById: jest.fn(),
  commissionAmount: jest.fn((dCharge, commissionPercent) => Math.round(((Number(dCharge) * Number(commissionPercent)) / 100) * 100) / 100),
}));
jest.mock("../pushNotifier", () => ({ notifyCustomerOrderAssigned: jest.fn().mockResolvedValue({ sent: true }) }));

const prisma = require("../../config/db");
const dispatchManager = require("../dispatchManager");
const lockManager = require("../lockManager");
const pricingEngine = require("../pricingEngine");
const tripLifecycle = require("../tripLifecycle");
const { haversineKm } = require("../../utils/geoDistance");

describe("tripLifecycle.acceptOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // acceptOrder runs its two conditional UPDATEs inside prisma.$transaction(async (tx) => ...).
    // Passing the same mocked `prisma` as `tx` means `tx.$executeRaw` / `tx.tbl_order_requests.*`
    // hit the exact jest.fn()s these tests configure below.
    prisma.$transaction.mockImplementation((cb) => cb(prisma));

    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 297,
      uid: 9,
      delivery_type: 6,
      distance: 15.4,
      radius_range: 3,
      extra_mile_charge: 12,
    });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, first_name: "Deepak" });
  });

  it("succeeds, prices from the accepted offer's own package, and stops the dispatch cascade", async () => {
    // First $executeRaw call claims the tbl_order_requests row, second claims pkg_order.
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });

    const result = await tripLifecycle.acceptOrder(297, 1);

    expect(result.success).toBe(true);
    expect(result.order.driver_earning).toBe(42);
    expect(result.order.delivery_type).toBe(6);
    // radiusRangeKm=1 (fallback), not order.radius_range (3) — neither the
    // order nor the rider fixture here carries lat/lng, so the accepting
    // driver's real pickup distance can't be computed and the standard
    // "unknown -> zero radius charge" default applies (same convention as
    // pricingEngine.getFareEstimate/orderController.createOrderCore).
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 15.4, 1, 12, 9);
    expect(lockManager.releaseLock).toHaveBeenCalledWith(1);
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "accepted_by_other");
    expect(dispatchManager.recordModel1Outcome).toHaveBeenCalledWith(1, 6, "accept");
  });

  it("does not record a Model 1 outcome when the accept fails (offer expired or order already taken)", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, status: "sent" });

    await tripLifecycle.acceptOrder(297, 2);

    expect(dispatchManager.recordModel1Outcome).not.toHaveBeenCalled();
  });

  it("uses the accepted offer's package_id, not pkg_order.delivery_type which a later tier may have already overwritten", async () => {
    // pkg_order.delivery_type has already drifted to Model 2 (7) because a
    // later tier's batch ran before this Model-1 offer was accepted.
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 297, uid: 9, delivery_type: 7, distance: 15.4 });
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    // But the offer actually being accepted was for Model 1 (package 6).
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });

    const result = await tripLifecycle.acceptOrder(297, 1);

    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 15.4, 1, 0, 9);
    expect(result.order.delivery_type).toBe(6);
  });

  it("fails with 'Offer expired' when the request is still 'sent' but past its freshness window", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0); // freshness/status WHERE clause didn't match
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, status: "sent" });

    const result = await tripLifecycle.acceptOrder(297, 2);

    expect(result).toEqual({ success: false, msg: "Offer expired" });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1); // pkg_order UPDATE never attempted
    expect(dispatchManager.stopDispatch).not.toHaveBeenCalled();
  });

  it("fails with 'Order already taken or cancelled' when the request row was already resolved another way", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(0);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, status: "timeout" });

    const result = await tripLifecycle.acceptOrder(297, 3);

    expect(result).toEqual({ success: false, msg: "Order already taken or cancelled" });
  });

  it("fails without touching dispatch state when the order was already taken (pkg_order UPDATE loses the race)", async () => {
    // The request claim succeeds (still fresh), but a different rider already won the order.
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, package_id: 6, status: "accepted" });

    const result = await tripLifecycle.acceptOrder(297, 4);

    expect(result).toEqual({ success: false, msg: "Order already taken or cancelled" });
    expect(dispatchManager.stopDispatch).not.toHaveBeenCalled();
  });

  it("pushes an order-assigned FCM notification to the customer", async () => {
    const pushNotifier = require("../pushNotifier");
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 297, uid: 9, delivery_type: 6, distance: 15.4, otp: 4321 });
    prisma.tbl_user.findUnique.mockResolvedValue({ fcm_token: "cust-tok" });

    await tripLifecycle.acceptOrder(297, 1);

    expect(pushNotifier.notifyCustomerOrderAssigned).toHaveBeenCalledWith(
      "cust-tok",
      expect.objectContaining({ order_id: 297, rider_name: "Deepak", otp: 4321 })
    );
  });

  it("prices off the driver's real pickup distance and sets advance_payment = pricingEngine's own radiusCharge + cancellation_charge_customer", async () => {
    // Merged design: advance_payment is no longer its own separate
    // distance*rate calc (which — unlike the fare itself — used to bill the
    // full distance with no free first km, a second divergent formula for
    // the same concept). It now reuses the exact radiusCharge pricingEngine
    // already computed for d_charge/total_dcharge off this SAME driver
    // distance, so the two can never drift apart again.
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });
    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 297, uid: 9, delivery_type: 6, distance: 15.4, radius_range: 3, extra_mile_charge: 12,
      plat: "28.704059", plong: "77.102490",
    });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, first_name: "Deepak", rlats: "28.650000", rlongs: "77.080000" });
    pricingEngine.priceForPackageId.mockResolvedValue({
      pkg: { pickup_per_km_charge: "4", cancellation_charge_customer: "15" },
      fare: 24.78,
      driverEarning: 42,
      commission: 5,
      radiusCharge: 40,
    });

    const expectedDistanceKm = haversineKm(28.65, 77.08, 28.704059, 77.10249);

    const result = await tripLifecycle.acceptOrder(297, 1);

    // radiusRangeKm passed in is the driver's real pickup distance, not
    // order.radius_range (3, the customer's search-radius setting).
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 15.4, expectedDistanceKm, 12, 9);
    expect(result.order.advance_payment).toBe("55"); // 40 (radiusCharge) + 15 (cancellation_charge_customer)
  });

  it("falls back to just cancellation_charge_customer (zero radius charge) when the rider has no known location", async () => {
    prisma.$executeRaw.mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    prisma.tbl_order_requests.findFirst.mockResolvedValue({ id: 1, order_id: 297, rider_id: 1, package_id: 6, status: "accepted" });
    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 297, delivery_type: 6, distance: 15.4,
      plat: "28.704059", plong: "77.102490",
    });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, first_name: "Deepak", rlats: null, rlongs: null });
    pricingEngine.priceForPackageId.mockResolvedValue({
      pkg: { pickup_per_km_charge: "4", cancellation_charge_customer: "15" },
      fare: 24.78,
      driverEarning: 42,
      commission: 5,
      radiusCharge: 0,
    });

    const result = await tripLifecycle.acceptOrder(297, 1);

    // No known driver location -> radiusRangeKm falls back to 1 (free).
    expect(pricingEngine.priceForPackageId).toHaveBeenCalledWith(6, 15.4, 1, 0, undefined);
    expect(result.order.advance_payment).toBe("15");
  });
});


describe("tripLifecycle.rejectOrder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scopes the reject to the rider's currently-locked tier, not just the order", async () => {
    // Rider is currently locked on Model 2 (package 7) of this order.
    lockManager.peekLock.mockReturnValue({ orderId: 297, packageId: 7 });
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });

    const result = await tripLifecycle.rejectOrder(297, 1);

    expect(result).toEqual({ success: true });
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({
      where: { order_id: 297, rider_id: 1, package_id: 7, status: { in: ["sent", "timeout"] } },
      data: { status: "10" },
    });
    expect(lockManager.releaseLock).toHaveBeenCalledWith(1);
    expect(dispatchManager.recordModel1Outcome).toHaveBeenCalledWith(1, 7, "miss");
  });

  it("still records the reject using the client-supplied package_id even when the lock has already expired (order:reject has no ack)", async () => {
    // Live bug: order:reject is fire-and-forget — if it arrives after this
    // popup's own 15s timeout already fired and released the lock, the old
    // lock-only lookup had nothing left to infer the tier from and silently
    // dropped the reject (recorded as a plain 'timeout'), so the rider kept
    // getting offered this order's later tiers despite explicitly rejecting.
    lockManager.peekLock.mockReturnValue(undefined); // lock already gone
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });

    const result = await tripLifecycle.rejectOrder(297, 1, 7);

    expect(result).toEqual({ success: true });
    // Matches 'timeout' too, not just 'sent' — this row may have already
    // been written 'timeout' by scheduleExpiry before this late reject landed.
    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({
      where: { order_id: 297, rider_id: 1, package_id: 7, status: { in: ["sent", "timeout"] } },
      data: { status: "10" },
    });
    expect(dispatchManager.recordModel1Outcome).toHaveBeenCalledWith(1, 7, "miss");
    // No lock matched this order/tier, so there's nothing to release.
    expect(lockManager.releaseLock).not.toHaveBeenCalled();
  });

  it("does not release a lock that belongs to a NEWER tier when a late reject for an OLDER tier arrives with its own package_id", async () => {
    // Rider has already moved on to Model 3 (package 21) of this same
    // order by the time a late reject for Model 1 (package 6) arrives.
    lockManager.peekLock.mockReturnValue({ orderId: 297, packageId: 21 });
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });

    await tripLifecycle.rejectOrder(297, 1, 6);

    expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({
      where: { order_id: 297, rider_id: 1, package_id: 6, status: { in: ["sent", "timeout"] } },
      data: { status: "10" },
    });
    // Must NOT release the lock — it's for package 21, not the package 6 this reject was about.
    expect(lockManager.releaseLock).not.toHaveBeenCalled();
  });

  it("does not record a Model 1 outcome when the reject's row was already resolved another way", async () => {
    lockManager.peekLock.mockReturnValue({ orderId: 297, packageId: 6 });
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 0 });

    await tripLifecycle.rejectOrder(297, 1);

    expect(dispatchManager.recordModel1Outcome).not.toHaveBeenCalled();
  });

  it("is a no-op when the rider's current lock no longer matches this order — a stale/delayed reject must not touch a newer tier's row", async () => {
    // Live bug this guards against (order #1503): a reject for an OLDER
    // tier arrived after the rider had already moved on to a NEWER tier of
    // the same order (or a different order entirely). Matching only
    // orderId would flip the newer tier's still-legitimately-'sent' row to
    // rejected, permanently excluding the rider from every tier after that
    // over an offer they never actually saw.
    lockManager.peekLock.mockReturnValue({ orderId: 999, packageId: 21 }); // a different order now

    const result = await tripLifecycle.rejectOrder(297, 1);

    expect(result).toEqual({ success: true });
    expect(prisma.tbl_order_requests.updateMany).not.toHaveBeenCalled();
    expect(lockManager.releaseLock).not.toHaveBeenCalled();
  });

  it("is a no-op when the rider holds no lock at all", async () => {
    lockManager.peekLock.mockReturnValue(undefined);

    const result = await tripLifecycle.rejectOrder(297, 1);

    expect(result).toEqual({ success: true });
    expect(prisma.tbl_order_requests.updateMany).not.toHaveBeenCalled();
    expect(lockManager.releaseLock).not.toHaveBeenCalled();
  });
});

describe("tripLifecycle.customerCancel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stops dispatch when cancelling an unassigned order", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 297, uid: 7, rid: 0 });
    prisma.$executeRaw.mockResolvedValueOnce(1);

    const result = await tripLifecycle.customerCancel(7, 297, "changed my mind");

    expect(result).toEqual({ success: true });
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "cancelled_by_user");
  });

  it("returns failure when the driver already won the accept race", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 297, uid: 7, rid: 1 });
    prisma.$executeRaw.mockResolvedValueOnce(0);

    const result = await tripLifecycle.customerCancel(7, 297, "too late");

    expect(result).toEqual({ success: false, msg: "Order cannot be cancelled" });
  });
});

describe("tripLifecycle.driverCancel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    prisma.$queryRaw.mockResolvedValue([{
      id: 297,
      uid: 7,
      rid: 11,
      order_status: 1,
      o_status: "Processing",
      advance_payment: "250",
      payment_status: 1,
      razorpay_payment_id: "pay_123",
    }]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 297, uid: 7, rid: 0, order_status: 0, o_status: "Pending" });
    prisma.tbl_user.update.mockResolvedValue({ id: 7, wallet: 250 });
  });

  it("credits a captured advance exactly once and terminally cancels the order", async () => {
    const result = await tripLifecycle.driverCancel(297, 11, "vehicle breakdown");

    expect(result).toMatchObject({ success: true, refund_amount: 250, refund_status: "refunded_to_wallet" });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 250 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        order_id: 297,
        amount: 250,
        type: "credit",
        wallet_type: "user",
        payment_id: "advance_refund:297:pay_123",
      }),
    }));
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:driver_cancelled", expect.objectContaining({
      order_id: 297,
      refund_status: "refunded_to_wallet",
      order_status: 4,
      o_status: "Cancelled",
      searching_for_new_driver: false,
    }));
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "driver_cancelled");
    expect(dispatchManager.startDispatch).not.toHaveBeenCalled();
  });

  it("does not credit an uncaptured advance", async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{
      id: 297, uid: 7, rid: 11, order_status: 1, o_status: "Processing",
      advance_payment: "250", payment_status: 0, razorpay_payment_id: null,
    }]);

    const result = await tripLifecycle.driverCancel(297, 11, "cancelled");

    expect(result.refund_status).toBe("payment_not_captured");
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});

describe("tripLifecycle.updateStatus('complete') — commission deduction", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
    prisma.pkg_order.update.mockResolvedValue({});
  });

  it("debits the driver's wallet for a cash order with commission > 0, reading the payment method from trans_id", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 297,
      rid: 1,
      city_id: 1,
      d_charge: 100,
      total_dcharge: 100,
      commission: 5,
      trans_id: "cash_payment",
      free_waiting_time: "0",
      wating_charge: "0",
    });

    const result = await tripLifecycle.updateStatus(297, 1, "complete");

    expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed" });
    expect(pricingEngine.commissionAmount).toHaveBeenCalledWith(100, 5);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { wallet_balance: { decrement: 5 } },
    });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: 1,
          amount: 5,
          type: "debit",
          order_id: 297,
        }),
      })
    );
  });

  it("does not touch the wallet for a non-cash order even when commission > 0", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 298,
      rid: 1,
      city_id: 1,
      d_charge: 100,
      total_dcharge: 100,
      commission: 5,
      trans_id: "razorpay_txn_123",
      free_waiting_time: "0",
      wating_charge: "0",
    });

    const result = await tripLifecycle.updateStatus(298, 1, "complete");

    expect(result.success).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("does not touch the wallet for a cash order with commission = 0", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({
      id: 299,
      rid: 1,
      city_id: 1,
      d_charge: 100,
      total_dcharge: 100,
      commission: 0,
      trans_id: "cash_payment",
      free_waiting_time: "0",
      wating_charge: "0",
    });

    const result = await tripLifecycle.updateStatus(299, 1, "complete");

    expect(result.success).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});

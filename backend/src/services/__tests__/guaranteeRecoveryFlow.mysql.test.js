const { enabled, describeMysql, resetDb, resetOrders, makeOrder, makeUser, makeAssignedCase, insertRow } = require("./helpers/mysqlTestDb");

// Only external side effects are mocked (sockets, pushes, wallet pushes, WhatsApp); the DB, the recovery
// service, bookingGuaranteeService and tripLifecycle are all real.
jest.mock("../dispatchManager", () => ({
  emitCustomerEvent: jest.fn(), emitDriverEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined), stopDispatch: jest.fn(),
}));
jest.mock("../pushNotifier", () => ({
  notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }),
  notifyCustomerPickupTimeoutCancel: jest.fn().mockResolvedValue({ sent: true }),
  notifyDriverPickupTimeoutCancel: jest.fn().mockResolvedValue({ sent: true }),
}));
jest.mock("../walletNotifier", () => ({
  notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined),
  notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn(), notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../whatsapp/notifications");

const prisma = enabled ? require("../../config/db") : null;
const recovery = enabled ? require("../guaranteeRecoveryService") : null;
const guarantee = enabled ? require("../bookingGuaranteeService") : null;
const dispatchManager = enabled ? require("../dispatchManager") : null;
const tripLifecycle = enabled ? require("../tripLifecycle") : null;
const CITY = 3;

describeMysql("driver-cancel recovery, end to end (real MySQL)", () => {
  beforeEach(async () => { await resetDb(prisma); await resetOrders(prisma); jest.clearAllMocks(); });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  const wallet = async (uid) => Number((await prisma.tbl_user.findUnique({ where: { id: uid }, select: { wallet: true } })).wallet);
  const credits = (orderId) => prisma.tbl_wallet_history.count({ where: { order_id: orderId, payment_id: `booking_guarantee_credit:${orderId}` } });
  const orderRow = (id) => prisma.$queryRawUnsafe("SELECT rid, order_status, o_status FROM pkg_order WHERE id = ?", id).then((r) => r[0]);

  it("cancel -> reopen -> deadline passes: compensation is paid exactly once, order cancelled, search stopped", async () => {
    const uid = await makeUser(prisma);
    const orderId = await makeOrder(prisma, { uid });
    const c = await makeAssignedCase(prisma, orderId, CITY, { uid, deadline_at: new Date(Date.now() + 2000) });

    const before = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect((await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY })).reopened).toBe(true);
    const reopened = await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } });
    expect(reopened.status).toBe("open");
    expect(reopened.deadline_at.getTime()).toBe(before.deadline_at.getTime()); // the ORIGINAL deadline is kept
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { deadline_at: new Date(Date.now() - 1000) } }); // deadline_at only moved EARLIER by the test

    expect(await guarantee.expireCase(c.id)).toBe(true);
    expect(await guarantee.expireCase(c.id)).toBe(false); // sweeper retry is a no-op
    expect(await wallet(uid)).toBe(100);
    expect(await credits(orderId)).toBe(1);
    expect(await orderRow(orderId)).toMatchObject({ order_status: 4, o_status: "Cancelled" });
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(orderId, "guarantee_expired");
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("expired_compensated");
  });

  it("cancel -> reopen -> another driver assigned: the case closes again with no compensation, and a second cancel can reopen it", async () => {
    const orderId = await makeOrder(prisma);
    const c = await makeAssignedCase(prisma, orderId, CITY);
    await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    await prisma.$executeRawUnsafe("UPDATE pkg_order SET rid = 12, order_status = 1, o_status = 'Processing' WHERE id = ?", orderId);
    expect(await guarantee.closeOnAssign(orderId, null, "driver_assigned")).toBe(true);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("resolved_assigned");

    expect((await recovery.reopenAfterDriverCancel({ orderId, riderId: 12, cityId: CITY })).reopened).toBe(true);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("open");
  });

  it("customer cancel after a reopen closes the case without compensation", async () => {
    const uid = await makeUser(prisma);
    const orderId = await makeOrder(prisma, { uid });
    const c = await makeAssignedCase(prisma, orderId, CITY, { uid });
    await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    expect(await guarantee.closeOnCancel(orderId, "customer_cancelled")).toBe(true);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("cancelled");
    expect(await credits(orderId)).toBe(0);
    expect(await wallet(uid)).toBe(0);
  });

  it("two concurrent expiry sweeps plus a late cancel never double-pay and never reopen an expired case", async () => {
    const uid = await makeUser(prisma);
    const orderId = await makeOrder(prisma, { uid });
    const c = await makeAssignedCase(prisma, orderId, CITY, { uid });
    await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { deadline_at: new Date(Date.now() - 1000) } });

    const results = await Promise.all([
      guarantee.expireCase(c.id),
      guarantee.expireCase(c.id),
      recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY }),
    ]);
    expect(results.slice(0, 2).filter(Boolean)).toHaveLength(1);
    expect(results[2].reopened).toBe(false);
    expect(await credits(orderId)).toBe(1);
    expect(await wallet(uid)).toBe(100);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("expired_compensated");
    expect(await orderRow(orderId)).toMatchObject({ rid: 0, order_status: 4, o_status: "Cancelled" });
  });
});

describeMysql("driver-cancel recovery through the REAL tripLifecycle.driverCancel (real MySQL)", () => {
  beforeEach(async () => {
    await resetDb(prisma);
    await resetOrders(prisma);
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
    for (const t of ["pkg_order_wait_timer", "driver_trip_event", "tbl_referral_point_log"]) await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
    await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
    // City 3: guarantee on, driver-cancel recovery switched on.
    await prisma.city_order_settings.upsert({
      where: { city_id: CITY },
      update: { guarantee_enabled: true, guarantee_recover_on_cancel: true },
      create: { city_id: CITY, guarantee_enabled: true, guarantee_recover_on_cancel: true },
    });
    require("../orderSearchSettings")._resetCache();
    require("../guaranteeQueueSettings")._resetCache();
    jest.clearAllMocks();
  });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  const userRow = (uid) => prisma.tbl_user.findUnique({ where: { id: uid }, select: { wallet: true, referral_points: true } });
  const riderWallet = async (rid) => Number((await prisma.tbl_rider.findUnique({ where: { id: rid }, select: { wallet_balance: true } })).wallet_balance);
  const keyRows = (key) => prisma.tbl_wallet_history.findMany({ where: { payment_id: key } });
  const orderRow = (id) => prisma.$queryRawUnsafe("SELECT rid, order_status, o_status, referral_points_used FROM pkg_order WHERE id = ?", id).then((r) => r[0]);
  const caseStatus = async (orderId) => (await prisma.booking_guarantee_case.findUnique({ where: { order_id: orderId } })).status;

  async function seed({ orderStatus = 1, oStatus = "Processing", userWallet = 0, ...orderExtra } = {}) {
    const uid = await makeUser(prisma, { wallet: userWallet, referral_points: 0 });
    const riderA = await insertRow(prisma, "tbl_rider", { wallet_balance: 1000 });
    const riderB = await insertRow(prisma, "tbl_rider", { wallet_balance: 1000 });
    const pkg = await insertRow(prisma, "tbl_package", {
      cancellation_charge_driver: 40, driver_cancel_user_earning: 25, cancellation_charge_customer: 30,
      start_time: "00:00:00", end_time: "23:59:59",
    });
    const orderId = await makeOrder(prisma, {
      uid, rid: riderA, order_status: orderStatus, o_status: oStatus, delivery_type: pkg, city_id: CITY, ...orderExtra,
    });
    await prisma.tbl_order_requests.create({ data: { order_id: orderId, rider_id: riderA, status: "accepted", package_id: pkg } });
    const c = await makeAssignedCase(prisma, orderId, CITY, { uid });
    return { uid, riderA, riderB, pkg, orderId, c };
  }

  it("Pickup-stage recovery stops driver A's wait clock, so the OTP and ceiling sweeps never cancel driver B's trip", async () => {
    const { uid, riderA, riderB, orderId } = await seed({ orderStatus: 2, oStatus: "Pickup" });
    const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000); // far beyond the OTP timeout AND the relocation ceiling
    await prisma.pkg_order_wait_timer.create({
      data: { order_id: orderId, rid: riderA, pickup_wait_start: longAgo, first_arrival_at: longAgo, created_at: longAgo },
    });
    await prisma.driver_trip_event.create({ data: { order_id: orderId, rider_id: riderA, user_id: uid, milestone: "arrived", payload: {} } });

    const result = await tripLifecycle.driverCancel(orderId, riderA, "breakdown");
    expect(result).toMatchObject({ success: true, recovered: true, refund_status: "order_reopened" });
    expect(await orderRow(orderId)).toMatchObject({ rid: 0, order_status: 0, o_status: "Pending" });
    expect(await prisma.pkg_order_wait_timer.count({ where: { order_id: orderId } })).toBe(0);
    expect(await prisma.driver_trip_event.count({ where: { order_id: orderId, milestone: "arrived" } })).toBe(0);

    // Driver B accepts the reopened order.
    await prisma.$executeRawUnsafe("UPDATE pkg_order SET rid = ?, order_status = 1, o_status = 'Processing' WHERE id = ?", riderB, orderId);
    const walletBefore = Number((await userRow(uid)).wallet);

    await tripLifecycle.sweepOverduePickups();
    await tripLifecycle.sweepPickupRelocationCeiling();

    expect(await orderRow(orderId)).toMatchObject({ rid: riderB, order_status: 1, o_status: "Processing" });
    expect(await prisma.tbl_wallet_history.count({ where: { order_id: orderId, remark: { startsWith: "No-show penalty" } } })).toBe(0);
    expect(Number((await userRow(uid)).wallet)).toBe(walletBefore);
    expect(dispatchManager.emitDriverEvent).not.toHaveBeenCalledWith(riderB, "order:customer_cancelled", expect.anything());
  });

  it("money: recovery charges the driver once and refunds NOTHING; the expiry then refunds advance, prepaid fare and points exactly once", async () => {
    // Customer paid the fare from the wallet (400, linked "Delivery payment" debit), paid the advance from the
    // wallet (200, advance_apply:<order> debit, as walletAdvanceService.payAdvanceFromWallet writes it) and used 5
    // referral points. Wallet after those debits: 300.
    const { uid, riderA, orderId, c } = await seed({ userWallet: 300, p_method_id: -2, trans_id: "wallet_test", referral_points_used: 5 });
    await insertRow(prisma, "tbl_wallet_history", {
      user_id: uid, amount: 400, type: "debit", wallet_type: "user", remark: "Delivery payment", order_id: orderId, payment_id: "", created_at: new Date(),
    });
    await insertRow(prisma, "tbl_wallet_history", {
      user_id: uid, amount: 200, type: "debit", wallet_type: "user", remark: `Advance payment for order #${orderId} (paid from wallet)`,
      payment_id: `advance_apply:${orderId}`, order_id: orderId, created_at: new Date(),
    });

    const result = await tripLifecycle.driverCancel(orderId, riderA, "breakdown");
    expect(result).toMatchObject({ success: true, recovered: true, refund_amount: 0, refund_status: "order_reopened" });
    // A double tap / socket retry gets the same answer and changes nothing.
    expect(await tripLifecycle.driverCancel(orderId, riderA, "breakdown")).toMatchObject({ success: true, recovered: true, refund_status: "order_reopened" });

    // At recovery: driver fee and customer earning once each, nothing refunded, order held, case open.
    const fee = await keyRows(`driver_cancel_fee:${orderId}:${riderA}`);
    expect(fee).toHaveLength(1);
    expect(fee[0]).toMatchObject({ type: "debit", wallet_type: "driver", user_id: riderA });
    expect(Number(fee[0].amount)).toBe(40);
    expect(await riderWallet(riderA)).toBe(960);
    const comp = await keyRows(`driver_cancel_comp:${orderId}:${riderA}`);
    expect(comp).toHaveLength(1);
    expect(Number(comp[0].amount)).toBe(25);
    expect(await keyRows(`advance_wallet_refund:${orderId}`)).toHaveLength(0);
    expect(await keyRows(`wallet_prepay_refund:${orderId}`)).toHaveLength(0);
    expect(await userRow(uid)).toMatchObject({ referral_points: 0 });
    expect(Number((await userRow(uid)).wallet)).toBe(325); // 300 + the 25 driver_cancel_user_earning only
    expect(await orderRow(orderId)).toMatchObject({ rid: 0, order_status: 0, o_status: "Pending", referral_points_used: 5 });
    expect(await prisma.tbl_order_requests.findMany({ where: { order_id: orderId, rider_id: riderA } })).toEqual([expect.objectContaining({ status: "10" })]);
    expect(await prisma.order_status_history.count({ where: { order_id: orderId, rider_id: riderA, status: "Driver Cancelled" } })).toBe(1);
    expect(await caseStatus(orderId)).toBe("open");

    // Deadline passes (test only moves it EARLIER); the sweeper runs twice.
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { deadline_at: new Date(Date.now() - 1000) } });
    expect(await guarantee.expireCase(c.id)).toBe(true);
    expect(await guarantee.expireCase(c.id)).toBe(false);

    const credit = await keyRows(`booking_guarantee_credit:${orderId}`);
    expect(credit).toHaveLength(1);
    expect(Number(credit[0].amount)).toBe(100);
    const advanceRefund = await keyRows(`advance_wallet_refund:${orderId}`);
    expect(advanceRefund).toHaveLength(1);
    expect(Number(advanceRefund[0].amount)).toBe(200);
    const prepayRefund = await keyRows(`wallet_prepay_refund:${orderId}`);
    expect(prepayRefund).toHaveLength(1);
    expect(Number(prepayRefund[0].amount)).toBe(400);
    expect(await prisma.tbl_referral_point_log.count({ where: { user_id: uid, source: "ride_discount_refund", txn_type: "credit" } })).toBe(1);
    expect(await userRow(uid)).toMatchObject({ referral_points: 5 });
    expect(Number((await userRow(uid)).wallet)).toBe(1025); // 325 + 100 compensation + 200 advance + 400 fare
    expect(await keyRows(`driver_cancel_fee:${orderId}:${riderA}`)).toHaveLength(1);
    expect(await riderWallet(riderA)).toBe(960);
    expect(await orderRow(orderId)).toMatchObject({ rid: 0, order_status: 4, o_status: "Cancelled", referral_points_used: 0 });
    expect(await caseStatus(orderId)).toBe("expired_compensated");
  });
});

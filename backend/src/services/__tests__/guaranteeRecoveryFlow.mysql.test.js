const { enabled, describeMysql, resetDb, resetOrders, makeOrder, makeUser, makeAssignedCase } = require("./helpers/mysqlTestDb");

jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined), stopDispatch: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn(), notifyOrderStatusUpdate: jest.fn() }));

const prisma = enabled ? require("../../config/db") : null;
const recovery = enabled ? require("../guaranteeRecoveryService") : null;
const guarantee = enabled ? require("../bookingGuaranteeService") : null;
const dispatchManager = enabled ? require("../dispatchManager") : null;
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

    expect((await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY })).reopened).toBe(true);
    await new Promise((r) => setTimeout(r, 2200));
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

  it("a cancel racing the expiry sweep never double-pays and never leaves an assigned order with an expired case", async () => {
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
  });
});

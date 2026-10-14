const { enabled, describeMysql, resetDb, resetOrders, makeOrder, makeAssignedCase, events } = require("./helpers/mysqlTestDb");

jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined), stopDispatch: jest.fn() }));
jest.mock("../bookingGuaranteeService", () => ({ announceOpened: jest.fn().mockResolvedValue(undefined) }));

const prisma = enabled ? require("../../config/db") : null;
const svc = enabled ? require("../guaranteeRecoveryService") : null;
const CITY = 3;

describeMysql("guaranteeRecoveryService (real MySQL)", () => {
  beforeEach(async () => { await resetDb(prisma); await resetOrders(prisma); });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  const orderRow = (id) => prisma.$queryRawUnsafe("SELECT id, rid, order_status, o_status FROM pkg_order WHERE id = ?", id).then((r) => r[0]);
  const caseOf = (orderId) => prisma.booking_guarantee_case.findUnique({ where: { order_id: orderId } });

  it("reopens the SAME case with the ORIGINAL deadline and returns the order to the held state", async () => {
    const orderId = await makeOrder(prisma);
    const before = await makeAssignedCase(prisma, orderId, CITY);
    const hook = jest.fn();
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY, inTx: hook });
    expect(out.reopened).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    const after = await caseOf(orderId);
    expect(after).toMatchObject({ id: before.id, status: "open", closed_at: null, owner_admin_id: null, queue_state: null, reminded_at: null, resolved_by_admin_id: null });
    expect(after.deadline_at.getTime()).toBe(before.deadline_at.getTime());
    expect(after.opened_at.getTime()).toBe(before.opened_at.getTime());
    expect(await orderRow(orderId)).toMatchObject({ rid: 0, order_status: 0, o_status: "Pending" });
    expect(await events(prisma, before.id)).toContain("reopened_after_driver_cancel");
  });

  it("is a no-op when the original deadline has already passed (terminal cancel stays)", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY, { deadline_at: new Date(Date.now() - 1000) });
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    expect(out).toMatchObject({ reopened: false, reason: "case_not_reopenable" });
    expect(await orderRow(orderId)).toMatchObject({ rid: 11, order_status: 1, o_status: "Processing" });
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
  });

  it.each([
    ["on route (status 3)", { order_status: 3, o_status: "On Route" }],
    ["another rider's order", { rid: 12 }],
  ])("does nothing for %s", async (_label, orderOverrides) => {
    const orderId = await makeOrder(prisma, orderOverrides);
    await makeAssignedCase(prisma, orderId, CITY);
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    expect(out.reopened).toBe(false);
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
    expect((await orderRow(orderId)).order_status).toBe(orderOverrides.order_status ?? 1);
  });

  it.each([["open"], ["cancelled"], ["expired_compensated"]])("does nothing when the case is already %s", async (status) => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY, { status });
    expect((await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY })).reopened).toBe(false);
    expect((await caseOf(orderId)).status).toBe(status);
    expect(await orderRow(orderId)).toMatchObject({ rid: 11, o_status: "Processing" });
  });

  it("does nothing when the case belongs to another city", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, 9);
    expect(await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY })).toMatchObject({ reopened: false, reason: "city_mismatch" });
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
  });

  it("rolls EVERYTHING back when the caller's hook throws", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY);
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY, inTx: async () => { throw new Error("fee failed"); } });
    expect(out).toMatchObject({ reopened: false, reason: "error" });
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
    expect(await orderRow(orderId)).toMatchObject({ rid: 11, order_status: 1, o_status: "Processing" });
  });

  it("two concurrent cancels reopen exactly once (the second sees an unassigned order)", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY);
    const results = await Promise.all([
      svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY }),
      svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY }),
    ]);
    expect(results.filter((r) => r.reopened)).toHaveLength(1);
    const auditCount = (await events(prisma, (await caseOf(orderId)).id)).filter((e) => e === "reopened_after_driver_cancel").length;
    expect(auditCount).toBe(1);
  });

  it("case-only reopen (approved cancel) keeps the original deadline and ignores a passed one", async () => {
    const orderId = await makeOrder(prisma, { rid: 0, order_status: 0, o_status: "Pending" });
    const before = await makeAssignedCase(prisma, orderId, CITY);
    const out = await svc.reopenAfterApprovedCancel({ orderId, riderId: 11, cityId: CITY });
    expect(out.reopened).toBe(true);
    expect((await caseOf(orderId)).deadline_at.getTime()).toBe(before.deadline_at.getTime());

    const lateOrder = await makeOrder(prisma, { rid: 0, order_status: 0, o_status: "Pending" });
    await makeAssignedCase(prisma, lateOrder, CITY, { deadline_at: new Date(Date.now() - 1000) });
    expect((await svc.reopenAfterApprovedCancel({ orderId: lateOrder, riderId: 11, cityId: CITY })).reopened).toBe(false);
  });

  it.each([
    ["cancelled by the customer after the un-assign", { rid: 0, order_status: 4, o_status: "Cancelled" }],
    ["already taken by another driver", { rid: 12, order_status: 1, o_status: "Processing" }],
  ])("case-only reopen (approved cancel) does nothing when the order is %s", async (_label, orderState) => {
    const orderId = await makeOrder(prisma, orderState);
    const before = await makeAssignedCase(prisma, orderId, CITY);
    const out = await svc.reopenAfterApprovedCancel({ orderId, riderId: 11, cityId: CITY });
    expect(out).toMatchObject({ reopened: false, reason: "order_changed" });
    const after = await caseOf(orderId);
    expect(after.status).toBe("resolved_assigned");
    expect(after.owner_admin_id).toBe(before.owner_admin_id);
    expect(await events(prisma, before.id)).not.toContain("reopened_after_driver_cancel");
    expect(await orderRow(orderId)).toMatchObject(orderState);
  });
});

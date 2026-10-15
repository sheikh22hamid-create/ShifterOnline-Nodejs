const { enabled, describeMysql, resetDb, resetOrders, makeOrder, insertRow } = require("./helpers/mysqlTestDb");

jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn() }));
jest.mock("../../utils/assignDefaultDeliveryTypes", () => ({ assignDefaultDeliveryTypes: jest.fn().mockResolvedValue(undefined) }));

const prisma = enabled ? require("../../config/db") : null;
const svc = enabled ? require("../outsideDriverService") : null;
const adminSocket = require("../../sockets/adminSocket");
const CITY = 3;

describeMysql("outside driver onboarding (real MySQL)", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await resetDb(prisma);
    await resetOrders(prisma);
    await prisma.$executeRawUnsafe("TRUNCATE TABLE tbl_rider");
  });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  const heldOrder = async () => {
    const orderId = await makeOrder(prisma, { rid: 0, order_status: 0, o_status: "Pending", category: "E loader" });
    await prisma.booking_guarantee_case.create({
      data: { order_id: orderId, uid: 1, status: "open", selected_package_ids: "[1]", compensation_amount: 100, deadline_at: new Date(Date.now() + 600000), city_id: CITY },
    });
    return orderId;
  };

  it("registers a trial rider, links it to the order, and alerts admins when that rider goes online", async () => {
    const orderId = await heldOrder();
    const out = await svc.registerTrial({ orderId, name: "Ankit", mobile: "09340352904", vehicleNumber: "MP-09-US-7097", adminId: 1 });
    expect(out).toMatchObject({ kind: "trial_created", online: false });
    const rider = await prisma.tbl_rider.findUnique({ where: { id: out.rider_id } });
    expect(rider).toMatchObject({ fmobile: "9340352904", vehicle: "E loader", city_id: CITY, trial_status: "active", trial_orders_allowed: 1, vehicle_no: "MP-09-US-7097" });

    expect(await svc.onboardStatus({ orderId, riderId: out.rider_id })).toEqual({ online: false, order_open: true });

    await prisma.tbl_rider.update({ where: { id: out.rider_id }, data: { a_status: 1 } });
    expect(await svc.onboardStatus({ orderId, riderId: out.rider_id })).toEqual({ online: true, order_open: true });
  });

  it("alerts for the linked held order only, and stops once the case is closed", async () => {
    const orderId = await heldOrder();
    const out = await svc.registerTrial({ orderId, name: "Ankit", mobile: "9340352904", adminId: 1 });
    adminSocket.notifyDispatchAlert.mockClear();
    await svc.notifyIfAwaited({ id: out.rider_id, city_id: CITY });
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyDispatchAlert.mock.calls[0].slice(0, 2)).toEqual([orderId, CITY]);

    await svc.notifyIfAwaited({ id: out.rider_id + 100, city_id: CITY });
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledTimes(1);

    await prisma.booking_guarantee_case.update({ where: { order_id: orderId }, data: { status: "resolved_assigned" } });
    adminSocket.notifyDispatchAlert.mockClear();
    await svc.notifyIfAwaited({ id: out.rider_id, city_id: CITY });
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
  });

  it("does not match a longer rider id that merely starts with the same digits", async () => {
    const orderId = await heldOrder();
    await insertRow(prisma, "tbl_rider", { id: 1, fmobile: "9000000001" }).catch(() => {});
    const out = await svc.registerTrial({ orderId, name: "A", mobile: "9340352904", adminId: 1 });
    adminSocket.notifyDispatchAlert.mockClear();
    await svc.notifyIfAwaited({ id: Number(`${out.rider_id}0`), city_id: CITY });
    expect(adminSocket.notifyDispatchAlert).not.toHaveBeenCalled();
    await expect(svc.onboardStatus({ orderId, riderId: Number(`${out.rider_id}0`) })).rejects.toMatchObject({ statusCode: 404 });
  });
});

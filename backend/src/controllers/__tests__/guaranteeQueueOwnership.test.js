jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  pkg_order_interest: { groupBy: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  order_status_history: { create: jest.fn() },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock("../../services/dispatchManager", () => ({ stopDispatch: jest.fn(), emitDirectAssign: jest.fn() }));
jest.mock("../../services/pricingEngine", () => ({ priceForPackageId: jest.fn() }));
jest.mock("../../services/pushNotifier", () => ({ notifyCustomerNextDayAssigned: jest.fn().mockResolvedValue() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));
jest.mock("../../services/bookingGuaranteeService", () => ({
  closeOnAssign: jest.fn().mockResolvedValue(true),
  closeOnCancel: jest.fn().mockResolvedValue(true),
}));
jest.mock("../../services/guaranteeQueueService", () => ({
  assertExecutiveMayAssign: jest.fn().mockResolvedValue(undefined),
  recordAssignmentAction: jest.fn().mockResolvedValue(undefined),
}));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const { getIO } = require("../../sockets/socketServer");
const queue = require("../../services/guaranteeQueueService");
const guarantee = require("../../services/bookingGuaranteeService");
const { assignRider, assignNextDayBatch } = require("../adminOrderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}
function blocked() {
  const e = new Error("This order is owned by another executive");
  e.statusCode = 403;
  return e;
}

describe("assignRider ownership guard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    queue.assertExecutiveMayAssign.mockResolvedValue(undefined);
    queue.recordAssignmentAction.mockResolvedValue(undefined);
    prisma.pkg_order.findUnique.mockReset(); // clearAllMocks keeps unconsumed once-values from the previous test
    prisma.pkg_order.findUnique
      .mockResolvedValueOnce({ id: 500, city_id: 1, rid: 0, order_status: 0, delivery_type: 6, distance: 10, o_status: "Pending", uid: 9 })
      .mockResolvedValueOnce({ id: 500, paddress: "A", daddress: "B", uid: 9 });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1, status: 1, a_status: 1, full_name: "Deepak" });
    prisma.pkg_order.count.mockResolvedValue(0);
    prisma.$executeRaw.mockResolvedValue(1);
    pricingEngine.priceForPackageId.mockResolvedValue({ pkg: {}, fare: 100, driverEarning: 80, commission: 20 });
    getIO.mockReturnValue({ to: jest.fn().mockReturnThis(), emit: jest.fn() });
  });

  it("returns 403 for a blocked executive and runs no assignment SQL", async () => {
    queue.assertExecutiveMayAssign.mockRejectedValueOnce(blocked());
    const req = { params: { id: "500" }, body: { rider_id: "2" }, user: { role: "executive", id: 5 } };
    const res = makeRes();
    await assignRider(req, res);
    expect(queue.assertExecutiveMayAssign).toHaveBeenCalledWith(req.user, 500, 2);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(guarantee.closeOnAssign).not.toHaveBeenCalled();
    expect(queue.recordAssignmentAction).not.toHaveBeenCalled();
  });

  it("does not block an admin (guard passes) and assigns", async () => {
    const req = { params: { id: "500" }, body: { rider_id: "2" }, user: { role: "superadmin", id: 1, username: "admin" } };
    const res = makeRes();
    await assignRider(req, res);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalledWith(403);
  });

  it("records the assignment action with the acting admin before closeOnAssign", async () => {
    const req = { params: { id: "500" }, body: { rider_id: "2" }, user: { role: "executive", id: 5 } };
    await assignRider(req, makeRes());
    expect(queue.recordAssignmentAction).toHaveBeenCalledWith({ orderId: 500, adminId: 5, riderId: 2 });
    expect(guarantee.closeOnAssign).toHaveBeenCalledWith(500, 5);
    expect(queue.recordAssignmentAction.mock.invocationCallOrder[0]).toBeLessThan(guarantee.closeOnAssign.mock.invocationCallOrder[0]);
  });

  it("rethrows an unexpected guard error as a 500 without assigning", async () => {
    queue.assertExecutiveMayAssign.mockRejectedValueOnce(new Error("db down"));
    const req = { params: { id: "500" }, body: { rider_id: "2" }, user: { role: "executive", id: 5 } };
    const res = makeRes();
    await assignRider(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});

describe("assignNextDayBatch ownership guard", () => {
  const user = { role: "executive", id: 5 };
  beforeEach(() => {
    jest.clearAllMocks();
    queue.assertExecutiveMayAssign.mockResolvedValue(undefined);
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1 });
    prisma.pkg_order.findMany.mockResolvedValue([
      { id: 11, city_id: 1, booking_type: 3, rid: 0, o_status: "Pending" },
      { id: 12, city_id: 1, booking_type: 3, rid: 0, o_status: "Pending" },
    ]);
    prisma.$transaction.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(2);
  });
  const body = { rider_id: "2", sequence: [{ order_id: 11, position: 1 }, { order_id: 12, position: 2 }] };

  it("rejects the whole batch with 403 when any order is blocked, assigning nothing", async () => {
    queue.assertExecutiveMayAssign
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(blocked());
    const res = makeRes();
    await assignNextDayBatch({ body, user }, res);
    expect(queue.assertExecutiveMayAssign).toHaveBeenCalledTimes(2);
    expect(queue.assertExecutiveMayAssign).toHaveBeenCalledWith(user, 12);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
    expect(guarantee.closeOnAssign).not.toHaveBeenCalled();
  });

  it("assigns the batch when every order passes the guard", async () => {
    const res = makeRes();
    await assignNextDayBatch({ body, user }, res);
    expect(queue.assertExecutiveMayAssign).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(guarantee.closeOnAssign).toHaveBeenCalledTimes(2);
  });
});

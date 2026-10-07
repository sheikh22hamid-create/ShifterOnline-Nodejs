jest.mock("../../config/db", () => ({
  monthly_driver_contract: { findUnique: jest.fn() },
  pkg_order: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  driver_order_queue: { count: jest.fn(), create: jest.fn() },
}));
jest.mock("../../services/dispatchManager", () => ({ emitDirectAssign: jest.fn(), emitQueueUpdate: jest.fn() }));
jest.mock("../../services/bookingGuaranteeService", () => ({ closeOnAssign: jest.fn().mockResolvedValue(true) }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const prisma = require("../../config/db");
const bookingGuarantee = require("../../services/bookingGuaranteeService");
const { assignOrderToQueue } = require("../orderQueueController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const req = () => ({ body: { order_id: 500, rider_id: 7 }, user: { id: 3, role: "admin" } });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.monthly_driver_contract.findUnique.mockResolvedValue({ status: "active" });
  prisma.driver_order_queue.count.mockResolvedValue(0);
  prisma.driver_order_queue.create.mockResolvedValue({ id: 1 });
  prisma.pkg_order.update.mockResolvedValue({ id: 500 });
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 500, rid: 7 });
});

describe("assignOrderToQueue - Booking Guarantee", () => {
  it("a free monthly driver gets the order immediately: the open guarantee case is closed (no payout)", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null); // driver has no active order
    const r = res();

    await assignOrderToQueue(req(), r);

    expect(prisma.pkg_order.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 500 }, data: expect.objectContaining({ rid: 7 }) }));
    expect(bookingGuarantee.closeOnAssign).toHaveBeenCalledWith(500, 3);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, isActivated: true }));
  });

  it("a failure closing the case never blocks the assignment", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null);
    bookingGuarantee.closeOnAssign.mockRejectedValueOnce(new Error("boom"));
    const r = res();

    await assignOrderToQueue(req(), r);

    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, isActivated: true }));
  });

  it("a busy driver only queues the order (rid is not set), so the case is left open", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 999 }); // driver has an active trip
    const r = res();

    await assignOrderToQueue(req(), r);

    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
    expect(bookingGuarantee.closeOnAssign).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, isActivated: false }));
  });
});

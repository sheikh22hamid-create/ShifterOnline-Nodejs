// A minimal db mock: the real Prisma client's model delegates cannot be spied on reliably. tripLifecycle only
// touches prisma inside functions, so requiring it with this mock is safe. If requiring it ever fails with
// "Cannot read properties of undefined", add the missing delegate to this object.
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  tbl_order_requests: { updateMany: jest.fn() },
}));
jest.mock("../dispatchManager", () => ({ recordModel1Outcome: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../orderStageService", () => ({ getStage: jest.fn() }));
jest.mock("../tierPenaltyService", () => ({ onMiss: jest.fn().mockResolvedValue({ applied: false }) }));
jest.mock("../driverOrderEventService", () => ({
  EVENTS: { ACCEPTED: "accepted", COMPLETED: "completed" },
  logEvent: jest.fn().mockResolvedValue(null),
}));

const prisma = require("../../config/db");
const orderStage = require("../orderStageService");
const tierPenalty = require("../tierPenaltyService");
const tripLifecycle = require("../tripLifecycle");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("rejectOrder -> tier penalty hook", () => {
  it("reports a real reject (row flipped to '10') with the order's stage", async () => {
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
    orderStage.getStage.mockResolvedValue("free");

    await tripLifecycle.rejectOrder(50, 9, 6);

    expect(tierPenalty.onMiss).toHaveBeenCalledWith(expect.objectContaining({ orderId: 50, riderId: 9, event: "rejected", stage: "free" }));
  });

  it("does not report anything when no offer row was affected", async () => {
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 0 });

    await tripLifecycle.rejectOrder(50, 9, 6);

    expect(tierPenalty.onMiss).not.toHaveBeenCalled();
  });

  it("a failing penalty service never fails the reject", async () => {
    prisma.tbl_order_requests.updateMany.mockResolvedValue({ count: 1 });
    orderStage.getStage.mockResolvedValue("daily");
    tierPenalty.onMiss.mockRejectedValue(new Error("boom"));

    await expect(tripLifecycle.rejectOrder(50, 9, 6)).resolves.toEqual({ success: true });
  });
});

jest.mock("../../config/db", () => ({ driver_order_event: { create: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const events = require("../driverOrderEventService");

beforeEach(() => jest.clearAllMocks());

it("writes one row with the tier defaulting to normal", async () => {
  prisma.driver_order_event.create.mockResolvedValue({ id: 1 });
  const row = await events.logEvent({ riderId: 9, orderId: 50, event: events.EVENTS.OFFERED });
  expect(row).toEqual({ id: 1 });
  expect(prisma.driver_order_event.create).toHaveBeenCalledWith({
    data: {
      rider_id: 9, order_id: 50, tier: "normal", event: "offered",
      reason: null, penalty_pct: null, penalty_amount: null, miss_no: null,
    },
  });
});

it("stores penalty details", async () => {
  prisma.driver_order_event.create.mockResolvedValue({ id: 2 });
  await events.logEvent({
    riderId: 9, orderId: 50, tier: "free", event: events.EVENTS.PENALTY, penaltyPct: 20, penaltyAmount: 60, missNo: 3, reason: "skipped",
  });
  const data = prisma.driver_order_event.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ tier: "free", event: "penalty", penalty_pct: 20, penalty_amount: 60, miss_no: 3, reason: "skipped" });
});

it("never throws: a failed write is logged and returns null", async () => {
  prisma.driver_order_event.create.mockRejectedValue(new Error("table missing"));
  await expect(events.logEvent({ riderId: 1, orderId: 2, event: "offered" })).resolves.toBeNull();
  expect(logger.error).toHaveBeenCalled();
});

it("has a superseded event for offers someone else took", () => {
  expect(events.EVENTS.SUPERSEDED).toBe("superseded");
});

it("truncates a long reason to the column size", async () => {
  prisma.driver_order_event.create.mockResolvedValue({ id: 3 });
  await events.logEvent({ riderId: 1, orderId: 2, event: "cancel_requested", reason: "x".repeat(400) });
  expect(prisma.driver_order_event.create.mock.calls[0][0].data.reason).toHaveLength(255);
});

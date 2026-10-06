// backend/src/services/__tests__/trackActionService.test.js
jest.mock("../../config/db", () => ({ order_receiver_feedback: { findUnique: jest.fn(), create: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../trackSnapshotService", () => ({
  loadLinkedOrder: jest.fn(),
  isCompleted: jest.requireActual("../trackSnapshotService").isCompleted,
  deliveredWindowOpen: jest.requireActual("../trackSnapshotService").deliveredWindowOpen,
}));
jest.mock("../receiverPayService", () => {
  class ReceiverPayError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
  return { ReceiverPayError, mintLink: jest.fn() };
});

const prisma = require("../../config/db");
const snapshot = require("../trackSnapshotService");
const pay = require("../receiverPayService");
const svc = require("../trackActionService");

const NOW = Date.UTC(2026, 9, 7, 8, 0, 0);
const link = { id: 1, order_id: 50, receiver_phone: "9876543210" };
const done = (o = {}) => ({ id: 50, rid: 9, order_status: 5, o_status: "Completed", drop_time: new Date("2026-10-06T15:00:00Z"), ...o });

beforeEach(() => {
  jest.clearAllMocks();
  snapshot.loadLinkedOrder.mockResolvedValue({ order: done() });
  prisma.order_receiver_feedback.findUnique.mockResolvedValue(null);
  prisma.order_receiver_feedback.create.mockResolvedValue({});
});

describe("both endpoints only act on a delivered order of this link", () => {
  it.each([
    ["the number changed / flag off", { reason: "invalid" }],
    ["the order is not completed", { order: done({ order_status: 3, o_status: "On_Route" }) }],
    ["the 24 h window is over", { order: done({ drop_time: new Date("2026-10-05T15:00:00Z") }) }],
  ])("refuses when %s", async (_n, loaded) => {
    snapshot.loadLinkedOrder.mockResolvedValue(loaded);
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toMatchObject({ code: "NOT_AVAILABLE", status: 404 });
    await expect(svc.submitReview(link, { driver_rating: 5 }, { now: NOW })).rejects.toMatchObject({ code: "NOT_AVAILABLE", status: 404 });
    expect(pay.mintLink).not.toHaveBeenCalled();
    expect(prisma.order_receiver_feedback.create).not.toHaveBeenCalled();
  });
});

describe("mintPayLink", () => {
  it("returns the pay link for the linked order", async () => {
    pay.mintLink.mockResolvedValue({ link: "https://x/pay/t" });
    expect(await svc.mintPayLink(link, { now: NOW })).toEqual({ link: "https://x/pay/t" });
    expect(pay.mintLink).toHaveBeenCalledWith({ orderId: 50 });
  });
  it("maps NOT_CONFIGURED to 503 and the other pay errors to 409", async () => {
    pay.mintLink.mockRejectedValue(new pay.ReceiverPayError("NOT_CONFIGURED", "off"));
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toMatchObject({ code: "NOT_CONFIGURED", status: 503 });
    pay.mintLink.mockRejectedValue(new pay.ReceiverPayError("NOT_PAYABLE", "nothing"));
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toMatchObject({ code: "NOT_PAYABLE", status: 409 });
  });
  it("lets unexpected errors through", async () => {
    pay.mintLink.mockRejectedValue(new Error("db"));
    await expect(svc.mintPayLink(link, { now: NOW })).rejects.toThrow("db");
  });
});

describe("submitReview", () => {
  it("stores the review for the linked order and rider", async () => {
    const out = await svc.submitReview(link, { driver_rating: 5, delivery_rating: 4, tags: ["Safe Driving", "Clean Vehicle"], comment: "  Great  " }, { now: NOW });
    expect(out).toEqual({ ok: true });
    expect(prisma.order_receiver_feedback.create).toHaveBeenCalledWith({
      data: { order_id: 50, rider_id: 9, receiver_phone: "9876543210", driver_rating: 5, delivery_rating: 4, feedback_tags: "Safe Driving, Clean Vehicle", comment: "Great", created_at: expect.any(Date) },
    });
  });
  it("accepts a single rating, no tags and no comment", async () => {
    await svc.submitReview(link, { delivery_rating: 3 }, { now: NOW });
    expect(prisma.order_receiver_feedback.create.mock.calls[0][0].data).toMatchObject({ driver_rating: null, delivery_rating: 3, feedback_tags: null, comment: null });
  });
  it.each([
    [{}], [{ driver_rating: 0 }], [{ driver_rating: 6 }], [{ driver_rating: 4.5 }], [{ driver_rating: "x" }],
    [{ driver_rating: 5, tags: ["Not a tag"] }], [{ driver_rating: 5, tags: "Safe Driving" }],
  ])("rejects invalid input %j", async (body) => {
    await expect(svc.submitReview(link, body, { now: NOW })).rejects.toMatchObject({ code: "VALIDATION", status: 400 });
    expect(prisma.order_receiver_feedback.create).not.toHaveBeenCalled();
  });
  it("cuts the comment at 500 characters and de-duplicates tags", async () => {
    await svc.submitReview(link, { driver_rating: 5, tags: ["Safe Driving", "Safe Driving"], comment: "x".repeat(900) }, { now: NOW });
    const data = prisma.order_receiver_feedback.create.mock.calls[0][0].data;
    expect(data.comment).toHaveLength(500);
    expect(data.feedback_tags).toBe("Safe Driving");
  });
  it("a second review is ALREADY_SUBMITTED (409), also when the insert loses a race", async () => {
    prisma.order_receiver_feedback.findUnique.mockResolvedValue({ id: 1 });
    await expect(svc.submitReview(link, { driver_rating: 5 }, { now: NOW })).rejects.toMatchObject({ code: "ALREADY_SUBMITTED", status: 409 });
    prisma.order_receiver_feedback.findUnique.mockResolvedValue(null);
    prisma.order_receiver_feedback.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(svc.submitReview(link, { driver_rating: 5 }, { now: NOW })).rejects.toMatchObject({ code: "ALREADY_SUBMITTED", status: 409 });
  });
  it("whitelist is exactly the customer app's ten tags", () => {
    expect([...svc.ALLOWED_TAGS].sort()).toEqual([
      "Careful with items", "Careless Handling", "Clean Vehicle", "Delayed Arrival", "Demanded Extra Cash",
      "On-Time Arrival", "Polite & Helpful", "Rash Driving", "Rude Behaviour", "Safe Driving",
    ]);
  });
});

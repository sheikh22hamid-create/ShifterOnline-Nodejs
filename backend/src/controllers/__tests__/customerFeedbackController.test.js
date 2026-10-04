jest.mock("../../config/db", () => ({
  pkg_order: { findFirst: jest.fn(), update: jest.fn() },
  order_customer_feedback: { upsert: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const prisma = require("../../config/db");
const { submitCustomerFeedback } = require("../customerFeedbackController");

function res() {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
}

describe("submitCustomerFeedback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 9, uid: 3, rid: 5, cust_rate: null, cust_comment: null });
    prisma.order_customer_feedback.upsert.mockResolvedValue({ id: 1 });
    prisma.pkg_order.update.mockResolvedValue({});
  });

  it("requires order_id and uid", async () => {
    const r = res();
    await submitCustomerFeedback({ body: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it("only accepts feedback for the customer's own order", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null);
    const r = res();
    await submitCustomerFeedback({ body: { order_id: 9, uid: 3 } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(prisma.order_customer_feedback.upsert).not.toHaveBeenCalled();
  });

  it("rejects ratings outside 1-5", async () => {
    const r = res();
    await submitCustomerFeedback({ body: { order_id: 9, uid: 3, driver_rating: 6 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.order_customer_feedback.upsert).not.toHaveBeenCalled();
  });

  it("saves customer feedback and updates pkg_order rating", async () => {
    const r = res();
    await submitCustomerFeedback(
      {
        body: {
          order_id: 9,
          uid: 3,
          rider_id: 5,
          driver_rating: 5,
          delivery_rating: 4,
          vehicle_rating: 5,
          feedback_tags: ["Polite Driver", "On-Time"],
          comment: "Great experience!",
        },
      },
      r
    );
    expect(r.status).toHaveBeenCalledWith(200);
    expect(prisma.order_customer_feedback.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { order_id: 9 },
        create: expect.objectContaining({
          order_id: 9,
          uid: 3,
          rider_id: 5,
          driver_rating: 5,
          delivery_rating: 4,
          vehicle_rating: 5,
          feedback_tags: "Polite Driver, On-Time",
          comment: "Great experience!",
        }),
      })
    );
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({
        is_rate: 1,
        cust_rate: 5,
        cust_comment: "Great experience!",
      }),
    });
  });
});

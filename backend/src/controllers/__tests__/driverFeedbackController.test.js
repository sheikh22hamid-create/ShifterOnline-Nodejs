jest.mock("../../config/db", () => ({
  pkg_order: { findFirst: jest.fn(), update: jest.fn(), aggregate: jest.fn() },
  order_driver_feedback: { upsert: jest.fn() },
  tbl_goods_type: { findFirst: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

const prisma = require("../../config/db");
const { submitDriverFeedback, getRiderRatingSummary } = require("../driverFeedbackController");

function res() {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
}

describe("submitDriverFeedback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order.findFirst.mockResolvedValue({ id: 9, uid: 3, rid: 5, o_status: "Completed" });
    prisma.order_driver_feedback.upsert.mockResolvedValue({ id: 1 });
  });

  it("requires order_id and rider_id", async () => {
    const r = res();
    await submitDriverFeedback({ body: {} }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });

  it("only accepts feedback for the driver's own completed order", async () => {
    prisma.pkg_order.findFirst.mockResolvedValue(null);
    let r = res();
    await submitDriverFeedback({ body: { order_id: 9, rider_id: 5 } }, r);
    expect(r.status).toHaveBeenCalledWith(404);

    prisma.pkg_order.findFirst.mockResolvedValue({ id: 9, uid: 3, rid: 5, o_status: "Pending" });
    r = res();
    await submitDriverFeedback({ body: { order_id: 9, rider_id: 5 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.order_driver_feedback.upsert).not.toHaveBeenCalled();
  });

  it("rejects ratings outside 1-5 and unknown customer types", async () => {
    let r = res();
    await submitDriverFeedback({ body: { order_id: 9, rider_id: 5, route_rating: 6 } }, r);
    expect(r.status).toHaveBeenCalledWith(400);

    r = res();
    await submitDriverFeedback({ body: { order_id: 9, rider_id: 5, customer_type: "vip" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.order_driver_feedback.upsert).not.toHaveBeenCalled();
  });

  it("saves only the fields that were sent (everything is optional)", async () => {
    const r = res();
    await submitDriverFeedback(
      { body: { order_id: 9, rider_id: 5, customer_rating: 4, no_entry_zone: "yes", customer_type: "home_shifting" } },
      r
    );
    expect(prisma.order_driver_feedback.upsert).toHaveBeenCalledWith({
      where: { order_id: 9 },
      create: { order_id: 9, rider_id: 5, uid: 3, customer_rating: 4, no_entry_zone: true, customer_type: "home_shifting" },
      update: { customer_rating: 4, no_entry_zone: true, customer_type: "home_shifting" },
    });
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it("an empty submission is accepted and saves nothing extra", async () => {
    const r = res();
    await submitDriverFeedback({ body: { order_id: 9, rider_id: 5 } }, r);
    expect(prisma.order_driver_feedback.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: {} }));
    expect(r.status).toHaveBeenCalledWith(200);
  });

  it("lets the driver correct the goods type", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 2, name: "Clothing" });
    const r = res();
    await submitDriverFeedback({ body: { order_id: 9, rider_id: 5, goods_type_id: 2 } }, r);
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: { goods_type_id: 2, goods_type_name: "Clothing", goods_type_other: null },
    });
  });
});

describe("getRiderRatingSummary", () => {
  it("rounds the average to one decimal and returns the count", async () => {
    prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: 4.666 }, _count: { _all: 3 } });
    expect(await getRiderRatingSummary(5)).toEqual({ average: 4.7, count: 3 });
  });

  it("returns null average when there are no ratings", async () => {
    prisma.pkg_order.aggregate.mockResolvedValue({ _avg: { cust_rate: null }, _count: { _all: 0 } });
    expect(await getRiderRatingSummary(5)).toEqual({ average: null, count: 0 });
  });
});

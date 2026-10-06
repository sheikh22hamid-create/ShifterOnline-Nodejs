// backend/src/controllers/__tests__/adminReceiverFeedback.test.js
jest.mock("../../config/db", () => ({
  order_receiver_feedback: { count: jest.fn(), findMany: jest.fn() },
  pkg_order: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const prisma = require("../../config/db");
const { listReceiverFeedback } = require("../adminTripFeedbackController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const req = (query = {}, extra = {}) => ({ query, ...extra });
const row = (o = {}) => ({
  id: 1, order_id: 50, rider_id: 9, receiver_phone: "9876543210", driver_rating: 5, delivery_rating: 4,
  feedback_tags: "Safe Driving", comment: "Great", created_at: new Date("2026-10-06T10:00:00Z"), ...o,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.order_receiver_feedback.count.mockResolvedValue(1);
  prisma.order_receiver_feedback.findMany.mockResolvedValue([row()]);
  prisma.pkg_order.findMany.mockResolvedValue([{ id: 50, paddress: "P", daddress: "D", goods_type_name: "Boxes", city_id: 1 }]);
  prisma.tbl_rider.findMany.mockResolvedValue([{ id: 9, full_name: "Suresh Patel", fmobile: "9109114515" }]);
});

it("lists receiver feedback joined with the order and driver", async () => {
  const r = res();
  await listReceiverFeedback(req(), r);
  expect(r.status).toHaveBeenCalledWith(200);
  expect(r.json).toHaveBeenCalledWith({
    success: true, total: 1, page: 1, limit: 25,
    data: [{
      id: 1, order_id: 50, receiver_mobile: "9876543210", driver_id: 9, driver_name: "Suresh Patel", driver_mobile: "9109114515",
      pickup: "P", drop: "D", goods_type: "Boxes", driver_rating: 5, delivery_rating: 4,
      feedback_tags: "Safe Driving", comment: "Great", created_at: new Date("2026-10-06T10:00:00Z"),
    }],
  });
});
it("falls back to a placeholder driver name", async () => {
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  const r = res();
  await listReceiverFeedback(req(), r);
  expect(r.json.mock.calls[0][0].data[0].driver_name).toBe("Driver #9");
});
it("filters by rating on either rating column, by date range, and paginates", async () => {
  await listReceiverFeedback(req({ rating: "4", from: "2026-10-01", to: "2026-10-06", page: "2", limit: "10" }), res());
  const args = prisma.order_receiver_feedback.findMany.mock.calls[0][0];
  expect(args.where.OR).toEqual([{ driver_rating: 4 }, { delivery_rating: 4 }]);
  expect(args.where.created_at.gte).toEqual(new Date("2026-10-01T00:00:00"));
  expect(args.where.created_at.lte).toEqual(new Date("2026-10-06T23:59:59"));
  expect(args.skip).toBe(10);
  expect(args.take).toBe(10);
});
it("searches by order id, receiver number or driver name", async () => {
  prisma.tbl_rider.findMany.mockResolvedValueOnce([{ id: 9 }]).mockResolvedValue([{ id: 9, full_name: "Suresh Patel", fmobile: "1" }]);
  await listReceiverFeedback(req({ search: "50" }), res());
  const where = prisma.order_receiver_feedback.findMany.mock.calls[0][0].where;
  expect(where.AND[0].OR).toEqual(expect.arrayContaining([{ order_id: 50 }, { receiver_phone: { contains: "50" } }, { rider_id: { in: [9] } }]));
});
it("limits a city-scoped admin to that city's orders", async () => {
  prisma.pkg_order.findMany.mockResolvedValueOnce([{ id: 50 }]).mockResolvedValue([{ id: 50, paddress: "P", daddress: "D", goods_type_name: "x", city_id: 1 }]);
  await listReceiverFeedback(req({}, { scopedCityId: 1 }), res());
  expect(prisma.pkg_order.findMany.mock.calls[0][0].where).toMatchObject({ city_id: 1 });
  expect(prisma.order_receiver_feedback.findMany.mock.calls[0][0].where.AND[0]).toEqual({ order_id: { in: [50] } });
});
it("answers 500 without leaking details", async () => {
  prisma.order_receiver_feedback.count.mockRejectedValue(new Error("secret"));
  const r = res();
  await listReceiverFeedback(req(), r);
  expect(r.status).toHaveBeenCalledWith(500);
  expect(r.json).toHaveBeenCalledWith({ success: false, message: "Internal server error" });
});

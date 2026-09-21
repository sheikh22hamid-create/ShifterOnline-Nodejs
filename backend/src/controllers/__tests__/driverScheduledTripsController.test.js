const { listScheduledTrips, markInterest, removeInterest } = require("../driverScheduledTripsController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  pkg_order: { findMany: jest.fn(), findUnique: jest.fn() },
  pkg_order_interest: { findMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
}));

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

afterEach(() => {
  jest.clearAllMocks();
});

describe("listScheduledTrips", () => {
  it("returns 401-shaped error when uid is missing", async () => {
    const res = mockRes();
    await listScheduledTrips({ body: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("lists pending booking_type=2 orders in the rider's own category and city, within 7 days, marking which ones the rider is already interested in", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValueOnce({ id: 7, vehicle: "Bike", city_id: 3 });
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      { id: 100, category: "Bike", city_id: 3, schedule_date_time: "2026-09-22T15:00:00.000Z", paddress: "A", daddress: "B", total_dcharge: 120 },
    ]);
    prisma.pkg_order_interest.findMany.mockResolvedValueOnce([{ order_id: 100, rider_id: 7 }]);

    const res = mockRes();
    await listScheduledTrips({ body: { uid: 7 } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ResponseCode: "200",
      TripData: [expect.objectContaining({ id: "100", is_interested: "1" })],
    }));
  });

  it("queries pkg_order with the rider's category/city and the fixed pending/unassigned/booking_type=2 filters", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValueOnce({ id: 7, vehicle: "Bike", city_id: 3 });
    prisma.pkg_order.findMany.mockResolvedValueOnce([]);

    const res = mockRes();
    await listScheduledTrips({ body: { uid: 7 } }, res);

    expect(prisma.pkg_order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        booking_type: 2,
        o_status: "Pending",
        rid: 0,
        category: "Bike",
        city_id: 3,
      }),
    }));
  });

  it("excludes an order whose schedule_date_time is in the past", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValueOnce({ id: 7, vehicle: "Bike", city_id: 3 });
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      { id: 101, category: "Bike", city_id: 3, schedule_date_time: "2020-01-01T00:00:00.000Z", paddress: "A", daddress: "B", total_dcharge: 120 },
    ]);
    prisma.pkg_order_interest.findMany.mockResolvedValueOnce([]);

    const res = mockRes();
    await listScheduledTrips({ body: { uid: 7 } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ResponseCode: "200",
      TripData: [],
    }));
  });

  it("excludes an order whose schedule_date_time is more than 7 days out", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValueOnce({ id: 7, vehicle: "Bike", city_id: 3 });
    const farFuture = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    prisma.pkg_order.findMany.mockResolvedValueOnce([
      { id: 102, category: "Bike", city_id: 3, schedule_date_time: farFuture, paddress: "A", daddress: "B", total_dcharge: 120 },
    ]);
    prisma.pkg_order_interest.findMany.mockResolvedValueOnce([]);

    const res = mockRes();
    await listScheduledTrips({ body: { uid: 7 } }, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      ResponseCode: "200",
      TripData: [],
    }));
  });
});

describe("markInterest", () => {
  const eligibleOrder = { id: 100, booking_type: 2, o_status: "Pending", rid: 0 };

  it("requires uid and order_id", async () => {
    const res = mockRes();
    await markInterest({ body: {} }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("requires order_id when uid is present", async () => {
    const res = mockRes();
    await markInterest({ body: { uid: 7 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("requires uid when order_id is present", async () => {
    const res = mockRes();
    await markInterest({ body: { order_id: 100 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("upserts a pkg_order_interest row", async () => {
    prisma.pkg_order.findUnique.mockResolvedValueOnce(eligibleOrder);
    prisma.pkg_order_interest.create.mockResolvedValueOnce({});
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(prisma.pkg_order_interest.create).toHaveBeenCalledWith({
      data: { order_id: 100, rider_id: 7 },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "200" }));
  });

  it("treats a duplicate mark (unique constraint) as success, not an error", async () => {
    prisma.pkg_order.findUnique.mockResolvedValueOnce(eligibleOrder);
    prisma.pkg_order_interest.create.mockRejectedValueOnce({ code: "P2002" });
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "200" }));
  });

  it("returns a 401-shaped error when the order doesn't exist", async () => {
    prisma.pkg_order.findUnique.mockResolvedValueOnce(null);
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 999 } }, res);
    expect(prisma.pkg_order_interest.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("returns a 401-shaped error when the order isn't booking_type=2 (e.g. instant order)", async () => {
    prisma.pkg_order.findUnique.mockResolvedValueOnce({ id: 100, booking_type: 1, o_status: "Pending", rid: 0 });
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(prisma.pkg_order_interest.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("returns a 401-shaped error when the order isn't Pending", async () => {
    prisma.pkg_order.findUnique.mockResolvedValueOnce({ id: 100, booking_type: 2, o_status: "Processing", rid: 0 });
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(prisma.pkg_order_interest.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("returns a 401-shaped error when the order is already assigned to a rider", async () => {
    prisma.pkg_order.findUnique.mockResolvedValueOnce({ id: 100, booking_type: 2, o_status: "Pending", rid: 5 });
    const res = mockRes();
    await markInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(prisma.pkg_order_interest.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });
});

describe("removeInterest", () => {
  it("requires uid and order_id", async () => {
    const res = mockRes();
    await removeInterest({ body: {} }, res);
    expect(prisma.pkg_order_interest.deleteMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });

  it("deletes the rider's interest row for the order", async () => {
    prisma.pkg_order_interest.deleteMany.mockResolvedValueOnce({ count: 1 });
    const res = mockRes();
    await removeInterest({ body: { uid: 7, order_id: 100 } }, res);
    expect(prisma.pkg_order_interest.deleteMany).toHaveBeenCalledWith({
      where: { order_id: 100, rider_id: 7 },
    });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "200" }));
  });
});

jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), count: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
  order_status_history: { create: jest.fn() },
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock("../../services/dispatchManager", () => ({ stopDispatch: jest.fn() }));
jest.mock("../../services/pricingEngine", () => ({ priceForPackageId: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const { getIO } = require("../../sockets/socketServer");
const { assignRider, listNextDay, suggestNextDaySequence, assignNextDayBatch } = require("../adminOrderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("adminOrderController.assignRider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_order.findUnique
      .mockResolvedValueOnce({ id: 500, city_id: 1, rid: 0, order_status: 0, delivery_type: 6, distance: 10, o_status: "Pending", uid: 9 })
      .mockResolvedValueOnce({ id: 500, paddress: "A", daddress: "B", uid: 9 });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1, status: 1, a_status: 1, full_name: "Deepak" });
    prisma.pkg_order.count.mockResolvedValue(0);
    prisma.$executeRaw.mockResolvedValue(1);
    pricingEngine.priceForPackageId.mockResolvedValue({ pkg: {}, fare: 100, driverEarning: 80, commission: 20 });
    getIO.mockReturnValue({ to: jest.fn().mockReturnThis(), emit: jest.fn() });
  });

  it("stores and emits the full gross fare as driver_earning, not the commission-deducted net earning", async () => {
    const req = { params: { id: "500" }, body: { rider_id: "2" }, user: { role: "superadmin", id: 1, username: "admin" } };
    const res = makeRes();

    await assignRider(req, res);

    expect(prisma.pkg_order.update).toHaveBeenCalledWith({
      where: { id: 500 },
      data: { driver_earning: 100, commission: 20 },
    });
    const io = getIO.mock.results[0].value;
    expect(io.emit).toHaveBeenCalledWith(
      "order:assigned",
      expect.objectContaining({ driver_earning: "100" })
    );
  });
});

describe("adminOrderController next-day orders", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("listNextDay", () => {
    it("filters to booking_type 3 only", async () => {
      prisma.pkg_order.findMany.mockResolvedValue([{ id: 1, booking_type: 3 }]);
      const req = { query: {}, scopedCityId: null };
      const res = makeRes();

      await listNextDay(req, res);

      expect(prisma.pkg_order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { booking_type: 3 } })
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe("suggestNextDaySequence", () => {
    it("orders by nearest-pickup-from-driver, then nearest-pickup-from-previous-drop", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, rlats: "0", rlongs: "0" });
      prisma.pkg_order.findMany.mockResolvedValue([
        { id: 100, booking_type: 3, plat: 0, plong: 5, dlat: 0, dlong: 6 },
        { id: 200, booking_type: 3, plat: 0, plong: 1, dlat: 0, dlong: 2 },
      ]);
      const req = { body: { rider_id: "2", order_ids: [100, 200] } };
      const res = makeRes();

      await suggestNextDaySequence(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const payload = res.json.mock.calls[0][0];
      expect(payload.data.map((s) => s.order_id)).toEqual([200, 100]);
    });

    it("404s when the driver doesn't exist", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue(null);
      const req = { body: { rider_id: "999", order_ids: [1] } };
      const res = makeRes();

      await suggestNextDaySequence(req, res);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("403s when the driver is outside a city-scoped admin's assigned city", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 2, rlats: "0", rlongs: "0" });
      const req = { body: { rider_id: "2", order_ids: [100] }, user: { role: "admin", city_id: 1 } };
      const res = makeRes();

      await suggestNextDaySequence(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.pkg_order.findMany).not.toHaveBeenCalled();
    });

    it("403s when an order in the batch is outside a city-scoped admin's assigned city", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1, rlats: "0", rlongs: "0" });
      prisma.pkg_order.findMany.mockResolvedValue([
        { id: 100, booking_type: 3, city_id: 2, plat: 0, plong: 5, dlat: 0, dlong: 6 },
      ]);
      const req = { body: { rider_id: "2", order_ids: [100] }, user: { role: "admin", city_id: 1 } };
      const res = makeRes();

      await suggestNextDaySequence(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
    });
  });

  describe("assignNextDayBatch", () => {
    it("sets rid and next_day_sequence on every order in the batch, and notifies the driver once", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1 });
      prisma.pkg_order.findMany.mockResolvedValue([
        { id: 200, booking_type: 3, city_id: 1, paddress: "A", daddress: "B" },
        { id: 100, booking_type: 3, city_id: 1, paddress: "C", daddress: "D" },
      ]);
      prisma.pkg_order.update.mockResolvedValue({});
      prisma.$transaction.mockResolvedValue([{}, {}]);
      getIO.mockReturnValue({ to: jest.fn().mockReturnThis(), emit: jest.fn() });
      const req = {
        body: {
          rider_id: "2",
          notify_driver_now: true,
          sequence: [{ order_id: 200, position: 1 }, { order_id: 100, position: 2 }],
        },
        user: { role: "superadmin" },
      };
      const res = makeRes();

      await assignNextDayBatch(req, res);

      expect(prisma.$transaction).toHaveBeenCalledWith([
        expect.anything(),
        expect.anything(),
      ]);
      expect(prisma.pkg_order.update).toHaveBeenNthCalledWith(1, {
        where: { id: 200 },
        data: { rid: 2, next_day_sequence: 1 },
      });
      expect(prisma.pkg_order.update).toHaveBeenNthCalledWith(2, {
        where: { id: 100 },
        data: { rid: 2, next_day_sequence: 2 },
      });
      expect(prisma.tbl_rnoti.create).toHaveBeenCalledTimes(1);
      const io = getIO.mock.results[0].value;
      expect(io.emit).toHaveBeenCalledWith("order:next_day_assigned", expect.objectContaining({
        orders: expect.arrayContaining([expect.objectContaining({ order_id: 200, sequence: 1 })]),
      }));
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("rejects a batch containing a non-next-day order", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1 });
      prisma.pkg_order.findMany.mockResolvedValue([{ id: 200, booking_type: 1, city_id: 1 }]);
      const req = { body: { rider_id: "2", sequence: [{ order_id: 200, position: 1 }] }, user: { role: "superadmin" } };
      const res = makeRes();

      await assignNextDayBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("403s when the driver is outside a city-scoped admin's assigned city", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 2 });
      const req = {
        body: { rider_id: "2", sequence: [{ order_id: 200, position: 1 }] },
        user: { role: "admin", city_id: 1 },
      };
      const res = makeRes();

      await assignNextDayBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("403s when an order in the batch is outside a city-scoped admin's assigned city", async () => {
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 2, city_id: 1 });
      prisma.pkg_order.findMany.mockResolvedValue([{ id: 200, booking_type: 3, city_id: 2 }]);
      const req = {
        body: { rider_id: "2", sequence: [{ order_id: 200, position: 1 }] },
        user: { role: "admin", city_id: 1 },
      };
      const res = makeRes();

      await assignNextDayBatch(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});

jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  order_status_history: { create: jest.fn() },
  $executeRaw: jest.fn(),
}));
jest.mock("../../services/dispatchManager", () => ({ stopDispatch: jest.fn() }));
jest.mock("../../services/pricingEngine", () => ({ priceForPackageId: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyOrderStatusUpdate: jest.fn() }));
jest.mock("../../sockets/socketServer", () => ({ getIO: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const { getIO } = require("../../sockets/socketServer");
const { assignRider } = require("../adminOrderController");

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

jest.mock("../../config/db", () => ({
  tbl_rider: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_city: { findMany: jest.fn().mockResolvedValue([]) },
  tbl_rnoti: { create: jest.fn() },
}));

const prisma = require("../../config/db");
const { listModel1Suspended, unsuspendModel1 } = require("../adminRiderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("adminRiderController.listModel1Suspended", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns riders currently suspended from Model 1", async () => {
    const suspendedUntil = new Date(Date.now() + 60 * 60 * 1000);
    prisma.tbl_rider.findMany.mockResolvedValue([
      { id: 42, full_name: "Raju Kumar", first_name: null, last_name: null, fmobile: "9876543210", city_id: 1, model1_suspended_until: suspendedUntil },
    ]);

    const req = { query: {}, scopedCityId: null };
    const res = makeRes();
    await listModel1Suspended(req, res);

    expect(prisma.tbl_rider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ model1_suspended_until: { gt: expect.any(Date) } }) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.total).toBe(1);
    expect(payload.data[0]).toMatchObject({ id: 42, full_name: "Raju Kumar", model1_suspended_until: suspendedUntil });
  });

  it("scopes the query to the admin's city when scopedCityId is set", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    const req = { query: {}, scopedCityId: 7 };
    const res = makeRes();

    await listModel1Suspended(req, res);

    expect(prisma.tbl_rider.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ city_id: 7 }) })
    );
  });
});

describe("adminRiderController.unsuspendModel1", () => {
  afterEach(() => jest.clearAllMocks());

  it("clears the suspension and miss streak, and notifies the driver", async () => {
    const req = { params: { id: "42" }, user: { role: "superadmin" } };
    const res = makeRes();
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 42,
      city_id: 1,
      model1_suspended_until: new Date(Date.now() + 60 * 60 * 1000),
    });

    await unsuspendModel1(req, res);

    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 42 },
      data: { model1_suspended_until: null, model1_miss_streak: 0 },
    });
    expect(prisma.tbl_rnoti.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rid: 42, type: "account_status" }) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s for an unknown driver", async () => {
    const req = { params: { id: "999" }, user: { role: "superadmin" } };
    const res = makeRes();
    prisma.tbl_rider.findUnique.mockResolvedValue(null);

    await unsuspendModel1(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("400s when the driver isn't currently suspended", async () => {
    const req = { params: { id: "42" }, user: { role: "superadmin" } };
    const res = makeRes();
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 42, city_id: 1, model1_suspended_until: null });

    await unsuspendModel1(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("403s when the driver is outside the admin's scoped city", async () => {
    const req = { params: { id: "42" }, user: { role: "admin", city_id: "2" } };
    const res = makeRes();
    prisma.tbl_rider.findUnique.mockResolvedValue({
      id: 42,
      city_id: 1,
      model1_suspended_until: new Date(Date.now() + 60 * 60 * 1000),
    });

    await unsuspendModel1(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
});

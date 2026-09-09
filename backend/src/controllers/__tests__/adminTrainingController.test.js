jest.mock("../../config/db", () => ({
  tbl_rider: { findMany: jest.fn(), findUnique: jest.fn() },
  driver_training_progress: { findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
}));

const prisma = require("../../config/db");
const { listProgress, resetProgress } = require("../adminTrainingController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("adminTrainingController.listProgress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("includes drivers with no progress row as 0%, not completed", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 1, first_name: "A", last_name: "B", full_name: null, fmobile: "999", city_id: 1 }]);
    prisma.driver_training_progress.findMany.mockResolvedValue([]);

    const req = { query: {}, scopedCityId: null };
    const res = makeRes();
    await listProgress(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toEqual([expect.objectContaining({ rider_id: 1, watch_progress: 0, is_completed: false })]);
  });

  it("filters to pending drivers when status=pending", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([
      { id: 1, full_name: "Done", fmobile: "1", city_id: 1 },
      { id: 2, full_name: "Not done", fmobile: "2", city_id: 1 },
    ]);
    prisma.driver_training_progress.findMany.mockResolvedValue([
      { rider_id: 1, watch_progress: 100, is_completed: true, completed_at: new Date(), updated_at: new Date() },
    ]);

    const req = { query: { status: "pending" }, scopedCityId: null };
    const res = makeRes();
    await listProgress(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].rider_id).toBe(2);
  });
});

describe("adminTrainingController.resetProgress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes the driver's progress row", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ city_id: 1 });
    prisma.driver_training_progress.findUnique.mockResolvedValue({ rider_id: 7 });
    prisma.driver_training_progress.delete.mockResolvedValue({});

    const req = { params: { riderId: "7" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await resetProgress(req, res);

    expect(prisma.driver_training_progress.delete).toHaveBeenCalledWith({ where: { rider_id: 7 } });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s when the driver has no progress to reset", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ city_id: 1 });
    prisma.driver_training_progress.findUnique.mockResolvedValue(null);

    const req = { params: { riderId: "7" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await resetProgress(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.driver_training_progress.delete).not.toHaveBeenCalled();
  });

  it("403s when a city-scoped admin targets a driver outside their city", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ city_id: 2 });

    const req = { params: { riderId: "7" }, user: { role: "admin", city_id: 1 } };
    const res = makeRes();
    await resetProgress(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.driver_training_progress.delete).not.toHaveBeenCalled();
  });
});

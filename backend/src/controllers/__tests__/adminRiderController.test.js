jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  tbl_city: { findUnique: jest.fn() },
  tbl_personal_doc: { findFirst: jest.fn() },
  tbl_vehicle_details: { findMany: jest.fn() },
  tbl_bank_account: { findMany: jest.fn() },
  tbl_eme_contact: { findFirst: jest.fn() },
  tbl_kit: { findFirst: jest.fn() },
  driver_training_progress: { findUnique: jest.fn() },
}));

const prisma = require("../../config/db");
const { getOne } = require("../adminRiderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("adminRiderController.getOne", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 3, city_id: 1, first_name: "A", last_name: "B", full_name: null });
    prisma.tbl_city.findUnique.mockResolvedValue({ title: "City" });
    prisma.tbl_personal_doc.findFirst.mockResolvedValue(null);
    prisma.tbl_vehicle_details.findMany.mockResolvedValue([]);
    prisma.tbl_bank_account.findMany.mockResolvedValue([]);
    prisma.tbl_eme_contact.findFirst.mockResolvedValue(null);
    prisma.tbl_kit.findFirst.mockResolvedValue(null);
  });

  it("includes a null training field when the driver has no progress row", async () => {
    prisma.driver_training_progress.findUnique.mockResolvedValue(null);

    const req = { params: { id: "3" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await getOne(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.training).toBeNull();
  });

  it("includes percent/completion when a progress row exists", async () => {
    prisma.driver_training_progress.findUnique.mockResolvedValue({
      watch_progress: 55.5,
      is_completed: false,
      completed_at: null,
    });

    const req = { params: { id: "3" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await getOne(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.training).toEqual({ percent: 55.5, is_completed: false, completed_at: null });
  });
});

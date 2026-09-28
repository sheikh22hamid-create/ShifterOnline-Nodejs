jest.mock("../../config/db", () => ({
  tbl_referral_point_log: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
}));

const prisma = require("../../config/db");
const { listPointLog } = require("../referralController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("referralController.listPointLog", () => {
  beforeEach(() => jest.clearAllMocks());

  it("enriches driver and customer names and returns them with each log row", async () => {
    prisma.tbl_referral_point_log.findMany.mockResolvedValue([
      { id: 2, user_id: 5, user_type: "DRIVER", points: 50, txn_type: "credit", source: "signup_bonus", ref_id: 0, balance_after: 50, note: "Sign-up bonus", created_at: new Date() },
      { id: 1, user_id: 9, user_type: "USER", points: 50, txn_type: "credit", source: "signup_bonus", ref_id: 0, balance_after: 50, note: "Sign-up bonus", created_at: new Date() },
    ]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 5, full_name: "Ravi Driver", fmobile: "9998887771", city_id: 1 }]);
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 9, name: "Priya Customer", mobile: 9998887772, city_id: 1 }]);

    const res = mockRes();
    await listPointLog({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(2);
    expect(payload.data[0].user).toEqual(expect.objectContaining({ id: 5, type: "DRIVER", name: "Ravi Driver", mobile: "9998887771" }));
    expect(payload.data[1].user).toEqual(expect.objectContaining({ id: 9, type: "USER", name: "Priya Customer" }));
  });

  it("filters by source when provided", async () => {
    prisma.tbl_referral_point_log.findMany.mockResolvedValue([]);
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    prisma.tbl_user.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listPointLog({ query: { source: "signup_bonus" } }, res);

    expect(prisma.tbl_referral_point_log.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { source: "signup_bonus" } })
    );
  });

  it("falls back to a placeholder name when the entity row is missing", async () => {
    prisma.tbl_referral_point_log.findMany.mockResolvedValue([
      { id: 1, user_id: 42, user_type: "USER", points: 10, txn_type: "credit", source: "signup_bonus", ref_id: 0, balance_after: 10, note: "", created_at: new Date() },
    ]);
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    prisma.tbl_user.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listPointLog({ query: {} }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data[0].user.name).toBe("Customer #42");
  });

  it("paginates the results", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({
      id: 30 - i, user_id: 1, user_type: "USER", points: 1, txn_type: "credit", source: "signup_bonus", ref_id: 0, balance_after: 1, note: "", created_at: new Date(),
    }));
    prisma.tbl_referral_point_log.findMany.mockResolvedValue(rows);
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    prisma.tbl_user.findMany.mockResolvedValue([]);

    const res = mockRes();
    await listPointLog({ query: { page: "2", limit: "20" } }, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.total).toBe(30);
    expect(payload.data).toHaveLength(10);
  });
});

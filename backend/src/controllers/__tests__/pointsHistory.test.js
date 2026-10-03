jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn() },
  tbl_user: { findFirst: jest.fn() },
  tbl_referral_point_log: { findMany: jest.fn(), aggregate: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
const db = require("../../config/db");
const { pointsHistory } = require("../customerWalletController");

async function request(body = {}) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await pointsHistory({ body: { mobile: "6378211202", wallet_type: "user", ...body } }, res);
  return res.json.mock.calls[0][0];
}

beforeEach(() => {
  jest.clearAllMocks();
  db.tbl_user.findFirst.mockResolvedValue({ id: 29, referral_points: 100 });
  db.tbl_rider.findFirst.mockResolvedValue({ id: 31, referral_points: 40 });
  db.tbl_referral_point_log.findMany.mockResolvedValue([
    { id: 3, points: -43, txn_type: "debit", source: "ride_discount", balance_after: 57, note: "Redeemed for ride discount (₹43)", created_at: new Date("2026-10-03T20:31:00Z") },
    { id: 2, points: 100, txn_type: "credit", source: "admin_adjustment", balance_after: 100, note: "Manual credit by admin #1", created_at: new Date("2026-10-03T19:00:00Z") },
  ]);
  db.tbl_referral_point_log.aggregate.mockImplementation(async ({ where }) => ({ _sum: { points: where.points?.gt === 0 ? 150 : -50 } }));
});

describe("customerWalletController.pointsHistory", () => {
  it("returns the balance, lifetime earned/used totals and labelled rows for a customer", async () => {
    const result = await request();

    expect(result.Result).toBe(true);
    expect(result.points_balance).toBe(100);
    expect(result.total_earned).toBe(150);
    expect(result.total_used).toBe(50);
    expect(result.data[0]).toEqual(expect.objectContaining({
      id: 3, points: -43, txn_type: "debit", source: "ride_discount", source_label: "Used on a ride", balance_after: 57,
    }));
    expect(result.data[1].source_label).toBe("Added by Shifter");
  });

  it("only reads the log of that account type (USER vs DRIVER ids can overlap)", async () => {
    await request();
    expect(db.tbl_referral_point_log.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { user_id: 29, user_type: "USER" },
      orderBy: { id: "desc" },
    }));

    await request({ wallet_type: "driver" });
    expect(db.tbl_referral_point_log.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { user_id: 31, user_type: "DRIVER" },
    }));
  });

  it("uses the driver's own point balance for wallet_type=driver", async () => {
    const result = await request({ wallet_type: "driver" });
    expect(result.points_balance).toBe(40);
  });

  it("formats created_at like the wallet ledger (zone-less string)", async () => {
    const result = await request();
    expect(result.data[0].created_at).toBe("2026-10-03 20:31:00");
  });

  it("pages the rows and caps the page size", async () => {
    await request({ page: 3, limit: 1000 });
    expect(db.tbl_referral_point_log.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 200, take: 100 }));
  });

  it("falls back to a readable label for an unknown source", async () => {
    db.tbl_referral_point_log.findMany.mockResolvedValue([
      { id: 9, points: 5, txn_type: "credit", source: "some_new_source", balance_after: 5, note: null, created_at: new Date("2026-10-03T00:00:00Z") },
    ]);
    const result = await request();
    expect(result.data[0].source_label).toBe("Some new source");
  });

  it("rejects missing params and unknown accounts", async () => {
    expect((await request({ mobile: "" })).Result).toBe(false);
    db.tbl_user.findFirst.mockResolvedValue(null);
    const result = await request();
    expect(result.Result).toBe(false);
    expect(result.msg).toBe("User Not Found");
  });
});

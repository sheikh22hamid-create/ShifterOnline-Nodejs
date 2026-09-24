jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  tbl_wallet_history: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

const prisma = require("../../config/db");
const { walletHistory } = require("../adminRiderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("adminRiderController.walletHistory", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns the driver's ledger balance and recent transactions", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 7, city_id: 1, wallet_balance: "350.00" });
    prisma.tbl_wallet_history.findMany.mockResolvedValue([
      { id: 2, amount: "10.00", type: "debit", remark: "Ledger Withdraw via UPI (driver@okhdfc)", order_id: null, created_at: new Date("2026-09-24T00:00:00Z") },
      { id: 1, amount: "20.00", type: "credit", remark: "Admin deduction for order #1", order_id: 1, created_at: new Date("2026-09-23T00:00:00Z") },
    ]);

    const req = { params: { id: "7" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await walletHistory(req, res);

    expect(prisma.tbl_wallet_history.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 7, wallet_type: "driver" }, orderBy: { id: "desc" }, take: 100 })
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.data.wallet_balance).toBe("350.00");
    expect(payload.data.transactions[0].remark).toBe("Ledger Withdraw via UPI (driver@okhdfc)");
  });

  it("404s when the driver does not exist", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(null);
    const req = { params: { id: "999" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await walletHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("403s when a scoped (non-superadmin) admin requests a driver outside their city", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 7, city_id: 2, wallet_balance: "0.00" });
    const req = { params: { id: "7" }, user: { role: "admin", city_id: 1 } };
    const res = makeRes();
    await walletHistory(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.tbl_wallet_history.findMany).not.toHaveBeenCalled();
  });
});

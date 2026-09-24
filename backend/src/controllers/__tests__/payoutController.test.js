jest.mock("../../config/db", () => ({
  driver_withdraw_requests: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  tbl_bank_account: { findMany: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyPayoutUpdate: jest.fn() }));

const prisma = require("../../config/db");
const { approve } = require("../payoutController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("payoutController.approve", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
  });

  // This is the other half of the withdraw-approval fix: once admin approves
  // a pending request created by customerWalletController.withdrawWallet,
  // the debit's ledger remark must carry the UPI/bank the driver picked at
  // request time (the request row's payout_detail snapshot) - not silently
  // drop it, which would put admin back to not knowing where to send money.
  it("folds the request's payout_detail snapshot into the ledger remark on approval", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue({
      id: 55, rider_id: 7, amount: "2.00", status: "pending", city_id: 3,
      payout_method: "upi", payout_detail: "UPI (driver@okhdfc)",
    });
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 7, wallet_balance: "10.00", city_id: 3 });

    const req = { params: { id: "55" }, body: {}, user: { role: "superadmin" } };
    const res = mockRes();
    await approve(req, res);

    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ remark: expect.stringContaining("via UPI (driver@okhdfc)") }) })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("refuses to approve a request that isn't pending", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue({ id: 55, rider_id: 7, amount: "2.00", status: "approved" });
    const req = { params: { id: "55" }, body: {}, user: { role: "superadmin" } };
    const res = mockRes();
    await approve(req, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

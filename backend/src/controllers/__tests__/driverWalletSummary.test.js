jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn() }, tbl_user: { findFirst: jest.fn() },
  tbl_wallet_history: { findMany: jest.fn() },
  driver_withdraw_requests: { aggregate: jest.fn(), findFirst: jest.fn() },
  tbl_bank_account: { findFirst: jest.fn() },
  app_settings: { findFirst: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
const db = require("../../config/db");
const { walletHistory } = require("../customerWalletController");
async function request(body = {}) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  await walletHistory({ body: { mobile: "9000000000", wallet_type: "driver", ...body } }, res);
  return res.json.mock.calls[0][0];
}
beforeEach(() => {
  jest.clearAllMocks();
  db.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "500.25" });
  db.tbl_wallet_history.findMany.mockResolvedValue([]);
  db.driver_withdraw_requests.aggregate.mockResolvedValue({ _sum: { amount: "125.10" } });
  db.driver_withdraw_requests.findFirst.mockResolvedValue({ id: 9, amount: "125.10", status: "pending", created_at: new Date("2026-09-22T00:00:00Z") });
});
it("subtracts pending reservations from wallet balance without changing the balance", async () => {
  const result = await request();
  expect(result.wallet_balance).toBe("500.25");
  expect(result.pending_withdrawal_amount).toBe("125.10");
  expect(result.available_to_withdraw).toBe("375.15");
  expect(result.latest_withdrawal.status).toBe("pending");
  expect(db.driver_withdraw_requests.aggregate).toHaveBeenCalledWith({ where: { rider_id: 7, status: "pending" }, _sum: { amount: true } });
});
it("does not filter current withdrawal availability by transaction history dates", async () => {
  await request({ from_date: "2026-09-01", to_date: "2026-09-02", txn_type: "debit" });
  expect(db.driver_withdraw_requests.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { rider_id: 7 } }));
});
it("shows no requests explicitly and prevents negative available balance", async () => {
  db.driver_withdraw_requests.findFirst.mockResolvedValue(null);
  db.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-5.00" });
  const result = await request();
  expect(result.latest_withdrawal).toBeNull(); expect(result.available_to_withdraw).toBe("0.00");
});
it("keeps the customer wallet response unchanged", async () => {
  db.tbl_user.findFirst.mockResolvedValue({ id: 2, wallet: "90.00" });
  const result = await request({ wallet_type: "user" });
  expect(result.wallet_balance).toBe("90.00"); expect(result).not.toHaveProperty("available_to_withdraw");
  expect(db.driver_withdraw_requests.aggregate).not.toHaveBeenCalled();
});

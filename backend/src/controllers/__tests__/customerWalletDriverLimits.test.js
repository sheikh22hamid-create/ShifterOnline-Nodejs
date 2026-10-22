jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findFirst: jest.fn() },
  tbl_wallet_history: { findMany: jest.fn() },
  driver_withdraw_requests: { aggregate: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  tbl_bank_account: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn(), fetchRazorpayOrder: jest.fn() }));
jest.mock("../../services/driverWalletSettings", () => ({
  getDriverMaxDueLimit: jest.fn(), getDriverMinWithdrawalAmount: jest.fn(), getCustomerWalletMaxTopup: jest.fn().mockResolvedValue(50000),
}));

const prisma = require("../../config/db");
const { getDriverMaxDueLimit, getDriverMinWithdrawalAmount } = require("../../services/driverWalletSettings");
const { withdrawWallet, walletHistory } = require("../customerWalletController");

const mockRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
const sent = (res) => res.json.mock.calls[0][0];

describe("driver wallet limits follow the driver's vehicle type", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.driver_withdraw_requests.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.driver_withdraw_requests.findFirst.mockResolvedValue(null);
    prisma.tbl_wallet_history.findMany.mockResolvedValue([]);
    getDriverMaxDueLimit.mockResolvedValue(200);
    getDriverMinWithdrawalAmount.mockResolvedValue(300);
  });

  it("withdraw looks up the minimum balance for the rider's vehicle and flags a violation with the amount", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, vehicle: "Three Wheeler", wallet_balance: "350.00" });
    const res = mockRes();
    await withdrawWallet({ body: { mobile: "9999999999", amount: 100, wallet_type: "driver" } }, res);
    expect(getDriverMinWithdrawalAmount).toHaveBeenCalledWith("Three Wheeler");
    expect(prisma.driver_withdraw_requests.create).not.toHaveBeenCalled();
    expect(sent(res)).toMatchObject({ Result: "false", min_balance_violation: true, min_required_balance: 300, current_balance: 350, max_withdrawable: 50 });
    expect(sent(res).ResponseMsg).toContain("₹300");
  });

  it("history summary reports the vehicle's minimum balance and negative limit, and the saved bank details", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, vehicle: "Three Wheeler", wallet_balance: "500.00", upi_id: "ram@okbank" });
    prisma.tbl_bank_account.findFirst.mockResolvedValue({ bank_name: "SBI", a_name: "Ram Kumar", ifsc_code: "SBIN0001234", iban_num: "123456789012" });
    const res = mockRes();
    await walletHistory({ body: { mobile: "9999999999", wallet_type: "driver" } }, res);
    expect(getDriverMaxDueLimit).toHaveBeenCalledWith("Three Wheeler");
    expect(getDriverMinWithdrawalAmount).toHaveBeenCalledWith("Three Wheeler");
    const body = sent(res);
    expect(body).toMatchObject({ vehicle_name: "Three Wheeler", min_required_balance: 300, max_due_limit: 200, available_to_withdraw: "200.00" });
    expect(body.payout_methods.upi_id).toBe("ram@okbank");
    expect(body.payout_methods.bank_account).toMatchObject({ bank_name: "SBI", account_name: "Ram Kumar", ifsc_code: "SBIN0001234", account_number: "123456789012", account_number_masked: "•••9012" });
  });
});

describe("withdraw payout details are validated", () => {
  const body = (extra) => ({ body: { mobile: "9999999999", amount: 100, wallet_type: "driver", ...extra } });
  beforeEach(() => {
    jest.clearAllMocks();
    getDriverMinWithdrawalAmount.mockResolvedValue(0);
    prisma.driver_withdraw_requests.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, vehicle: "Bike", wallet_balance: "500.00", city_id: 1 });
    prisma.driver_withdraw_requests.create.mockResolvedValue({ id: 9 });
    prisma.tbl_bank_account.findFirst.mockResolvedValue(null);
  });

  it("rejects a malformed UPI id and saves nothing", async () => {
    const res = mockRes();
    await withdrawWallet(body({ payout_method: "upi", upi_id: "not a upi" }), res);
    expect(sent(res)).toMatchObject({ Result: "false", ResponseCode: "405" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.driver_withdraw_requests.create).not.toHaveBeenCalled();
  });

  it("accepts and saves an edited, valid UPI id", async () => {
    const res = mockRes();
    await withdrawWallet(body({ payout_method: "upi", upi_id: "ram.kumar@okhdfcbank" }), res);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { upi_id: "ram.kumar@okhdfcbank" } });
    expect(sent(res)).toMatchObject({ Result: "true", request_id: 9 });
  });

  it.each([
    ["a short account number", { account_number: "1234" }],
    ["letters in the account number", { account_number: "12345678AB" }],
    ["a malformed IFSC", { ifsc_code: "BAD123" }],
    ["a numeric account holder name", { account_name: "12345" }],
  ])("rejects %s", async (_label, override) => {
    const res = mockRes();
    await withdrawWallet(body({
      payout_method: "bank", account_name: "Ram Kumar", account_number: "123456789012", ifsc_code: "SBIN0001234", bank_name: "SBI", ...override,
    }), res);
    expect(sent(res)).toMatchObject({ Result: "false", ResponseCode: "405" });
    expect(prisma.tbl_bank_account.create).not.toHaveBeenCalled();
    expect(prisma.driver_withdraw_requests.create).not.toHaveBeenCalled();
  });

  it("saves valid edited bank details, normalising spaces and IFSC case", async () => {
    prisma.tbl_bank_account.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ bank_name: "SBI", iban_num: "123456789012" });
    const res = mockRes();
    await withdrawWallet(body({
      payout_method: "bank", account_name: "Ram Kumar", account_number: "1234 5678 9012", ifsc_code: "sbin0001234", bank_name: "SBI",
    }), res);
    expect(prisma.tbl_bank_account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rider_id: 7, a_name: "Ram Kumar", iban_num: "123456789012", ifsc_code: "SBIN0001234", bank_name: "SBI" }),
    });
    expect(sent(res)).toMatchObject({ Result: "true" });
  });
});

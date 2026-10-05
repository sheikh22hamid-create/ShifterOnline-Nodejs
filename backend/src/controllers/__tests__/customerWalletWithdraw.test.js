jest.mock("../../config/db", () => ({
  tbl_user: { findFirst: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/walletNotifier", () => ({}));
jest.mock("../../services/driverWalletSettings", () => ({}));
jest.mock("../../utils/razorpayVerify", () => ({}));

const prisma = require("../../config/db");
const { withdrawWallet } = require("../customerWalletController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

describe("withdrawWallet - customer wallet is spend-only", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects an explicit customer withdrawal and never touches the account", async () => {
    const r = res();
    await withdrawWallet({ body: { mobile: "9999999999", amount: 50, wallet_type: "user" } }, r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "403", Result: "false" }));
    expect(prisma.tbl_user.findFirst).not.toHaveBeenCalled();
  });

  it("rejects when wallet_type is omitted (it defaults to the customer wallet)", async () => {
    const r = res();
    await withdrawWallet({ body: { mobile: "9999999999", amount: 50 } }, r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "403" }));
    expect(prisma.tbl_user.findFirst).not.toHaveBeenCalled();
  });

  it("still lets the driver path through to its own account lookup", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    const r = res();
    await withdrawWallet({ body: { mobile: "9999999999", amount: 50, wallet_type: "driver" } }, r);
    expect(prisma.tbl_rider.findFirst).toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });
});

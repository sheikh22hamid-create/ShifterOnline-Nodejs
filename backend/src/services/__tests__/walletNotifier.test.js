jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyDriverWalletTransaction: jest.fn() }));

const prisma = require("../../config/db");
const pushNotifier = require("../pushNotifier");
const { notifyDriverWalletTransaction } = require("../walletNotifier");

describe("walletNotifier.notifyDriverWalletTransaction", () => {
  beforeEach(() => jest.clearAllMocks());

  it("writes an in-app notification and sends a push when the driver has an fcm token", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "token-123" });
    prisma.tbl_rnoti.create.mockResolvedValue({ id: 1 });

    await notifyDriverWalletTransaction(7, { type: "credit", amount: 50, remark: "Cancellation compensation for order #1" });

    expect(prisma.tbl_rnoti.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rid: 7, type: "wallet" }) })
    );
    expect(pushNotifier.notifyDriverWalletTransaction).toHaveBeenCalledWith(
      "token-123", "credit", "₹50.00", "Cancellation compensation for order #1"
    );
  });

  it("still writes the in-app notification when the driver has no fcm token, but skips the push", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: null });
    prisma.tbl_rnoti.create.mockResolvedValue({ id: 1 });

    await notifyDriverWalletTransaction(7, { type: "debit", amount: 10, remark: "Admin deduction for order #2" });

    expect(prisma.tbl_rnoti.create).toHaveBeenCalled();
    expect(pushNotifier.notifyDriverWalletTransaction).not.toHaveBeenCalled();
  });

  it("never throws, even if the DB lookup fails", async () => {
    prisma.tbl_rider.findUnique.mockRejectedValue(new Error("db down"));
    await expect(notifyDriverWalletTransaction(7, { type: "credit", amount: 10, remark: "x" })).resolves.toBeUndefined();
  });
});

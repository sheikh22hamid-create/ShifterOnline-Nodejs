const mockTx = {
  $queryRaw: jest.fn(),
  pkg_order: { findUnique: jest.fn() },
  tbl_user: { update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
};

jest.mock("../../config/db", () => ({
  $transaction: jest.fn((fn) => fn(mockTx)),
  tbl_wallet_history: { findFirst: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), info: jest.fn() }));

const prisma = require("../../config/db");
const {
  isWalletPaidOrder, linkWalletPrepayment, refundWalletPrepayment, refundIfWalletPaid,
} = require("../walletPrepaymentRefund");

beforeEach(() => {
  jest.clearAllMocks();
  mockTx.pkg_order.findUnique.mockResolvedValue({ uid: 9 });
  mockTx.tbl_wallet_history.findFirst.mockResolvedValue(null);
  mockTx.tbl_wallet_history.findMany.mockResolvedValue([{ id: 1, amount: "86.00" }]);
});

describe("isWalletPaidOrder", () => {
  it("recognises wallet bookings by p_method_id -2 or a wallet_ transaction id", () => {
    expect(isWalletPaidOrder({ p_method_id: -2 })).toBe(true);
    expect(isWalletPaidOrder({ p_method_id: 0, trans_id: "wallet_1700000000" })).toBe(true);
    expect(isWalletPaidOrder({ p_method_id: 2, trans_id: "cash_1700000000" })).toBe(false);
    expect(isWalletPaidOrder({})).toBe(false);
    expect(isWalletPaidOrder(null)).toBe(false);
  });
});

describe("linkWalletPrepayment", () => {
  it("attaches the customer's latest unlinked 'Delivery payment' debit to the order", async () => {
    prisma.tbl_wallet_history.findFirst.mockResolvedValue({ id: 41, amount: "86.00" });
    prisma.tbl_wallet_history.updateMany.mockResolvedValue({ count: 1 });

    const row = await linkWalletPrepayment({ uid: 9, orderId: 199 });

    expect(prisma.tbl_wallet_history.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ user_id: 9, wallet_type: "user", type: "debit", remark: "Delivery payment", order_id: null }),
      orderBy: { id: "desc" },
    }));
    expect(prisma.tbl_wallet_history.updateMany).toHaveBeenCalledWith({ where: { id: 41, order_id: null }, data: { order_id: 199 } });
    expect(row.id).toBe(41);
  });

  it("does nothing when there is no recent unlinked payment", async () => {
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
    expect(await linkWalletPrepayment({ uid: 9, orderId: 199 })).toBeNull();
    expect(prisma.tbl_wallet_history.updateMany).not.toHaveBeenCalled();
  });
});

describe("refundWalletPrepayment", () => {
  it("returns the whole prepaid fare to the wallet and writes one credit row", async () => {
    const result = await refundWalletPrepayment(199);

    expect(result).toEqual({ refunded: 86, paid: 86 });
    expect(mockTx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet: { increment: 86 } } });
    expect(mockTx.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user_id: 9, amount: 86, type: "credit", wallet_type: "user", order_id: 199, payment_id: "wallet_prepay_refund:199",
      }),
    });
  });

  it("keeps the cancellation charge: refund = paid - charge", async () => {
    const result = await refundWalletPrepayment(199, { deduct: 15 });
    expect(result).toEqual({ refunded: 71, paid: 86 });
    expect(mockTx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet: { increment: 71 } } });
  });

  it("never refunds a negative amount when the charge exceeds the payment", async () => {
    const result = await refundWalletPrepayment(199, { deduct: 500 });
    expect(result.refunded).toBe(0);
    expect(mockTx.tbl_user.update).not.toHaveBeenCalled();
    expect(mockTx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("is idempotent: a second call for the same order refunds nothing", async () => {
    mockTx.tbl_wallet_history.findFirst.mockResolvedValue({ id: 99 }); // refund row already exists
    const result = await refundWalletPrepayment(199);
    expect(result).toEqual({ refunded: 0, alreadyRefunded: true });
    expect(mockTx.tbl_user.update).not.toHaveBeenCalled();
  });

  it("does nothing when no wallet payment is linked to the order (cash/online or legacy order)", async () => {
    mockTx.tbl_wallet_history.findMany.mockResolvedValue([]);
    expect(await refundWalletPrepayment(199)).toEqual({ refunded: 0, paid: 0 });
    expect(mockTx.tbl_user.update).not.toHaveBeenCalled();
  });

  it("locks the order row first so concurrent cancels cannot double-refund", async () => {
    await refundWalletPrepayment(199);
    expect(mockTx.$queryRaw).toHaveBeenCalled();
  });
});

describe("refundIfWalletPaid (safe wrapper used by every cancel path)", () => {
  it("skips non-wallet orders without touching the database", async () => {
    const result = await refundIfWalletPaid({ id: 5, p_method_id: 2, trans_id: "cash_1" });
    expect(result).toBeNull();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refunds wallet orders", async () => {
    const result = await refundIfWalletPaid({ id: 199, p_method_id: -2, trans_id: "wallet_1" }, { deduct: 15 });
    expect(result).toEqual({ refunded: 71, paid: 86 });
  });

  it("never throws into the cancel flow if the refund fails", async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error("db down"));
    await expect(refundIfWalletPaid({ id: 199, p_method_id: -2 })).resolves.toBeNull();
  });
});

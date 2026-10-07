jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-08T10:00:00Z") }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../config/firebase", () => ({ sendPushNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  pkg_order: { update: jest.fn() },
  order_receiver_pay: { findFirst: jest.fn() },
  tbl_user: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn() },
}));

const prisma = require("../../config/db");
const { sendPushNotification } = require("../../config/firebase");
const walletNotifier = require("../walletNotifier");
const svc = require("../walletAdvanceService");

const order = (o = {}) => ({ id: 77, uid: 5, rid: 9, advance_payment: "100", payment_status: 0, o_status: "Processing", order_status: 1, ...o });

function setup({ o = order(), wallet = 150, receiver = null, updated = 1 } = {}) {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([o]);
  prisma.order_receiver_pay.findFirst.mockResolvedValue(receiver);
  prisma.tbl_user.findUnique.mockResolvedValue({ id: 5, mobile: 9999999999, wallet });
  prisma.tbl_user.updateMany.mockResolvedValue({ count: updated });
  prisma.tbl_user.update.mockResolvedValue({});
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.pkg_order.update.mockResolvedValue({});
  prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "tok" });
}

describe("payAdvanceFromWallet", () => {
  it("wallet Rs150 >= advance Rs100: debits Rs100, writes the ledger row, marks the order paid", async () => {
    setup();
    const out = await svc.payAdvanceFromWallet(77, { uid: 5 });
    expect(out).toMatchObject({ code: "200", due: 100 });
    expect(prisma.tbl_user.updateMany).toHaveBeenCalledWith({ where: { id: 5, wallet: { gte: 100 } }, data: { wallet: { decrement: 100 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 5, amount: 100, type: "debit", wallet_type: "user", order_id: 77, payment_id: "advance_apply:77" }),
    });
    expect(prisma.pkg_order.update).toHaveBeenCalledWith({ where: { id: 77 }, data: { payment_status: 1 } });
  });

  it("tells the customer and the driver about it", async () => {
    setup();
    await svc.payAdvanceFromWallet(77, { uid: 5 });
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(5, expect.objectContaining({ type: "debit", amount: 100 }));
    expect(sendPushNotification).toHaveBeenCalledWith("tok", "Advance Payment Received", expect.stringContaining("₹100"), { type: "advance_payment", order_id: "77" });
  });

  it("wallet exactly equal to the advance is enough", async () => {
    setup({ wallet: 100 });
    expect((await svc.payAdvanceFromWallet(77)).code).toBe("200");
  });

  it("wallet Rs60 < advance Rs100: nothing changes, code 402 (app shows the normal payment screen)", async () => {
    setup({ wallet: 60 });
    const out = await svc.payAdvanceFromWallet(77, { uid: 5 });
    expect(out.code).toBe("402");
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
  });

  it("a concurrent spend between the read and the guarded debit cannot overdraw the wallet", async () => {
    setup({ updated: 0 });
    expect((await svc.payAdvanceFromWallet(77)).code).toBe("402");
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.pkg_order.update).not.toHaveBeenCalled();
  });

  it.each([
    ["already paid", { payment_status: 1 }],
    ["cancelled", { o_status: "Cancelled", order_status: 4 }],
    ["no advance due", { advance_payment: "0" }],
  ])("%s: refused, nothing debited", async (_n, patch) => {
    setup({ o: order(patch) });
    expect((await svc.payAdvanceFromWallet(77)).code).toBe("401");
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
  });

  it("another customer's order is refused", async () => {
    setup();
    expect((await svc.payAdvanceFromWallet(77, { uid: 6 })).code).toBe("401");
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
  });

  it("receiver-pays orders are not auto-paid (the advance stays a deposit in the wallet)", async () => {
    setup({ receiver: { id: 1 } });
    expect((await svc.payAdvanceFromWallet(77)).code).toBe("402");
    expect(prisma.tbl_user.updateMany).not.toHaveBeenCalled();
  });
});

describe("refundWalletAdvanceIfAny", () => {
  const debitRow = { id: 3, user_id: 5, mobile: "9999999999", amount: "100.00" };

  it("gives the wallet-paid advance back on a cancel", async () => {
    setup();
    prisma.tbl_wallet_history.findFirst.mockImplementation(({ where }) => Promise.resolve(where.payment_id === "advance_apply:77" ? debitRow : null));
    expect(await svc.refundWalletAdvanceIfAny(77)).toBe(100);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { wallet: { increment: 100 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: "credit", amount: 100, payment_id: "advance_wallet_refund:77", order_id: 77 }),
    });
  });

  it("is a no-op when the advance was not paid from the wallet (Razorpay-paid advance never left the wallet)", async () => {
    setup();
    expect(await svc.refundWalletAdvanceIfAny(77)).toBe(0);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("is idempotent: a second cancel does not refund twice", async () => {
    setup();
    prisma.tbl_wallet_history.findFirst.mockResolvedValue(debitRow); // both the debit and the refund row exist
    expect(await svc.refundWalletAdvanceIfAny(77)).toBe(0);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });

  it("never throws into the cancel flow", async () => {
    setup();
    prisma.tbl_wallet_history.findFirst.mockRejectedValue(new Error("db down"));
    await expect(svc.refundWalletAdvanceIfAny(77)).resolves.toBe(0);
  });
});

jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  order_receiver_pay: { updateMany: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  tbl_user: { update: jest.fn(), findUnique: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({
  notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined),
  notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: jest.fn() }) }) }));

const prisma = require("../../config/db");
const walletNotifier = require("../walletNotifier");
const svc = require("../settlementService");

const row = (o = {}) => ({
  id: 4, order_id: 50, uid: 7, rid: 9, amount_due: 90, fare: 100, commission_amount: 10, per_trip_charge: 0,
  prepaid_amount: 10, status: "pending", method: null, wallet_effect: "none", effect_seq: 0,
  payer: "receiver", receiver_markup: 2.7, advance_held: 20, receiver_credited: false, reversal_shortfall: 0,
  pending_since: new Date("2026-10-05T10:00:00Z"), created_at: new Date(), updated_at: new Date(), ...o,
});

function setup(current) {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: current.id }]);
  prisma.order_settlement.findUnique.mockResolvedValue(current);
  prisma.order_settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }));
  prisma.order_settlement_event.create.mockResolvedValue({});
  prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
  prisma.tbl_user.update.mockResolvedValue({});
  prisma.tbl_user.findUnique.mockResolvedValue({ wallet: 100 });
}

describe("createForCompletedOrder - receiver mode", () => {
  const payload = { orderId: 50, uid: 7, riderId: 9, amountDue: 90, fare: 100, commissionAmount: 10, perTripCharge: 0, prepaidAmount: 10 };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    prisma.order_settlement.create.mockImplementation(({ data }) => Promise.resolve({ id: 3, ...data }));
    prisma.order_settlement_event.create.mockResolvedValue({});
  });
  it("stores payer, markup and the held advance", async () => {
    await svc.createForCompletedOrder({ ...payload, receiver: { markup: 2.7, advanceHeld: 20 } });
    expect(prisma.order_settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payer: "receiver", receiver_markup: 2.7, advance_held: 20, amount_due: 90, prepaid_amount: 10 }),
    });
  });
  it("normal mode keeps payer=customer and zero receiver fields", async () => {
    await svc.createForCompletedOrder(payload);
    expect(prisma.order_settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payer: "customer", receiver_markup: 0, advance_held: 0 }),
    });
  });
});

describe("effectOps - receiver commission collected in cash", () => {
  it("adds a driver debit for the commission after the normal commission ops", () => {
    expect(svc.effectOps("cash", row({ prepaid_amount: 0 }))).toEqual([
      { type: "debit", amount: 10, remark: "Admin deduction for order #50" },
      { type: "debit", amount: 2.7, remark: "Receiver commission collected in cash for order #50" },
    ]);
  });
  it("customer-mode rows never get it, and the online effect is unchanged", () => {
    expect(svc.effectOps("cash", row({ payer: "customer", receiver_markup: 0, prepaid_amount: 10 }))).toEqual([]);
    expect(svc.effectOps("online", row())).toEqual([{ type: "credit", amount: 90, remark: "Online payment received for order #50" }]);
  });
});

describe("publicView", () => {
  it("exposes what the receiver owes in total", () => {
    const v = svc.publicView(row());
    expect(v).toMatchObject({ payer: "receiver", receiver_markup: 2.7, advance_held: 20, receiver_pay_total: 92.7 });
  });
  it("customer mode total equals amount_due", () => {
    expect(svc.publicView(row({ payer: "customer", receiver_markup: 0, advance_held: 0 })).receiver_pay_total).toBe(90);
  });
});

describe("markCashReceived - receiver mode", () => {
  it("refunds the advance AND credits the commission to the booker, and the driver hands the commission over", async () => {
    setup(row());
    const { settlement } = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(settlement.status).toBe("cash_received");
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    // the driver collected fare + commission in cash, so the commission is debited from the driver wallet
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 2.7 } } });
    const data = prisma.order_settlement.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ receiver_credited: true, status: "cash_received" });
    expect(data).not.toHaveProperty("receiver_markup");
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({ where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "paid" }) });
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "credit", amount: 20 }));
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "credit", amount: 2.7 }));
  });
  it("with 0% commission only the advance is refunded and the driver wallet is untouched", async () => {
    setup(row({ receiver_markup: 0 }));
    await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(prisma.tbl_user.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
  it("a normal customer settlement is untouched (no booker wallet writes)", async () => {
    setup(row({ payer: "customer", receiver_markup: 0, advance_held: 0 }));
    await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.order_receiver_pay.updateMany).not.toHaveBeenCalled();
  });
  it("tapping Received twice does not credit twice", async () => {
    setup(row({ status: "cash_received", receiver_credited: true }));
    const out = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(out.alreadyDone).toBe(true);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("adminResolve - receiver mode", () => {
  it("paid_online credits the booker once", async () => {
    setup(row());
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "paid_online", note: "verified" });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
  });
  it("cash_received credits the advance and the commission, and keeps the commission on the row", async () => {
    setup(row({ status: "disputed" }));
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "cash_received", note: "driver showed receipt" });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 2.7 } } });
    expect(prisma.order_settlement.update.mock.calls[0][0].data).not.toHaveProperty("receiver_markup");
  });
  it("waived converts to customer mode with the advance netted and no booker credit", async () => {
    setup(row());
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "waived", note: "goodwill" });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: expect.objectContaining({ payer: "customer", amount_due: 70, prepaid_amount: 30, receiver_markup: 0, status: "waived" }),
    });
  });
});

describe("adminResolve - receiver mode driver wallet and reversals", () => {
  it("reverses a prior CASH effect using the original prepaid, not the advance-netted one", async () => {
    setup(row({ wallet_effect: "cash", status: "disputed", effect_seq: 1 }));
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "waived", note: "goodwill" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 20 } } });
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(2);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 90 } } });
    // the commission the driver handed over in cash comes back to the driver
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 2.7 } } });
  });
  it("waived after a credited online payment debits the booker and clears the credit flag", async () => {
    setup(row({ status: "paid_online", wallet_effect: "online", effect_seq: 1, receiver_credited: true }));
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "waived", note: "refund" });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 20 } } });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 2.7 } } });
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "debit" }));
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: expect.objectContaining({ payer: "customer", receiver_credited: false, reversal_shortfall: 0, status: "waived" }),
    });
  });
  it("records the uncollected part as reversal_shortfall when the booker wallet is short", async () => {
    setup(row({ status: "paid_online", wallet_effect: "online", effect_seq: 1, receiver_credited: true, receiver_markup: 0 }));
    prisma.tbl_user.findUnique.mockResolvedValue({ wallet: 5 });
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "waived", note: "refund" });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 5 } } });
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: expect.objectContaining({ receiver_credited: false, reversal_shortfall: 15 }),
    });
  });
});

describe("booker cannot pay itself while the receiver is the payer", () => {
  it("chooseDriverPayment is refused with RECEIVER_MODE", async () => {
    setup(row());
    await expect(svc.chooseDriverPayment({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "RECEIVER_MODE" });
  });
  it("createOnlineOrder is refused with RECEIVER_MODE", async () => {
    setup(row());
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "RECEIVER_MODE" });
  });
  it("settleOnline is refused with RECEIVER_MODE", async () => {
    setup(row());
    await expect(svc.settleOnline({ orderId: 50, uid: 7, paymentId: "p", razorpayOrderId: "o", signature: "s" })).rejects.toMatchObject({ code: "RECEIVER_MODE" });
  });
});

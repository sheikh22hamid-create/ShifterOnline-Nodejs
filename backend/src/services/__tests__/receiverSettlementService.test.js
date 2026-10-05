jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), update: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  order_receiver_pay: { findUnique: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn(), fetchRazorpayOrder: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({
  notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined),
  notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: jest.fn() }) }) }));

const prisma = require("../../config/db");
const { verifyRazorpayPayment, fetchRazorpayOrder } = require("../../utils/razorpayVerify");
const { createRazorpayOrder } = require("../../utils/razorpayOrders");
const { hashToken } = require("../receiverPayToken");
const svc = require("../receiverSettlementService");

const TOKEN = "t".repeat(43);
const settlement = (o = {}) => ({
  id: 4, order_id: 50, uid: 7, rid: 9, amount_due: 90, fare: 100, commission_amount: 10, per_trip_charge: 0, prepaid_amount: 10,
  status: "pending", method: null, wallet_effect: "none", effect_seq: 0, payer: "receiver", receiver_markup: 2.7, advance_held: 20,
  receiver_credited: false, reversal_shortfall: 0, razorpay_payment_id: null, ...o,
});
const rp = (o = {}) => ({
  id: 3, order_id: 50, uid: 7, status: "active", token_hash: hashToken(TOKEN),
  token_expires_at: new Date(Date.now() + 3600 * 1000), razorpay_order_id: null, ...o,
});

let current;
function setup({ s = settlement(), r = rp() } = {}) {
  jest.clearAllMocks();
  current = s;
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: s.id }]);
  prisma.order_settlement.findUnique.mockImplementation(() => Promise.resolve(current));
  prisma.order_settlement.update.mockImplementation(({ data }) => { current = { ...current, ...data }; return Promise.resolve(current); });
  prisma.order_settlement_event.create.mockResolvedValue({});
  prisma.order_receiver_pay.findUnique.mockResolvedValue(r);
  prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
  prisma.order_receiver_pay.update.mockResolvedValue({});
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, rid: 9, paddress: "Pickup road", daddress: "Drop road" });
  prisma.tbl_rider.findUnique.mockResolvedValue({ first_name: "Suresh" });
  prisma.tbl_user.findUnique.mockResolvedValue({ name: "Anita Sharma", wallet: 100 });
  prisma.tbl_user.update.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  verifyRazorpayPayment.mockResolvedValue({ ok: true });
}

describe("getPublicState", () => {
  it("payable: returns the breakup and no booker phone", async () => {
    setup();
    const s = await svc.getPublicState(TOKEN);
    expect(s).toEqual({
      state: "payable", order_id: 50, amount_due: 90, markup: 2.7, total: 92.7,
      driver_first_name: "Suresh", booker_first_name: "Anita", pickup: "Pickup road", drop: "Drop road",
    });
    expect(JSON.stringify(s)).not.toMatch(/mobile|phone/i);
  });
  it("unknown token -> INVALID_LINK", async () => {
    setup();
    prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
    await expect(svc.getPublicState("x".repeat(43))).rejects.toMatchObject({ code: "INVALID_LINK" });
  });
  it("expired token -> neutral expired state without order data", async () => {
    setup({ r: rp({ token_expires_at: new Date(Date.now() - 1000) }) });
    expect(await svc.getPublicState(TOKEN)).toEqual({ state: "expired" });
  });
  it("paid -> paid state; declined/closed/converted -> closed state", async () => {
    setup({ r: rp({ status: "paid" }) });
    expect((await svc.getPublicState(TOKEN)).state).toBe("paid");
    setup({ r: rp({ status: "declined" }) });
    expect(await svc.getPublicState(TOKEN)).toEqual({ state: "closed" });
    setup({ s: settlement({ payer: "customer" }) });
    expect(await svc.getPublicState(TOKEN)).toEqual({ state: "closed" });
  });
});

describe("createOrderByToken", () => {
  it("creates a Razorpay order for amount_due + markup and stores it", async () => {
    setup();
    createRazorpayOrder.mockResolvedValue({ ok: true, id: "order_R1", amountPaise: 9270, currency: "INR" });
    prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    const out = await svc.createOrderByToken(TOKEN);
    expect(createRazorpayOrder).toHaveBeenCalledWith({ amountRupees: 92.7, receipt: "rpay_50" });
    expect(out).toEqual({ razorpay_order_id: "order_R1", amount_paise: 9270, currency: "INR", key_id: "rzp_test" });
  });
  it("reuses an existing Razorpay order", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R0" }) });
    const out = await svc.createOrderByToken(TOKEN);
    expect(createRazorpayOrder).not.toHaveBeenCalled();
    expect(out.razorpay_order_id).toBe("order_R0");
    expect(out.amount_paise).toBe(9270);
  });
  it("refuses when the link is no longer payable", async () => {
    setup({ s: settlement({ status: "cash_received" }) });
    await expect(svc.createOrderByToken(TOKEN)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("settleByReceiver", () => {
  const pay = { token: TOKEN, paymentId: "pay_1", razorpayOrderId: "order_R1", signature: "sig" };

  it("verifies the exact total, credits the driver (online) and the booker, and marks everything paid", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    const { settlement: out } = await svc.settleByReceiver(pay);
    expect(verifyRazorpayPayment).toHaveBeenCalledWith({ paymentId: "pay_1", orderId: "order_R1", signature: "sig", expectedAmountRupees: 92.7 });
    expect(out).toMatchObject({ status: "paid_online", method: "online", wallet_effect: "online", confirmed_by: "receiver_online", receiver_credited: true });
    // driver online effect: fare 100 - commission 10
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 90 } } });
    // booker: advance refund + commission
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({ where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "paid" }) });
  });
  it("a stale/rotated token with a matching razorpay_order_id still applies the payment once", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
    prisma.order_receiver_pay.findFirst.mockResolvedValue(rp({ razorpay_order_id: "order_R1" }));
    const { settlement: out } = await svc.settleByReceiver(pay);
    expect(prisma.order_receiver_pay.findFirst).toHaveBeenCalledWith({ where: { razorpay_order_id: "order_R1" } });
    expect(out).toMatchObject({ status: "paid_online", receiver_credited: true });
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
  });
  it("a stale token and a non-matching order id is INVALID_LINK with no wallet writes", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
    prisma.order_receiver_pay.findFirst.mockResolvedValue(null);
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "INVALID_LINK" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
  it("a repeat of the same payment id is a no-op (no second credit)", async () => {
    setup({ s: settlement({ status: "paid_online", razorpay_payment_id: "pay_1" }), r: rp({ status: "paid", razorpay_order_id: "order_R1" }) });
    const out = await svc.settleByReceiver(pay);
    expect(out.alreadyDone).toBe(true);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
  it("a payment for a different Razorpay order is rejected", async () => {
    setup({ r: rp({ razorpay_order_id: "order_OTHER" }) });
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
  });
  it("a failed verification leaves the settlement pending and moves no money", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment Verification Failed!" });
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAYMENT_VERIFICATION_FAILED" });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
  it("driver confirmed cash while the receiver was paying: no double effect, flagged for reconciliation", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    // the pre-check sees pending, but once the lock is taken the settlement is already cash_received
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(settlement())
      .mockResolvedValue(settlement({ status: "cash_received", receiver_credited: true }));
    prisma.$queryRaw.mockResolvedValue([{ id: 4 }]);
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAID_BUT_STATE_CHANGED" });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringContaining("needs manual reconciliation") }),
    });
  });
  it("accepts a verification that arrives just after link expiry when the Razorpay order matches", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1", token_expires_at: new Date(Date.now() - 1000) }) });
    const out = await svc.settleByReceiver(pay);
    expect(out.settlement.status).toBe("paid_online");
  });
});

describe("settleByReceiver reconciliation and getPublicState edge cases", () => {
  const pay = { token: TOKEN, paymentId: "pay_1", razorpayOrderId: "order_R1", signature: "sig" };

  it("payer flipped to customer under the lock: PAID_BUT_STATE_CHANGED, no wallet effect, payer noted", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(settlement())
      .mockResolvedValue(settlement({ payer: "customer" }));
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAID_BUT_STATE_CHANGED" });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringMatching(/converted to customer payment; needs manual reconciliation/) }),
    });
  });
  it("pre-check failure after capture (settlement already cash_received): verified from the Razorpay order and audited", async () => {
    setup({ s: settlement({ status: "cash_received" }), r: rp({ razorpay_order_id: "order_R1" }) });
    fetchRazorpayOrder.mockResolvedValue({ id: "order_R1", amount: 9270 });
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAID_BUT_STATE_CHANGED" });
    expect(fetchRazorpayOrder).toHaveBeenCalledWith("order_R1");
    expect(verifyRazorpayPayment).toHaveBeenCalledWith({ paymentId: "pay_1", orderId: "order_R1", signature: "sig", expectedAmountRupees: 92.7 });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringContaining("needs manual reconciliation") }),
    });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
  it("pre-check failure with a failed verification keeps the original INVALID_STATE and writes no audit", async () => {
    setup({ s: settlement({ status: "cash_received" }), r: rp({ razorpay_order_id: "order_R1" }) });
    fetchRazorpayOrder.mockResolvedValue({ id: "order_R1", amount: 9270 });
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "bad" });
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.order_settlement_event.create).not.toHaveBeenCalled();
  });
  it("pre-check failure for a different Razorpay order is a plain INVALID_STATE (no fetch)", async () => {
    setup({ s: settlement({ status: "cash_received" }), r: rp({ razorpay_order_id: "order_OTHER" }) });
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(fetchRazorpayOrder).not.toHaveBeenCalled();
  });
  it("getPublicState: declined row with a paid_online settlement stays closed", async () => {
    setup({ s: settlement({ status: "paid_online" }), r: rp({ status: "declined" }) });
    expect(await svc.getPublicState(TOKEN)).toEqual({ state: "closed" });
  });
});

describe("declineReceiverPay", () => {
  it("before completion (no settlement yet): just marks the row declined", async () => {
    setup();
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "booker", actorId: 7 });
    expect(out.phase).toBe("before_completion");
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "declined", declined_by: "booker" }),
    });
  });
  it("after completion: converts to customer mode with the advance netted off", async () => {
    setup();
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 9 });
    expect(out.phase).toBe("converted");
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: expect.objectContaining({ payer: "customer", amount_due: 70, prepaid_amount: 30, receiver_markup: 0, razorpay_order_id: null }),
    });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
  it("conversion also works when the decline landed just before the settlement row existed (row already declined)", async () => {
    setup({ r: rp({ status: "declined" }) });
    prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 0 });
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "receiver" });
    expect(out.phase).toBe("converted");
  });
  it("advance covers the whole amount: settles immediately like a fully prepaid cash order", async () => {
    setup({ s: settlement({ amount_due: 20, advance_held: 20, prepaid_amount: 0, receiver_markup: 0.6 }) });
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "booker", actorId: 7 });
    expect(out.settlement).toMatchObject({ status: "cash_received", amount_due: 0, confirmed_by: "system" });
    // cash effect: prepaid 20 > commission 10 -> driver is owed the 10 leftover
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 10 } } });
  });
  it("is a no-op on an already-normal settlement", async () => {
    setup({ s: settlement({ payer: "customer" }) });
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "receiver" });
    expect(out.phase).toBe("already_normal");
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });
  it("refuses once the settlement is no longer pending", async () => {
    setup({ s: settlement({ status: "cash_received" }) });
    await expect(svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 9 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  it("a driver or booker who is not on the order is forbidden", async () => {
    setup();
    await expect(svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 999 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.declineReceiverPay({ orderId: 50, actor: "booker", actorId: 999 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("declining a disputed settlement is INVALID_STATE and leaves the receiver row untouched", async () => {
    setup({ s: settlement({ status: "disputed" }) });
    await expect(svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 9 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.order_receiver_pay.updateMany).not.toHaveBeenCalled();
  });
  it("already-normal settlement leaves the receiver row untouched", async () => {
    setup({ s: settlement({ payer: "customer" }) });
    await svc.declineReceiverPay({ orderId: 50, actor: "receiver" });
    expect(prisma.order_receiver_pay.updateMany).not.toHaveBeenCalled();
  });
  it("decline before completion where the re-read finds a settlement: converts it", async () => {
    setup();
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(null)
      .mockImplementation(() => Promise.resolve(current));
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "system" });
    expect(out.phase).toBe("converted");
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "declined", declined_by: "system" }),
    });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actor: "system" }) });
  });
  it("flips the row inside the conversion transaction", async () => {
    setup();
    await svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 9 });
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "declined", declined_by: "driver" }),
    });
  });
});

describe("declineByToken", () => {
  it("rejects an expired token without changing any state", async () => {
    setup({ r: rp({ token_expires_at: new Date(Date.now() - 1000) }) });
    await expect(svc.declineByToken(TOKEN)).rejects.toMatchObject({ code: "LINK_EXPIRED" });
    expect(prisma.order_receiver_pay.updateMany).not.toHaveBeenCalled();
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });
  it("declines with a valid token", async () => {
    setup();
    const out = await svc.declineByToken(TOKEN);
    expect(out.phase).toBe("converted");
  });
});

jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
const mockEmit = jest.fn();
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: mockEmit }) }) }));

const prisma = require("../../config/db");
const walletNotifier = require("../walletNotifier");
const logger = require("../../utils/logger");
const { verifyRazorpayPayment } = require("../../utils/razorpayVerify");
const { createRazorpayOrder } = require("../../utils/razorpayOrders");
const svc = require("../settlementService");

const row = (o = {}) => ({
  id: 1, order_id: 50, uid: 7, rid: 9, amount_due: 100, fare: 100,
  commission_amount: 10, per_trip_charge: 0, prepaid_amount: 0,
  status: "pending", method: null, wallet_effect: "none", effect_seq: 0,
  pending_since: new Date("2026-10-04T10:00:00Z"), created_at: new Date(), updated_at: new Date(), ...o,
});

function setup(current) {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: current.id }]);
  prisma.order_settlement.findUnique.mockResolvedValue(current);
  prisma.order_settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }));
  prisma.order_settlement.updateMany.mockResolvedValue({ count: 1 });
  prisma.order_settlement_event.create.mockResolvedValue({});
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
}

describe("settlementService.effectOps", () => {
  it("cash: debits commission + per-trip charge net of prepaid", () => {
    expect(svc.effectOps("cash", row({ commission_amount: 10, per_trip_charge: 2, prepaid_amount: 5 })))
      .toEqual([{ type: "debit", amount: 7, remark: "Admin deduction for order #50" }]);
  });
  it("cash: credits the leftover advance when prepaid exceeds commission", () => {
    const ops = svc.effectOps("cash", row({ commission_amount: 10, prepaid_amount: 15 }));
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: "credit", amount: 5 });
  });
  it("online: credits fare minus commission and per-trip charge", () => {
    expect(svc.effectOps("online", row({ fare: 100, commission_amount: 10, per_trip_charge: 2 })))
      .toEqual([{ type: "credit", amount: 88, remark: "Online payment received for order #50" }]);
  });
  it("online: never credits a negative amount", () => {
    expect(svc.effectOps("online", row({ fare: 5, commission_amount: 10 }))).toEqual([]);
  });
  it("none: no ops", () => expect(svc.effectOps("none", row())).toEqual([]));
});

describe("settlementService.createForCompletedOrder", () => {
  const payload = { orderId: 50, uid: 7, riderId: 9, amountDue: 85, fare: 100, commissionAmount: 10, perTripCharge: 0, prepaidAmount: 15 };

  it("creates a pending settlement with an audit event and notifies the order room", async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    prisma.order_settlement.create.mockImplementation(({ data }) => Promise.resolve({ id: 3, ...data }));
    prisma.order_settlement_event.create.mockResolvedValue({});

    const created = await svc.createForCompletedOrder(payload);

    expect(prisma.order_settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        order_id: 50, uid: 7, rid: 9, amount_due: 85, fare: 100, commission_amount: 10,
        per_trip_charge: 0, prepaid_amount: 15, status: "pending", wallet_effect: "none",
      }),
    });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ settlement_id: 3, actor: "system", to_status: "pending" }),
    });
    expect(mockEmit).toHaveBeenCalledWith("settlement:updated", expect.objectContaining({ order_id: 50, status: "pending", amount_due: 85 }));
    expect(created.id).toBe(3);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("is idempotent: an existing settlement is returned untouched", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue(row());
    const result = await svc.createForCompletedOrder(payload);
    expect(prisma.order_settlement.create).not.toHaveBeenCalled();
    expect(result.id).toBe(1);
  });

  it("returns the winner's row when a concurrent create hits the unique index (P2002)", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row({ id: 8 }));
    prisma.order_settlement.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    const result = await svc.createForCompletedOrder(payload);
    expect(result.id).toBe(8);
    expect(prisma.order_settlement_event.create).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("settlementService views", () => {
  it("getViewForParty hides another customer's settlement", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue(row({ uid: 7 }));
    await expect(svc.getViewForParty({ orderId: 50, party: "customer", partyId: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await svc.getViewForParty({ orderId: 50, party: "customer", partyId: 7 })).toMatchObject({ order_id: 50, status: "pending", amount_due: 100 });
  });

  it("getViewForParty returns null when the order has no settlement", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    expect(await svc.getViewForParty({ orderId: 50, party: "driver", partyId: 9 })).toBeNull();
  });

  it("getPublicViewForOrder swallows a missing table (schema drift) and returns null", async () => {
    jest.clearAllMocks();
    prisma.order_settlement.findUnique.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    expect(await svc.getPublicViewForOrder(50)).toBeNull();
  });
});

describe("settlementService.changeWalletEffect", () => {
  it("none -> cash applies the commission debit with a unique key and bumps effect_seq", async () => {
    const current = row({ wallet_effect: "none", effect_seq: 0 });
    setup(current);
    const { effectSeq, notifications } = await svc.changeWalletEffect(prisma, current, "cash");
    expect(effectSeq).toBe(1);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 10 } } });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 9, amount: 10, type: "debit", wallet_type: "driver", order_id: 50, payment_id: "settle:1:1:apply:0" }),
    });
    expect(notifications).toEqual([{ riderId: 9, type: "debit", amount: 10, remark: "Admin deduction for order #50" }]);
  });

  it("cash -> online reverses the cash effect first, then applies the online credit", async () => {
    const current = row({ wallet_effect: "cash", effect_seq: 1 });
    setup(current);
    const { effectSeq } = await svc.changeWalletEffect(prisma, current, "online");
    expect(effectSeq).toBe(3);
    const keys = prisma.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id);
    expect(keys).toEqual(["settle:1:2:rev:0", "settle:1:3:apply:0"]);
    expect(prisma.tbl_rider.update.mock.calls.map(([a]) => a.data.wallet_balance)).toEqual([{ increment: 10 }, { increment: 90 }]);
  });

  it("is a no-op when the effect is unchanged", async () => {
    const current = row({ wallet_effect: "online", effect_seq: 2 });
    setup(current);
    const { effectSeq, notifications } = await svc.changeWalletEffect(prisma, current, "online");
    expect(effectSeq).toBe(2);
    expect(notifications).toEqual([]);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("skips a wallet row whose idempotency key already exists", async () => {
    const current = row({ wallet_effect: "none", effect_seq: 0 });
    setup(current);
    prisma.tbl_wallet_history.findFirst.mockResolvedValue({ id: 1 });
    await svc.changeWalletEffect(prisma, current, "cash");
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});

describe("settlementService.changeWalletEffect advance credit", () => {
  it("reverses a cash CREDIT as a debit, then applies the online credit", async () => {
    const current = row({ wallet_effect: "cash", effect_seq: 1, commission_amount: 10, prepaid_amount: 15 });
    setup(current);
    await svc.changeWalletEffect(prisma, current, "online");
    const types = prisma.tbl_wallet_history.create.mock.calls.map(([a]) => [a.data.type, a.data.amount]);
    expect(types).toEqual([["debit", 5], ["credit", 90]]);
    expect(prisma.tbl_rider.update.mock.calls.map(([a]) => a.data.wallet_balance)).toEqual([{ decrement: 5 }, { increment: 90 }]);
  });
});

describe("settlementService locks", () => {
  it("lockByOrderId / lockById return null when no row is locked", async () => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
    expect(await svc.lockByOrderId(prisma, 50)).toBeNull();
    expect(await svc.lockById(prisma, 1)).toBeNull();
    expect(prisma.order_settlement.findUnique).not.toHaveBeenCalled();
  });
  it("lockByOrderId / lockById return the findUnique row otherwise", async () => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([{ id: 1 }]);
    prisma.order_settlement.findUnique.mockResolvedValue(row());
    expect((await svc.lockByOrderId(prisma, 50)).id).toBe(1);
    expect((await svc.lockById(prisma, 1)).id).toBe(1);
    expect(prisma.order_settlement.findUnique).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});

describe("settlementService.runTransition", () => {
  const notif = { riderId: 9, type: "debit", amount: 10, remark: "r" };
  const settlement = row();
  const flush = () => new Promise((r) => setImmediate(r));
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmit.mockReset();
    walletNotifier.notifyDriverWalletTransaction.mockReset().mockResolvedValue(undefined);
    prisma.$transaction.mockReset();
  });

  it("notifies and emits only after the transaction callback resolved", async () => {
    const order = [];
    prisma.$transaction.mockImplementation(async (cb) => { const r = await cb(prisma); order.push("committed"); return r; });
    walletNotifier.notifyDriverWalletTransaction.mockImplementation(() => { order.push("notify"); return Promise.resolve(); });
    mockEmit.mockImplementation(() => order.push("emit"));
    await svc.runTransition(async (tx, notifications) => { order.push("work"); notifications.push(notif); return { settlement }; });
    expect(order).toEqual(["work", "committed", "notify", "emit"]);
    expect(walletNotifier.notifyDriverWalletTransaction).toHaveBeenCalledWith(9, { type: "debit", amount: 10, remark: "r" });
  });

  it("never notifies or emits when the transaction rejects", async () => {
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    await expect(svc.runTransition(async (tx, notifications) => { notifications.push(notif); throw new Error("boom"); })).rejects.toThrow("boom");
    expect(walletNotifier.notifyDriverWalletTransaction).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("a throwing socket emit does not fail the transition", async () => {
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    mockEmit.mockImplementationOnce(() => { throw new Error("socket down"); });
    const result = await svc.runTransition(async () => ({ settlement }));
    expect(result.settlement).toBe(settlement);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("a synchronously throwing or rejecting notifier does not fail the transition", async () => {
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    walletNotifier.notifyDriverWalletTransaction
      .mockImplementationOnce(() => { throw new Error("sync"); })
      .mockImplementationOnce(() => Promise.reject(new Error("async")));
    const result = await svc.runTransition(async (tx, notifications) => { notifications.push(notif, notif); return { settlement }; });
    await flush();
    expect(result.settlement).toBe(settlement);
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("alreadyDone does not emit", async () => {
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    await svc.runTransition(async () => ({ settlement, alreadyDone: true }));
    expect(mockEmit).not.toHaveBeenCalled();
  });
});

describe("settlementService.markCashReceived", () => {
  it("pending -> cash_received: debits commission once, records who/when, notifies the driver", async () => {
    const current = row();
    setup(current);
    const { settlement } = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(settlement).toMatchObject({ status: "cash_received", method: "cash", wallet_effect: "cash", confirmed_by: "driver", effect_seq: 1 });
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 10 } } });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actor: "driver", actor_id: 9, from_status: "pending", to_status: "cash_received" }),
    });
    expect(walletNotifier.notifyDriverWalletTransaction).toHaveBeenCalledWith(9, { type: "debit", amount: 10, remark: "Admin deduction for order #50" });
    expect(mockEmit).toHaveBeenCalledWith("settlement:updated", expect.objectContaining({ status: "cash_received" }));
  });

  it("double tap / retry: a second call is a successful no-op and moves no money", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", effect_seq: 1 }));
    const result = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(result.alreadyDone).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("rejects a different driver", async () => {
    setup(row({ rid: 9 }));
    await expect(svc.markCashReceived({ orderId: 50, riderId: 11 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects while disputed and after an online payment", async () => {
    setup(row({ status: "disputed" }));
    await expect(svc.markCashReceived({ orderId: 50, riderId: 9 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    setup(row({ status: "paid_online", wallet_effect: "online" }));
    await expect(svc.markCashReceived({ orderId: 50, riderId: 9 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects when the order has no settlement", async () => {
    setup(row());
    prisma.$queryRaw.mockResolvedValue([]);
    await expect(svc.markCashReceived({ orderId: 50, riderId: 9 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("settlementService.chooseDriverPayment", () => {
  it("records the customer's choice without touching status or money", async () => {
    setup(row());
    const { settlement } = await svc.chooseDriverPayment({ orderId: 50, uid: 7 });
    expect(settlement).toMatchObject({ status: "pending", customer_choice: "driver" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("is refused once the payment is no longer pending", async () => {
    setup(row({ status: "cash_received" }));
    await expect(svc.chooseDriverPayment({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("settlementService.raiseDispute", () => {
  const settings = (disputeWindowHours = 48) =>
    jest.spyOn(svc.settlementSettings, "getSettlementSettings").mockResolvedValue({ enabled: true, disputeWindowHours });

  afterEach(() => jest.restoreAllMocks());

  it("customer disputes a pending payment; wallet untouched", async () => {
    setup(row());
    settings();
    const { settlement } = await svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "Driver says I did not pay" });
    expect(settlement).toMatchObject({ status: "disputed", dispute_raised_by: "customer", dispute_reason: "Driver says I did not pay" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("driver may dispute a pending payment", async () => {
    setup(row());
    settings();
    const { settlement } = await svc.raiseDispute({ orderId: 50, actor: "driver", actorId: 9, reason: "Customer refused to pay" });
    expect(settlement.status).toBe("disputed");
  });

  it("requires a real reason", async () => {
    setup(row());
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "  " })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
  });

  it("customer can dispute a driver-confirmed payment inside the window and keeps the applied wallet effect until admin decides", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", effect_seq: 1, confirmed_by: "driver", confirmed_at: new Date(Date.now() - 60 * 60 * 1000) }));
    settings(48);
    const { settlement } = await svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "I never gave cash" });
    expect(settlement).toMatchObject({ status: "disputed", wallet_effect: "cash" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects a customer dispute after the window closed", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", confirmed_by: "driver", confirmed_at: new Date(Date.now() - 49 * 60 * 60 * 1000) }));
    settings(48);
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "late complaint" })).rejects.toMatchObject({ code: "WINDOW_CLOSED" });
  });

  it("customer cannot dispute a cash payment an admin already resolved", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", confirmed_by: "admin", confirmed_at: new Date() }));
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "I disagree" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("fails closed when a driver-confirmed cash row has no confirmed_at", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", confirmed_by: "driver", confirmed_at: null }));
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "no timestamp" })).rejects.toMatchObject({ code: "WINDOW_CLOSED" });
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });

  it("driver cannot dispute after confirming cash; nobody can dispute an online payment", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", confirmed_at: new Date() }));
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "driver", actorId: 9, reason: "changed my mind" })).rejects.toMatchObject({ code: "INVALID_STATE" });
    setup(row({ status: "paid_online", wallet_effect: "online" }));
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "double charged" })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("is idempotent when already disputed", async () => {
    setup(row({ status: "disputed" }));
    settings();
    const result = await svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 7, reason: "again" });
    expect(result.alreadyDone).toBe(true);
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });

  it("rejects the wrong party", async () => {
    setup(row());
    settings();
    await expect(svc.raiseDispute({ orderId: 50, actor: "customer", actorId: 99, reason: "not mine" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("settlementService.adminResolve", () => {
  const resolve = (outcome, note = "Checked with both parties") => svc.adminResolve({ settlementId: 1, adminId: 3, outcome, note });

  it("requires a note and a valid outcome", async () => {
    setup(row({ status: "disputed" }));
    await expect(resolve("cash_received", "  ")).rejects.toMatchObject({ code: "NOTE_REQUIRED" });
    await expect(resolve("bogus")).rejects.toMatchObject({ code: "INVALID_OUTCOME" });
  });

  it("disputed (no effect yet) -> cash_received applies the cash effect and records the admin", async () => {
    setup(row({ status: "disputed" }));
    const { settlement } = await resolve("cash_received");
    expect(settlement).toMatchObject({ status: "cash_received", method: "cash", wallet_effect: "cash", confirmed_by: "admin", resolved_by: 3, resolve_note: "Checked with both parties" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { decrement: 10 } } });
  });

  it("waived credits the driver (company absorbs) with no customer method", async () => {
    setup(row({ status: "disputed" }));
    const { settlement } = await resolve("waived");
    expect(settlement).toMatchObject({ status: "waived", wallet_effect: "online", method: null });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 90 } } });
  });

  it("customer_owes also credits the driver", async () => {
    setup(row({ status: "disputed" }));
    const { settlement } = await resolve("customer_owes");
    expect(settlement).toMatchObject({ status: "customer_owes", wallet_effect: "online" });
  });

  it("changing outcome reverses exactly the previous effect (cash -> paid_online)", async () => {
    setup(row({ status: "cash_received", wallet_effect: "cash", effect_seq: 1 }));
    const { settlement } = await resolve("paid_online");
    expect(settlement).toMatchObject({ status: "paid_online", wallet_effect: "online", effect_seq: 3 });
    expect(prisma.tbl_rider.update.mock.calls.map(([a]) => a.data.wallet_balance)).toEqual([{ increment: 10 }, { increment: 90 }]);
  });

  it("changing back (online -> cash) reverses the credit and re-applies the debit, each with fresh keys", async () => {
    setup(row({ status: "paid_online", wallet_effect: "online", effect_seq: 3 }));
    await resolve("cash_received");
    expect(prisma.tbl_rider.update.mock.calls.map(([a]) => a.data.wallet_balance)).toEqual([{ decrement: 90 }, { decrement: 10 }]);
    expect(prisma.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id)).toEqual(["settle:1:4:rev:0", "settle:1:5:apply:0"]);
  });

  it("repeating the same resolve moves no money", async () => {
    setup(row({ status: "waived", wallet_effect: "online", effect_seq: 1 }));
    const result = await resolve("waived");
    expect(result.alreadyDone).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("can resolve an escalated pending settlement", async () => {
    setup(row({ status: "pending", escalated_at: new Date() }));
    const { settlement } = await resolve("paid_online");
    expect(settlement.status).toBe("paid_online");
  });

  it("writes an audit event with the admin note", async () => {
    setup(row({ status: "disputed" }));
    await resolve("cash_received", "Driver showed receipt");
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actor: "admin", actor_id: 3, from_status: "disputed", to_status: "cash_received", note: "Driver showed receipt" }),
    });
  });
});

describe("settlementService.createOnlineOrder", () => {
  const ORIGINAL_KEY_ID = process.env.RAZORPAY_KEY_ID;
  afterEach(() => {
    if (ORIGINAL_KEY_ID === undefined) delete process.env.RAZORPAY_KEY_ID;
    else process.env.RAZORPAY_KEY_ID = ORIGINAL_KEY_ID;
  });

  it("creates a Razorpay order for the amount due and remembers it", async () => {
    setup(row({ amount_due: 85 }));
    createRazorpayOrder.mockResolvedValue({ ok: true, id: "order_A", amountPaise: 8500, currency: "INR" });
    process.env.RAZORPAY_KEY_ID = "rzp_key";
    const out = await svc.createOnlineOrder({ orderId: 50, uid: 7 });
    expect(createRazorpayOrder).toHaveBeenCalledWith({ amountRupees: 85, receipt: "settle_50" });
    expect(out).toEqual({ razorpay_order_id: "order_A", amount_paise: 8500, currency: "INR", key_id: "rzp_key" });
    expect(prisma.order_settlement.updateMany).toHaveBeenCalledWith({
      where: { id: 1, status: "pending", razorpay_order_id: null },
      data: expect.objectContaining({ razorpay_order_id: "order_A", customer_choice: "online" }),
    });
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ settlement_id: 1, actor: "customer", note: "Chose to pay online" }),
    });
  });

  it("loses the race to a concurrent call: returns the winner order, writes no audit event", async () => {
    const pending = row({ amount_due: 85 });
    setup(pending);
    createRazorpayOrder.mockResolvedValue({ ok: true, id: "order_L", amountPaise: 8500, currency: "INR" });
    prisma.order_settlement.updateMany.mockResolvedValue({ count: 0 });
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, razorpay_order_id: "order_W" });
    const out = await svc.createOnlineOrder({ orderId: 50, uid: 7 });
    expect(out).toMatchObject({ razorpay_order_id: "order_W", amount_paise: 8500 });
    expect(prisma.order_settlement_event.create).not.toHaveBeenCalled();
  });

  it("rejects when the settlement left pending while the order was being created", async () => {
    const pending = row({ amount_due: 85 });
    setup(pending);
    createRazorpayOrder.mockResolvedValue({ ok: true, id: "order_L", amountPaise: 8500, currency: "INR" });
    prisma.order_settlement.updateMany.mockResolvedValue({ count: 0 });
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, status: "cash_received" });
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.order_settlement_event.create).not.toHaveBeenCalled();
  });

  it("reuses the existing Razorpay order instead of creating an orphan", async () => {
    setup(row({ amount_due: 85, razorpay_order_id: "order_A" }));
    process.env.RAZORPAY_KEY_ID = "rzp_key";
    const out = await svc.createOnlineOrder({ orderId: 50, uid: 7 });
    expect(createRazorpayOrder).not.toHaveBeenCalled();
    expect(out).toMatchObject({ razorpay_order_id: "order_A", amount_paise: 8500 });
  });

  it("refuses when not pending or for another customer; reports gateway failure", async () => {
    setup(row({ status: "disputed" }));
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "INVALID_STATE" });
    setup(row());
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 99 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    setup(row());
    createRazorpayOrder.mockResolvedValue({ ok: false, reason: "Gateway down" });
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "GATEWAY_ERROR", message: "Gateway down" });
  });
});

describe("settlementService.settleOnline", () => {
  const pay = { orderId: 50, uid: 7, paymentId: "pay_1", razorpayOrderId: "order_A", signature: "sig" };

  it("verifies against the amount due, then settles and credits the driver", async () => {
    setup(row({ amount_due: 85, razorpay_order_id: "order_A" }));
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: {} });
    const { settlement } = await svc.settleOnline(pay);
    expect(verifyRazorpayPayment).toHaveBeenCalledWith({ paymentId: "pay_1", orderId: "order_A", signature: "sig", expectedAmountRupees: 85 });
    expect(settlement).toMatchObject({ status: "paid_online", method: "online", wallet_effect: "online", confirmed_by: "customer_online", razorpay_payment_id: "pay_1" });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 90 } } });
  });

  it("rejects a payment made against a different Razorpay order (replay on another settlement)", async () => {
    setup(row({ razorpay_order_id: "order_A" }));
    await expect(svc.settleOnline({ ...pay, razorpayOrderId: "order_OTHER" })).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects when Razorpay verification fails (bad signature or wrong amount) and stays pending", async () => {
    setup(row({ razorpay_order_id: "order_A" }));
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment amount does not match" });
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "PAYMENT_VERIFICATION_FAILED", message: "Payment amount does not match" });
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("rejects when no Razorpay order was created for this settlement", async () => {
    setup(row({ razorpay_order_id: null }));
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
  });

  it("is a no-op for the same payment id after it already settled", async () => {
    setup(row({ status: "paid_online", wallet_effect: "online", effect_seq: 1, razorpay_order_id: "order_A", razorpay_payment_id: "pay_1" }));
    const result = await svc.settleOnline(pay);
    expect(result.alreadyDone).toBe(true);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
  });

  it("refuses to settle a disputed payment online", async () => {
    setup(row({ status: "disputed", razorpay_order_id: "order_A" }));
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });

  it("rechecks state inside the transaction (payment verified, but driver confirmed cash meanwhile)", async () => {
    const pending = row({ razorpay_order_id: "order_A" });
    setup(pending);
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: {} });
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(pending) // pre-check read
      .mockResolvedValueOnce({ ...pending, status: "cash_received", wallet_effect: "cash" }); // locked read
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "INVALID_STATE" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });

  it("rejects when the stored Razorpay order changed between the pre-check and the lock", async () => {
    const pending = row({ razorpay_order_id: "order_A" });
    setup(pending);
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: {} });
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce({ ...pending, razorpay_order_id: "order_B" });
    await expect(svc.settleOnline(pay)).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });
});

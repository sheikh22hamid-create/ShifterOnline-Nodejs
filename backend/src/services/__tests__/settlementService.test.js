jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../walletNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
const mockEmit = jest.fn();
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: mockEmit }) }) }));

const prisma = require("../../config/db");
const walletNotifier = require("../walletNotifier");
const logger = require("../../utils/logger");
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

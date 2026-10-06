jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-05T10:00:00Z") }));

const credits = require("../receiverWalletCredits");

function makeTx({ wallet = 100, duplicates = [] } = {}) {
  const tx = {
    tbl_wallet_history: {
      findFirst: jest.fn(({ where }) => Promise.resolve(duplicates.includes(where.payment_id) ? { id: 1 } : null)),
      create: jest.fn().mockResolvedValue({}),
    },
    tbl_user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ wallet }) },
    order_receiver_pay: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  return tx;
}
const s = (o = {}) => ({
  id: 4, order_id: 50, uid: 7, payer: "receiver", amount_due: 90, prepaid_amount: 10,
  advance_held: 20, receiver_markup: 2.7, receiver_credited: false, reversal_shortfall: 0, effect_seq: 1, ...o,
});

describe("applyReceiverCredits", () => {
  it("credits the advance refund and the commission (online)", async () => {
    const tx = makeTx(); const notifications = [];
    const out = await credits.applyReceiverCredits(tx, s(), { includeMarkup: true, notifications });
    expect(out).toEqual({ advance: 20, markup: 2.7 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    const keys = tx.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id);
    expect(keys).toEqual(["receiver_advance_refund:4", "receiver_markup_credit:4"]);
    expect(tx.tbl_wallet_history.create.mock.calls[1][0].data).toMatchObject({
      type: "credit", wallet_type: "user", user_id: 7, order_id: 50, remark: "Receiver commission for order #50",
    });
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({ userId: 7, type: "credit", amount: 20 });
  });
  it("cash: credits only the advance refund", async () => {
    const tx = makeTx(); const notifications = [];
    const out = await credits.applyReceiverCredits(tx, s(), { includeMarkup: false, notifications });
    expect(out).toEqual({ advance: 20, markup: 0 });
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
  });
  it("advance 0 (no-advance plan / wallet-paid) writes no refund row", async () => {
    const tx = makeTx();
    await credits.applyReceiverCredits(tx, s({ advance_held: 0 }), { includeMarkup: true, notifications: [] });
    const keys = tx.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id);
    expect(keys).toEqual(["receiver_markup_credit:4"]);
  });
  it("is idempotent: an existing key is skipped", async () => {
    const tx = makeTx({ duplicates: ["receiver_advance_refund:4", "receiver_markup_credit:4"] });
    await credits.applyReceiverCredits(tx, s(), { includeMarkup: true, notifications: [] });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});

describe("reverseReceiverCredits", () => {
  it("debits what was credited when the wallet still has it", async () => {
    const tx = makeTx({ wallet: 100 });
    const out = await credits.reverseReceiverCredits(tx, s(), { notifications: [] });
    expect(out).toEqual({ shortfall: 0 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 20 } } });
  });
  it("never drives the wallet negative: caps at the balance and reports the shortfall", async () => {
    const tx = makeTx({ wallet: 5 });
    const out = await credits.reverseReceiverCredits(tx, s({ advance_held: 20, receiver_markup: 0 }), { notifications: [] });
    expect(out).toEqual({ shortfall: 15 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 5 } } });
  });
  it("an empty wallet debits nothing and reports the full shortfall", async () => {
    const tx = makeTx({ wallet: 0 });
    const out = await credits.reverseReceiverCredits(tx, s({ advance_held: 20, receiver_markup: 0 }), { notifications: [] });
    expect(out).toEqual({ shortfall: 20 });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("adminOutcomePatch", () => {
  it("is a no-op for a normal (customer) settlement", async () => {
    expect(await credits.adminOutcomePatch(makeTx(), s({ payer: "customer" }), "paid_online", { notifications: [] })).toEqual({});
  });
  it("paid_online credits advance + commission and marks credited", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "paid_online", { notifications: [] });
    expect(patch).toEqual({ receiver_credited: true });
    expect(tx.order_receiver_pay.updateMany).toHaveBeenCalledWith({ where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "paid" }) });
  });
  it("cash_received credits advance + commission and keeps the commission on the row", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "cash_received", { notifications: [] });
    expect(patch).toEqual({ receiver_credited: true });
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledTimes(2);
  });
  it("does not credit twice when already credited", async () => {
    const tx = makeTx();
    expect(await credits.adminOutcomePatch(tx, s({ receiver_credited: true }), "paid_online", { notifications: [] })).toEqual({});
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
  it("waived converts to customer mode: advance consumed against the amount, nothing credited", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "waived", { notifications: [] });
    expect(patch).toEqual({
      payer: "customer", amount_due: 70, prepaid_amount: 30, receiver_markup: 0, receiver_credited: false, reversal_shortfall: 0,
    });
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
  it("waived after a credited payment reverses the credits and records the shortfall", async () => {
    const tx = makeTx({ wallet: 0 });
    const patch = await credits.adminOutcomePatch(tx, s({ receiver_credited: true, receiver_markup: 0 }), "customer_owes", { notifications: [] });
    expect(patch).toMatchObject({ payer: "customer", receiver_credited: false, reversal_shortfall: 20 });
  });
});

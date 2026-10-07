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
  it("credits only the commission (online) - the advance stays in the wallet, no refund", async () => {
    const tx = makeTx(); const notifications = [];
    const out = await credits.applyReceiverCredits(tx, s(), { includeMarkup: true, notifications });
    expect(out).toEqual({ markup: 2.7 });
    expect(tx.tbl_user.update).toHaveBeenCalledTimes(1);
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    const keys = tx.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id);
    expect(keys).toEqual(["receiver_markup_credit:4"]);
    expect(tx.tbl_wallet_history.create.mock.calls[0][0].data).toMatchObject({
      type: "credit", wallet_type: "user", user_id: 7, order_id: 50, remark: "Receiver commission for order #50",
    });
    expect(notifications).toHaveLength(1);
  });
  it("cash with no commission credits nothing - the advance is already in the wallet", async () => {
    const tx = makeTx(); const notifications = [];
    const out = await credits.applyReceiverCredits(tx, s(), { includeMarkup: false, notifications });
    expect(out).toEqual({ markup: 0 });
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });
  it("is idempotent: an existing key is skipped", async () => {
    const tx = makeTx({ duplicates: ["receiver_markup_credit:4"] });
    await credits.applyReceiverCredits(tx, s(), { includeMarkup: true, notifications: [] });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});

describe("consumeAdvance", () => {
  it("debits the held advance from the wallet and reports it consumed", async () => {
    const tx = makeTx({ wallet: 100 });
    const out = await credits.consumeAdvance(tx, s(), { notifications: [] });
    expect(out).toEqual({ consumed: 20, shortfall: 0 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 20 } } });
    expect(tx.tbl_wallet_history.create.mock.calls[0][0].data).toMatchObject({ type: "debit", payment_id: "advance_apply:50" });
  });
  it("never drives the wallet negative: consumes what is left, the rest stays owed", async () => {
    const tx = makeTx({ wallet: 5 });
    const out = await credits.consumeAdvance(tx, s(), { notifications: [] });
    expect(out).toEqual({ consumed: 5, shortfall: 15 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 5 } } });
  });
  it("is a no-op with no advance held", async () => {
    const tx = makeTx();
    expect(await credits.consumeAdvance(tx, s({ advance_held: 0 }), { notifications: [] })).toEqual({ consumed: 0, shortfall: 0 });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });
  it("is idempotent: already applied (e.g. by tripLifecycle) is not debited twice", async () => {
    const tx = makeTx({ duplicates: ["advance_apply:50"] });
    const out = await credits.consumeAdvance(tx, s(), { notifications: [] });
    expect(out).toEqual({ consumed: 20, shortfall: 0 });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("reverseReceiverCredits", () => {
  it("debits the commission that was credited when the wallet still has it (advance untouched)", async () => {
    const tx = makeTx({ wallet: 100 });
    const out = await credits.reverseReceiverCredits(tx, s(), { notifications: [] });
    expect(out).toEqual({ shortfall: 0 });
    expect(tx.tbl_user.update).toHaveBeenCalledTimes(1);
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 2.7 } } });
  });
  it("never drives the wallet negative: caps at the balance and reports the shortfall", async () => {
    const tx = makeTx({ wallet: 1 });
    const out = await credits.reverseReceiverCredits(tx, s(), { notifications: [] });
    expect(out).toEqual({ shortfall: 1.7 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 1 } } });
  });
  it("an empty wallet debits nothing and reports the full shortfall", async () => {
    const tx = makeTx({ wallet: 0 });
    const out = await credits.reverseReceiverCredits(tx, s(), { notifications: [] });
    expect(out).toEqual({ shortfall: 2.7 });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("adminOutcomePatch", () => {
  it("is a no-op for a normal (customer) settlement", async () => {
    expect(await credits.adminOutcomePatch(makeTx(), s({ payer: "customer" }), "paid_online", { notifications: [] })).toEqual({});
  });
  it("paid_online credits the commission only (advance stays in the wallet) and marks credited", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "paid_online", { notifications: [] });
    expect(patch).toEqual({ receiver_credited: true });
    expect(tx.order_receiver_pay.updateMany).toHaveBeenCalledWith({ where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "paid" }) });
  });
  it("cash_received credits the commission and keeps it on the row", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "cash_received", { notifications: [] });
    expect(patch).toEqual({ receiver_credited: true });
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
  });
  it("does not credit twice when already credited", async () => {
    const tx = makeTx();
    expect(await credits.adminOutcomePatch(tx, s({ receiver_credited: true }), "paid_online", { notifications: [] })).toEqual({});
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
  it("waived converts to customer mode: the advance is debited from the wallet and netted off the amount", async () => {
    const tx = makeTx({ wallet: 100 });
    const patch = await credits.adminOutcomePatch(tx, s(), "waived", { notifications: [] });
    expect(patch).toEqual({
      payer: "customer", amount_due: 70, prepaid_amount: 30, receiver_markup: 0, receiver_credited: false, reversal_shortfall: 0,
    });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 20 } } });
  });
  it("waived when the booker already spent the advance: only the debited part is netted, the rest stays due", async () => {
    const tx = makeTx({ wallet: 5 });
    const patch = await credits.adminOutcomePatch(tx, s(), "customer_owes", { notifications: [] });
    expect(patch).toMatchObject({ payer: "customer", amount_due: 85, prepaid_amount: 15, reversal_shortfall: 0 });
  });
  it("waived after a credited payment reverses the commission (shortfall recorded) and consumes the advance", async () => {
    const tx = makeTx({ wallet: 0 });
    const patch = await credits.adminOutcomePatch(tx, s({ receiver_credited: true }), "customer_owes", { notifications: [] });
    expect(patch).toMatchObject({ payer: "customer", receiver_credited: false, reversal_shortfall: 2.7, amount_due: 90, prepaid_amount: 10 });
  });
});

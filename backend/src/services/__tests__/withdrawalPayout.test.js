jest.mock("../../config/db", () => ({
  driver_withdraw_requests: { findUnique: jest.fn(), updateMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyPayoutUpdate: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));

const prisma = require("../../config/db");
const adminSocket = require("../../sockets/adminSocket");
const pushNotifier = require("../pushNotifier");
const { claimAndDebit, revertToPending, applyPayoutState } = require("../withdrawalPayout");

const RIDER = { id: 7, city_id: 3, fcm_token: "tok-7", wallet_balance: "10.00" };

function withdrawal(overrides = {}) {
  return {
    id: 55, rider_id: 7, amount: "2.00", status: "processing", city_id: 3,
    payout_method: "upi", payout_detail: "UPI (driver@okhdfc)",
    ...overrides,
  };
}

function walletWriteCount() {
  return prisma.tbl_rider.update.mock.calls.length + prisma.tbl_rider.updateMany.mock.calls.length;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  prisma.tbl_rider.findUnique.mockResolvedValue(RIDER);
  prisma.tbl_rider.update.mockResolvedValue(RIDER);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_rnoti.create.mockResolvedValue({});
  pushNotifier.notifyDriverWalletTransaction.mockResolvedValue(undefined);
});

describe("claimAndDebit", () => {
  it("claims pending -> processing, debits with a balance guard and writes a debit ledger row", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
    prisma.tbl_rider.updateMany.mockResolvedValue({ count: 1 });

    const result = await claimAndDebit(55);

    expect(result.ok).toBe(true);
    expect(result.withdrawal.id).toBe(55);
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "pending" },
      data: expect.objectContaining({ status: "processing", payout_started_at: expect.any(Date), failure_reason: null }),
    });
    expect(prisma.tbl_rider.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_rider.updateMany).toHaveBeenCalledWith({
      where: { id: 7, wallet_balance: { gte: 2 } },
      data: { wallet_balance: { decrement: 2 } },
    });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
    const ledger = prisma.tbl_wallet_history.create.mock.calls[0][0].data;
    expect(ledger).toEqual(expect.objectContaining({ user_id: 7, amount: 2, type: "debit", wallet_type: "driver" }));
    expect(ledger.remark).toContain("withdrawal #55");
    expect(ledger.remark).toContain("via UPI (driver@okhdfc)");
  });

  it("returns not_pending and touches no money when the claim loses the race", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 0 });

    const result = await claimAndDebit(55);

    expect(result).toEqual({ ok: false, reason: "not_pending" });
    expect(walletWriteCount()).toBe(0);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("rolls back the whole transaction (claim included) on low balance", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
    prisma.tbl_rider.updateMany.mockResolvedValue({ count: 0 });

    const result = await claimAndDebit(55);

    expect(result).toEqual({ ok: false, reason: "low_balance" });
    // The transaction callback must reject so Prisma rolls back the claim.
    await expect(prisma.$transaction.mock.results[0].value).rejects.toBeDefined();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });

  it("propagates unexpected DB errors instead of masking them as a result", async () => {
    prisma.driver_withdraw_requests.updateMany.mockRejectedValue(new Error("db down"));
    await expect(claimAndDebit(55)).rejects.toThrow("db down");
  });
});

describe("applyPayoutState", () => {
  it("processed -> paid, stores utr and payout id, no wallet write, notifies driver + admin", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });

    const out = await applyPayoutState({ withdrawalId: 55, payoutId: "pout_1", status: "processed", utr: "UTR123" });

    expect(out).toBe("paid");
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "processing", razorpay_payout_id: null },
      data: expect.objectContaining({
        status: "paid", utr: "UTR123", razorpay_payout_id: "pout_1", payout_processed_at: expect.any(Date),
      }),
    });
    expect(walletWriteCount()).toBe(0);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.tbl_rnoti.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rid: 7, title: "Payout sent", type: "payout" }),
    });
    expect(pushNotifier.notifyDriverWalletTransaction).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyPayoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 55, rider_id: 7, city_id: 3, status: "paid", amount: 2 })
    );
  });

  it("processed on a row that is not processing -> ignored, no writes", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: "paid" }));

    const out = await applyPayoutState({ withdrawalId: 55, payoutId: "pout_1", status: "processed", utr: "UTR123" });

    expect(out).toBe("ignored");
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });

  it("reversed on a processing row -> failed with exactly one refund; a repeat is a no-op", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
    prisma.driver_withdraw_requests.updateMany.mockResolvedValueOnce({ count: 1 });

    const out = await applyPayoutState({ withdrawalId: 55, payoutId: "pout_1", status: "reversed", failureReason: "Beneficiary bank down" });

    expect(out).toBe("failed");
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: { in: ["processing", "paid"] }, razorpay_payout_id: null },
      data: expect.objectContaining({ status: "failed", failure_reason: "Beneficiary bank down" }),
    });
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { wallet_balance: { increment: 2 } },
    });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
    const ledger = prisma.tbl_wallet_history.create.mock.calls[0][0].data;
    expect(ledger).toEqual(expect.objectContaining({ user_id: 7, amount: 2, type: "credit", wallet_type: "driver" }));
    expect(ledger.remark).toBe("Payout failed — returned (withdrawal #55)");
    expect(prisma.tbl_rnoti.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ title: "Payout failed", msg: expect.stringContaining("₹2.00") }),
    });
    expect(adminSocket.notifyPayoutUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));

    // Repeat delivery: another caller already moved the row, update count 0.
    prisma.driver_withdraw_requests.updateMany.mockResolvedValueOnce({ count: 0 });
    const again = await applyPayoutState({ withdrawalId: 55, payoutId: "pout_1", status: "reversed", failureReason: "Beneficiary bank down" });

    expect(again).toBe("ignored");
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_rnoti.create).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyPayoutUpdate).toHaveBeenCalledTimes(1);
  });

  it("reversed on a paid row (processed-then-reversed) -> failed with one refund", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: "paid", utr: "UTR123" }));
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });

    const out = await applyPayoutState({ withdrawalId: 55, payoutId: "pout_1", status: "reversed", failureReason: "Reversed by bank" });

    expect(out).toBe("failed");
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "rejected", "cancelled"])("%s maps to failed with one refund", async (status) => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });

    expect(await applyPayoutState({ withdrawalId: 55, payoutId: "p", status, failureReason: "x" })).toBe("failed");
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
  });

  it("does the refund in the same transaction as the failed status update", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    const tx = {
      driver_withdraw_requests: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      tbl_rider: { update: jest.fn().mockResolvedValue(RIDER) },
      tbl_wallet_history: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma.$transaction.mockImplementation((fn) => fn(tx));

    await applyPayoutState({ withdrawalId: 55, payoutId: "p", status: "failed", failureReason: "x" });

    expect(tx.driver_withdraw_requests.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });

  it("a notification failure after commit does not undo or throw out of the transition", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    prisma.tbl_rnoti.create.mockRejectedValue(new Error("rnoti down"));
    adminSocket.notifyPayoutUpdate.mockImplementation(() => { throw new Error("socket down"); });

    await expect(
      applyPayoutState({ withdrawalId: 55, payoutId: "p", status: "reversed", failureReason: "x" })
    ).resolves.toBe("failed");
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    adminSocket.notifyPayoutUpdate.mockReset();
  });

  it.each(["queued", "pending", "initiated", "processing"])("%s -> ignored with no DB writes", async (status) => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());

    expect(await applyPayoutState({ withdrawalId: 55, payoutId: "p", status })).toBe("ignored");
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(walletWriteCount()).toBe(0);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.tbl_rnoti.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });

  it("unknown withdrawal id -> ignored with no writes", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(null);

    expect(await applyPayoutState({ withdrawalId: 999, payoutId: "p", status: "reversed" })).toBe("ignored");
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(walletWriteCount()).toBe(0);
  });

  it("failed on a row that is still pending or already failed -> ignored, no refund", async () => {
    for (const s of ["pending", "failed", "approved", "rejected"]) {
      prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: s }));
      expect(await applyPayoutState({ withdrawalId: 55, payoutId: "p", status: "failed" })).toBe("ignored");
    }
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(walletWriteCount()).toBe(0);
  });
});

describe("applyPayoutState payout id matching", () => {
  it.each(["reversed", "processed"])("stored pay_A, event pay_B %s -> ignored with no writes", async (status) => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pay_A" }));
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });

    expect(await applyPayoutState({ withdrawalId: 55, payoutId: "pay_B", status, utr: "U", failureReason: "x" })).toBe("ignored");
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(walletWriteCount()).toBe(0);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(prisma.tbl_rnoti.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });

  it("stored pay_A, event pay_A reversed -> failed with one refund, where matches the stored id", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pay_A" }));
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });

    expect(await applyPayoutState({ withdrawalId: 55, payoutId: "pay_A", status: "reversed", failureReason: "x" })).toBe("failed");
    const call = prisma.driver_withdraw_requests.updateMany.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ id: 55, razorpay_payout_id: "pay_A" }));
    expect(call.data).not.toHaveProperty("razorpay_payout_id");
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
  });

  it("no stored id, event pay_A processed -> paid, adopts the id guarded by razorpay_payout_id null", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: null }));
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });

    expect(await applyPayoutState({ withdrawalId: 55, payoutId: "pay_A", status: "processed", utr: "U" })).toBe("paid");
    const call = prisma.driver_withdraw_requests.updateMany.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ razorpay_payout_id: null }));
    expect(call.data.razorpay_payout_id).toBe("pay_A");
  });

  it("stored id, event without payoutId -> processed normally without overwriting the stored id", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pay_A" }));
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });

    expect(await applyPayoutState({ withdrawalId: 55, status: "processed", utr: "U" })).toBe("paid");
    const call = prisma.driver_withdraw_requests.updateMany.mock.calls[0][0];
    expect(call.where).toEqual(expect.objectContaining({ razorpay_payout_id: "pay_A" }));
    expect(call.data).not.toHaveProperty("razorpay_payout_id");
    expect(call.data.utr).toBe("U");
  });

  it("guarded update count 0 on a matching id (concurrent change) -> ignored, no refund", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pay_A" }));
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 0 });

    expect(await applyPayoutState({ withdrawalId: 55, payoutId: "pay_A", status: "failed" })).toBe("ignored");
    expect(walletWriteCount()).toBe(0);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});

describe("revertToPending", () => {
  it("requireNoFundAccount adds the null fund-account / payout-id guard to the claim", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: "pending" }));

    const ok = await revertToPending(55, "Invalid VPA", { requireNoFundAccount: true });

    expect(ok).toBe(true);
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "processing", razorpay_fund_account_id: null, razorpay_payout_id: null },
      data: { status: "pending", failure_reason: "Invalid VPA" },
    });
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
  });

  it("requireNoFundAccount: 0 rows matched -> false, no wallet or ledger writes", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 0 });

    const ok = await revertToPending(55, "Invalid VPA", { requireNoFundAccount: true });

    expect(ok).toBe(false);
    expect(walletWriteCount()).toBe(0);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });

  it("without options the claim is guarded on status only (unchanged)", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: "pending" }));

    await revertToPending(55, "Insufficient balance");

    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "processing" },
      data: { status: "pending", failure_reason: "Insufficient balance" },
    });
  });

  it("moves processing -> pending, refunds once with a credit row, notifies admin only", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: "pending" }));

    const ok = await revertToPending(55, "Invalid VPA");

    expect(ok).toBe(true);
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "processing" },
      data: expect.objectContaining({ status: "pending", failure_reason: "Invalid VPA" }),
    });
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { wallet_balance: { increment: 2 } },
    });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
    const ledger = prisma.tbl_wallet_history.create.mock.calls[0][0].data;
    expect(ledger).toEqual(expect.objectContaining({ user_id: 7, amount: 2, type: "credit", wallet_type: "driver" }));
    expect(ledger.remark).toBe("Payout not sent — returned (withdrawal #55)");
    expect(adminSocket.notifyPayoutUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 55, rider_id: 7, status: "pending", amount: 2 })
    );
    expect(pushNotifier.notifyDriverWalletTransaction).not.toHaveBeenCalled();
    expect(prisma.tbl_rnoti.create).not.toHaveBeenCalled();
  });

  it("returns false with no refund when the row is no longer processing", async () => {
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 0 });

    expect(await revertToPending(55, "Invalid VPA")).toBe(false);
    expect(walletWriteCount()).toBe(0);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });
});

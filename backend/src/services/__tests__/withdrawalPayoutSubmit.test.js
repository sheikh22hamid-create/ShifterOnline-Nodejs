jest.mock("../../config/db", () => ({
  driver_withdraw_requests: { findUnique: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  tbl_bank_account: { findFirst: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyPayoutUpdate: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../utils/razorpayx", () => ({
  isConfigured: jest.fn(),
  createContact: jest.fn(),
  createFundAccount: jest.fn(),
  createPayout: jest.fn(),
  fetchPayout: jest.fn(),
}));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const razorpayx = require("../../utils/razorpayx");
const {
  resolveDestination,
  submitPayout,
  syncWithdrawal,
  sweepStuckPayouts,
} = require("../withdrawalPayout");

const MISMATCH = "Driver changed payout details after requesting — reject and ask them to request again.";

function rider(overrides = {}) {
  return {
    id: 7, city_id: 3, fcm_token: "tok-7", wallet_balance: "10.00",
    full_name: "Ravi Kumar", first_name: "Ravi", last_name: "K", fmobile: "9876543210",
    upi_id: "driver@okhdfc", razorpay_contact_id: null,
    ...overrides,
  };
}

function withdrawal(overrides = {}) {
  return {
    id: 55, rider_id: 7, amount: "2.00", status: "processing", city_id: 3,
    payout_method: "upi", payout_detail: "UPI (driver@okhdfc)",
    razorpay_payout_id: null, razorpay_fund_account_id: null,
    ...overrides,
  };
}

const BANK = { id: 1, rider_id: 7, iban_num: "123456789012", ifsc_code: "SBIN0001234", bank_name: "SBI", a_name: "Ravi Kumar" };

// The revertToPending claim (processing -> pending) is the only write with that shape.
function revertCalls() {
  return prisma.driver_withdraw_requests.updateMany.mock.calls.filter(
    ([arg]) => arg.data && arg.data.status === "pending"
  );
}

function walletWriteCount() {
  return prisma.tbl_rider.update.mock.calls.length + prisma.tbl_wallet_history.create.mock.calls.length;
}

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((fn) => fn(prisma));
  prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal());
  prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
  prisma.driver_withdraw_requests.findMany.mockResolvedValue([]);
  prisma.tbl_rider.findUnique.mockResolvedValue(rider());
  prisma.tbl_rider.updateMany.mockResolvedValue({ count: 1 });
  prisma.tbl_rider.update.mockResolvedValue(rider());
  prisma.tbl_bank_account.findFirst.mockResolvedValue(BANK);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_rnoti.create.mockResolvedValue({});
  razorpayx.isConfigured.mockReturnValue(true);
  razorpayx.createContact.mockResolvedValue({ ok: true, id: "cont_1" });
  razorpayx.createFundAccount.mockResolvedValue({ ok: true, id: "fa_1" });
  razorpayx.createPayout.mockResolvedValue({ ok: true, id: "pout_1", status: "processing", utr: null });
  razorpayx.fetchPayout.mockResolvedValue({ ok: true, id: "pout_1", status: "processing", utr: null, failureReason: null });
});

describe("resolveDestination", () => {
  it("UPI matching the snapshot -> ok with upiId", async () => {
    const out = await resolveDestination(withdrawal(), rider());
    expect(out).toEqual({ ok: true, method: "upi", upiId: "driver@okhdfc" });
  });

  it("UPI changed after requesting -> refused with the changed message", async () => {
    const out = await resolveDestination(withdrawal(), rider({ upi_id: "other@okaxis" }));
    expect(out).toEqual({ ok: false, message: MISMATCH });
    expect(out.message).toContain("changed");
  });

  it("UPI removed after requesting -> refused", async () => {
    const out = await resolveDestination(withdrawal(), rider({ upi_id: null }));
    expect(out).toEqual({ ok: false, message: MISMATCH });
  });

  it("bank with matching last 4 -> ok with full number, IFSC and name", async () => {
    const w = withdrawal({ payout_method: "bank", payout_detail: "Bank SBI (•••9012)" });
    const out = await resolveDestination(w, rider());
    expect(prisma.tbl_bank_account.findFirst).toHaveBeenCalledWith({ where: { rider_id: 7 } });
    expect(out).toEqual({
      ok: true, method: "bank", accountName: "Ravi Kumar", accountNumber: "123456789012", ifsc: "SBIN0001234",
    });
  });

  it("bank with different last 4 -> refused", async () => {
    const w = withdrawal({ payout_method: "bank", payout_detail: "Bank SBI (•••4444)" });
    const out = await resolveDestination(w, rider());
    expect(out).toEqual({ ok: false, message: MISMATCH });
  });

  it("bank account deleted after requesting -> refused", async () => {
    prisma.tbl_bank_account.findFirst.mockResolvedValue(null);
    const w = withdrawal({ payout_method: "bank", payout_detail: "Bank SBI (•••9012)" });
    const out = await resolveDestination(w, rider());
    expect(out).toEqual({ ok: false, message: MISMATCH });
  });

  it("null payout_method -> refused", async () => {
    const out = await resolveDestination(withdrawal({ payout_method: null, payout_detail: null }), rider());
    expect(out).toEqual({
      ok: false,
      message: "no payout method on this request — reject and ask the driver to request again",
    });
  });

  it("is side-effect free (no writes, no Razorpay calls)", async () => {
    await resolveDestination(withdrawal({ payout_method: "bank", payout_detail: "Bank SBI (•••9012)" }), rider());
    await resolveDestination(withdrawal(), rider({ upi_id: "x@y" }));
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.updateMany).not.toHaveBeenCalled();
    expect(razorpayx.createContact).not.toHaveBeenCalled();
    expect(razorpayx.createFundAccount).not.toHaveBeenCalled();
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });
});

describe("submitPayout", () => {
  it("accepted: creates + stores contact and fund account, creates the payout, stores its id", async () => {
    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "accepted" });
    expect(razorpayx.createContact).toHaveBeenCalledWith({
      name: "Ravi Kumar", mobile: "9876543210", referenceId: "rider-7",
    });
    expect(prisma.tbl_rider.updateMany).toHaveBeenCalledWith({
      where: { id: 7, razorpay_contact_id: null },
      data: { razorpay_contact_id: "cont_1" },
    });
    expect(razorpayx.createFundAccount).toHaveBeenCalledWith({
      contactId: "cont_1", method: "upi", upiId: "driver@okhdfc",
    });
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, razorpay_fund_account_id: null },
      data: { razorpay_fund_account_id: "fa_1" },
    });
    expect(razorpayx.createPayout).toHaveBeenCalledWith({
      fundAccountId: "fa_1", amountRupees: 2, method: "upi", referenceId: "wd-55",
    });
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, razorpay_payout_id: null },
      data: { razorpay_payout_id: "pout_1" },
    });
    expect(revertCalls()).toHaveLength(0);
    expect(walletWriteCount()).toBe(0);
  });

  it("bank destination: fund account gets the full number, IFSC and holder name; IMPS method passed", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(
      withdrawal({ payout_method: "bank", payout_detail: "Bank SBI (•••9012)", amount: "1500.50" })
    );

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "accepted" });
    expect(razorpayx.createFundAccount).toHaveBeenCalledWith({
      contactId: "cont_1", method: "bank", accountName: "Ravi Kumar", accountNumber: "123456789012", ifsc: "SBIN0001234",
    });
    expect(razorpayx.createPayout).toHaveBeenCalledWith({
      fundAccountId: "fa_1", amountRupees: 1500.5, method: "bank", referenceId: "wd-55",
    });
  });

  it("contact name falls back to first + last name, then Driver #id", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ full_name: null }));
    await submitPayout(55);
    expect(razorpayx.createContact).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Ravi K" }));

    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ full_name: "  ", first_name: null, last_name: null }));
    await submitPayout(55);
    expect(razorpayx.createContact).toHaveBeenLastCalledWith(expect.objectContaining({ name: "Driver #7" }));
  });

  it("reuses an existing contact id and fund account id (no create calls)", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ razorpay_contact_id: "cont_old" }));
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_fund_account_id: "fa_old" }));

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "accepted" });
    expect(razorpayx.createContact).not.toHaveBeenCalled();
    expect(razorpayx.createFundAccount).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.updateMany).not.toHaveBeenCalled();
    expect(razorpayx.createPayout).toHaveBeenCalledWith({
      fundAccountId: "fa_old", amountRupees: 2, method: "upi", referenceId: "wd-55",
    });
  });

  it("uses the fund account a concurrent caller stored when the guarded write loses", async () => {
    // First read: no fund account; after our guarded write loses, the re-read shows the winner's id.
    prisma.driver_withdraw_requests.findUnique
      .mockResolvedValueOnce(withdrawal())
      .mockResolvedValue(withdrawal({ razorpay_fund_account_id: "fa_winner" }));
    prisma.driver_withdraw_requests.updateMany.mockImplementation(async ({ data }) =>
      ({ count: data.razorpay_fund_account_id ? 0 : 1 })
    );

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "accepted" });
    expect(razorpayx.createPayout).toHaveBeenCalledWith(expect.objectContaining({ fundAccountId: "fa_winner" }));
  });

  it("does not overwrite a different stored payout id; logs the mismatch and still returns accepted", async () => {
    prisma.driver_withdraw_requests.findUnique
      .mockResolvedValueOnce(withdrawal())
      .mockResolvedValue(withdrawal({ razorpay_fund_account_id: "fa_1", razorpay_payout_id: "pout_webhook" }));
    prisma.driver_withdraw_requests.updateMany.mockImplementation(async ({ data }) =>
      ({ count: data.razorpay_payout_id ? 0 : 1 })
    );

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "accepted" });
    const payoutIdWrites = prisma.driver_withdraw_requests.updateMany.mock.calls.filter(([a]) => "razorpay_payout_id" in a.data);
    expect(payoutIdWrites).toEqual([[{ where: { id: 55, razorpay_payout_id: null }, data: { razorpay_payout_id: "pout_1" } }]]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("pout_webhook"));
    expect(revertCalls()).toHaveLength(0);
  });

  it("runs applyPayoutState when the payout is already final (processed -> paid)", async () => {
    razorpayx.createPayout.mockResolvedValue({ ok: true, id: "pout_1", status: "processed", utr: "UTR9" });
    prisma.driver_withdraw_requests.findUnique
      .mockResolvedValueOnce(withdrawal())
      .mockResolvedValue(withdrawal({ razorpay_fund_account_id: "fa_1", razorpay_payout_id: "pout_1" }));

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "accepted" });
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "processing", razorpay_payout_id: "pout_1" },
      data: expect.objectContaining({ status: "paid", utr: "UTR9" }),
    });
  });

  it("definitive createPayout refusal -> revertToPending with that reason, refused", async () => {
    razorpayx.createPayout.mockResolvedValue({ ok: false, definitive: true, reason: "Insufficient balance" });

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "refused", reason: "Insufficient balance" });
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "processing" },
      data: { status: "pending", failure_reason: "Insufficient balance" },
    });
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({
      where: { id: 7 }, data: { wallet_balance: { increment: 2 } },
    });
  });

  it("definitive refusal at the fund account step -> revert, refused, no payout attempted", async () => {
    razorpayx.createFundAccount.mockResolvedValue({ ok: false, definitive: true, reason: "Invalid VPA" });

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "refused", reason: "Invalid VPA" });
    expect(revertCalls()).toHaveLength(1);
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });

  it("non-definitive createPayout failure -> no revert, no refund, unknown", async () => {
    razorpayx.createPayout.mockResolvedValue({ ok: false, definitive: false, reason: "Could not reach RazorpayX. Try again." });

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "unknown", reason: "Could not reach RazorpayX. Try again." });
    expect(revertCalls()).toHaveLength(0);
    expect(walletWriteCount()).toBe(0);
  });

  it("not configured (non-definitive at contact step) -> unknown, nothing reverted", async () => {
    razorpayx.createContact.mockResolvedValue({ ok: false, definitive: false, reason: "RazorpayX is not configured" });

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "unknown", reason: "RazorpayX is not configured" });
    expect(revertCalls()).toHaveLength(0);
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });

  it("destination mismatch -> revertToPending with the message, refused, nothing sent", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ upi_id: "new@okaxis" }));

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "refused", reason: MISMATCH });
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "processing" },
      data: { status: "pending", failure_reason: MISMATCH },
    });
    expect(razorpayx.createContact).not.toHaveBeenCalled();
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });

  it("request not processing -> unknown, writes nothing and calls nothing", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: "pending" }));

    const out = await submitPayout(55);

    expect(out).toEqual({ outcome: "unknown", reason: "request is not processing" });
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(razorpayx.createContact).not.toHaveBeenCalled();
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });
});

describe("syncWithdrawal", () => {
  it("with a payout id: fetchPayout processed -> paid", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pout_1" }));
    razorpayx.fetchPayout.mockResolvedValue({ ok: true, id: "pout_1", status: "processed", utr: "UTR1", failureReason: null });

    const out = await syncWithdrawal(55);

    expect(out).toBe("paid");
    expect(razorpayx.fetchPayout).toHaveBeenCalledWith("pout_1");
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });

  it("with a payout id: fetchPayout reversed -> failed (one refund)", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pout_1" }));
    razorpayx.fetchPayout.mockResolvedValue({ ok: true, id: "pout_1", status: "reversed", utr: null, failureReason: "Bank down" });

    const out = await syncWithdrawal(55);

    expect(out).toBe("failed");
    expect(prisma.tbl_rider.update).toHaveBeenCalledTimes(1);
  });

  it("with a payout id: non-final status -> processing, no writes", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pout_1" }));

    const out = await syncWithdrawal(55);

    expect(out).toBe("processing");
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
  });

  it("fetchPayout 404 (definitive) never refunds or reverts; stays processing", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pout_1" }));
    razorpayx.fetchPayout.mockResolvedValue({ ok: false, definitive: true, reason: "The id provided does not exist" });

    const out = await syncWithdrawal(55);

    expect(out).toBe("processing");
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(walletWriteCount()).toBe(0);
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });

  it("fetchPayout timeout (non-definitive) -> processing, no writes", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ razorpay_payout_id: "pout_1" }));
    razorpayx.fetchPayout.mockResolvedValue({ ok: false, definitive: false, reason: "timeout" });

    const out = await syncWithdrawal(55);

    expect(out).toBe("processing");
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
    expect(walletWriteCount()).toBe(0);
  });

  it("without a payout id: re-submits with the same referenceId", async () => {
    const out = await syncWithdrawal(55);

    expect(out).toBe("processing");
    expect(razorpayx.fetchPayout).not.toHaveBeenCalled();
    expect(razorpayx.createPayout).toHaveBeenCalledWith(expect.objectContaining({ referenceId: "wd-55" }));
  });

  it("without a payout id: definitive refusal on re-submit -> refused", async () => {
    razorpayx.createPayout.mockResolvedValue({ ok: false, definitive: true, reason: "Insufficient balance" });

    const out = await syncWithdrawal(55);

    expect(out).toBe("refused");
    expect(revertCalls()).toHaveLength(1);
  });

  it("not processing -> no Razorpay call, reports the current state", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(withdrawal({ status: "paid", razorpay_payout_id: "pout_1" }));
    expect(await syncWithdrawal(55)).toBe("paid");
    expect(razorpayx.fetchPayout).not.toHaveBeenCalled();
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });
});

describe("sweepStuckPayouts", () => {
  it("queries processing rows older than the cutoff (max 20) and keeps going when one row throws", async () => {
    const before = Date.now();
    prisma.driver_withdraw_requests.findMany.mockResolvedValue([{ id: 55 }, { id: 56 }]);
    prisma.driver_withdraw_requests.findUnique.mockImplementation(async ({ where }) => {
      if (where.id === 55) throw new Error("db hiccup");
      return withdrawal({ id: 56, razorpay_payout_id: "pout_56" });
    });
    razorpayx.fetchPayout.mockResolvedValue({ ok: true, id: "pout_56", status: "processing", utr: null, failureReason: null });

    const n = await sweepStuckPayouts();

    expect(n).toBe(2);
    const arg = prisma.driver_withdraw_requests.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe("processing");
    expect(arg.take).toBe(20);
    const cutoff = arg.where.payout_started_at.lt;
    expect(cutoff).toBeInstanceOf(Date);
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 15 * 60 * 1000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - 15 * 60 * 1000);
    expect(razorpayx.fetchPayout).toHaveBeenCalledWith("pout_56");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("55"), expect.any(Error));
  });

  it("honours a custom olderThanMs", async () => {
    const before = Date.now();
    await sweepStuckPayouts(60 * 1000);
    const cutoff = prisma.driver_withdraw_requests.findMany.mock.calls[0][0].where.payout_started_at.lt;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(before - 60 * 1000);
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - 60 * 1000);
  });

  it("returns 0 without touching the DB or Razorpay when RazorpayX is not configured", async () => {
    razorpayx.isConfigured.mockReturnValue(false);

    const n = await sweepStuckPayouts();

    expect(n).toBe(0);
    expect(prisma.driver_withdraw_requests.findMany).not.toHaveBeenCalled();
    expect(prisma.driver_withdraw_requests.findUnique).not.toHaveBeenCalled();
    expect(razorpayx.fetchPayout).not.toHaveBeenCalled();
    expect(razorpayx.createPayout).not.toHaveBeenCalled();
  });
});

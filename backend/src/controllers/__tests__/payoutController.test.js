jest.mock("../../config/db", () => ({
  driver_withdraw_requests: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  tbl_bank_account: { findMany: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  tbl_rnoti: { create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../../sockets/adminSocket", () => ({ notifyPayoutUpdate: jest.fn() }));
jest.mock("../../services/pushNotifier", () => ({ notifyDriverWalletTransaction: jest.fn() }));
jest.mock("../../services/withdrawalPayout", () => ({
  claimAndDebit: jest.fn(),
  submitPayout: jest.fn(),
  syncWithdrawal: jest.fn(),
  resolveDestination: jest.fn(),
  revertToPending: jest.fn(),
}));
jest.mock("../../utils/razorpayx", () => ({ isConfigured: jest.fn() }));

const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const adminSocket = require("../../sockets/adminSocket");
const pushNotifier = require("../../services/pushNotifier");
const payoutService = require("../../services/withdrawalPayout");
const razorpayx = require("../../utils/razorpayx");
const { approve, reject, sync, list } = require("../payoutController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

const PENDING = {
  id: 55, rider_id: 7, amount: "2.00", status: "pending", city_id: 3,
  payout_method: "upi", payout_detail: "UPI (driver@okhdfc)",
};
const RIDER = { id: 7, wallet_balance: "10.00", city_id: 3, fcm_token: "tok" };
const SUPER = { role: "superadmin" };

function approveReq(extra = {}) {
  return { params: { id: "55" }, body: {}, user: SUPER, ...extra };
}

describe("payoutController.approve", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    razorpayx.isConfigured.mockReturnValue(true);
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(PENDING);
    prisma.tbl_rider.findUnique.mockResolvedValue(RIDER);
    prisma.tbl_rnoti.create.mockResolvedValue({});
    pushNotifier.notifyDriverWalletTransaction.mockResolvedValue(undefined);
    payoutService.resolveDestination.mockResolvedValue({ ok: true, method: "upi", upiId: "driver@okhdfc" });
    payoutService.claimAndDebit.mockResolvedValue({ ok: true, withdrawal: PENDING });
    payoutService.submitPayout.mockResolvedValue({ outcome: "accepted" });
  });

  it("answers 503 and writes nothing when RazorpayX is not configured", async () => {
    razorpayx.isConfigured.mockReturnValue(false);
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "RazorpayX payouts are not configured." });
    expect(payoutService.resolveDestination).not.toHaveBeenCalled();
    expect(payoutService.claimAndDebit).not.toHaveBeenCalled();
    expect(payoutService.submitPayout).not.toHaveBeenCalled();
  });

  it("refuses with 409 and does not claim when the destination no longer matches", async () => {
    payoutService.resolveDestination.mockResolvedValue({ ok: false, message: "Driver changed payout details" });
    const res = mockRes();
    await approve(approveReq(), res);
    expect(payoutService.resolveDestination).toHaveBeenCalledWith(PENDING, RIDER);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Driver changed payout details" });
    expect(payoutService.claimAndDebit).not.toHaveBeenCalled();
  });

  it("claims, submits and answers 200 when RazorpayX accepts; body reference/proof are ignored", async () => {
    const calls = [];
    payoutService.claimAndDebit.mockImplementation(async () => { calls.push("claim"); return { ok: true, withdrawal: PENDING }; });
    payoutService.submitPayout.mockImplementation(async () => { calls.push("submit"); return { outcome: "accepted" }; });
    const res = mockRes();
    await approve(approveReq({ body: { transaction_reference: "REF1", payment_proof_url: "http://x/p.png" } }), res);

    expect(calls).toEqual(["claim", "submit"]);
    expect(payoutService.claimAndDebit).toHaveBeenCalledWith(55);
    expect(payoutService.submitPayout).toHaveBeenCalledWith(55);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, status: "processing", message: "Payout sent to RazorpayX" });
    expect(adminSocket.notifyPayoutUpdate).toHaveBeenCalledWith({
      id: 55, rider_id: 7, city_id: 3, status: "processing", amount: 2,
    });
    expect(prisma.tbl_rnoti.create).toHaveBeenCalledTimes(1);
    const noti = prisma.tbl_rnoti.create.mock.calls[0][0].data;
    expect(noti).toEqual(expect.objectContaining({ rid: 7, title: "Payout approved", type: "payout" }));
    expect(noti.msg).toBe("Your withdrawal of 2 is on its way to your account.");
    expect(noti.msg).not.toContain("REF1");
    expect(pushNotifier.notifyDriverWalletTransaction).toHaveBeenCalledTimes(1);
    expect(pushNotifier.notifyDriverWalletTransaction.mock.calls[0][0]).toBe("tok");
  });

  it("still answers 200 when the driver notification fails", async () => {
    prisma.tbl_rnoti.create.mockRejectedValue(new Error("db down"));
    pushNotifier.notifyDriverWalletTransaction.mockRejectedValue(new Error("fcm down"));
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("answers 409 and does not submit when the claim finds the request no longer pending", async () => {
    payoutService.claimAndDebit.mockResolvedValue({ ok: false, reason: "not_pending" });
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Withdrawal request is already being processed" });
    expect(payoutService.submitPayout).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });

  it("answers 409 and does not submit on low balance", async () => {
    payoutService.claimAndDebit.mockResolvedValue({ ok: false, reason: "low_balance" });
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      success: false, message: "Driver's wallet balance is lower than the requested amount",
    });
    expect(payoutService.submitPayout).not.toHaveBeenCalled();
  });

  it("answers 422 with the reason and no approval notification when RazorpayX refuses", async () => {
    payoutService.submitPayout.mockResolvedValue({ outcome: "refused", reason: "Invalid VPA" });
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Invalid VPA" });
    expect(prisma.tbl_rnoti.create).not.toHaveBeenCalled();
    expect(pushNotifier.notifyDriverWalletTransaction).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });

  it("answers 202, tells the admin socket, and does not notify the driver on an unknown outcome", async () => {
    payoutService.submitPayout.mockResolvedValue({ outcome: "unknown", reason: "timeout" });
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({
      success: true, status: "processing", message: "Payout submitted; confirmation pending",
    });
    expect(adminSocket.notifyPayoutUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 55, status: "processing" }));
    expect(prisma.tbl_rnoti.create).not.toHaveBeenCalled();
    expect(pushNotifier.notifyDriverWalletTransaction).not.toHaveBeenCalled();
  });

  it("refuses with 409 before any claim when the request isn't pending", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue({ ...PENDING, status: "processing" });
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(payoutService.claimAndDebit).not.toHaveBeenCalled();
    expect(payoutService.resolveDestination).not.toHaveBeenCalled();
  });

  it("answers a generic 500, never reverts, and logs the withdrawal id when submit throws after a claim", async () => {
    payoutService.submitPayout.mockRejectedValue(new Error("boom"));
    const res = mockRes();
    await approve(approveReq(), res);
    expect(payoutService.claimAndDebit).toHaveBeenCalledWith(55);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Internal server error" });
    expect(payoutService.revertToPending).not.toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toContain("55");
  });

  it("answers 404 for an unknown request", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await approve(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(payoutService.claimAndDebit).not.toHaveBeenCalled();
  });

  it("answers 403 for a non-superadmin outside the request's city", async () => {
    const res = mockRes();
    await approve(approveReq({ user: { role: "admin", city_id: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(payoutService.claimAndDebit).not.toHaveBeenCalled();
  });

  it("lets a non-superadmin approve inside their own city", async () => {
    const res = mockRes();
    await approve(approveReq({ user: { role: "admin", city_id: "3" } }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("payoutController.sync", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.tbl_rider.findUnique.mockResolvedValue(RIDER);
  });

  it("resolves a processing request through syncWithdrawal and returns its status", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue({ ...PENDING, status: "processing" });
    payoutService.syncWithdrawal.mockResolvedValue("paid");
    const res = mockRes();
    await sync(approveReq(), res);
    expect(payoutService.syncWithdrawal).toHaveBeenCalledWith(55);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, status: "paid" });
  });

  it("answers 409 and never syncs a request that isn't processing", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(PENDING);
    const res = mockRes();
    await sync(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Only processing payouts can be checked" });
    expect(payoutService.syncWithdrawal).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown request", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await sync(approveReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(payoutService.syncWithdrawal).not.toHaveBeenCalled();
  });

  it("answers 403 for a non-superadmin outside the request's city", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue({ ...PENDING, status: "processing" });
    const res = mockRes();
    await sync(approveReq({ user: { role: "admin", city_id: 9 } }), res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(payoutService.syncWithdrawal).not.toHaveBeenCalled();
  });
});

describe("payoutController.reject", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.tbl_rider.findUnique.mockResolvedValue(RIDER);
    prisma.tbl_rnoti.create.mockResolvedValue({});
  });

  it("rejects a pending request in the user's city with a status-guarded update", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(PENDING);
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 1 });
    const res = mockRes();
    await reject({ params: { id: "55" }, body: { rejection_reason: "bad" }, user: { role: "admin", city_id: 3 } }, res);
    expect(prisma.driver_withdraw_requests.updateMany).toHaveBeenCalledWith({
      where: { id: 55, status: "pending" },
      data: { status: "rejected" },
    });
    expect(prisma.tbl_rnoti.create).toHaveBeenCalledTimes(1);
    expect(adminSocket.notifyPayoutUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: 55, status: "rejected" }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("answers 409 with no notification when an approve claimed the request meanwhile", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(PENDING);
    prisma.driver_withdraw_requests.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await reject({ params: { id: "55" }, body: {}, user: SUPER }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Withdrawal request is no longer pending" });
    expect(prisma.tbl_rnoti.create).not.toHaveBeenCalled();
    expect(adminSocket.notifyPayoutUpdate).not.toHaveBeenCalled();
  });

  it("refuses a request that isn't pending and one outside the city", async () => {
    prisma.driver_withdraw_requests.findUnique.mockResolvedValue({ ...PENDING, status: "processing" });
    let res = mockRes();
    await reject({ params: { id: "55" }, body: {}, user: SUPER }, res);
    expect(res.status).toHaveBeenCalledWith(409);

    prisma.driver_withdraw_requests.findUnique.mockResolvedValue(PENDING);
    res = mockRes();
    await reject({ params: { id: "55" }, body: {}, user: { role: "admin", city_id: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.driver_withdraw_requests.updateMany).not.toHaveBeenCalled();
  });
});

describe("payoutController.list", () => {
  beforeEach(() => jest.resetAllMocks());

  it("carries utr, failure_reason and razorpay_payout_id on each row", async () => {
    prisma.driver_withdraw_requests.findMany.mockResolvedValue([
      { ...PENDING, id: 2, status: "paid", utr: "UTR123", failure_reason: null, razorpay_payout_id: "pout_1" },
      { ...PENDING, id: 1, status: "failed", utr: null, failure_reason: "Payout reversed", razorpay_payout_id: "pout_0" },
    ]);
    prisma.tbl_rider.findMany.mockResolvedValue([RIDER]);
    prisma.tbl_bank_account.findMany.mockResolvedValue([]);
    const res = mockRes();
    await list({ query: {} }, res);
    const { data } = res.json.mock.calls[0][0];
    expect(data[0]).toEqual(expect.objectContaining({ id: 2, utr: "UTR123", failure_reason: null, razorpay_payout_id: "pout_1" }));
    expect(data[1]).toEqual(expect.objectContaining({ id: 1, utr: null, failure_reason: "Payout reversed", razorpay_payout_id: "pout_0" }));
  });
});

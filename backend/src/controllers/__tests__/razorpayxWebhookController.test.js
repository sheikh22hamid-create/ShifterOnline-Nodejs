jest.mock("../../utils/razorpayx", () => ({ verifyWebhookSignature: jest.fn() }));
jest.mock("../../services/withdrawalPayout", () => ({ applyPayoutState: jest.fn() }));
jest.mock("../../config/db", () => ({ driver_withdraw_requests: { findFirst: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));

const razorpayx = require("../../utils/razorpayx");
const { applyPayoutState } = require("../../services/withdrawalPayout");
const prisma = require("../../config/db");
const logger = require("../../utils/logger");
const { handle } = require("../razorpayxWebhookController");

const SIG = "sig-secret-value";

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

function makeReq(body, { signature = SIG } = {}) {
  const rawBody = Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return { headers: signature === null ? {} : { "x-razorpay-signature": signature }, rawBody };
}

function event(name, entity) {
  return { event: name, payload: { payout: { entity } } };
}

beforeEach(() => {
  jest.clearAllMocks();
  razorpayx.verifyWebhookSignature.mockReturnValue(true);
  applyPayoutState.mockResolvedValue("paid");
  prisma.driver_withdraw_requests.findFirst.mockResolvedValue(null);
});

describe("razorpayx webhook", () => {
  test("invalid signature -> 401, nothing else runs", async () => {
    razorpayx.verifyWebhookSignature.mockReturnValue(false);
    const res = mockRes();
    await handle(makeReq(event("payout.processed", { id: "pout_x", reference_id: "wd-12", status: "processed" })), res);
    expect(razorpayx.verifyWebhookSignature).toHaveBeenCalledWith(expect.any(Buffer), SIG);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Invalid signature" });
    expect(applyPayoutState).not.toHaveBeenCalled();
    expect(prisma.driver_withdraw_requests.findFirst).not.toHaveBeenCalled();
  });

  test("missing or non-Buffer rawBody -> 401", async () => {
    for (const raw of [undefined, "{}", {}]) {
      const res = mockRes();
      const req = makeReq({});
      req.rawBody = raw;
      await handle(req, res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
    expect(applyPayoutState).not.toHaveBeenCalled();
    expect(prisma.driver_withdraw_requests.findFirst).not.toHaveBeenCalled();
  });

  test("missing signature header -> 401", async () => {
    razorpayx.verifyWebhookSignature.mockReturnValue(false);
    const res = mockRes();
    await handle(makeReq(event("payout.processed", { id: "p", reference_id: "wd-1" }), { signature: null }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(applyPayoutState).not.toHaveBeenCalled();
  });

  test("payout.processed resolved by reference_id, no db lookup", async () => {
    const res = mockRes();
    await handle(
      makeReq(event("payout.processed", { id: "pout_x", reference_id: "wd-12", status: "processed", utr: "UTR1" })),
      res
    );
    expect(applyPayoutState).toHaveBeenCalledTimes(1);
    expect(applyPayoutState).toHaveBeenCalledWith({
      withdrawalId: 12,
      payoutId: "pout_x",
      status: "processed",
      utr: "UTR1",
      failureReason: undefined,
    });
    expect(prisma.driver_withdraw_requests.findFirst).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test("payout.reversed passes status_details.description as failureReason", async () => {
    applyPayoutState.mockResolvedValue("failed");
    const res = mockRes();
    await handle(
      makeReq(
        event("payout.reversed", {
          id: "pout_x",
          reference_id: "wd-5",
          status: "reversed",
          utr: "U",
          status_details: { description: "Beneficiary bank offline" },
          failure_reason: "other",
        })
      ),
      res
    );
    expect(applyPayoutState).toHaveBeenCalledWith({
      withdrawalId: 5,
      payoutId: "pout_x",
      status: "reversed",
      utr: "U",
      failureReason: "Beneficiary bank offline",
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("falls back to failure_reason when no status_details", async () => {
    await handle(
      makeReq(event("payout.failed", { id: "p", reference_id: "wd-5", status: "failed", failure_reason: "bad acct" })),
      mockRes()
    );
    expect(applyPayoutState).toHaveBeenCalledWith(expect.objectContaining({ failureReason: "bad acct" }));
  });

  test("non-matching reference_id -> lookup by payout id, applied when found", async () => {
    prisma.driver_withdraw_requests.findFirst.mockResolvedValue({ id: 33 });
    const res = mockRes();
    await handle(makeReq(event("payout.processed", { id: "pout_y", reference_id: "other", status: "processed", utr: "U2" })), res);
    expect(prisma.driver_withdraw_requests.findFirst).toHaveBeenCalledWith({
      where: { razorpay_payout_id: "pout_y" },
      select: { id: true },
    });
    expect(applyPayoutState).toHaveBeenCalledWith({
      withdrawalId: 33,
      payoutId: "pout_y",
      status: "processed",
      utr: "U2",
      failureReason: undefined,
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  test("unknown payout -> 200, not applied", async () => {
    const res = mockRes();
    await handle(makeReq(event("payout.processed", { id: "pout_z", reference_id: null, status: "processed" })), res);
    expect(prisma.driver_withdraw_requests.findFirst).toHaveBeenCalled();
    expect(applyPayoutState).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test("unparseable JSON with valid signature -> 200, not applied", async () => {
    const res = mockRes();
    await handle(makeReq("not json {"), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
    expect(applyPayoutState).not.toHaveBeenCalled();
  });

  test("body without payout entity -> 200, not applied", async () => {
    const res = mockRes();
    await handle(makeReq({ event: "account.activated", payload: {} }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(applyPayoutState).not.toHaveBeenCalled();
  });

  test("applyPayoutState returns ignored -> 200", async () => {
    applyPayoutState.mockResolvedValue("ignored");
    const res = mockRes();
    await handle(makeReq(event("payout.initiated", { id: "p", reference_id: "wd-9", status: "initiated" })), res);
    expect(applyPayoutState).toHaveBeenCalledWith(expect.objectContaining({ withdrawalId: 9, status: "initiated" }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  test("status missing -> derived from event name", async () => {
    await handle(makeReq(event("payout.reversed", { id: "p", reference_id: "wd-9" })), mockRes());
    expect(applyPayoutState).toHaveBeenCalledWith(expect.objectContaining({ withdrawalId: 9, status: "reversed" }));
  });

  test("applyPayoutState throws -> 500", async () => {
    applyPayoutState.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    await handle(makeReq(event("payout.processed", { id: "p", reference_id: "wd-9", status: "processed" })), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "Internal server error" });
    expect(logger.error).toHaveBeenCalled();
  });

  test("db lookup throws -> 500", async () => {
    prisma.driver_withdraw_requests.findFirst.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    await handle(makeReq(event("payout.processed", { id: "p", reference_id: "x", status: "processed" })), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(applyPayoutState).not.toHaveBeenCalled();
  });

  test("never logs the raw body or signature", async () => {
    applyPayoutState.mockRejectedValue(new Error("boom"));
    const body = event("payout.processed", { id: "p", reference_id: "wd-9", status: "processed", utr: "SECRETUTR" });
    await handle(makeReq(body), mockRes());
    await handle(makeReq("garbage"), mockRes());
    const logged = JSON.stringify(Object.values(logger).flatMap((fn) => fn.mock.calls));
    expect(logged).not.toContain(SIG);
    expect(logged).not.toContain("SECRETUTR");
    expect(logged).not.toContain("garbage");
  });

  test("router exports POST /", () => {
    const router = require("../../routes/razorpayxWebhookRoutes");
    const layer = router.stack.find((l) => l.route && l.route.path === "/");
    expect(layer).toBeTruthy();
    expect(layer.route.methods.post).toBe(true);
  });
});

jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }));
jest.mock("../../config/db", () => ({ order_settlement: { findUnique: jest.fn() } }));
jest.mock("../../services/receiverSettlementService", () => ({ declineReceiverPay: jest.fn() }));
jest.mock("../../services/receiverPayService", () => {
  class ReceiverPayError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return { ReceiverPayError, issueLink: jest.fn(), getConfig: jest.fn() };
});
jest.mock("../../services/settlementService", () => {
  class SettlementError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return {
    SettlementError,
    getViewForParty: jest.fn(), chooseDriverPayment: jest.fn(), createOnlineOrder: jest.fn(),
    settleOnline: jest.fn(), raiseDispute: jest.fn(), markCashReceived: jest.fn(), listPendingForDriver: jest.fn(),
    publicView: jest.fn((s) => ({ order_id: s.order_id, status: s.status })),
    assertParty: jest.fn((s, party, id) => {
      if (!s) throw new SettlementError("NOT_FOUND", "No payment record for this order.");
      const owner = party === "customer" ? s.uid : s.rid;
      if (Number(owner) !== Number(id)) throw new SettlementError("FORBIDDEN", "This order belongs to another " + party + ".");
    }),
  };
});
const svc = require("../../services/settlementService");
const c = require("../settlementController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });
const body = (r) => r.json.mock.calls[0][0];

describe("settlementController (customer)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("state: returns the settlement view, or null when none exists", async () => {
    svc.getViewForParty.mockResolvedValue({ order_id: 5, status: "pending" });
    const r = res();
    await c.customerState({ body: { uid: 7, order_id: 5 } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ ResponseCode: "200", Result: "true", settlement: { order_id: 5, status: "pending" } });
    expect(svc.getViewForParty).toHaveBeenCalledWith({ orderId: 5, party: "customer", partyId: 7 });
    svc.getViewForParty.mockResolvedValue(null);
    const r2 = res();
    await c.customerState({ body: { uid: 7, order_id: 5 } }, r2);
    expect(body(r2).settlement).toBeNull();
  });

  it("requires uid and order_id", async () => {
    const r = res();
    await c.customerState({ body: {} }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", Result: "false", code: "VALIDATION" });
  });

  it("maps SettlementError to a 200 envelope with ResponseCode 401 and the machine code", async () => {
    svc.raiseDispute.mockRejectedValue(new svc.SettlementError("WINDOW_CLOSED", "closed"));
    const r = res();
    await c.customerDispute({ body: { uid: 7, order_id: 5, reason: "x" } }, r);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ ResponseCode: "401", Result: "false", ResponseMsg: "closed", code: "WINDOW_CLOSED" });
  });

  it("unexpected errors become ResponseCode 500", async () => {
    svc.chooseDriverPayment.mockRejectedValue(new Error("boom"));
    const r = res();
    await c.customerChooseDriver({ body: { uid: 7, order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "500", Result: "false" });
  });

  it("pay-online/create passes uid/order and returns the gateway payload", async () => {
    svc.createOnlineOrder.mockResolvedValue({ razorpay_order_id: "order_A", amount_paise: 8500, currency: "INR", key_id: "k" });
    const r = res();
    await c.customerPayOnlineCreate({ body: { uid: 7, order_id: 5 } }, r);
    expect(svc.createOnlineOrder).toHaveBeenCalledWith({ orderId: 5, uid: 7 });
    expect(body(r)).toMatchObject({ ResponseCode: "200", razorpay_order_id: "order_A", amount_paise: 8500, key_id: "k" });
  });

  it("pay-online/verify requires all three Razorpay fields", async () => {
    const r = res();
    await c.customerPayOnlineVerify({ body: { uid: 7, order_id: 5, razorpay_payment_id: "p" } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", code: "VALIDATION" });
    expect(svc.settleOnline).not.toHaveBeenCalled();
  });

  it("pay-online/verify settles with the posted fields", async () => {
    svc.settleOnline.mockResolvedValue({ settlement: { order_id: 5, status: "paid_online" } });
    const r = res();
    await c.customerPayOnlineVerify({ body: { uid: 7, order_id: 5, razorpay_payment_id: "p", razorpay_order_id: "o", razorpay_signature: "s" } }, r);
    expect(svc.settleOnline).toHaveBeenCalledWith({ orderId: 5, uid: 7, paymentId: "p", razorpayOrderId: "o", signature: "s" });
    expect(body(r).settlement).toMatchObject({ status: "paid_online" });
  });
});

describe("settlementController (id validation and remaining paths)", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [{ uid: "abc", order_id: 5 }],
    [{ uid: 7, order_id: "x" }],
    [{ uid: -1, order_id: 5 }],
    [{ uid: 7, order_id: 1.5 }],
    [{ uid: {}, order_id: 5 }],
  ])("customer state rejects garbage ids %j without calling the service", async (b) => {
    const r = res();
    await c.customerState({ body: b }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", Result: "false", code: "VALIDATION" });
    expect(svc.getViewForParty).not.toHaveBeenCalled();
  });

  it("numeric strings still work and reach the service as numbers", async () => {
    svc.getViewForParty.mockResolvedValue(null);
    const r = res();
    await c.customerState({ body: { uid: "7", order_id: "5" } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "200" });
    expect(svc.getViewForParty).toHaveBeenCalledWith({ orderId: 5, party: "customer", partyId: 7 });
  });

  it("driver handlers reject garbage ids without calling the service", async () => {
    const r = res();
    await c.driverReceived({ body: { rider_id: "abc", order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", code: "VALIDATION" });
    const r2 = res();
    await c.driverState({ body: { rider_id: 9, order_id: 2.5 } }, r2);
    expect(body(r2)).toMatchObject({ ResponseCode: "401", code: "VALIDATION" });
    expect(svc.markCashReceived).not.toHaveBeenCalled();
    expect(svc.getViewForParty).not.toHaveBeenCalled();
  });

  it("customer choose-driver success returns the public view", async () => {
    svc.chooseDriverPayment.mockResolvedValue({ settlement: { order_id: 5, status: "awaiting_driver" } });
    const r = res();
    await c.customerChooseDriver({ body: { uid: 7, order_id: 5 } }, r);
    expect(svc.chooseDriverPayment).toHaveBeenCalledWith({ orderId: 5, uid: 7 });
    expect(body(r)).toMatchObject({ ResponseCode: "200", settlement: { status: "awaiting_driver" } });
  });

  it("customer dispute uses actor customer with the posted uid", async () => {
    svc.raiseDispute.mockResolvedValue({ settlement: { order_id: 5, status: "disputed" } });
    const r = res();
    await c.customerDispute({ body: { uid: 7, order_id: 5, reason: "paid" } }, r);
    expect(svc.raiseDispute).toHaveBeenCalledWith({ orderId: 5, actor: "customer", actorId: 7, reason: "paid" });
  });

  it("driver state success", async () => {
    svc.getViewForParty.mockResolvedValue({ order_id: 5, status: "pending" });
    const r = res();
    await c.driverState({ body: { rider_id: 9, order_id: 5 } }, r);
    expect(svc.getViewForParty).toHaveBeenCalledWith({ orderId: 5, party: "driver", partyId: 9 });
    expect(body(r)).toMatchObject({ ResponseCode: "200", settlement: { status: "pending" } });
  });
});

describe("settlementController (driver)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("received: confirms cash for the posted rider and order", async () => {
    svc.markCashReceived.mockResolvedValue({ settlement: { order_id: 5, status: "cash_received" } });
    const r = res();
    await c.driverReceived({ body: { rider_id: 9, order_id: 5 } }, r);
    expect(svc.markCashReceived).toHaveBeenCalledWith({ orderId: 5, riderId: 9 });
    expect(body(r)).toMatchObject({ ResponseCode: "200", settlement: { status: "cash_received" } });
  });

  it("received twice reports success (idempotent)", async () => {
    svc.markCashReceived.mockResolvedValue({ settlement: { order_id: 5, status: "cash_received" }, alreadyDone: true });
    const r = res();
    await c.driverReceived({ body: { rider_id: 9, order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "200", Result: "true" });
  });

  it("dispute uses actor 'driver'", async () => {
    svc.raiseDispute.mockResolvedValue({ settlement: { order_id: 5, status: "disputed" } });
    const r = res();
    await c.driverDispute({ body: { rider_id: 9, order_id: 5, reason: "customer refused" } }, r);
    expect(svc.raiseDispute).toHaveBeenCalledWith({ orderId: 5, actor: "driver", actorId: 9, reason: "customer refused" });
  });

  it("state requires rider_id", async () => {
    const r = res();
    await c.driverState({ body: { order_id: 5 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "401", code: "VALIDATION" });
  });
});

describe("settlementController driverPending", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requires a valid rider_id (order_id is not needed)", async () => {
    for (const bad of [undefined, "", 0, -1, 2.5, "abc", {}]) {
      const r = res();
      await c.driverPending({ body: { rider_id: bad } }, r);
      expect(body(r)).toMatchObject({ ResponseCode: "401", Result: "false", code: "VALIDATION" });
    }
    const r = res();
    await c.driverPending({}, r);
    expect(body(r)).toMatchObject({ code: "VALIDATION" });
    expect(svc.listPendingForDriver).not.toHaveBeenCalled();
  });

  it("returns the driver's pending settlements in the success envelope", async () => {
    svc.listPendingForDriver.mockResolvedValue([{ order_id: 5, status: "pending" }]);
    const r = res();
    await c.driverPending({ body: { rider_id: "9" } }, r);
    expect(svc.listPendingForDriver).toHaveBeenCalledWith(9);
    expect(r.status).toHaveBeenCalledWith(200);
    expect(body(r)).toMatchObject({ ResponseCode: "200", Result: "true", settlements: [{ order_id: 5, status: "pending" }] });
  });

  it("unexpected errors become ResponseCode 500", async () => {
    svc.listPendingForDriver.mockRejectedValue(new Error("boom"));
    const r = res();
    await c.driverPending({ body: { rider_id: 9 } }, r);
    expect(body(r)).toMatchObject({ ResponseCode: "500", Result: "false" });
  });
});

describe("receiver-pay endpoints", () => {
  const receiverSettlementService = require("../../services/receiverSettlementService");
  const receiverPayService = require("../../services/receiverPayService");
  const resp = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  beforeEach(() => jest.clearAllMocks());

  it("customerTakeOver declines as the booker", async () => {
    receiverSettlementService.declineReceiverPay.mockResolvedValue({ phase: "converted", settlement: { id: 1, order_id: 50, status: "pending", amount_due: 70 } });
    const r = resp();
    await c.customerTakeOver({ body: { uid: 7, order_id: 50 } }, r);
    expect(receiverSettlementService.declineReceiverPay).toHaveBeenCalledWith({ orderId: 50, actor: "booker", actorId: 7 });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", phase: "converted" }));
  });
  it("driverReceiverRefused declines as the driver", async () => {
    receiverSettlementService.declineReceiverPay.mockResolvedValue({ phase: "converted", settlement: { id: 1, order_id: 50, status: "pending", amount_due: 70 } });
    const r = resp();
    await c.driverReceiverRefused({ body: { rider_id: 9, order_id: 50 } }, r);
    expect(receiverSettlementService.declineReceiverPay).toHaveBeenCalledWith({ orderId: 50, actor: "driver", actorId: 9 });
  });
  it("a forbidden party gets a failure envelope, not a 500", async () => {
    const { SettlementError } = require("../../services/settlementService");
    receiverSettlementService.declineReceiverPay.mockRejectedValue(new SettlementError("FORBIDDEN", "This order belongs to another driver."));
    const r = resp();
    await c.driverReceiverRefused({ body: { rider_id: 1, order_id: 50 } }, r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", code: "FORBIDDEN" }));
  });
  it("resend link (booker) returns sent + link and maps ReceiverPayError codes", async () => {
    const prisma = require("../../config/db");
    prisma.order_settlement.findUnique.mockResolvedValue({ order_id: 50, uid: 7, rid: 9 });
    receiverPayService.issueLink.mockResolvedValue({ sent: true, link: "https://x/pay/t" });
    const r = resp();
    await c.customerResendLink({ body: { uid: 7, order_id: 50 } }, r);
    expect(receiverPayService.issueLink).toHaveBeenCalledWith({ orderId: 50, resend: true });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", sent: true, link: "https://x/pay/t" }));

    receiverPayService.issueLink.mockRejectedValue(new receiverPayService.ReceiverPayError("TOO_SOON", "Please wait a minute before sending the link again."));
    const r2 = resp();
    await c.customerResendLink({ body: { uid: 7, order_id: 50 } }, r2);
    expect(r2.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", code: "TOO_SOON" }));
  });
  it("resend link is refused for someone else's order", async () => {
    const prisma = require("../../config/db");
    prisma.order_settlement.findUnique.mockResolvedValue({ order_id: 50, uid: 7, rid: 9 });
    const r = resp();
    await c.driverResendLink({ body: { rider_id: 999, order_id: 50 } }, r);
    expect(receiverPayService.issueLink).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", code: "FORBIDDEN" }));
  });
});

jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }));
jest.mock("../../services/settlementService", () => {
  class SettlementError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return {
    SettlementError,
    getViewForParty: jest.fn(), chooseDriverPayment: jest.fn(), createOnlineOrder: jest.fn(),
    settleOnline: jest.fn(), raiseDispute: jest.fn(), markCashReceived: jest.fn(),
    publicView: jest.fn((s) => ({ order_id: s.order_id, status: s.status })),
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

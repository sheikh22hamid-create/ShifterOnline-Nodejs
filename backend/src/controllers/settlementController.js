const settlementService = require("../services/settlementService");
const logger = require("../utils/logger");
const receiverPayService = require("../services/receiverPayService");

const { SettlementError } = settlementService;

// Same convention as every other cust_api/rider_api port: always HTTP 200, the
// logical outcome lives in the body (ApiWrapper ignores non-200 bodies).
const ok = (res, extra = {}, msg = "OK") =>
  res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: msg, ...extra });
const fail = (res, code, msg) =>
  res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: msg, code });

function handleError(res, err, label) {
  if (err instanceof SettlementError) return fail(res, err.code, err.message);
  logger.error(`${label} failed:`, err);
  return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
}

// Strict positive-integer id: a number or numeric string; anything else is null.
const toId = (v) => {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

function customerAction(label, run) {
  return async (req, res) => {
    try {
      const { uid, order_id } = req.body || {};
      const uidN = toId(uid);
      const orderId = toId(order_id);
      if (!uidN || !orderId) return fail(res, "VALIDATION", "uid and order_id are required");
      return await run({ req, res, uid: uidN, orderId });
    } catch (err) {
      return handleError(res, err, label);
    }
  };
}

function driverAction(label, run) {
  return async (req, res) => {
    try {
      const { rider_id, order_id } = req.body || {};
      const riderId = toId(rider_id);
      const orderId = toId(order_id);
      if (!riderId || !orderId) return fail(res, "VALIDATION", "rider_id and order_id are required");
      return await run({ req, res, riderId, orderId });
    } catch (err) {
      return handleError(res, err, label);
    }
  };
}

const customerState = customerAction("settlement customerState", async ({ res, uid, orderId }) => {
  const settlement = await settlementService.getViewForParty({ orderId, party: "customer", partyId: uid });
  return ok(res, { settlement });
});

const customerChooseDriver = customerAction("settlement customerChooseDriver", async ({ res, uid, orderId }) => {
  const { settlement } = await settlementService.chooseDriverPayment({ orderId, uid });
  return ok(res, { settlement: settlementService.publicView(settlement) });
});

const customerPayOnlineCreate = customerAction("settlement customerPayOnlineCreate", async ({ res, uid, orderId }) => {
  const order = await settlementService.createOnlineOrder({ orderId, uid });
  return ok(res, order, "Payment order created");
});

const customerPayOnlineVerify = customerAction("settlement customerPayOnlineVerify", async ({ req, res, uid, orderId }) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return fail(res, "VALIDATION", "razorpay_payment_id, razorpay_order_id and razorpay_signature are required");
  }
  const { settlement } = await settlementService.settleOnline({
    orderId, uid, paymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id, signature: razorpay_signature,
  });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Payment received");
});

const customerDispute = customerAction("settlement customerDispute", async ({ req, res, uid, orderId }) => {
  const { settlement } = await settlementService.raiseDispute({ orderId, actor: "customer", actorId: uid, reason: req.body.reason });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Problem reported. Admin will review it.");
});

const driverState = driverAction("settlement driverState", async ({ res, riderId, orderId }) => {
  const settlement = await settlementService.getViewForParty({ orderId, party: "driver", partyId: riderId });
  return ok(res, { settlement });
});

const driverReceived = driverAction("settlement driverReceived", async ({ res, riderId, orderId }) => {
  const { settlement } = await settlementService.markCashReceived({ orderId, riderId });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Payment confirmed");
});

const driverDispute = driverAction("settlement driverDispute", async ({ req, res, riderId, orderId }) => {
  const { settlement } = await settlementService.raiseDispute({ orderId, actor: "driver", actorId: riderId, reason: req.body.reason });
  return ok(res, { settlement: settlementService.publicView(settlement) }, "Problem reported. Admin will review it.");
});

// Lets a driver discover which settlements are blocking them; needs only rider_id.
const driverPending = async (req, res) => {
  try {
    const riderId = toId((req.body || {}).rider_id);
    if (!riderId) return fail(res, "VALIDATION", "rider_id is required");
    const settlements = await settlementService.listPendingForDriver(riderId);
    return ok(res, { settlements });
  } catch (err) {
    return handleError(res, err, "settlement driverPending");
  }
};

const receiverPayConfig = async (req, res) => {
  try {
    return ok(res, { config: await receiverPayService.getConfig() });
  } catch (err) {
    return handleError(res, err, "receiverPayConfig");
  }
};

module.exports = {
  receiverPayConfig,
  customerState, customerChooseDriver, customerPayOnlineCreate, customerPayOnlineVerify, customerDispute,
  driverState, driverReceived, driverDispute, driverPending,
};

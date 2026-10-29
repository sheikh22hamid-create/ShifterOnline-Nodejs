const logger = require("../utils/logger");
const service = require("../services/pickupOtpShareService");

// HTTP layer for the pickup OTP share (spec 2026-10-29). The customer call answers with the legacy
// { ResponseCode, Result, ResponseMsg } shape; the driver calls with the { Result, ... } shape of the other driver
// endpoints. All rules live in pickupOtpShareService. The customer's uid is checked against the order's owner there
// (the platform has no per-user tokens yet, see order_dispatch_auth_gap).

async function customerShare(req, res) {
  try {
    const { uid, order_id } = req.body || {};
    const out = await service.share({ uid, orderId: order_id });
    return res.status(200).json({ ResponseCode: out.ok ? "200" : "400", Result: out.ok ? "true" : "false", ResponseMsg: out.msg });
  } catch (err) {
    logger.error("pickupOtpShare.customerShare failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: service.MSG.FAILED });
  }
}

async function driverPending(req, res) {
  try {
    const { rider_id, order_id } = req.body || {};
    const pending = await service.pendingForDriver({ riderId: rider_id, orderId: order_id });
    return res.status(200).json(pending ? { Result: true, ...pending } : { Result: true, share_id: null });
  } catch (err) {
    logger.error("pickupOtpShare.driverPending failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

async function driverAck(req, res) {
  try {
    const { rider_id, order_id, share_id } = req.body || {};
    const ok = await service.acknowledge({ riderId: rider_id, orderId: order_id, shareId: share_id });
    return res.status(200).json({ Result: ok });
  } catch (err) {
    logger.error("pickupOtpShare.driverAck failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

module.exports = { customerShare, driverPending, driverAck };

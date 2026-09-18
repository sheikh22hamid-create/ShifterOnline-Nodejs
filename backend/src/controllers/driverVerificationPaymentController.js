const prisma = require("../config/db");
const logger = require("../utils/logger");
const { verifyRazorpayPayment } = require("../utils/razorpayVerify");
const { getAutoVerificationSettings } = require("../utils/driverVerificationSettings");
const { evaluateDriverApproval } = require("../utils/driverApproval");

// New endpoints for the driver-registration auto-verification charge
// (AutoPaymentActivity in the driver app). There was previously no
// server-side record of this payment at all - the app opened Razorpay
// checkout with no order_id and never reported success back to the
// backend, so a driver's approval (gated only on document status) could be
// reached without ever paying. These two endpoints create a
// server-priced Razorpay order and verify the completed payment the same
// way customerWalletController.addWallet does, then mark
// tbl_rider.payment_complete so evaluateDriverApproval can require it.

function fail(res, msg) {
  return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: msg });
}

// Fetches the order back from Razorpay so verifyPayment can confirm it was
// actually created for THIS rider_id (via the `notes` we stamp it with in
// createOrder) - see verifyPayment for why this check exists.
async function fetchRazorpayOrder(orderId) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString("base64");
  const resp = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!resp.ok) return null;
  return resp.json();
}

async function createOrder(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    if (!riderId) return fail(res, "rider_id is required");

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return fail(res, "Driver not found");
    if (Number(rider.payment_complete) === 1) {
      return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Payment already completed", already_paid: true });
    }

    const { charge } = await getAutoVerificationSettings();
    if (!charge || charge <= 0) {
      return fail(res, "No verification charge is due for this account");
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      logger.error("driverVerificationPaymentController.createOrder: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.");
      return fail(res, "Payment gateway is not configured. Try again later.");
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(charge * 100), // paise
        currency: "INR",
        receipt: `driver_verify_${riderId}_${Date.now()}`,
        // Binds this order to the rider it was priced for - verifyPayment
        // reads this back from Razorpay (not from the request body) so a
        // driver can't pay for their own order and then replay the
        // resulting valid signature against a different rider_id to mark
        // someone else's account paid.
        notes: { rider_id: String(riderId) },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      logger.error("driverVerificationPaymentController.createOrder: Razorpay API error:", data);
      return fail(res, data?.error?.description || "Failed to create payment order");
    }

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Order created",
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
      key_id: keyId,
    });
  } catch (err) {
    logger.error("driverVerificationPaymentController.createOrder failed:", err);
    return fail(res, "Internal server error");
  }
}

async function verifyPayment(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || 0);
    const paymentId = req.body?.razorpay_payment_id;
    const orderId = req.body?.razorpay_order_id;
    const signature = req.body?.razorpay_signature;
    if (!riderId || !paymentId || !orderId || !signature) {
      return fail(res, "Missing payment details");
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return fail(res, "Driver not found");
    if (Number(rider.payment_complete) === 1) {
      const { isAllVerified } = await evaluateDriverApproval(riderId);
      const { charge } = await getAutoVerificationSettings();
      return res.status(200).json({
        ResponseCode: "200",
        Result: "true",
        ResponseMsg: "Payment already verified",
        already_paid: true,
        is_all_verified: isAllVerified,
        rider_data: {
          ...rider,
          mobile: rider.fmobile,
          fmobile: rider.fmobile,
          dob: rider.dob || "",
          nationality: rider.nationality || "Indian",
          full_address: rider.full_address || "",
          know_language: rider.know_language || "Hindi, English",
          vehicle_no: rider.vehicle_no || "",
          wallet_balance: rider.wallet_balance?.toString?.() ?? rider.wallet_balance,
          payment_complete: 1,
          auto_verification_charge: charge,
        },
      });
    }

    // Confirm this order was actually priced for THIS rider before trusting
    // the signature - the HMAC only proves the (order_id, payment_id) pair
    // is a genuine captured Razorpay payment, not who it belongs to. Without
    // this, a driver could pay their own order and replay the resulting
    // valid (order_id, payment_id, signature) triple with someone else's
    // rider_id to mark that account paid for free.
    let order;
    try {
      order = await fetchRazorpayOrder(orderId);
    } catch (e) {
      logger.error("driverVerificationPaymentController.verifyPayment: order lookup failed:", e);
      return fail(res, "Unable to verify payment right now. Try again.");
    }
    if (!order || String(order.notes?.rider_id || "") !== String(riderId)) {
      logger.error(`driverVerificationPaymentController.verifyPayment: order ${orderId} rider_id mismatch (claimed ${riderId})`);
      return fail(res, "Payment Verification Failed!");
    }

    const { charge } = await getAutoVerificationSettings();

    let verification;
    try {
      verification = await verifyRazorpayPayment({ paymentId, orderId, signature, expectedAmountRupees: charge });
    } catch (e) {
      logger.error("driverVerificationPaymentController.verifyPayment: Razorpay not configured.", e);
      return fail(res, "Payment verification is not configured. Try again later.");
    }
    if (!verification.ok) return fail(res, verification.reason);

    await prisma.tbl_rider.update({ where: { id: riderId }, data: { payment_complete: 1 } });
    const { isAllVerified } = await evaluateDriverApproval(riderId);

    const updated = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: isAllVerified ? "Payment verified! Your driver profile is now approved." : "Payment verified. Your documents are still under review.",
      is_all_verified: isAllVerified,
      rider_data: {
        ...updated,
        mobile: updated.fmobile,
        fmobile: updated.fmobile,
        dob: updated.dob || "",
        nationality: updated.nationality || "Indian",
        full_address: updated.full_address || "",
        know_language: updated.know_language || "Hindi, English",
        vehicle_no: updated.vehicle_no || "",
        wallet_balance: updated.wallet_balance?.toString?.() ?? updated.wallet_balance,
        payment_complete: 1,
        auto_verification_charge: charge,
      },
    });
  } catch (err) {
    logger.error("driverVerificationPaymentController.verifyPayment failed:", err);
    return fail(res, "Internal server error");
  }
}

module.exports = { createOrder, verifyPayment };

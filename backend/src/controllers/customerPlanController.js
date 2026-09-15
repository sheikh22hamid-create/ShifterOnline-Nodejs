const customerPlanService = require("../services/customerPlanService");
const logger = require("../utils/logger");

// Node port of the CUSTOMER_PREMIUM half of cust_api/get_premium_plans_api.php
// and purchase_premium_plan_api.php. See customerPlanService.js header for
// what was deliberately left out (the older tbl_joining_plan-based system).

async function list(req, res) {
  try {
    const uid = req.body?.uid;
    if (!uid) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid is required." });
    return res.status(200).json(await customerPlanService.listCustomerPlans(uid, req.body?.city_id));
  } catch (err) {
    logger.error("customerPlan.list failed:", err);
    return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not fetch plans" });
  }
}

async function purchase(req, res) {
  try {
    const { uid, plan_id } = req.body || {};
    if (!uid || !plan_id) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "uid and plan_id are required." });
    }
    const result = await customerPlanService.purchaseCustomerPlan({
      userId: uid,
      planId: plan_id,
      usePoints: Boolean(req.body.use_points),
      paymentTxnId: req.body.razorpay_payment_id || req.body.payment_txn_id,
      paymentMethod: req.body.payment_method,
      razorpayOrderId: req.body.razorpay_order_id,
      razorpaySignature: req.body.razorpay_signature,
    });

    const sub = {
      subscription_id: result.subscription.id,
      plan_id: result.plan.id,
      plan_name: result.plan.plan_name,
      plan_type: "CUSTOMER_PREMIUM",
      plan_type_label: "Premium Membership",
      plan_for: "USER",
      start_date: result.subscription.start_date.toISOString().slice(0, 10),
      end_date: result.subscription.end_date.toISOString().slice(0, 10),
      days_left: result.validityDays,
      status: "active",
      auto_renew: false,
      amount_paid: Number(result.subscription.amount_paid),
      payment_method: result.subscription.payment_method,
      payment_txn_id: result.subscription.payment_txn_id,
      price: Number(result.plan.price),
      renewal_price: Number(result.plan.price),
    };
    if (result.pointsUsed > 0) {
      sub.points_used = result.pointsUsed;
      sub.points_amount = result.pointsAmount;
    }
    if (result.walletCredited > 0) sub.wallet_credited = result.walletCredited;

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Plan purchased successfully.", Subscription: sub });
  } catch (err) {
    logger.error("customerPlan.purchase failed:", err);
    return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not purchase plan" });
  }
}

module.exports = { list, purchase };

const driverPlanService = require("../services/driverPlanService");
const logger = require("../utils/logger");

async function list(req, res) {
  try {
    const driverId = req.body.driver_id || req.body.rider_id;
    if (!driverId) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    return res.json(await driverPlanService.listDriverPlans(driverId, req.body.city_id));
  } catch (err) {
    logger.error("driverPlan.list failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not fetch driver plans" });
  }
}

async function purchase(req, res) {
  try {
    const { plan_id } = req.body;
    const driverId = req.body.driver_id || req.body.rider_id;
    if (!driverId || !plan_id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id and plan_id are required" });
    const result = await driverPlanService.purchaseDriverPlan({
      driverId, planId: plan_id, usePoints: Boolean(req.body.use_points), paymentTxnId: req.body.payment_txn_id,
      paymentMethod: req.body.payment_method, amountPaid: req.body.amount_paid,
    });
    const { subscription, plan } = result;
    const daysLeft = Math.max(0, Math.ceil((new Date(subscription.end_date) - new Date()) / 86400000));
    return res.status(201).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Driver plan activated",
      Subscription: {
        subscription_id: subscription.id,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        amount_paid: subscription.amount_paid,
        points_used: result.pointsUsed,
        points_amount: result.pointsAmount,
        // PlanDetailActivity's success dialog also reads these - filled in
        // here since driverPlanService already computes/stores all of them.
        validity_label: plan.lifetime_enabled ? "Lifetime" : `${plan.validity_days} days`,
        end_date: subscription.end_date,
        days_left: daysLeft,
        commission_percent: Number(plan.commission_percent),
        per_trip_charge: Number(plan.per_trip_charge),
        payment_method: subscription.payment_method,
        payment_txn_id: subscription.payment_txn_id,
      },
    });
  } catch (err) {
    logger.error("driverPlan.purchase failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not purchase driver plan" });
  }
}

module.exports = { list, purchase };

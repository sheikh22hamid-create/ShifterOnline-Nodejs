const driverPlanService = require("../services/driverPlanService");
const logger = require("../utils/logger");

async function list(req, res) {
  try {
    if (!req.body.driver_id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    return res.json(await driverPlanService.listDriverPlans(req.body.driver_id, req.body.city_id));
  } catch (err) {
    logger.error("driverPlan.list failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not fetch driver plans" });
  }
}

async function purchase(req, res) {
  try {
    const { driver_id, plan_id } = req.body;
    if (!driver_id || !plan_id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id and plan_id are required" });
    const result = await driverPlanService.purchaseDriverPlan({
      driverId: driver_id, planId: plan_id, usePoints: Boolean(req.body.use_points), paymentTxnId: req.body.payment_txn_id,
      paymentMethod: req.body.payment_method, amountPaid: req.body.amount_paid,
    });
    return res.status(201).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Driver plan activated", Subscription: { subscription_id: result.subscription.id, plan_id: result.plan.id, plan_name: result.plan.plan_name, amount_paid: result.subscription.amount_paid, points_used: result.pointsUsed, points_amount: result.pointsAmount } });
  } catch (err) {
    logger.error("driverPlan.purchase failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not purchase driver plan" });
  }
}

module.exports = { list, purchase };

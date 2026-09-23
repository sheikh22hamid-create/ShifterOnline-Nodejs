const rewardPlanService = require("../services/rewardPlanService");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: err.message || "Internal server error" });
}

/** Admin gives a plan to a customer or driver right now. */
async function assignNow(req, res) {
  try {
    const { user_id, user_type, plan_id } = req.body;
    const planFor = user_type === "DRIVER" ? "DRIVER" : "USER";
    if (!user_id || !plan_id) {
      return res.status(400).json({ success: false, message: "user_id and plan_id are required" });
    }
    const result = await rewardPlanService.assignPlanNow({ userId: user_id, planFor, planId: plan_id });
    return res.status(200).json({
      success: true,
      message: `${result.plan.plan_name} activated for this ${planFor === "DRIVER" ? "driver" : "customer"}.`,
      data: { subscription_id: result.subscription.id, plan_name: result.plan.plan_name },
    });
  } catch (err) {
    return internalError(res, err, "rewardPlan.assignNow");
  }
}

/** Admin pre-sets a plan that activates automatically on this customer's next completed ride. */
async function setPending(req, res) {
  try {
    const { user_id, plan_id } = req.body;
    if (!user_id || !plan_id) {
      return res.status(400).json({ success: false, message: "user_id and plan_id are required" });
    }
    const pending = await rewardPlanService.setPendingRewardPlan({ userId: user_id, planId: plan_id, adminId: req.user.id });
    return res.status(200).json({ success: true, message: "Reward plan will be given on this customer's next completed ride.", data: pending });
  } catch (err) {
    return internalError(res, err, "rewardPlan.setPending");
  }
}

async function cancelPending(req, res) {
  try {
    await rewardPlanService.cancelPendingRewardPlan({ id: req.params.id });
    return res.status(200).json({ success: true, message: "Pending reward plan cancelled." });
  } catch (err) {
    return internalError(res, err, "rewardPlan.cancelPending");
  }
}

async function getPending(req, res) {
  try {
    const pending = await rewardPlanService.getPendingRewardPlan({ userId: req.params.userId, planFor: "USER" });
    return res.status(200).json({ success: true, data: pending });
  } catch (err) {
    return internalError(res, err, "rewardPlan.getPending");
  }
}

/** List all ride-milestone tiers (admin-configured, applies to every customer). */
async function listMilestones(req, res) {
  try {
    const rows = await rewardPlanService.listMilestoneRewards();
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    return internalError(res, err, "rewardPlan.listMilestones");
  }
}

async function createMilestone(req, res) {
  try {
    const { rides_required, plan_id } = req.body;
    if (!rides_required || !plan_id) {
      return res.status(400).json({ success: false, message: "rides_required and plan_id are required" });
    }
    const milestone = await rewardPlanService.createMilestoneReward({ ridesRequired: rides_required, planId: plan_id, adminId: req.user.id });
    return res.status(201).json({ success: true, message: "Ride milestone created.", data: milestone });
  } catch (err) {
    return internalError(res, err, "rewardPlan.createMilestone");
  }
}

async function updateMilestone(req, res) {
  try {
    const { rides_required, plan_id, status } = req.body;
    const milestone = await rewardPlanService.updateMilestoneReward({ id: req.params.id, ridesRequired: rides_required, planId: plan_id, status });
    return res.status(200).json({ success: true, message: "Ride milestone updated.", data: milestone });
  } catch (err) {
    return internalError(res, err, "rewardPlan.updateMilestone");
  }
}

async function deleteMilestone(req, res) {
  try {
    await rewardPlanService.deleteMilestoneReward({ id: req.params.id });
    return res.status(200).json({ success: true, message: "Ride milestone deleted." });
  } catch (err) {
    return internalError(res, err, "rewardPlan.deleteMilestone");
  }
}

module.exports = {
  assignNow,
  setPending,
  cancelPending,
  getPending,
  listMilestones,
  createMilestone,
  updateMilestone,
  deleteMilestone,
};

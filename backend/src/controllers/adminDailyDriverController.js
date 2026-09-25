const prisma = require("../config/db");
const planService = require("../services/dailyDriverPlanService");
const forceAssignService = require("../services/forceAssignService");
const logger = require("../utils/logger");

async function listPlans(req, res) {
  try {
    const plans = await planService.listAllPlans();
    return res.json({ success: true, data: plans });
  } catch (err) {
    logger.error("adminDailyDriver.listPlans failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function createPlan(req, res) {
  try {
    if (!req.body.plan_name) return res.status(400).json({ success: false, message: "plan_name is required" });
    const plan = await planService.createPlan(req.body);
    return res.status(201).json({ success: true, message: "Daily Driver plan created", data: plan });
  } catch (err) {
    logger.error("adminDailyDriver.createPlan failed:", err);
    return res.status(400).json({ success: false, message: err.message || "Could not create plan" });
  }
}

async function updatePlan(req, res) {
  try {
    const plan = await planService.updatePlan(req.params.planId, req.body);
    return res.json({ success: true, message: "Plan updated", data: plan });
  } catch (err) {
    logger.error("adminDailyDriver.updatePlan failed:", err);
    return res.status(400).json({ success: false, message: err.message || "Could not update plan" });
  }
}

async function setPlanStatus(req, res) {
  try {
    const plan = await planService.setPlanStatus(req.params.planId, req.body.status);
    return res.json({ success: true, message: "Plan status updated", data: plan });
  } catch (err) {
    logger.error("adminDailyDriver.setPlanStatus failed:", err);
    return res.status(400).json({ success: false, message: err.message || "Could not update plan status" });
  }
}

async function listPendingRequests(req, res) {
  try {
    const rows = await planService.listPendingRequests(req.query.plan_id);
    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error("adminDailyDriver.listPendingRequests failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function approveEnrollment(req, res) {
  try {
    const row = await planService.approveEnrollment({ enrollmentId: req.params.enrollmentId, adminId: req.user?.id });
    return res.json({ success: true, message: "Enrollment approved", data: row });
  } catch (err) {
    logger.error("adminDailyDriver.approveEnrollment failed:", err);
    return res.status(400).json({ success: false, message: err.message || "Could not approve enrollment" });
  }
}

async function rejectEnrollment(req, res) {
  try {
    const row = await planService.rejectEnrollment({ enrollmentId: req.params.enrollmentId, adminId: req.user?.id });
    return res.json({ success: true, message: "Enrollment rejected", data: row });
  } catch (err) {
    logger.error("adminDailyDriver.rejectEnrollment failed:", err);
    return res.status(400).json({ success: false, message: err.message || "Could not reject enrollment" });
  }
}

async function listEnrollments(req, res) {
  try {
    const { date, plan_id, status } = req.query;
    const where = {};
    if (date) where.enrollment_date = new Date(date);
    if (plan_id) where.plan_id = Number(plan_id);
    if (status) where.status = status;

    const enrollments = await prisma.daily_driver_enrollment.findMany({
      where,
      include: { plan: true, duty_log: true },
      orderBy: { id: "desc" },
    });

    const riderIds = [...new Set(enrollments.map((e) => e.rider_id))];
    const riders = await prisma.tbl_rider.findMany({
      where: { id: { in: riderIds } },
      select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true },
    });
    const riderMap = new Map(riders.map((r) => [r.id, r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`]));

    return res.json({
      success: true,
      data: enrollments.map((e) => ({ ...e, rider_name: riderMap.get(e.rider_id) || `Driver #${e.rider_id}` })),
    });
  } catch (err) {
    logger.error("adminDailyDriver.listEnrollments failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function getLedger(req, res) {
  try {
    const riderId = Number(req.params.riderId);
    if (!riderId) return res.status(400).json({ success: false, message: "riderId is required" });

    const { start_date, end_date } = req.query;
    const where = { rider_id: riderId };
    if (start_date && end_date) where.created_at = { gte: new Date(start_date), lte: new Date(end_date + "T23:59:59.999Z") };

    const entries = await prisma.daily_driver_ledger.findMany({ where, orderBy: [{ created_at: "desc" }, { id: "desc" }] });
    let totalCredits = 0;
    let totalDebits = 0;
    const formatted = entries.map((e) => {
      const amount = Number(e.amount);
      if (e.balance_effect === "CREDIT") totalCredits += amount;
      else totalDebits += amount;
      return { ...e, amount };
    });

    return res.json({
      success: true,
      data: {
        entries: formatted,
        summary: {
          total_credits: Math.round(totalCredits * 100) / 100,
          total_debits: Math.round(totalDebits * 100) / 100,
          net_balance: Math.round((totalCredits - totalDebits) * 100) / 100,
        },
      },
    });
  } catch (err) {
    logger.error("adminDailyDriver.getLedger failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/** Scheduled (booking_type=2), still-unassigned orders eligible for force-assign. */
async function listAssignableScheduledOrders(req, res) {
  try {
    const orders = await prisma.pkg_order.findMany({
      where: { booking_type: 2, o_status: "Pending" },
      orderBy: { schedule_date_time: "asc" },
      select: { id: true, uid: true, category: true, pick_name: true, drop_name: true, schedule_date_time: true, distance: true, total_dcharge: true, city_id: true },
      take: 100,
    });
    return res.json({ success: true, data: orders });
  } catch (err) {
    logger.error("adminDailyDriver.listAssignableScheduledOrders failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function forceAssign(req, res) {
  try {
    const { order_id, rider_id } = req.body;
    if (!order_id || !rider_id) return res.status(400).json({ success: false, message: "order_id and rider_id are required" });
    const result = await forceAssignService.forceAssignScheduledOrder({ orderId: order_id, riderId: rider_id, adminId: req.user?.id });
    return res.json({ success: true, message: "Order force-assigned to driver", data: result });
  } catch (err) {
    logger.error("adminDailyDriver.forceAssign failed:", err);
    return res.status(400).json({ success: false, message: err.message || "Could not force-assign order" });
  }
}

module.exports = {
  listPlans,
  createPlan,
  updatePlan,
  setPlanStatus,
  listPendingRequests,
  approveEnrollment,
  rejectEnrollment,
  listEnrollments,
  getLedger,
  listAssignableScheduledOrders,
  forceAssign,
};

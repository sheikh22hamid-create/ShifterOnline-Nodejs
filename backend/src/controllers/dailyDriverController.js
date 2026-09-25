const planService = require("../services/dailyDriverPlanService");
const dutyService = require("../services/dailyDriverDutyService");
const logger = require("../utils/logger");

function driverId(req) {
  return req.body.driver_id || req.body.rider_id || req.query.rider_id || req.params.riderId;
}

async function listPlans(req, res) {
  try {
    const id = driverId(req);
    if (!id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    const data = await planService.listDriverPlans(id, req.body.city_id || req.query.city_id);
    return res.json({ ResponseCode: "200", Result: "true", ResponseMsg: "Daily Driver plans fetched successfully.", ...data });
  } catch (err) {
    logger.error("dailyDriver.listPlans failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not fetch plans" });
  }
}

async function enroll(req, res) {
  try {
    const id = driverId(req);
    const { plan_id } = req.body;
    if (!id || !plan_id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id and plan_id are required" });
    const { enrollment, autoApproved } = await planService.enroll({ riderId: id, planId: plan_id });
    return res.status(201).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: autoApproved ? "Enrolled successfully." : "Enrollment limit reached - request sent for admin approval.",
      Enrollment: { enrollment_id: enrollment.id, status: enrollment.status, enrollment_date: enrollment.enrollment_date },
    });
  } catch (err) {
    logger.error("dailyDriver.enroll failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not enroll" });
  }
}

async function cancelEnrollment(req, res) {
  try {
    const id = driverId(req);
    const { enrollment_id } = req.body;
    if (!id || !enrollment_id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id and enrollment_id are required" });
    await planService.cancelEnrollment({ riderId: id, enrollmentId: enrollment_id });
    return res.json({ ResponseCode: "200", Result: "true", ResponseMsg: "Enrollment cancelled." });
  } catch (err) {
    logger.error("dailyDriver.cancelEnrollment failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not cancel enrollment" });
  }
}

async function setAutoEnroll(req, res) {
  try {
    const id = driverId(req);
    const { plan_id, until_date } = req.body;
    if (!id || !plan_id || !until_date) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id, plan_id and until_date are required" });
    const row = await planService.setAutoEnroll({ riderId: id, planId: plan_id, untilDate: until_date });
    return res.json({ ResponseCode: "200", Result: "true", ResponseMsg: "Auto Enroll saved.", AutoEnroll: row });
  } catch (err) {
    logger.error("dailyDriver.setAutoEnroll failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not save auto enroll" });
  }
}

async function cancelAutoEnroll(req, res) {
  try {
    const id = driverId(req);
    if (!id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    await planService.cancelAutoEnroll({ riderId: id });
    return res.json({ ResponseCode: "200", Result: "true", ResponseMsg: "Auto Enroll cancelled." });
  } catch (err) {
    logger.error("dailyDriver.cancelAutoEnroll failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not cancel auto enroll" });
  }
}

async function getDutyStatus(req, res) {
  try {
    const id = driverId(req);
    if (!id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    const status = await dutyService.getDutyStatus(id);
    return res.json({ ResponseCode: "200", Result: "true", ResponseMsg: "Duty status fetched.", ...status });
  } catch (err) {
    logger.error("dailyDriver.getDutyStatus failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Could not fetch duty status" });
  }
}

async function punchIn(req, res) {
  try {
    const id = driverId(req);
    const { lat, lng } = req.body;
    if (!id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    const result = await dutyService.punchIn(id, lat, lng);
    return res.json({ ResponseCode: "200", Result: "true", ...result });
  } catch (err) {
    logger.error("dailyDriver.punchIn failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Punch in failed" });
  }
}

async function punchOut(req, res) {
  try {
    const id = driverId(req);
    if (!id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    const result = await dutyService.punchOut(id);
    return res.json({ ResponseCode: "200", Result: "true", ...result });
  } catch (err) {
    logger.error("dailyDriver.punchOut failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Punch out failed" });
  }
}

async function locationPing(req, res) {
  try {
    const id = driverId(req);
    const { lat, lng } = req.body;
    if (!id) return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: "driver_id is required" });
    const result = await dutyService.recordDutyLocationPing(id, lat, lng);
    return res.json({ ResponseCode: "200", Result: "true", ...result });
  } catch (err) {
    logger.error("dailyDriver.locationPing failed:", err);
    return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Location ping failed" });
  }
}

module.exports = { listPlans, enroll, cancelEnrollment, setAutoEnroll, cancelAutoEnroll, getDutyStatus, punchIn, punchOut, locationPing };

const prisma = require("../config/db");
const geofenceService = require("./geofenceService");
const settlementService = require("./dailyDriverSettlementService");
const logger = require("../utils/logger");

function istNow() {
  return new Date(Date.now() + 330 * 60 * 1000);
}

function istDateOnly(d = istNow()) {
  return new Date(d.toISOString().split("T")[0]);
}

/**
 * Lazily closes out an enrollment whose duty window has ended but the
 * driver never explicitly punched out (app killed, phone died, etc). Called
 * from every read/ping path so no separate cron is required for this case -
 * settleEnrollment itself is idempotent, so double-firing here is harmless.
 */
async function maybeAutoSettle(enrollment) {
  if (!enrollment || enrollment.status !== "active" || !enrollment.duty_log) return enrollment;
  const { dutyWindow } = settlementService;
  const { end } = dutyWindow(enrollment.enrollment_date, enrollment.plan);
  if (istNow() < end) return enrollment;

  await prisma.daily_driver_duty_log.update({
    where: { id: enrollment.duty_log.id },
    data: { punch_out_at: enrollment.duty_log.punch_out_at || istNow(), status: "completed" },
  });
  await prisma.daily_driver_enrollment.update({ where: { id: enrollment.id }, data: { status: "settlement_pending" } });
  await settlementService.settleEnrollment(enrollment.id).catch((err) =>
    logger.error(`dailyDriverDutyService.maybeAutoSettle: settlement failed for enrollment ${enrollment.id}:`, err)
  );
  return prisma.daily_driver_enrollment.findUnique({ where: { id: enrollment.id }, include: { plan: true, duty_log: true } });
}

async function getTodayEnrollment(riderId) {
  return prisma.daily_driver_enrollment.findFirst({
    where: {
      rider_id: Number(riderId),
      enrollment_date: istDateOnly(),
      status: { in: ["enrolled", "active"] },
    },
    include: { plan: true, duty_log: true },
    orderBy: { id: "desc" },
  });
}

async function punchIn(riderId, lat, lng) {
  const enrollment = await getTodayEnrollment(riderId);
  if (!enrollment) throw new Error("No active Daily Driver enrollment found for today.");

  const plan = enrollment.plan;
  let zone = null;
  if (plan.assigned_zone_id) {
    zone = await prisma.service_zone.findUnique({ where: { id: plan.assigned_zone_id } });
  }

  let insideZone = true;
  if (lat && lng && zone) insideZone = geofenceService.isInsideZone(lat, lng, zone);

  if (enrollment.status === "enrolled") {
    await prisma.daily_driver_enrollment.update({ where: { id: enrollment.id }, data: { status: "active" } });
  }

  let log = enrollment.duty_log;
  if (!log) {
    log = await prisma.daily_driver_duty_log.create({
      data: { enrollment_id: enrollment.id, rider_id: Number(riderId), punch_in_at: istNow(), status: "in_progress" },
    });
  } else if (!log.punch_in_at) {
    log = await prisma.daily_driver_duty_log.update({
      where: { id: log.id },
      data: { punch_in_at: istNow(), status: "in_progress" },
    });
  }

  return { success: true, message: "Duty punched in successfully", insideZone, log, plan, zone };
}

async function punchOut(riderId) {
  const enrollment = await prisma.daily_driver_enrollment.findFirst({
    where: { rider_id: Number(riderId), enrollment_date: istDateOnly(), status: "active" },
    include: { plan: true, duty_log: true },
    orderBy: { id: "desc" },
  });
  if (!enrollment || !enrollment.duty_log) throw new Error("No active duty log found to punch out.");

  await prisma.daily_driver_duty_log.update({
    where: { id: enrollment.duty_log.id },
    data: { punch_out_at: istNow(), status: "completed" },
  });
  await prisma.daily_driver_enrollment.update({ where: { id: enrollment.id }, data: { status: "settlement_pending" } });

  const settled = await settlementService.settleEnrollment(enrollment.id);
  return { success: true, message: "Duty punched out successfully", settlement: settled };
}

/**
 * Periodic location ping - mirrors dutyTrackingService.recordDutyLocationPing,
 * but the delta window is bounded to whatever falls within the plan's duty
 * window so idle time before duty_start / after duty_end never counts.
 */
async function recordDutyLocationPing(riderId, lat, lng) {
  let enrollment = await prisma.daily_driver_enrollment.findFirst({
    where: { rider_id: Number(riderId), enrollment_date: istDateOnly(), status: "active" },
    include: { plan: true, duty_log: true },
    orderBy: { id: "desc" },
  });
  if (!enrollment) return { active: false };
  enrollment = await maybeAutoSettle(enrollment);
  if (!enrollment || !enrollment.duty_log || enrollment.duty_log.status !== "in_progress") return { active: false };

  const plan = enrollment.plan;
  const log = enrollment.duty_log;

  let zone = null;
  if (plan.assigned_zone_id) zone = await prisma.service_zone.findUnique({ where: { id: plan.assigned_zone_id } });
  const insideZone = zone ? geofenceService.isInsideZone(lat, lng, zone) : true;

  const activeOrder = await prisma.pkg_order.findFirst({
    where: { rid: Number(riderId), o_status: { in: ["Processing", "On_Route", "Pickup"] } },
    select: { id: true },
  });
  const countAsInZone = insideZone || activeOrder != null;

  const lastTime = log.updated_at ? new Date(log.updated_at).getTime() : new Date(log.punch_in_at).getTime();
  const now = Date.now();
  const deltaMinutes = Math.min(300, Math.max(0, Math.floor((now - lastTime) / 1000))) / 60;

  const newInZoneMins = Math.round((log.total_in_zone_minutes + (countAsInZone ? deltaMinutes : 0)) * 10) / 10;
  const newOutZoneMins = Math.round((log.total_out_zone_minutes + (countAsInZone ? 0 : deltaMinutes)) * 10) / 10;
  const newOnlineMins = Math.round((log.total_online_minutes + deltaMinutes) * 10) / 10;

  await prisma.daily_driver_duty_log.update({
    where: { id: log.id },
    data: {
      total_online_minutes: Math.round(newOnlineMins),
      total_in_zone_minutes: Math.round(newInZoneMins),
      total_out_zone_minutes: Math.round(newOutZoneMins),
    },
  });

  return {
    active: true,
    insideZone,
    inDelivery: activeOrder != null,
    totalInZoneMinutes: Math.round(newInZoneMins),
    totalOutZoneMinutes: Math.round(newOutZoneMins),
  };
}

async function getDutyStatus(riderId) {
  let enrollment = await getTodayEnrollment(riderId);
  if (!enrollment) return { hasActiveEnrollment: false };
  enrollment = await maybeAutoSettle(enrollment);
  if (!enrollment) return { hasActiveEnrollment: false };

  const plan = enrollment.plan;
  const log = enrollment.duty_log;
  const isPunchedIn = log != null && log.status === "in_progress";

  let inZoneMinutes = log ? log.total_in_zone_minutes || 0 : 0;
  let totalOnlineMinutes = log ? log.total_online_minutes || 0 : 0;
  if (isPunchedIn && log.punch_in_at) {
    const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(log.punch_in_at).getTime()) / 60000));
    totalOnlineMinutes = Math.max(totalOnlineMinutes, elapsedMinutes);
  }

  const targetMinutes = Number(plan.required_duty_hours) * 60;

  return {
    hasActiveEnrollment: true,
    enrollment: { id: enrollment.id, status: enrollment.status, enrollment_date: enrollment.enrollment_date },
    plan: {
      id: plan.id,
      plan_name: plan.plan_name,
      price: Number(plan.price),
      duty_start_time: plan.duty_start_time,
      duty_end_time: plan.duty_end_time,
      required_duty_hours: plan.required_duty_hours,
      free_km: plan.free_km,
      extra_km_rate: Number(plan.extra_km_rate),
      shortfall_hourly_rate: Number(plan.shortfall_hourly_rate),
      overtime_hourly_rate: Number(plan.overtime_hourly_rate),
    },
    duty: {
      isPunchedIn,
      punchInAt: log ? log.punch_in_at : null,
      inZoneMinutes,
      totalOnlineMinutes,
      targetMinutes,
      ridesCompleted: log ? log.rides_completed : 0,
    },
  };
}

module.exports = {
  getTodayEnrollment,
  punchIn,
  punchOut,
  recordDutyLocationPing,
  getDutyStatus,
};

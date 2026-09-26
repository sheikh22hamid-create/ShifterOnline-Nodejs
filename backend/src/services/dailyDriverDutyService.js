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
 * Forces every delivery model for the rider's vehicle category to enabled.
 * Daily Driver duty guarantees a fixed payout for being dispatchable, so a
 * driver punched in can't quietly disable all models and collect duty hours
 * (and the zero-ride-forfeit-bypassing overtime pay) while invisible to
 * dispatch - see memory on the Daily Driver abuse review.
 */
async function enableAllDeliveryModels(riderId) {
  const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { vehicle: true } });
  if (!rider) return;

  const category = await prisma.pkg_category.findFirst({ where: { cat_name: rider.vehicle, cat_status: 1 } });
  if (!category) return;

  const packages = await prisma.tbl_package.findMany({ where: { cat_id: category.id, status: 1 }, select: { id: true } });
  for (const pkg of packages) {
    const deliveryType = String(pkg.id);
    const existing = await prisma.tbl_rider_delivery_type.findFirst({
      where: { rider_id: Number(riderId), delivery_type: deliveryType },
    });
    if (existing) {
      if (existing.status !== 1) {
        await prisma.tbl_rider_delivery_type.update({ where: { id: existing.id }, data: { status: 1 } });
      }
    } else {
      await prisma.tbl_rider_delivery_type.create({ data: { rider_id: Number(riderId), delivery_type: deliveryType, status: 1 } });
    }
  }
}

/**
 * A "only"-mode Favorite Route excludes the rider from any order that
 * doesn't match it (see favoriteRouteService.matchCandidates) - same
 * invisible-to-dispatch effect as disabling all delivery models, just via a
 * different subsystem. Force-pause it on punch-in so it can't be used to
 * sit on Daily Driver duty without ever being dispatchable. "prefer" mode
 * only reorders candidates, never excludes, so it's left alone.
 */
async function pauseOnlyModeFavoriteRoute(riderId) {
  const state = await prisma.driver_favorite_route_state.findUnique({ where: { rider_id: Number(riderId) } });
  if (!state || !state.route_id) return;
  const route = await prisma.driver_favorite_route.findUnique({ where: { id: state.route_id } });
  if (route && route.mode === "only") {
    await prisma.driver_favorite_route_state.update({ where: { rider_id: Number(riderId) }, data: { route_id: null } });
  }
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

  const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { a_status: true } });
  if (!rider || rider.a_status !== 1) {
    throw new Error("Please go online before starting your Daily Driver duty.");
  }

  const plan = enrollment.plan;
  let zone = null;
  if (plan.assigned_zone_id) {
    zone = await prisma.service_zone.findUnique({ where: { id: plan.assigned_zone_id } });
  }

  let insideZone = true;
  if (lat && lng && zone) insideZone = geofenceService.isInsideZone(lat, lng, zone);

  await enableAllDeliveryModels(riderId);
  await pauseOnlyModeFavoriteRoute(riderId);

  if (enrollment.status === "enrolled") {
    await prisma.daily_driver_enrollment.update({ where: { id: enrollment.id }, data: { status: "active" } });
  }

  let log = enrollment.duty_log;
  if (!log) {
    log = await prisma.daily_driver_duty_log.create({
      data: { enrollment_id: enrollment.id, rider_id: Number(riderId), punch_in_at: istNow(), status: "in_progress" },
    });
  } else if (log.status !== "in_progress") {
    // Covers both the first punch-in (no punch_in_at yet) and resuming after
    // a mid-day pause - either way the session (re)starts now. `updated_at`
    // resets here too, which is what recordDutyLocationPing uses as the
    // delta reference, so break time is never counted as online.
    log = await prisma.daily_driver_duty_log.update({
      where: { id: log.id },
      data: { punch_in_at: log.punch_in_at || istNow(), status: "in_progress" },
    });
  }

  return { success: true, message: "Duty punched in successfully", insideZone, log, plan, zone };
}

/**
 * Punch-out only PAUSES the current duty session - it does not settle.
 * The enrollment stays "active" so the driver can punch back in any number
 * of times before the plan's duty window ends (e.g. a lunch break). Real
 * settlement only happens once via maybeAutoSettle, lazily triggered by
 * whichever API call (status/ping/punch-in) first lands after duty_end_time.
 */
async function punchOut(riderId) {
  const enrollment = await prisma.daily_driver_enrollment.findFirst({
    where: { rider_id: Number(riderId), enrollment_date: istDateOnly(), status: "active" },
    include: { plan: true, duty_log: true },
    orderBy: { id: "desc" },
  });
  if (!enrollment || !enrollment.duty_log || enrollment.duty_log.status !== "in_progress") {
    throw new Error("No active duty log found to punch out.");
  }

  await prisma.daily_driver_duty_log.update({
    where: { id: enrollment.duty_log.id },
    data: { punch_out_at: istNow(), status: "paused" },
  });

  return { success: true, message: "Duty paused. You can punch in again before your duty window ends." };
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
  if (isPunchedIn) {
    // total_online_minutes only advances on each ~90s ping, so add the time
    // elapsed since the current session started (punch-in or last resume,
    // tracked via updated_at) as a live estimate on top of the accumulated
    // total - using punch_in_at alone here would double-count any earlier
    // pause/resume break as online time.
    const sessionStart = log.updated_at || log.punch_in_at;
    if (sessionStart) {
      const elapsedMinutes = Math.max(0, Math.floor((Date.now() - new Date(sessionStart).getTime()) / 60000));
      totalOnlineMinutes += elapsedMinutes;
    }
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

const prisma = require("../config/db");
const geofenceService = require("./geofenceService");
const logger = require("../utils/logger");

/**
 * Formats current date as YYYY-MM-DD in IST timezone.
 */
function getTodayDateIST() {
  const istDate = new Date(Date.now() + 330 * 60 * 1000);
  return istDate.toISOString().split("T")[0];
}

/**
 * Returns contract details for a monthly driver.
 */
async function getDriverContract(riderId) {
  return await prisma.monthly_driver_contract.findUnique({
    where: { rider_id: Number(riderId) },
  });
}

/**
 * Returns today's duty log for a driver.
 */
async function getTodayDutyLog(riderId) {
  const todayStr = getTodayDateIST();
  const todayDate = new Date(todayStr);

  let log = await prisma.driver_duty_log.findFirst({
    where: {
      rider_id: Number(riderId),
      duty_date: todayDate,
    },
    orderBy: { id: "desc" },
  });

  return log;
}

/**
 * Handles Driver Punch-In.
 */
async function punchIn(riderId, lat, lng) {
  const contract = await getDriverContract(riderId);
  if (!contract || contract.status !== "active") {
    throw new Error("No active monthly driver contract found for this rider.");
  }

  let zone = null;
  if (contract.assigned_zone_id) {
    zone = await prisma.service_zone.findUnique({
      where: { id: contract.assigned_zone_id },
    });
  }

  // Check Geofence if coordinates provided
  let insideZone = true;
  if (lat && lng && zone) {
    insideZone = geofenceService.isInsideZone(lat, lng, zone);
  }

  const todayStr = getTodayDateIST();
  const todayDate = new Date(todayStr);

  let log = await getTodayDutyLog(riderId);

  if (!log) {
    log = await prisma.driver_duty_log.create({
      data: {
        rider_id: Number(riderId),
        duty_date: todayDate,
        punch_in_at: new Date(),
        status: "in_progress",
        total_online_minutes: 0,
        total_in_zone_minutes: 0,
        total_out_zone_minutes: 0,
        total_break_minutes: 0,
        calculated_daily_salary: 0,
      },
    });
  } else {
    log = await prisma.driver_duty_log.update({
      where: { id: log.id },
      data: {
        punch_in_at: log.punch_in_at || new Date(),
        status: "in_progress",
      },
    });
  }

  return {
    success: true,
    message: "Duty punched in successfully",
    insideZone,
    log,
    contract,
    zone,
  };
}

/**
 * Handles Driver Punch-Out.
 */
async function punchOut(riderId) {
  const log = await getTodayDutyLog(riderId);
  if (!log) {
    throw new Error("No active duty log found to punch out.");
  }

  const contract = await getDriverContract(riderId);
  const targetMinutes = contract ? (Number(contract.target_shift_hours) * 60) : 600;
  const baseSalary = contract ? Number(contract.monthly_base_salary) : 15000;
  const dailyBase = baseSalary / 30;

  const validMinutes = Math.min(targetMinutes, log.total_in_zone_minutes);
  const dailySalary = Math.round(((validMinutes / targetMinutes) * dailyBase) * 100) / 100;

  const updatedLog = await prisma.driver_duty_log.update({
    where: { id: log.id },
    data: {
      punch_out_at: new Date(),
      status: "completed",
      calculated_daily_salary: dailySalary,
    },
  });

  return {
    success: true,
    message: "Duty punched out successfully",
    log: updatedLog,
  };
}

/**
 * Records driver periodic location ping & tracks in-zone / out-of-zone duty minutes.
 */
async function recordDutyLocationPing(riderId, lat, lng) {
  const log = await getTodayDutyLog(riderId);
  if (!log || log.status !== "in_progress") {
    return { active: false };
  }

  const contract = await getDriverContract(riderId);
  if (!contract) return { active: false };

  let zone = null;
  if (contract.assigned_zone_id) {
    zone = await prisma.service_zone.findUnique({
      where: { id: contract.assigned_zone_id },
    });
  }

  const insideZone = zone ? geofenceService.isInsideZone(lat, lng, zone) : true;

  // Check if driver has an active in-progress order
  const activeOrder = await prisma.pkg_order.findFirst({
    where: {
      rid: Number(riderId),
      o_status: { in: ["Processing", "On_Route", "Pickup"] },
    },
    select: { id: true },
  });

  // If driver has active order, duty counts even if out of zone delivering
  const countAsInZone = insideZone || (activeOrder != null);

  const incrementInZone = countAsInZone ? 1 : 0;
  const incrementOutZone = countAsInZone ? 0 : 1;

  const targetMinutes = Number(contract.target_shift_hours) * 60 || 600;
  const baseDaily = (Number(contract.monthly_base_salary) || 15000) / 30;

  const newInZoneMins = log.total_in_zone_minutes + incrementInZone;
  const newOutZoneMins = log.total_out_zone_minutes + incrementOutZone;
  const newOnlineMins = log.total_online_minutes + 1;

  const dailySalary = Math.round((Math.min(1.0, newInZoneMins / targetMinutes) * baseDaily) * 100) / 100;

  const updated = await prisma.driver_duty_log.update({
    where: { id: log.id },
    data: {
      total_online_minutes: newOnlineMins,
      total_in_zone_minutes: newInZoneMins,
      total_out_zone_minutes: newOutZoneMins,
      calculated_daily_salary: dailySalary,
    },
  });

  return {
    active: true,
    insideZone,
    inDelivery: activeOrder != null,
    totalInZoneMinutes: newInZoneMins,
    totalOutZoneMinutes: newOutZoneMins,
    dailySalary,
  };
}

/**
 * Gets full duty status for driver app.
 */
async function getDriverDutyStatus(riderId) {
  const contract = await getDriverContract(riderId);
  if (!contract) {
    return { isMonthlyDriver: false };
  }

  let zone = null;
  if (contract.assigned_zone_id) {
    zone = await prisma.service_zone.findUnique({
      where: { id: contract.assigned_zone_id },
    });
  }

  const log = await getTodayDutyLog(riderId);
  const isPunchedIn = log != null && log.status === "in_progress";

  const targetMinutes = Number(contract.target_shift_hours) * 60;
  const inZoneMinutes = log ? log.total_in_zone_minutes : 0;
  const outZoneMinutes = log ? log.total_out_zone_minutes : 0;
  const dailySalary = log ? Number(log.calculated_daily_salary) : 0;

  return {
    isMonthlyDriver: true,
    contract: {
      id: contract.id,
      shiftStartTime: contract.shift_start_time,
      shiftEndTime: contract.shift_end_time,
      targetShiftHours: contract.target_shift_hours,
      monthlyBaseSalary: Number(contract.monthly_base_salary),
      allowedBreakMinutes: contract.allowed_break_minutes,
      status: contract.status,
    },
    zone: zone ? {
      id: zone.id,
      name: zone.name,
      centerLat: zone.center_lat,
      centerLng: zone.center_lng,
      radiusKm: zone.radius_km,
      polygonGeojson: zone.polygon_geojson,
    } : null,
    duty: {
      isPunchedIn,
      punchInAt: log ? log.punch_in_at : null,
      punchOutAt: log ? log.punch_out_at : null,
      inZoneMinutes,
      outZoneMinutes,
      totalOnlineMinutes: log ? log.total_online_minutes : 0,
      targetMinutes,
      dailySalary,
      ordersCompleted: log ? log.orders_completed : 0,
    },
  };
}

module.exports = {
  getDriverContract,
  getTodayDutyLog,
  punchIn,
  punchOut,
  recordDutyLocationPing,
  getDriverDutyStatus,
};

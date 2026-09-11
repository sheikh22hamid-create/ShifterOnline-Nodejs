const prisma = require("../config/db");
const dutyTrackingService = require("../services/dutyTrackingService");
const logger = require("../utils/logger");

/**
 * Lists all Monthly Drivers with their contracts, assigned zones, and current status.
 */
async function listMonthlyDrivers(req, res) {
  try {
    const contracts = await prisma.monthly_driver_contract.findMany({
      orderBy: { id: "desc" },
    });

    const riderIds = contracts.map((c) => c.rider_id);
    const riders = await prisma.tbl_rider.findMany({
      where: { id: { in: riderIds } },
      select: {
        id: true,
        title: true,
        mobile: true,
        email: true,
        vehicle: true,
        vehicle_no: true,
        status: true,
        wallet_balance: true,
        monthly_plan: true,
      },
    });

    const zones = await prisma.service_zone.findMany();
    const zoneMap = new Map(zones.map((z) => [z.id, z]));
    const riderMap = new Map(riders.map((r) => [r.id, r]));

    const result = contracts.map((contract) => {
      const rider = riderMap.get(contract.rider_id);
      const zone = contract.assigned_zone_id ? zoneMap.get(contract.assigned_zone_id) : null;
      return {
        ...contract,
        monthly_base_salary: Number(contract.monthly_base_salary),
        rider: rider || null,
        zone: zone ? { id: zone.id, name: zone.name, radius_km: zone.radius_km } : null,
      };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error("Error listing monthly drivers:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Promotes a driver to Monthly Driver and configures their shift, salary, and service zone.
 */
async function promoteDriver(req, res) {
  try {
    const {
      rider_id,
      assigned_zone_id,
      shift_start_time,
      shift_end_time,
      target_shift_hours,
      monthly_base_salary,
      allowed_break_minutes,
    } = req.body;

    if (!rider_id) {
      return res.status(400).json({ success: false, message: "rider_id is required" });
    }

    const riderId = Number(rider_id);

    // 1. Update rider monthly_plan = 1
    await prisma.tbl_rider.update({
      where: { id: riderId },
      data: {
        monthly_plan: 1,
        working_hours: target_shift_hours ? Number(target_shift_hours) : 10,
      },
    });

    // 2. Ensure all delivery tier packages are enabled for monthly driver
    const packages = await prisma.tbl_package.findMany({ select: { id: true } });
    for (const pkg of packages) {
      const existing = await prisma.tbl_rider_delivery_type.findFirst({
        where: { rider_id: riderId, delivery_type: String(pkg.id) },
      });
      if (!existing) {
        await prisma.tbl_rider_delivery_type.create({
          data: { rider_id: riderId, delivery_type: String(pkg.id), status: 1 },
        });
      } else if (existing.status !== 1) {
        await prisma.tbl_rider_delivery_type.update({
          where: { id: existing.id },
          data: { status: 1 },
        });
      }
    }

    // 3. Create or update contract
    const contract = await prisma.monthly_driver_contract.upsert({
      where: { rider_id: riderId },
      create: {
        rider_id: riderId,
        assigned_zone_id: assigned_zone_id ? Number(assigned_zone_id) : null,
        shift_start_time: shift_start_time || "10:00:00",
        shift_end_time: shift_end_time || "20:00:00",
        target_shift_hours: target_shift_hours ? Number(target_shift_hours) : 10.0,
        monthly_base_salary: monthly_base_salary ? Number(monthly_base_salary) : 15000.0,
        allowed_break_minutes: allowed_break_minutes ? Number(allowed_break_minutes) : 45,
        status: "active",
      },
      update: {
        assigned_zone_id: assigned_zone_id ? Number(assigned_zone_id) : null,
        shift_start_time: shift_start_time || "10:00:00",
        shift_end_time: shift_end_time || "20:00:00",
        target_shift_hours: target_shift_hours ? Number(target_shift_hours) : 10.0,
        monthly_base_salary: monthly_base_salary ? Number(monthly_base_salary) : 15000.0,
        allowed_break_minutes: allowed_break_minutes ? Number(allowed_break_minutes) : 45,
        status: "active",
      },
    });

    return res.json({
      success: true,
      message: "Driver promoted to Monthly Dedicated Driver successfully",
      data: contract,
    });
  } catch (err) {
    logger.error("Error promoting driver to monthly:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Demotes a monthly driver back to freelance.
 */
async function demoteDriver(req, res) {
  try {
    const { rider_id } = req.body;
    if (!rider_id) {
      return res.status(400).json({ success: false, message: "rider_id is required" });
    }

    const riderId = Number(rider_id);

    await prisma.tbl_rider.update({
      where: { id: riderId },
      data: { monthly_plan: 0 },
    });

    await prisma.monthly_driver_contract.updateMany({
      where: { rider_id: riderId },
      data: { status: "terminated" },
    });

    return res.json({ success: true, message: "Driver reverted to Standard Freelance driver" });
  } catch (err) {
    logger.error("Error demoting monthly driver:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Gets duty status for driver app.
 */
async function getDutyStatus(req, res) {
  try {
    const riderId = req.params.riderId || req.query.riderId;
    if (!riderId) {
      return res.status(400).json({ success: false, message: "riderId required" });
    }

    const status = await dutyTrackingService.getDriverDutyStatus(riderId);
    return res.json({ success: true, data: status });
  } catch (err) {
    logger.error("Error getting driver duty status:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Punch In endpoint for Driver App.
 */
async function punchIn(req, res) {
  try {
    const { rider_id, lat, lng } = req.body;
    if (!rider_id) {
      return res.status(400).json({ success: false, message: "rider_id is required" });
    }

    const result = await dutyTrackingService.punchIn(rider_id, lat, lng);
    return res.json(result);
  } catch (err) {
    logger.error("Error during duty punch in:", err);
    return res.status(400).json({ success: false, message: err.message || "Punch in failed" });
  }
}

/**
 * Punch Out endpoint for Driver App.
 */
async function punchOut(req, res) {
  try {
    const { rider_id } = req.body;
    if (!rider_id) {
      return res.status(400).json({ success: false, message: "rider_id is required" });
    }

    const result = await dutyTrackingService.punchOut(rider_id);
    return res.json(result);
  } catch (err) {
    logger.error("Error during duty punch out:", err);
    return res.status(400).json({ success: false, message: err.message || "Punch out failed" });
  }
}

/**
 * Generates Attendance & Salary Report for Monthly Drivers.
 */
async function getAttendanceReport(req, res) {
  try {
    const { start_date, end_date, rider_id } = req.query;

    const where = {};
    if (rider_id) where.rider_id = Number(rider_id);
    if (start_date && end_date) {
      where.duty_date = {
        gte: new Date(start_date),
        lte: new Date(end_date),
      };
    }

    const logs = await prisma.driver_duty_log.findMany({
      where,
      orderBy: [{ duty_date: "desc" }, { id: "desc" }],
    });

    const riderIds = [...new Set(logs.map((l) => l.rider_id))];
    const riders = await prisma.tbl_rider.findMany({
      where: { id: { in: riderIds } },
      select: { id: true, title: true, mobile: true },
    });
    const riderMap = new Map(riders.map((r) => [r.id, r]));

    const result = logs.map((log) => ({
      ...log,
      calculated_daily_salary: Number(log.calculated_daily_salary),
      rider: riderMap.get(log.rider_id) || null,
    }));

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error("Error generating attendance report:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = {
  listMonthlyDrivers,
  promoteDriver,
  demoteDriver,
  getDutyStatus,
  punchIn,
  punchOut,
  getAttendanceReport,
};

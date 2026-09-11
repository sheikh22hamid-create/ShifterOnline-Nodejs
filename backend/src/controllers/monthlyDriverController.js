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
        full_name: true,
        first_name: true,
        last_name: true,
        fmobile: true,
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
    const riderMap = new Map(riders.map((r) => {
      const name = r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`;
      return [r.id, {
        ...r,
        full_name: name,
        fmobile: r.fmobile || "",
      }];
    }));

    const result = contracts.map((contract) => {
      const rider = riderMap.get(contract.rider_id);
      const zone = contract.assigned_zone_id ? zoneMap.get(contract.assigned_zone_id) : null;
      return {
        ...contract,
        monthly_base_salary: Number(contract.monthly_base_salary),
        overtime_hourly_rate: Number(contract.overtime_hourly_rate || 0),
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
 * Promotes a driver to Monthly Driver and configures their shift, salary, overtime rate, and service zone.
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
      overtime_hourly_rate,
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
        overtime_hourly_rate: overtime_hourly_rate !== undefined ? Number(overtime_hourly_rate) : 50.0,
        allowed_break_minutes: allowed_break_minutes ? Number(allowed_break_minutes) : 45,
        status: "active",
      },
      update: {
        assigned_zone_id: assigned_zone_id ? Number(assigned_zone_id) : null,
        shift_start_time: shift_start_time || "10:00:00",
        shift_end_time: shift_end_time || "20:00:00",
        target_shift_hours: target_shift_hours ? Number(target_shift_hours) : 10.0,
        monthly_base_salary: monthly_base_salary ? Number(monthly_base_salary) : 15000.0,
        overtime_hourly_rate: overtime_hourly_rate !== undefined ? Number(overtime_hourly_rate) : 50.0,
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
      select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true },
    });
    const riderMap = new Map(riders.map((r) => {
      const name = r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`;
      return [r.id, {
        id: r.id,
        full_name: name,
        fmobile: r.fmobile || "",
      }];
    }));

    const result = logs.map((log) => ({
      ...log,
      calculated_daily_salary: Number(log.calculated_daily_salary),
      overtime_minutes: Number(log.overtime_minutes || 0),
      overtime_pay: Number(log.overtime_pay || 0),
      cash_collected: Number(log.cash_collected || 0),
      rider: riderMap.get(log.rider_id) || null,
    }));

    return res.json({ success: true, data: result });
  } catch (err) {
    logger.error("Error generating attendance report:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Gets the financial ledger and cash settlement breakdown for a monthly driver.
 */
async function getMonthlyDriverLedger(req, res) {
  try {
    const riderId = Number(req.params.riderId || req.query.riderId);
    if (!riderId) {
      return res.status(400).json({ success: false, message: "riderId is required" });
    }

    const { start_date, end_date } = req.query;
    const where = { rider_id: riderId };
    if (start_date && end_date) {
      where.created_at = {
        gte: new Date(start_date),
        lte: new Date(end_date + "T23:59:59.999Z"),
      };
    }

    const [entries, rider, contract] = await Promise.all([
      prisma.monthly_driver_ledger.findMany({
        where,
        orderBy: [{ created_at: "desc" }, { id: "desc" }],
      }),
      prisma.tbl_rider.findUnique({
        where: { id: riderId },
        select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, wallet_balance: true },
      }),
      prisma.monthly_driver_contract.findUnique({
        where: { rider_id: riderId },
      }),
    ]);

    let totalBaseSalary = 0;
    let totalOvertimePay = 0;
    let totalCashCollected = 0;
    let totalCashDeposits = 0;
    let totalSettlementPayouts = 0;
    let totalCredits = 0;
    let totalDebits = 0;

    const formattedEntries = entries.map((entry) => {
      const amount = Number(entry.amount);
      if (entry.balance_effect === "CREDIT") {
        totalCredits += amount;
      } else {
        totalDebits += amount;
      }

      if (entry.entry_type === "BASE_SALARY") totalBaseSalary += amount;
      else if (entry.entry_type === "OVERTIME_PAY") totalOvertimePay += amount;
      else if (entry.entry_type === "CASH_COLLECTED") totalCashCollected += amount;
      else if (entry.entry_type === "CASH_DEPOSIT") totalCashDeposits += amount;
      else if (entry.entry_type === "SETTLEMENT_PAYOUT") totalSettlementPayouts += amount;

      return {
        ...entry,
        amount,
      };
    });

    const netSettlementBalance = Math.round((totalCredits - totalDebits) * 100) / 100;

    const riderName = rider ? (rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim() || `Driver #${rider.id}`) : `Driver #${riderId}`;

    return res.json({
      success: true,
      data: {
        rider: rider ? { ...rider, full_name: riderName } : null,
        contract: contract ? {
          ...contract,
          monthly_base_salary: Number(contract.monthly_base_salary),
          overtime_hourly_rate: Number(contract.overtime_hourly_rate || 0),
        } : null,
        summary: {
          total_base_salary: Math.round(totalBaseSalary * 100) / 100,
          total_overtime_pay: Math.round(totalOvertimePay * 100) / 100,
          total_cash_collected: Math.round(totalCashCollected * 100) / 100,
          total_cash_deposits: Math.round(totalCashDeposits * 100) / 100,
          total_settlement_payouts: Math.round(totalSettlementPayouts * 100) / 100,
          total_credits: Math.round(totalCredits * 100) / 100,
          total_debits: Math.round(totalDebits * 100) / 100,
          net_settlement_balance: netSettlementBalance,
        },
        entries: formattedEntries,
      },
    });
  } catch (err) {
    logger.error("Error fetching monthly driver ledger:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Allows admin to manually record a cash deposit, payout settlement, or adjustment.
 */
async function addLedgerAdjustment(req, res) {
  try {
    const riderId = Number(req.params.riderId || req.body.rider_id);
    const { entry_type, amount, balance_effect, notes } = req.body;

    if (!riderId || !amount || !entry_type || !balance_effect) {
      return res.status(400).json({ success: false, message: "rider_id, amount, entry_type, balance_effect are required" });
    }

    const todayDate = new Date(new Date(Date.now() + 330 * 60 * 1000).toISOString().split("T")[0]);
    const entry = await prisma.monthly_driver_ledger.create({
      data: {
        rider_id: riderId,
        entry_type,
        amount: Number(amount),
        balance_effect: balance_effect.toUpperCase(),
        notes: notes || `Manual ${entry_type} entry recorded by admin`,
        duty_date: todayDate,
        created_at: new Date(Date.now() + 330 * 60 * 1000),
      },
    });

    return res.json({ success: true, message: "Ledger entry added successfully", data: entry });
  } catch (err) {
    logger.error("Error adding ledger adjustment:", err);
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
  getMonthlyDriverLedger,
  addLedgerAdjustment,
};

const prisma = require("../config/db");
const logger = require("../utils/logger");

function istNow() {
  return new Date(Date.now() + 330 * 60 * 1000);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Builds the [start, end] Date range for a plan's duty window on a given
 * enrollment_date, from its "HH:MM:SS" start/end strings.
 */
function dutyWindow(enrollmentDate, plan) {
  const dateStr = new Date(enrollmentDate).toISOString().split("T")[0];
  const start = new Date(`${dateStr}T${plan.duty_start_time}`);
  const end = new Date(`${dateStr}T${plan.duty_end_time}`);
  return { start, end };
}

/**
 * Pure settlement math, split out from settleEnrollment so it can be unit
 * tested without a database. Pay is proportional to actual duty hours, not a
 * fixed daily price minus a penalty: e.g. price=1000 over a 10h plan, 2h
 * actually worked -> 200, not 1000 minus some shortfall charge. Hours beyond
 * required are handled separately as overtime. There is no zero-ride gate -
 * the driver is paid for being online/in-zone regardless of whether any ride
 * was actually dispatched to them (business decision: guaranteed pay for
 * availability, not for completed rides).
 */
function computeSettlement({ ridesCompleted, actualKm, rideEarnings, dutyHoursCounted, plan }) {
  const requiredHours = Number(plan.required_duty_hours) || 0;
  const perHourRate = requiredHours > 0 ? Number(plan.price) / requiredHours : 0;

  const overtimeHours = Math.max(0, dutyHoursCounted - requiredHours);
  const overtimePay = money(overtimeHours * Number(plan.overtime_hourly_rate));

  const extraKm = money(Math.max(0, actualKm - plan.free_km));
  const extraKmCharge = money(extraKm * Number(plan.extra_km_rate));

  const payableHours = Math.min(dutyHoursCounted, requiredHours);
  // Kept as an informational figure (price minus this equals the proportional
  // eligible amount below) - no longer driven by plan.shortfall_hourly_rate.
  const shortfallHours = money(Math.max(0, requiredHours - dutyHoursCounted));
  const shortfallDeduction = money(shortfallHours * perHourRate);
  const eligiblePlanAmount = money(payableHours * perHourRate);

  const diff = money(eligiblePlanAmount - rideEarnings);
  let settlementDirection = "none";
  let finalSettlementAmount = 0;
  if (diff > 0) {
    settlementDirection = "company_pays";
    finalSettlementAmount = diff;
  } else if (diff < 0) {
    settlementDirection = "company_retains";
    finalSettlementAmount = money(-diff);
  }

  return {
    overtimeHours, overtimePay, extraKm, extraKmCharge,
    shortfallHours, shortfallDeduction, eligiblePlanAmount,
    settlementDirection, finalSettlementAmount,
  };
}

/**
 * Computes and persists the final settlement for one enrollment. Idempotent:
 * re-running it for an already-settled enrollment recomputes and overwrites
 * the duty_log snapshot but only ever writes each ledger entry_type once per
 * enrollment (guarded below), so a retry after a partial failure is safe.
 *
 * Core rule ordering (spec sections 7 and 16-17): the zero-ride rule takes
 * priority over every other calculation - zero completed rides means zero
 * payout regardless of how many hours the driver stayed online.
 */
async function settleEnrollment(enrollmentId) {
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.daily_driver_enrollment.findUnique({
      where: { id: Number(enrollmentId) },
      include: { plan: true, duty_log: true },
    });
    if (!enrollment) throw new Error("Enrollment not found");
    if (!enrollment.duty_log) throw new Error("No duty log to settle");
    if (enrollment.status === "settlement_completed") return enrollment.duty_log;

    const plan = enrollment.plan;
    const log = enrollment.duty_log;
    const { start, end } = dutyWindow(enrollment.enrollment_date, plan);

    const completedRides = await tx.pkg_order.findMany({
      where: {
        rid: Number(enrollment.rider_id),
        o_status: "Completed",
        ddate: { gte: start, lte: end },
      },
      select: { id: true, distance: true, driver_earning: true },
    });

    const ridesCompleted = completedRides.length;
    const actualKm = money(completedRides.reduce((sum, o) => sum + (Number(o.distance) || 0), 0));
    const rideEarnings = money(completedRides.reduce((sum, o) => sum + (Number(o.driver_earning) || 0), 0));

    const dutyHoursCounted = (log.total_in_zone_minutes || 0) / 60;

    const {
      overtimeHours, overtimePay, extraKm, extraKmCharge,
      shortfallHours, shortfallDeduction, eligiblePlanAmount,
      settlementDirection, finalSettlementAmount,
    } = computeSettlement({ ridesCompleted, actualKm, rideEarnings, dutyHoursCounted, plan });

    const updatedLog = await tx.daily_driver_duty_log.update({
      where: { id: log.id },
      data: {
        rides_completed: ridesCompleted,
        actual_km: actualKm,
        extra_km: extraKm,
        extra_km_charge: extraKmCharge,
        shortfall_hours: shortfallHours,
        shortfall_deduction: shortfallDeduction,
        overtime_minutes: Math.round(overtimeHours * 60),
        overtime_pay: overtimePay,
        ride_earnings: rideEarnings,
        eligible_plan_amount: eligiblePlanAmount,
        final_settlement_amount: finalSettlementAmount,
        settlement_direction: settlementDirection,
        status: "settled",
      },
    });

    await writeLedgerEntries(tx, enrollment, plan, {
      ridesCompleted,
      eligiblePlanAmount,
      shortfallDeduction,
      extraKmCharge,
      overtimePay,
      rideEarnings,
      settlementDirection,
      finalSettlementAmount,
    });

    if (settlementDirection === "company_pays" && finalSettlementAmount > 0) {
      await tx.tbl_rider.update({ where: { id: enrollment.rider_id }, data: { wallet_balance: { increment: finalSettlementAmount } } });
    } else if (settlementDirection === "company_retains" && finalSettlementAmount > 0) {
      await tx.tbl_rider.update({ where: { id: enrollment.rider_id }, data: { wallet_balance: { decrement: finalSettlementAmount } } });
    }
    if (extraKmCharge > 0) {
      await tx.tbl_rider.update({ where: { id: enrollment.rider_id }, data: { wallet_balance: { increment: extraKmCharge } } });
    }
    if (overtimePay > 0) {
      await tx.tbl_rider.update({ where: { id: enrollment.rider_id }, data: { wallet_balance: { increment: overtimePay } } });
    }

    await tx.daily_driver_enrollment.update({ where: { id: enrollment.id }, data: { status: "settlement_completed" } });

    return updatedLog;
  });
}

async function writeLedgerEntries(tx, enrollment, plan, calc) {
  const riderId = Number(enrollment.rider_id);
  const dateStr = new Date(enrollment.enrollment_date).toISOString().split("T")[0];
  const existing = await tx.daily_driver_ledger.findFirst({ where: { enrollment_id: enrollment.id } });
  if (existing) return; // already ledgered - settleEnrollment being re-run after it already completed

  // No zero-ride gate: the driver is paid for duty hours regardless of
  // whether any ride was dispatched to them, so this is always the full
  // price credited, then debited down to the proportional eligible amount
  // via the shortfall entry below (if hours fell short of required).
  const rows = [
    {
      entry_type: "PLAN_AMOUNT",
      amount: Number(plan.price),
      balance_effect: "CREDIT",
      notes: `Base plan amount for ${plan.plan_name} on ${dateStr}`,
    },
  ];
  if (calc.shortfallDeduction > 0) {
    rows.push({
      entry_type: "SHORTFALL_DEDUCTION",
      amount: calc.shortfallDeduction,
      balance_effect: "DEBIT",
      notes: `Shortfall deduction for ${dateStr}`,
    });
  }
  if (calc.extraKmCharge > 0) {
    rows.push({ entry_type: "EXTRA_KM_CHARGE", amount: calc.extraKmCharge, balance_effect: "CREDIT", notes: `Extra KM charge for ${dateStr}` });
  }
  if (calc.overtimePay > 0) {
    rows.push({ entry_type: "OVERTIME_PAY", amount: calc.overtimePay, balance_effect: "CREDIT", notes: `Overtime pay for ${dateStr}` });
  }
  rows.push({ entry_type: "RIDE_EARNINGS", amount: calc.rideEarnings, balance_effect: "CREDIT", notes: `Ride earnings collected for ${dateStr}` });
  if (calc.settlementDirection === "company_pays" && calc.finalSettlementAmount > 0) {
    rows.push({
      entry_type: "COMPANY_SETTLEMENT_PAYOUT",
      amount: calc.finalSettlementAmount,
      balance_effect: "CREDIT",
      notes: `Company pays the difference between eligible plan amount and ride earnings for ${dateStr}`,
    });
  } else if (calc.settlementDirection === "company_retains" && calc.finalSettlementAmount > 0) {
    rows.push({
      entry_type: "COMPANY_RETAINED",
      amount: calc.finalSettlementAmount,
      balance_effect: "DEBIT",
      notes: `Ride earnings exceeded eligible plan amount for ${dateStr} - excess retained by company`,
    });
  }

  await tx.daily_driver_ledger.createMany({
    data: rows.map((r) => ({ rider_id: riderId, enrollment_id: enrollment.id, ...r, created_at: istNow() })),
  });
}

module.exports = { settleEnrollment, dutyWindow, __private: { computeSettlement, money } };

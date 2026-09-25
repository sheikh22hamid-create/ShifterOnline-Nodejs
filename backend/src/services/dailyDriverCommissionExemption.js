const prisma = require("../config/db");

// Deliberately standalone (no dependency on dailyDriverDutyService /
// dailyDriverSettlementService) - tripLifecycle only needs a cheap
// "is this rider commission-exempt right now" check, and pulling in the
// duty/settlement services here would create a require cycle back through
// them into tripLifecycle-adjacent code paths.
function istDateOnly() {
  const ist = new Date(Date.now() + 330 * 60 * 1000);
  return new Date(ist.toISOString().split("T")[0]);
}

/**
 * Mirrors the old monthly_plan boolean check this replaces (tripLifecycle.js
 * isMonthlyDriver): true while the rider has an active Daily Driver
 * enrollment for today, same as `monthly_plan=1` used to mean "always
 * exempt". Commission exemption is intentionally not conditioned on
 * punched-in/out status - the plan is active for the whole enrollment_date
 * once it has started.
 */
async function hasActiveDailyDriverEnrollmentToday(riderId) {
  if (!prisma.daily_driver_enrollment) return false; // guards incomplete migration deploys, same pattern as driverPlanService
  const enrollment = await prisma.daily_driver_enrollment.findFirst({
    where: { rider_id: Number(riderId), enrollment_date: istDateOnly(), status: "active" },
    select: { id: true },
  });
  return Boolean(enrollment);
}

module.exports = { hasActiveDailyDriverEnrollmentToday };

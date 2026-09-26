const prisma = require("../config/db");
const logger = require("../utils/logger");

// Mirrors tripLifecycle.js's istNow()/dutyTrackingService's getTodayDateIST -
// this DB stores true UTC and the rest of the app displays it shifted by
// +330 minutes, so every date/time this service writes or compares follows
// the same convention.
function istNow() {
  return new Date(Date.now() + 330 * 60 * 1000);
}

function istDateOnly(d = istNow()) {
  return new Date(d.toISOString().split("T")[0]);
}

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function matchesCsvField(raw, value) {
  if (!raw) return true;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.toLowerCase() === "all" || trimmed === "*") return true;
  const list = trimmed.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length || list.includes("all") || list.includes("*")) return true;
  return value != null && list.includes(String(value).trim().toLowerCase());
}

const OCCUPIED_STATUSES = ["pending_approval", "enrolled", "active", "completed", "settlement_pending", "settlement_completed"];

// --- Admin: plan CRUD ------------------------------------------------------

async function listAllPlans() {
  return prisma.daily_driver_plan.findMany({ orderBy: [{ sort_order: "asc" }, { id: "desc" }] });
}

async function createPlan(data) {
  return prisma.daily_driver_plan.create({
    data: {
      plan_name: data.plan_name,
      price: money(data.price),
      duty_start_time: data.duty_start_time || "10:00:00",
      duty_end_time: data.duty_end_time || "20:00:00",
      required_duty_hours: Number(data.required_duty_hours) || 10,
      free_km: Number(data.free_km) || 0,
      extra_km_rate: money(data.extra_km_rate),
      shortfall_hourly_rate: money(data.shortfall_hourly_rate),
      overtime_hourly_rate: money(data.overtime_hourly_rate),
      max_drivers: Math.max(1, Number(data.max_drivers) || 1),
      assigned_zone_id: data.assigned_zone_id ? Number(data.assigned_zone_id) : null,
      city: data.city || "all",
      package_categories: data.package_categories || "all",
      sort_order: Number(data.sort_order) || 0,
      status: data.status !== undefined ? Boolean(data.status) : true,
    },
  });
}

async function updatePlan(id, data) {
  const existing = await prisma.daily_driver_plan.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Plan not found");

  const patch = {};
  const fields = ["plan_name", "duty_start_time", "duty_end_time", "city", "package_categories"];
  for (const f of fields) if (data[f] !== undefined) patch[f] = data[f];

  const numericFields = ["required_duty_hours", "free_km", "max_drivers", "sort_order"];
  for (const f of numericFields) if (data[f] !== undefined) patch[f] = Number(data[f]);

  const moneyFields = ["price", "extra_km_rate", "shortfall_hourly_rate", "overtime_hourly_rate"];
  for (const f of moneyFields) if (data[f] !== undefined) patch[f] = money(data[f]);

  if (data.assigned_zone_id !== undefined) patch.assigned_zone_id = data.assigned_zone_id ? Number(data.assigned_zone_id) : null;
  if (data.status !== undefined) patch.status = Boolean(data.status);

  return prisma.daily_driver_plan.update({ where: { id: Number(id) }, data: patch });
}

async function setPlanStatus(id, status) {
  const existing = await prisma.daily_driver_plan.findUnique({ where: { id: Number(id) } });
  if (!existing) throw new Error("Plan not found");
  return prisma.daily_driver_plan.update({ where: { id: Number(id) }, data: { status: Boolean(status) } });
}

// --- Capacity ---------------------------------------------------------------

async function enrolledCount(planId, enrollmentDate, client = prisma) {
  return client.daily_driver_enrollment.count({
    where: { plan_id: Number(planId), enrollment_date: enrollmentDate, status: { in: OCCUPIED_STATUSES } },
  });
}

async function hasCapacity(planId, enrollmentDate, plan, client = prisma) {
  const count = await enrolledCount(planId, enrollmentDate, client);
  return count < plan.max_drivers;
}

// --- Driver: plan list --------------------------------------------------

async function listDriverPlans(driverId, cityId) {
  const driver = await prisma.tbl_rider.findUnique({
    where: { id: Number(driverId) },
    select: { vehicle: true, city_id: true },
  });
  if (!driver) throw new Error("Driver not found");

  const today = istDateOnly();
  const [plans, myEnrollment] = await Promise.all([
    prisma.daily_driver_plan.findMany({ where: { status: true }, orderBy: [{ sort_order: "asc" }, { id: "asc" }] }),
    prisma.daily_driver_enrollment.findFirst({
      where: { rider_id: Number(driverId), enrollment_date: today, status: { in: OCCUPIED_STATUSES } },
      include: { plan: true },
    }),
  ]);

  const cityToMatch = cityId || driver.city_id;
  const filtered = plans.filter(
    (plan) => matchesCsvField(plan.city, cityToMatch) && matchesCsvField(plan.package_categories, driver.vehicle)
  );

  const withSlots = await Promise.all(
    filtered.map(async (plan) => {
      const enrolled = await enrolledCount(plan.id, today);
      return {
        plan_id: plan.id,
        plan_name: plan.plan_name,
        price: Number(plan.price),
        duty_start_time: plan.duty_start_time,
        duty_end_time: plan.duty_end_time,
        required_duty_hours: plan.required_duty_hours,
        free_km: plan.free_km,
        extra_km_rate: Number(plan.extra_km_rate),
        shortfall_hourly_rate: Number(plan.shortfall_hourly_rate),
        overtime_hourly_rate: Number(plan.overtime_hourly_rate),
        max_drivers: plan.max_drivers,
        enrolled_count: enrolled,
        slots_available: Math.max(0, plan.max_drivers - enrolled),
        is_full: enrolled >= plan.max_drivers,
      };
    })
  );

  return {
    plans: withSlots,
    my_enrollment: myEnrollment
      ? {
          enrollment_id: myEnrollment.id,
          plan_id: myEnrollment.plan_id,
          plan_name: myEnrollment.plan.plan_name,
          status: myEnrollment.status,
          enrollment_date: myEnrollment.enrollment_date,
        }
      : null,
  };
}

// --- Enrollment lifecycle ----------------------------------------------

async function enroll({ riderId, planId, enrollmentDate = null, autoEnrollId = null }) {
  const date = enrollmentDate ? istDateOnly(new Date(enrollmentDate)) : istDateOnly();
  return prisma.$transaction(async (tx) => {
    // Serializes concurrent enroll attempts for this plan so two drivers
    // racing for the last slot can't both read "capacity available" before
    // either insert lands (see memory on the Daily Driver abuse review).
    await tx.$queryRaw`SELECT id FROM daily_driver_plan WHERE id = ${Number(planId)} FOR UPDATE`;

    const plan = await tx.daily_driver_plan.findFirst({ where: { id: Number(planId), status: true } });
    if (!plan) throw new Error("Plan not found or inactive");

    const existing = await tx.daily_driver_enrollment.findFirst({
      where: { rider_id: Number(riderId), enrollment_date: date, status: { in: OCCUPIED_STATUSES } },
    });
    if (existing) throw new Error("You already have a Daily Driver enrollment for this date");

    const driver = await tx.tbl_rider.findUnique({ where: { id: Number(riderId) } });
    if (!driver) throw new Error("Driver not found");
    if (!matchesCsvField(plan.package_categories, driver.vehicle)) {
      throw new Error("This plan is not available for your vehicle category");
    }

    const canEnrollDirectly = await hasCapacity(plan.id, date, plan, tx);
    const enrollment = await tx.daily_driver_enrollment.create({
      data: {
        rider_id: Number(riderId),
        plan_id: plan.id,
        enrollment_date: date,
        status: canEnrollDirectly ? "enrolled" : "pending_approval",
        auto_enroll_id: autoEnrollId ? Number(autoEnrollId) : null,
      },
    });
    return { enrollment, plan, autoApproved: canEnrollDirectly };
  });
}

async function cancelEnrollment({ riderId, enrollmentId }) {
  const enrollment = await prisma.daily_driver_enrollment.findUnique({ where: { id: Number(enrollmentId) } });
  if (!enrollment || Number(enrollment.rider_id) !== Number(riderId)) throw new Error("Enrollment not found");
  if (!["pending_approval", "enrolled"].includes(enrollment.status)) {
    throw new Error("Only a pending or not-yet-started enrollment can be cancelled");
  }
  return prisma.daily_driver_enrollment.update({ where: { id: enrollment.id }, data: { status: "cancelled" } });
}

async function listPendingRequests(planId = null) {
  return prisma.daily_driver_enrollment.findMany({
    where: { status: "pending_approval", ...(planId ? { plan_id: Number(planId) } : {}) },
    include: { plan: true },
    orderBy: { created_at: "asc" },
  });
}

async function approveEnrollment({ enrollmentId, adminId }) {
  return prisma.$transaction(async (tx) => {
    const enrollment = await tx.daily_driver_enrollment.findUnique({ where: { id: Number(enrollmentId) }, include: { plan: true } });
    if (!enrollment || enrollment.status !== "pending_approval") throw new Error("Enrollment request not found or already resolved");

    // Same per-plan lock as enroll() - two admins approving different pending
    // requests for the same plan at once must not both pass the capacity check.
    await tx.$queryRaw`SELECT id FROM daily_driver_plan WHERE id = ${enrollment.plan_id} FOR UPDATE`;

    // Re-check capacity at approval time - a slot may have freed up or filled
    // since the request was queued.
    const stillHasCapacity = await hasCapacity(enrollment.plan_id, enrollment.enrollment_date, enrollment.plan, tx);
    if (!stillHasCapacity) throw new Error("Plan is now full - cannot approve");

    return tx.daily_driver_enrollment.update({
      where: { id: enrollment.id },
      data: { status: "enrolled", approved_by_admin: Number(adminId) || null, approved_at: istNow() },
    });
  });
}

async function rejectEnrollment({ enrollmentId, adminId }) {
  const enrollment = await prisma.daily_driver_enrollment.findUnique({ where: { id: Number(enrollmentId) } });
  if (!enrollment || enrollment.status !== "pending_approval") throw new Error("Enrollment request not found or already resolved");
  return prisma.daily_driver_enrollment.update({
    where: { id: enrollment.id },
    data: { status: "rejected", approved_by_admin: Number(adminId) || null, approved_at: istNow() },
  });
}

// --- Auto-enroll ----------------------------------------------------------

async function setAutoEnroll({ riderId, planId, untilDate }) {
  await prisma.daily_driver_auto_enroll.updateMany({
    where: { rider_id: Number(riderId), status: "active" },
    data: { status: "cancelled" },
  });
  return prisma.daily_driver_auto_enroll.create({
    data: { rider_id: Number(riderId), plan_id: Number(planId), until_date: istDateOnly(new Date(untilDate)), status: "active" },
  });
}

async function cancelAutoEnroll({ riderId }) {
  // Only future automatic enrollments stop; today's already-created
  // enrollment (if any) is untouched, per spec section 4.
  const updated = await prisma.daily_driver_auto_enroll.updateMany({
    where: { rider_id: Number(riderId), status: "active" },
    data: { status: "cancelled" },
  });
  if (updated.count === 0) throw new Error("No active auto-enroll found");
  return { success: true };
}

/**
 * Daily job: for every active, non-expired auto-enroll row, create
 * tomorrow's enrollment (direct if capacity allows, else pending_approval -
 * auto-enroll never bypasses the admin capacity limit, per spec section 4).
 * Idempotent: enroll() itself rejects a duplicate enrollment for the same
 * rider+date, so re-running this job for the same day is a safe no-op for
 * riders already processed.
 */
async function runAutoEnrollJob(forDate = null) {
  const targetDate = forDate ? istDateOnly(new Date(forDate)) : istDateOnly(new Date(istNow().getTime() + 86400000));
  const candidates = await prisma.daily_driver_auto_enroll.findMany({
    where: { status: "active", enabled: true, until_date: { gte: targetDate } },
  });

  const results = [];
  for (const candidate of candidates) {
    try {
      const { enrollment, autoApproved } = await enroll({
        riderId: candidate.rider_id,
        planId: candidate.plan_id,
        enrollmentDate: targetDate,
        autoEnrollId: candidate.id,
      });
      results.push({ riderId: candidate.rider_id, enrollmentId: enrollment.id, autoApproved });
    } catch (err) {
      // Already enrolled for that date (e.g. manually), plan gone inactive,
      // vehicle mismatch, etc. - log and move to the next candidate rather
      // than aborting the whole batch.
      logger.error(`dailyDriverPlanService.runAutoEnrollJob: rider ${candidate.rider_id} skipped:`, err.message);
    }
  }
  return results;
}

module.exports = {
  listAllPlans,
  createPlan,
  updatePlan,
  setPlanStatus,
  listDriverPlans,
  enroll,
  cancelEnrollment,
  listPendingRequests,
  approveEnrollment,
  rejectEnrollment,
  setAutoEnroll,
  cancelAutoEnroll,
  runAutoEnrollJob,
  __private: { istNow, istDateOnly, money, matchesCsvField, enrolledCount, hasCapacity },
};

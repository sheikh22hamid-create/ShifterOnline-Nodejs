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
    // racing for the last application slot can't both read "capacity
    // available" before either insert lands (see memory on the Daily Driver
    // abuse review).
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

    // max_drivers now caps the number of drivers who can even APPLY for this
    // plan/date (pending_approval + already-enrolled, per OCCUPIED_STATUSES),
    // not just the number admin approves - every application always needs
    // admin review, there is no auto-enroll path any more. A rejected
    // application frees its slot immediately since "rejected" isn't in
    // OCCUPIED_STATUSES, letting another driver apply in its place.
    const hasSlot = await hasCapacity(plan.id, date, plan, tx);
    if (!hasSlot) throw new Error("This plan has reached its application limit for this date");

    const enrollment = await tx.daily_driver_enrollment.create({
      data: {
        rider_id: Number(riderId),
        plan_id: plan.id,
        enrollment_date: date,
        status: "pending_approval",
        auto_enroll_id: autoEnrollId ? Number(autoEnrollId) : null,
      },
    });
    return { enrollment, plan };
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

/**
 * Pending requests enriched with rider identity + a quick order-history
 * summary (total/completed/cancelled counts), so admin can review a driver's
 * track record before approving them into a Daily Driver slot.
 */
async function listPendingRequests(planId = null) {
  const rows = await prisma.daily_driver_enrollment.findMany({
    where: { status: "pending_approval", ...(planId ? { plan_id: Number(planId) } : {}) },
    include: { plan: true },
    orderBy: { created_at: "asc" },
  });
  if (!rows.length) return rows;

  const riderIds = [...new Set(rows.map((r) => r.rider_id))];
  const [riders, orderCounts] = await Promise.all([
    prisma.tbl_rider.findMany({
      where: { id: { in: riderIds } },
      select: { id: true, first_name: true, last_name: true, full_name: true, fmobile: true, vehicle: true },
    }),
    prisma.pkg_order.groupBy({ by: ["rid", "o_status"], where: { rid: { in: riderIds } }, _count: { id: true } }),
  ]);

  const riderMap = new Map(riders.map((r) => [r.id, r]));
  const statsMap = new Map();
  for (const row of orderCounts) {
    const stats = statsMap.get(row.rid) || { total: 0, completed: 0, cancelled: 0 };
    stats.total += row._count.id;
    if (row.o_status === "Completed") stats.completed += row._count.id;
    if (row.o_status === "Cancelled") stats.cancelled += row._count.id;
    statsMap.set(row.rid, stats);
  }

  return rows.map((r) => {
    const rider = riderMap.get(r.rider_id);
    return {
      ...r,
      rider_name: rider ? rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim() || `Driver #${r.rider_id}` : `Driver #${r.rider_id}`,
      rider_mobile: rider ? rider.fmobile : null,
      rider_vehicle: rider ? rider.vehicle : null,
      rider_order_stats: statsMap.get(r.rider_id) || { total: 0, completed: 0, cancelled: 0 },
    };
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
 * tomorrow's enrollment as a pending_approval request - auto-enroll never
 * bypasses either the admin capacity limit or the admin approval step, per
 * spec section 4.
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
      const { enrollment } = await enroll({
        riderId: candidate.rider_id,
        planId: candidate.plan_id,
        enrollmentDate: targetDate,
        autoEnrollId: candidate.id,
      });
      results.push({ riderId: candidate.rider_id, enrollmentId: enrollment.id });
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

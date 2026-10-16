const prisma = require("../config/db");
const rules = require("./nextDayRules");

// Admin "Daily Driver" filter on the manual-assign pickers (Next Day, Scheduled and Booking Guarantee orders):
// the Daily Drivers an admin can sensibly give this order to, nearest pickup first.

const ACTIVE_TRIP_STATUSES = [1, 2, 3]; // accepted / at pickup / on route
const SCHEDULED_BOOKING_TYPE = 2;
const NEXT_DAY_BOOKING_TYPE = 3;

// This DB stores true UTC and shows it +330 min; "today" for a Daily enrollment follows the same convention
// as dailyDriverPlanService.
const istDateOnly = () => new Date(new Date(Date.now() + 330 * 60 * 1000).toISOString().split("T")[0]);

/** Date the Daily Driver must be enrolled for: the trip day for scheduled / next-day orders, otherwise today. */
function tripDateFor(order) {
  const type = Number(order.booking_type);
  if (type === SCHEDULED_BOOKING_TYPE || type === NEXT_DAY_BOOKING_TYPE) {
    return new Date(`${String(order.schedule_date_time || "").slice(0, 10)}T00:00:00.000Z`);
  }
  return istDateOnly();
}

/**
 * The filter applies to the three order kinds the manager named: scheduled, next-day and an order
 * held by Booking Guarantee (an open guarantee case).
 */
async function isApplicable(order) {
  const type = Number(order.booking_type);
  if (type === SCHEDULED_BOOKING_TYPE || type === NEXT_DAY_BOOKING_TYPE) return true;
  const guaranteeCase = await prisma.booking_guarantee_case.findFirst({
    where: { order_id: order.id, closed_at: null },
    select: { id: true },
  });
  return Boolean(guaranteeCase);
}

/**
 * Daily Drivers who are enrolled for the trip date, approved, on the order's vehicle (and city), and not on an
 * active trip right now. Unrelated drivers are never returned, so the admin only sees who can really take it.
 */
async function listAvailableDailyDrivers(order) {
  const tripDate = tripDateFor(order);
  if (Number.isNaN(tripDate.getTime())) return [];

  const enrolled = await prisma.daily_driver_enrollment.findMany({
    where: { enrollment_date: tripDate, status: { in: ["enrolled", "active"] } },
    select: { rider_id: true },
  });
  const ids = [...new Set(enrolled.map((e) => Number(e.rider_id)))];
  if (!ids.length) return [];

  const riders = await prisma.tbl_rider.findMany({
    where: {
      id: { in: ids },
      status: 1,
      vehicle: order.category,
      ...(order.city_id ? { city_id: Number(order.city_id) } : {}),
    },
    select: {
      id: true, full_name: true, first_name: true, last_name: true, fmobile: true, vehicle_no: true,
      vehicle: true, wallet_balance: true, rlats: true, rlongs: true, a_status: true,
    },
  });
  if (!riders.length) return [];

  const busy = await prisma.pkg_order.findMany({
    where: { rid: { in: riders.map((r) => r.id) }, order_status: { in: ACTIVE_TRIP_STATUSES } },
    select: { rid: true },
  });
  const busyIds = new Set(busy.map((o) => Number(o.rid)));
  return rules.rankByPickupDistance(order, riders.filter((r) => !busyIds.has(Number(r.id))));
}

module.exports = { listAvailableDailyDrivers, isApplicable, tripDateFor };

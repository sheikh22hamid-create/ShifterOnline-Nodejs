const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { istNow } = require("../utils/istTime");
const pricingEngine = require("./pricingEngine");
const walletNotifier = require("./walletNotifier");
const customerInbox = require("./customerInbox");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");
const rules = require("./freeBookingRules");

const { STATUS, OUTCOME, REASON, OPEN_STATUSES } = rules;

const asDate = (yyyyMmDd) => new Date(`${yyyyMmDd}T00:00:00.000Z`);

function getCitySetting(cityId) {
  return prisma.free_booking_setting.findUnique({ where: { city_id: Number(cityId) } });
}

/** Riders in the city's pool whose row is active and valid on `todayStr` (IST date). */
async function poolRiderIds(cityId, todayStr = rules.istDateString()) {
  const rows = await prisma.free_booking_pool.findMany({
    where: {
      city_id: Number(cityId),
      active: true,
      valid_from: { lte: asDate(todayStr) },
      valid_to: { gte: asDate(todayStr) },
    },
    select: { rider_id: true },
  });
  return [...new Set(rows.map((r) => Number(r.rider_id)))];
}

// A free booking is "open" while it is waiting for a driver / trip / payment. A CONFIRMED row
// whose order was cancelled does not count, so a cancelled trip never blocks the next one.
async function findOpenBooking(userId) {
  const rows = await prisma.$queryRaw`
    SELECT f.id
    FROM free_booking_order f
    JOIN pkg_order o ON o.id = f.order_id
    WHERE f.user_id = ${Number(userId)}
      AND (
        f.status = ${STATUS.REWARD_PENDING}
        OR (f.status = ${STATUS.CONFIRMED} AND o.o_status <> 'Cancelled')
      )
    LIMIT 1
  `;
  return rows[0] || null;
}

// Same driver conditions as dispatchManager.selectEligibleDrivers (online, approved, fresh
// location, right vehicle, within the order radius, not on another trip), limited to the pool.
async function findPoolDriver({ uid, cityId, category, plat, plong, radiusKm, todayStr }) {
  const freshSince = new Date(Date.now() - RIDER_LOCATION_FRESHNESS_MS);
  const rows = await prisma.$queryRaw`
    SELECT
      r.id AS rider_id,
      (6371 * ACOS(
        LEAST(1, GREATEST(-1,
          COS(RADIANS(${Number(plat)})) * COS(RADIANS(CAST(r.rlats AS DECIMAL(10,6)))) *
          COS(RADIANS(CAST(r.rlongs AS DECIMAL(10,6))) - RADIANS(${Number(plong)})) +
          SIN(RADIANS(${Number(plat)})) * SIN(RADIANS(CAST(r.rlats AS DECIMAL(10,6))))
        ))
      )) AS distance_km
    FROM tbl_rider r
    JOIN free_booking_pool p ON p.rider_id = r.id
    WHERE p.city_id = ${Number(cityId)}
      AND p.active = 1
      AND p.valid_from <= ${todayStr}
      AND p.valid_to >= ${todayStr}
      AND r.a_status = 1
      AND r.status = 1
      AND r.vehicle = ${category}
      AND r.rlats IS NOT NULL AND r.rlats != ''
      AND r.rlongs IS NOT NULL AND r.rlongs != ''
      AND r.rloc_updated_at IS NOT NULL AND r.rloc_updated_at >= ${freshSince}
      AND r.id NOT IN (SELECT rider_id FROM tbl_user_blocked_driver WHERE user_id = ${Number(uid)})
      AND r.id NOT IN (
        SELECT rid FROM pkg_order WHERE rid > 0 AND o_status NOT IN ('Completed', 'Cancelled')
      )
    HAVING distance_km <= ${Number(radiusKm)}
    ORDER BY distance_km ASC
    LIMIT 1
  `;
  return rows[0] || null;
}

async function checkEligibility({ uid, plat, plong, category, radiusKm, cityId, bookingType = 1 }) {
  const userId = Number(uid);
  const user = await prisma.tbl_user.findUnique({
    where: { id: userId },
    select: { city_id: true, free_booking_locked: true },
  });
  const plan = user ? await pricingEngine.getActiveCustomerPlan(userId) : null;
  const city = Number(cityId) || (user?.city_id ? Number(user.city_id) : null);
  const setting = city ? await getCitySetting(city) : null;
  const premium = Boolean(plan);
  // Scheduled / next-day bookings are not dispatched at booking time: never free bookings.
  const instant = Number(bookingType) === 1;
  const cityOpen = rules.isCityOfferOpen(setting, new Date()) && instant;
  const locked = Boolean(user?.free_booking_locked);

  let openBooking = false;
  let pool = null;
  if (premium && cityOpen && !locked) {
    openBooking = Boolean(await findOpenBooking(userId));
    if (!openBooking) {
      pool = await findPoolDriver({
        uid: userId, cityId: city, category, plat, plong, radiusKm, todayStr: rules.istDateString(),
      });
    }
  }

  const outcome = rules.decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound: Boolean(pool) });
  return { outcome, cityId: city, planId: plan?.planId ?? null, poolRiderId: pool ? Number(pool.rider_id) : null };
}

async function createForOrder({ order, check, radiusKm }) {
  let planAmount = null;
  if (check.planId) {
    const plan = await prisma.tbl_premium_plan
      .findUnique({ where: { id: check.planId }, select: { price: true } })
      .catch(() => null);
    planAmount = plan?.price ?? null;
  }
  return prisma.free_booking_order.create({
    data: {
      order_id: Number(order.id),
      user_id: Number(order.uid),
      city_id: check.cityId ?? null,
      status: STATUS.CONFIRMED,
      search_radius_km: Math.round(Number(radiusKm)) || null,
      premium_plan_id: check.planId ?? null,
      premium_plan_amount: planAmount,
    },
  });
}

/** Pool rider ids a free-booking order may be offered to; null = normal order, no filter. Never throws. */
async function getDispatchPoolFilter(order) {
  try {
    const row = await prisma.free_booking_order.findUnique({
      where: { order_id: Number(order.id) },
      select: { status: true, city_id: true },
    });
    if (!row || row.status !== STATUS.CONFIRMED) return null;
    return await poolRiderIds(row.city_id);
  } catch (err) {
    logger.error(`freeBookingService.getDispatchPoolFilter failed for order ${order?.id}:`, err);
    return null;
  }
}

async function getUserStatus(uid) {
  const userId = Number(uid);
  const user = await prisma.tbl_user.findUnique({
    where: { id: userId },
    select: { city_id: true, free_booking_locked: true, free_booking_just_unlocked: true },
  });
  const plan = user ? await pricingEngine.getActiveCustomerPlan(userId) : null;
  const setting = user?.city_id ? await getCitySetting(user.city_id) : null;
  const premium = Boolean(plan);
  const cityOpen = rules.isCityOfferOpen(setting, new Date());
  const locked = Boolean(user?.free_booking_locked);
  const openBooking = premium && cityOpen && !locked ? Boolean(await findOpenBooking(userId)) : false;

  const outcome = rules.decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound: true });
  if (outcome !== OUTCOME.ELIGIBLE) return { state: outcome, message: rules.OUTCOME_MESSAGE[outcome] };
  if (user.free_booking_just_unlocked) {
    await prisma.tbl_user.updateMany({ where: { id: userId, free_booking_just_unlocked: true }, data: { free_booking_just_unlocked: false } });
    return { state: "unlocked", message: "Free Booking unlocked! Your next trip with a free vehicle can be credited back." };
  }
  return { state: "available", message: "Free Booking available. Book with a free vehicle and get the trip amount back in your wallet." };
}

module.exports = {
  getCitySetting, poolRiderIds, findOpenBooking, findPoolDriver,
  checkEligibility, createForOrder, getDispatchPoolFilter, getUserStatus,
};

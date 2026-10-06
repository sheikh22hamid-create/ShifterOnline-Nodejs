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

const notifyUser = (userId, title, description) =>
  customerInbox.saveCustomerNotification(userId, title, description);

// Atomic: only an open row flips, so a race between two callers voids once.
async function voidRow(rowId, reason) {
  const res = await prisma.free_booking_order.updateMany({
    where: { id: rowId, status: { in: OPEN_STATUSES } },
    data: { status: STATUS.NOT_ELIGIBLE, not_eligible_reason: reason },
  });
  return res.count === 1;
}

async function voidOrder(freeBookingOrderId, reason = REASON.ADMIN_VOID) {
  return voidRow(Number(freeBookingOrderId), reason);
}

/** A driver accepted the order: remember who, and void the booking if they are not a pool driver. */
async function recordAcceptance(orderId, riderId) {
  const row = await prisma.free_booking_order.findUnique({ where: { order_id: Number(orderId) } });
  if (!row || row.status !== STATUS.CONFIRMED) return;
  const ids = await poolRiderIds(row.city_id);
  if (ids.includes(Number(riderId))) {
    await prisma.free_booking_order.update({ where: { id: row.id }, data: { pool_rider_id: Number(riderId), accepted_in_pool: true } });
    return;
  }
  if (await voidRow(row.id, REASON.VEHICLE_CHANGED)) {
    await notifyUser(
      row.user_id,
      "Free Booking not applicable",
      "A paid vehicle accepted your booking, so Free Booking will not apply to this trip and no wallet refund will be given."
    );
  }
}

/** Dispatch ran out of pool drivers: continue as a normal booking. True if this call flipped the row. */
async function fallbackToNormalDispatch(orderId) {
  const res = await prisma.free_booking_order.updateMany({
    where: { order_id: Number(orderId), status: STATUS.CONFIRMED },
    data: { status: STATUS.NOT_ELIGIBLE, not_eligible_reason: REASON.POOL_UNAVAILABLE },
  });
  if (res.count !== 1) return false;
  // The flip is atomic and final, so the caller must always learn it happened: a failed
  // notification must not make dispatch cancel the order as "No driver found".
  try {
    const row = await prisma.free_booking_order.findUnique({ where: { order_id: Number(orderId) }, select: { user_id: true } });
    if (row) {
      await notifyUser(
        row.user_id,
        "Free Booking not available",
        "No free vehicle could take your booking, so it continues as a normal booking. No wallet refund will be given for this trip."
      );
    }
  } catch (err) {
    logger.error(`freeBookingService.fallbackToNormalDispatch: notify failed for order ${orderId}:`, err);
  }
  return true;
}

/**
 * Credits the booker once the trip is completed and its payment is settled. Safe to call from any
 * trigger (completion, every settlement transition): it is idempotent, takes the order and user
 * locks, and never throws.
 */
async function tryCredit(orderId) {
  const id = Number(orderId);
  const notifications = [];
  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT id, user_id FROM free_booking_order WHERE order_id = ${id} FOR UPDATE`;
      if (!locked[0]) return { credited: false, action: "skip" };
      const row = await tx.free_booking_order.findUnique({ where: { id: locked[0].id } });
      if (!row || !OPEN_STATUSES.includes(row.status)) return { credited: false, action: "skip" };

      const userRows = await tx.$queryRaw`SELECT free_booking_locked FROM tbl_user WHERE id = ${row.user_id} FOR UPDATE`;
      const userLocked = Boolean(Number(userRows[0]?.free_booking_locked));
      const order = await tx.pkg_order.findUnique({ where: { id }, select: { o_status: true, rid: true } });
      // order_settlement may not exist on a database that has not run the settlement migration.
      let settlement = null;
      try {
        settlement = await tx.order_settlement.findUnique({ where: { order_id: id }, select: { status: true } });
      } catch (err) {
        // Only "table missing" means "no settlement"; anything else must not fail open on the money path.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2021")) throw err;
        logger.warn(`freeBookingService.tryCredit: order_settlement table missing, treating order ${id} as unsettled-free: ${err.message}`);
      }

      const decision = rules.decideCredit({ row, order, userLocked, paymentSettled: rules.isPaymentSettled(settlement), settlementStatus: settlement?.status });
      if (decision.action === "skip" || decision.action === "wait") return { credited: false, action: decision.action };
      if (decision.action === "void") {
        await tx.free_booking_order.update({
          where: { id: row.id },
          data: { status: STATUS.NOT_ELIGIBLE, not_eligible_reason: decision.reason },
        });
        return { credited: false, action: "void" };
      }

      const key = `free_booking_credit:${id}`;
      const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
      if (duplicate) return { credited: false, action: "duplicate" };

      const remark = `Free Booking refund for order #${id}`;
      await tx.tbl_user.update({
        where: { id: row.user_id },
        data: {
          wallet: { increment: decision.amount },
          free_booking_locked: true,
          free_booking_locked_at: new Date(),
          free_booking_just_unlocked: false,
        },
      });
      const history = await tx.tbl_wallet_history.create({
        data: {
          user_id: row.user_id, amount: decision.amount, type: "credit", remark,
          wallet_type: "user", order_id: id, payment_id: key, created_at: istNow(),
        },
      });
      await tx.free_booking_order.update({
        where: { id: row.id },
        data: {
          status: STATUS.REWARD_CREDITED, credit_amount: decision.amount,
          wallet_history_id: history.id, credited_at: new Date(),
        },
      });
      notifications.push({ userId: row.user_id, amount: decision.amount, remark });
      return { credited: true, action: "credit" };
    });

    for (const n of notifications) {
      Promise.resolve(walletNotifier.notifyCustomerWalletTransaction(n.userId, { type: "credit", amount: n.amount, remark: n.remark }))
        .catch((err) => logger.error(`freeBookingService: wallet notify failed for user ${n.userId}:`, err));
    }
    return result;
  } catch (err) {
    logger.error(`freeBookingService.tryCredit failed for order ${id}:`, err);
    return { credited: false, action: "error" };
  }
}

/** Trip completed: record the final invoice total and try to credit straight away. */
async function markCompleted({ orderId, finalTotal }) {
  const res = await prisma.free_booking_order.updateMany({
    where: { order_id: Number(orderId), status: STATUS.CONFIRMED },
    data: { status: STATUS.REWARD_PENDING, actual_fare: rules.round2(finalTotal), completed_at: new Date() },
  });
  if (res.count !== 1) return { credited: false };
  return tryCredit(orderId);
}

/** A referral by this user just became successful. True if a locked user was unlocked. */
async function unlockForReferral(userId) {
  const res = await prisma.tbl_user.updateMany({
    where: { id: Number(userId), free_booking_locked: true },
    data: { free_booking_locked: false, free_booking_just_unlocked: true },
  });
  return res.count === 1;
}

async function setUserLock(userId, locked) {
  await prisma.tbl_user.update({
    where: { id: Number(userId) },
    data: locked
      ? { free_booking_locked: true, free_booking_locked_at: new Date(), free_booking_just_unlocked: false }
      : { free_booking_locked: false, free_booking_just_unlocked: false },
  });
}

module.exports = {
  getCitySetting, poolRiderIds, findOpenBooking, findPoolDriver,
  checkEligibility, createForOrder, getDispatchPoolFilter, getUserStatus,
  recordAcceptance, markCompleted, tryCredit, fallbackToNormalDispatch,
  unlockForReferral, setUserLock, voidOrder,
};

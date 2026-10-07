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

// Spec section 10: one line per status transition, written after the write succeeded.
const logTransition = (orderId, from, to, reason, amount) =>
  logger.info(`free-booking order=${orderId} ${from}->${to} reason=${reason ?? "-"} amount=${amount ?? "-"}`);

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
    SELECT f.id, f.order_id, o.o_status
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

// A subset of selectEligibleDrivers' conditions (online, approved, fresh location, right vehicle,
// within the order radius, not on another trip), limited to the pool; the fallback at cascade
// exhaustion covers any mismatch.
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

// Self-heal: an open row whose credit never ran (e.g. a transient error right after completion, with
// no settlement transition to retry it) is retried once here. tryCredit is idempotent and never
// throws. Returns the open row that remains after the retry (null when it settled or was voided),
// and whether the user was locked by a credit that just landed. Called through module.exports so
// tests can observe the retry.
async function findOpenBookingAfterRetry(userId) {
  let open = await findOpenBooking(userId);
  if (!open) return { open: null, locked: false };
  // A trip still in progress has nothing to credit: skip the two FOR UPDATE locks tryCredit takes.
  if (open.o_status !== "Completed") return { open, locked: false };
  await module.exports.tryCredit(open.order_id);
  open = await findOpenBooking(userId);
  if (open) return { open, locked: false };
  const fresh = await prisma.tbl_user.findUnique({ where: { id: Number(userId) }, select: { free_booking_locked: true } });
  return { open: null, locked: Boolean(fresh?.free_booking_locked) };
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
  let locked = Boolean(user?.free_booking_locked);

  let openBooking = false;
  let pool = null;
  if (premium && cityOpen && !locked) {
    const healed = await findOpenBookingAfterRetry(userId);
    openBooking = Boolean(healed.open);
    locked = healed.locked;
    if (!openBooking && !locked) {
      pool = await findPoolDriver({
        uid: userId, cityId: city, category, plat, plong, radiusKm, todayStr: rules.istDateString(),
      });
    }
  }

  const outcome = rules.decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound: Boolean(pool) });
  return {
    outcome, cityId: city, planId: plan?.planId ?? null, poolRiderId: pool ? Number(pool.rider_id) : null,
    message: rules.outcomeMessage(outcome, rules.referralsRequiredOf(setting)),
  };
}

async function createForOrder({ order, check, radiusKm }) {
  let planAmount = null;
  if (check.planId) {
    const plan = await prisma.tbl_premium_plan
      .findUnique({ where: { id: check.planId }, select: { price: true } })
      .catch(() => null);
    planAmount = plan?.price ?? null;
  }
  const created = await prisma.free_booking_order.create({
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
  logTransition(order.id, "create", STATUS.CONFIRMED);
  return created;
}

/** Pool rider ids a free-booking order may be offered to; null = normal order, no filter. Never throws. */
async function getDispatchPoolFilter(order) {
  try {
    const row = await prisma.free_booking_order.findUnique({
      where: { order_id: Number(order.id) },
      select: { status: true, city_id: true },
    });
    if (!row || row.status !== STATUS.CONFIRMED) return null;
    const ids = await poolRiderIds(row.city_id);
    if (!ids || ids.length === 0) {
      await fallbackToNormalDispatch(order.id);
      return null;
    }
    return ids;
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
  let locked = Boolean(user?.free_booking_locked);
  let openBooking = false;
  if (premium && cityOpen && !locked) {
    const healed = await findOpenBookingAfterRetry(userId);
    openBooking = Boolean(healed.open);
    locked = healed.locked;
  }

  // Non-premium users only hear about the offer (so the app can upsell Premium) while it is live in their city.
  if (!premium && !cityOpen) return { state: OUTCOME.OFFER_OFF, message: rules.OUTCOME_MESSAGE[OUTCOME.OFFER_OFF] };
  const outcome = rules.decideOutcome({ premium, cityOpen, locked, openBooking, poolVehicleFound: true });
  if (outcome !== OUTCOME.ELIGIBLE) return { state: outcome, message: rules.outcomeMessage(outcome, rules.referralsRequiredOf(setting)) };
  if (user.free_booking_just_unlocked) {
    await prisma.tbl_user.updateMany({ where: { id: userId, free_booking_just_unlocked: true }, data: { free_booking_just_unlocked: false } });
    return { state: "unlocked", message: "Free Ride Chance unlocked! Your next trip with a free vehicle can be credited back." };
  }
  return { state: "available", message: "Free Ride Chance active. Book your ride and if a free pool vehicle is assigned, get 100% cashback in your wallet." };
}

const notifyUser = (userId, title, description) =>
  customerInbox.saveCustomerNotification(userId, title, description);

// Atomic: only an open row flips, so a race between two callers voids once.
// orderId is only used to label the log line; when unknown it is looked up after the write.
async function voidRow(rowId, reason, orderId) {
  const res = await prisma.free_booking_order.updateMany({
    where: { id: rowId, status: { in: OPEN_STATUSES } },
    data: { status: STATUS.NOT_ELIGIBLE, not_eligible_reason: reason },
  });
  if (res.count !== 1) return false;
  let label = orderId;
  if (label == null) {
    try {
      label = (await prisma.free_booking_order.findUnique({ where: { id: rowId }, select: { order_id: true } }))?.order_id;
    } catch (err) {
      logger.warn(`freeBookingService.voidRow: order lookup for log failed (row ${rowId}): ${err.message}`);
    }
  }
  logTransition(label ?? `row#${rowId}`, "open", STATUS.NOT_ELIGIBLE, reason);
  return true;
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
    // Conditional write: a concurrent void between the read above and here must not be overwritten.
    const res = await prisma.free_booking_order.updateMany({
      where: { id: row.id, status: STATUS.CONFIRMED },
      data: { pool_rider_id: Number(riderId), accepted_in_pool: true },
    });
    if (res.count !== 1) return;
    logger.info(`free-booking order=${orderId} ${STATUS.CONFIRMED}->${STATUS.CONFIRMED} reason=pool_driver_accepted amount=-`);
    return;
  }
  if (await voidRow(row.id, REASON.VEHICLE_CHANGED, Number(orderId))) {
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
  logTransition(orderId, STATUS.CONFIRMED, STATUS.NOT_ELIGIBLE, REASON.POOL_UNAVAILABLE);
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
  let fromStatus = null;
  let voidReason = null;
  let creditAmount = null;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw`SELECT id, user_id FROM free_booking_order WHERE order_id = ${id} FOR UPDATE`;
      if (!locked[0]) return { credited: false, action: "skip" };
      const row = await tx.free_booking_order.findUnique({ where: { id: locked[0].id } });
      if (!row || !OPEN_STATUSES.includes(row.status)) return { credited: false, action: "skip" };
      fromStatus = row.status;

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
        voidReason = decision.reason;
        return { credited: false, action: "void" };
      }

      const key = `free_booking_credit:${id}`;
      const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
      if (duplicate) {
        // The wallet was already credited but the row never flipped (e.g. a crash between the two
        // writes): repair the row only. The wallet and the user lock are not touched again.
        await tx.free_booking_order.update({
          where: { id: row.id },
          data: {
            status: STATUS.REWARD_CREDITED, credit_amount: Number(duplicate.amount),
            wallet_history_id: duplicate.id, credited_at: new Date(),
          },
        });
        return { credited: false, action: "duplicate" };
      }

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
      creditAmount = decision.amount;
      return { credited: true, action: "credit" };
    });

    if (result.action === "void") logTransition(id, fromStatus, STATUS.NOT_ELIGIBLE, voidReason);
    if (result.action === "credit") logTransition(id, fromStatus, STATUS.REWARD_CREDITED, null, creditAmount);

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
  // round2(undefined) would be 0 and void the booking as zero_fare: refuse a non-numeric total instead.
  if (finalTotal == null || finalTotal === "" || typeof finalTotal === "boolean" || !Number.isFinite(Number(finalTotal))) {
    logger.error(`freeBookingService.markCompleted: invalid finalTotal for order ${orderId}: ${String(finalTotal)}`);
    return { credited: false };
  }
  const res = await prisma.free_booking_order.updateMany({
    where: { order_id: Number(orderId), status: STATUS.CONFIRMED },
    data: { status: STATUS.REWARD_PENDING, actual_fare: rules.round2(finalTotal), completed_at: new Date() },
  });
  if (res.count !== 1) return { credited: false };
  logTransition(orderId, STATUS.CONFIRMED, STATUS.REWARD_PENDING, null, rules.round2(finalTotal));
  return tryCredit(orderId);
}

/**
 * A cancelled trip leaves its open free-booking row CONFIRMED (cancellation does not go through this
 * service). Flip those rows to NOT_ELIGIBLE (cancelled) so the audit list is accurate. Returns the
 * number of rows changed. Never throws.
 */
async function reapCancelled() {
  try {
    const count = await prisma.$executeRaw`
      UPDATE free_booking_order f JOIN pkg_order o ON o.id = f.order_id
      SET f.status = ${STATUS.NOT_ELIGIBLE}, f.not_eligible_reason = ${REASON.CANCELLED}
      WHERE f.status IN (${STATUS.CONFIRMED}, ${STATUS.REWARD_PENDING}) AND o.o_status = 'Cancelled'
    `;
    if (count > 0) logger.info(`free-booking orders=${count} open->${STATUS.NOT_ELIGIBLE} reason=${REASON.CANCELLED} amount=-`);
    return count;
  } catch (err) {
    logger.error("freeBookingService.reapCancelled failed:", err);
    return 0;
  }
}

/**
 * A referral by this user just became successful. Unlocks a locked user once they have the city's
 * required number of successful referrals made since the lock (earlier ones never count).
 * True if the user was unlocked.
 */
async function unlockForReferral(userId) {
  const id = Number(userId);
  const user = await prisma.tbl_user.findUnique({
    where: { id },
    select: { city_id: true, free_booking_locked: true, free_booking_locked_at: true },
  });
  if (!user?.free_booking_locked) return false;
  const required = rules.referralsRequiredOf(user.city_id ? await getCitySetting(user.city_id) : null);
  if (required > 1) {
    const done = await prisma.tbl_referral.count({
      where: {
        referrer_id: id,
        referrer_type: "USER",
        status: "completed",
        ...(user.free_booking_locked_at ? { verified_at: { gte: user.free_booking_locked_at } } : {}),
      },
    });
    if (done < required) return false;
  }
  const res = await prisma.tbl_user.updateMany({
    where: { id, free_booking_locked: true },
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

async function getViewForOrder(orderId) {
  try {
    const row = await prisma.free_booking_order.findUnique({
      where: { order_id: Number(orderId) },
      select: {
        id: true,
        status: true,
        accepted_in_pool: true,
        actual_fare: true,
        credit_amount: true,
        not_eligible_reason: true,
      },
    });
    if (!row) {
      return {
        is_free: false,
        status: "STANDARD",
        badge_text: "Standard Ride",
        message: "Standard booking",
      };
    }
    const isFree = [STATUS.CONFIRMED, STATUS.REWARD_PENDING, STATUS.REWARD_CREDITED].includes(row.status) && Boolean(row.accepted_in_pool);
    let badgeText = "Standard Ride";
    let message = "Fulfilled by standard vehicle";
    if (isFree) {
      if (row.status === STATUS.CONFIRMED) {
        badgeText = "Free Ride Active 🎁";
        message = "Fulfilled by Free Pool Vehicle. 100% fare will be credited to your Shifter wallet upon completion.";
      } else if (row.status === STATUS.REWARD_PENDING) {
        badgeText = "Free Ride - Reward Pending 🎁";
        message = "Trip completed. 100% fare will be credited to your wallet once payment is settled.";
      } else if (row.status === STATUS.REWARD_CREDITED) {
        badgeText = "Free Ride - 100% Credited 🎉";
        message = `₹${row.credit_amount || 0} credited to your Shifter wallet!`;
      }
    } else if (row.status === STATUS.NOT_ELIGIBLE && row.not_eligible_reason === REASON.POOL_UNAVAILABLE) {
      badgeText = "Standard Ride";
      message = "No free pool vehicle was available; booking continues as a standard ride.";
    }
    return {
      is_free: isFree,
      status: row.status,
      badge_text: badgeText,
      message,
      credit_amount: row.credit_amount,
    };
  } catch (err) {
    logger.error(`freeBookingService.getViewForOrder failed for order ${orderId}:`, err);
    return { is_free: false, status: "STANDARD", badge_text: "Standard Ride", message: "" };
  }
}

module.exports = {
  getCitySetting, poolRiderIds, findOpenBooking, findPoolDriver,
  checkEligibility, createForOrder, getDispatchPoolFilter, getUserStatus,
  recordAcceptance, markCompleted, tryCredit, fallbackToNormalDispatch,
  unlockForReferral, setUserLock, voidOrder, reapCancelled, getViewForOrder,
};

const prisma = require("../config/db");
const logger = require("../utils/logger");
const adminSocket = require("../sockets/adminSocket");
const pricingEngine = require("./pricingEngine");
const settings = require("./nextDaySettings");
const rules = require("./nextDayRules");

// dispatchManager requires many modules; load it lazily like bookingGuaranteeService does.
const dispatchManager = () => require("./dispatchManager");

const { OFFER, STAGE, DAILY_DRIVER_SHARE } = rules;
const ALERT = "NEXT-DAY ORDER";
const LIVE_ALERT_THROTTLE_MS = 10 * 60 * 1000;
const STUCK_OFFER_GRACE_MS = 30 * 1000;
const liveFailAlertAt = new Map(); // orderId -> last go-live-failed alert time (ms)
const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const isArranging = (order) =>
  Boolean(order) && Number(order.booking_type) === 3 && order.next_day_stage === STAGE.ARRANGING
  && Number(order.rid) === 0 && order.o_status === "Pending";

/** Daily Drivers who can still be offered this order, nearest pickup first. */
async function listAvailableDailyDrivers(order) {
  const tripDate = new Date(`${String(order.schedule_date_time || "").slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(tripDate.getTime())) return [];
  const [enrolled, offered] = await Promise.all([
    prisma.daily_driver_enrollment.findMany({
      where: { enrollment_date: tripDate, status: { in: ["enrolled", "active"] } },
      select: { rider_id: true },
    }),
    prisma.next_day_daily_offer.findMany({ where: { order_id: order.id }, select: { rider_id: true } }),
  ]);
  const already = new Set(offered.map((o) => Number(o.rider_id)));
  const ids = [...new Set(enrolled.map((e) => Number(e.rider_id)))].filter((id) => !already.has(id));
  if (!ids.length) return [];
  const riders = await prisma.tbl_rider.findMany({
    where: { id: { in: ids }, status: 1, vehicle: order.category },
    select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, vehicle_no: true, rlats: true, rlongs: true, a_status: true },
  });
  return rules.rankByPickupDistance(order, riders);
}

async function offerToDriver({ order, riderId, adminId = null, now = new Date() }) {
  if (!isArranging(order)) throw httpError(409, "This order is not waiting for a Daily Driver");
  const open = await prisma.next_day_daily_offer.findFirst({ where: { order_id: order.id, status: OFFER.OFFERED } });
  if (open) throw httpError(409, "An offer for this order is already open");
  const available = await listAvailableDailyDrivers(order);
  if (!available.some((r) => Number(r.id) === Number(riderId))) throw httpError(400, "This driver is not an available Daily Driver for this order");

  const seconds = await settings.getOfferSeconds();
  const expiresAt = new Date(now.getTime() + seconds * 1000);
  let row;
  try {
    row = await prisma.next_day_daily_offer.create({
      data: { order_id: order.id, rider_id: Number(riderId), status: OFFER.OFFERED, offered_by_admin: adminId, offered_at: now, expires_at: expiresAt },
    });
  } catch (err) {
    if (err && err.code === "P2002") throw httpError(409, "This driver was already offered this order");
    throw err;
  }

  let sent;
  try {
    const { pkg, discount } = await pricingEngine.getFirstTierPricingContext(order);
    sent = await dispatchManager().offerToInterestedRiders(order, [Number(riderId)], pkg, discount, {
      ttlMs: seconds * 1000,
      popupMs: seconds * 1000,
      requireOnline: false,
      fareScale: DAILY_DRIVER_SHARE,
      payloadExtras: { next_day_daily_offer: "1", schedule_date_time: String(order.schedule_date_time || "") },
    });
  } catch (err) {
    // Never leave a ghost 'offered' row behind a failed send.
    try { await prisma.next_day_daily_offer.update({ where: { id: row.id }, data: { status: OFFER.CANCELLED, responded_at: now } }); }
    catch (e2) { logger.error(`nextDayOffer: could not cancel failed offer ${row.id}:`, e2); }
    throw err;
  }
  if (!(sent?.offeredRiderIds || []).map(Number).includes(Number(riderId))) {
    await prisma.next_day_daily_offer.update({ where: { id: row.id }, data: { status: OFFER.CANCELLED, responded_at: now } });
    throw httpError(409, "Could not reach this driver right now");
  }
  return row;
}

/** Offer to the nearest remaining Daily Driver; admin is alerted when nobody is left. */
async function cascade(orderId, now = new Date()) {
  const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  if (!isArranging(order)) return "skipped";
  const open = await prisma.next_day_daily_offer.findFirst({ where: { order_id: order.id, status: OFFER.OFFERED } });
  if (open) return "skipped";

  const available = await listAvailableDailyDrivers(order);
  for (const rider of available) {
    try {
      await offerToDriver({ order, riderId: rider.id, adminId: null, now });
      return "offered";
    } catch (err) {
      if (err.statusCode === 409 || err.statusCode === 400) continue; // unreachable / raced: try the next one
      throw err;
    }
  }
  try {
    adminSocket.notifyDispatchAlert(order.id, order.city_id, `${ALERT} – NO DAILY DRIVER LEFT, ARRANGE MANUALLY`, { kind: "next_day_none_left" });
  } catch (err) {
    logger.error(`nextDayOffer: none-left alert failed for order ${order.id}:`, err);
  }
  return "none_left";
}

async function closeOffer(offer, status, now) {
  const res = await prisma.next_day_daily_offer.updateMany({
    where: { id: offer.id, status: OFFER.OFFERED }, data: { status, responded_at: now },
  });
  return res.count === 1;
}

/** Flips the rider's request row so the popup can no longer be accepted. Returns how many rows changed. */
async function closeRequest(offer) {
  const res = await prisma.tbl_order_requests.updateMany({
    where: { order_id: offer.order_id, rider_id: offer.rider_id, status: "sent" }, data: { status: "timeout" },
  });
  return res?.count ?? 0;
}

async function onRejected(orderId, riderId, now = new Date()) {
  const res = await prisma.next_day_daily_offer.updateMany({
    where: { order_id: Number(orderId), rider_id: Number(riderId), status: OFFER.OFFERED },
    data: { status: OFFER.REJECTED, responded_at: now },
  });
  if (res.count === 1) await cascade(orderId, now);
}

const dismiss = (riderId, orderId, reason) => {
  try { dispatchManager().emitDriverEvent(Number(riderId), "order:dismiss", { order_id: String(orderId), reason }); } catch (_) { /* best effort */ }
};

/** Cancels an open offer, kills its request row and dismisses the popup. */
async function cancelOffer(offer, reason, now) {
  if (!(await closeOffer(offer, OFFER.CANCELLED, now))) return false;
  try { await closeRequest(offer); } catch (err) { logger.error(`nextDayOffer: closing request for offer ${offer.id} failed:`, err); }
  dismiss(offer.rider_id, offer.order_id, reason);
  return true;
}

/** Settles every open offer from the DB: accepted, cancelled, rejected or expired (cascading where needed). */
async function reconcileOffers(now = new Date()) {
  const open = await prisma.next_day_daily_offer.findMany({ where: { status: OFFER.OFFERED }, take: 100 });
  for (const offer of open) {
    try {
      const order = await prisma.pkg_order.findUnique({ where: { id: offer.order_id } });
      if (order && Number(order.rid) === Number(offer.rider_id) && order.o_status !== "Cancelled") {
        await closeOffer(offer, OFFER.ACCEPTED, now); // accept always wins, even past expiry
        continue;
      }
      if (!isArranging(order)) {
        await cancelOffer(offer, "next_day_closed", now);
        continue;
      }
      const request = await prisma.tbl_order_requests.findFirst({
        where: { order_id: offer.order_id, rider_id: offer.rider_id }, orderBy: { id: "desc" }, select: { status: true },
      });
      if (request && String(request.status) === "10") {
        if (await closeOffer(offer, OFFER.REJECTED, now)) await cascade(offer.order_id, now);
        continue;
      }
      if (new Date(offer.expires_at).getTime() <= now.getTime()) {
        // Flip the request row first: if the driver accepted meanwhile it is no longer 'sent'.
        if ((await closeRequest(offer)) === 1) {
          if (await closeOffer(offer, OFFER.EXPIRED, now)) {
            dismiss(offer.rider_id, offer.order_id, "timeout");
            await cascade(offer.order_id, now);
          }
        } else {
          const fresh = await prisma.pkg_order.findUnique({ where: { id: offer.order_id } });
          if (fresh && Number(fresh.rid) === Number(offer.rider_id) && fresh.o_status !== "Cancelled") {
            await closeOffer(offer, OFFER.ACCEPTED, now);
          } else if (now.getTime() - new Date(offer.expires_at).getTime() > STUCK_OFFER_GRACE_MS) {
            // Never leave an offer 'offered' forever.
            if (await closeOffer(offer, OFFER.EXPIRED, now)) {
              dismiss(offer.rider_id, offer.order_id, "timeout");
              await cascade(offer.order_id, now);
            }
          }
        }
      }
    } catch (err) {
      logger.error(`nextDayOffer: reconciling offer ${offer.id} failed:`, err);
    }
  }
}

/** At the live time, release unassigned orders to Normal Drivers through the normal dispatch engine. */
async function goLiveDue(now = new Date()) {
  const due = await prisma.pkg_order.findMany({
    where: { booking_type: 3, next_day_stage: STAGE.ARRANGING, rid: 0, o_status: "Pending", next_day_live_at: { lte: now } },
  });
  let released = 0;
  for (const order of due) {
    try {
      const flipped = await prisma.pkg_order.updateMany({
        where: { id: order.id, next_day_stage: STAGE.ARRANGING, rid: 0, o_status: "Pending" }, data: { next_day_stage: STAGE.LIVE },
      });
      if (flipped.count !== 1) continue; // another worker won
      const openOffers = await prisma.next_day_daily_offer.findMany({ where: { order_id: order.id, status: OFFER.OFFERED } });
      for (const offer of openOffers) {
        await cancelOffer(offer, "next_day_live", now);
      }
      try {
        const tiered = await require("./tieredDispatchSettings").isTieredEnabled();
        const opts = tiered ? { stage: require("./tierPenaltyRules").TIER.NORMAL } : {};
        await dispatchManager().startDispatch({ ...order, next_day_stage: STAGE.LIVE }, null, opts);
      } catch (err) {
        logger.error(`nextDayOffer: dispatch at go-live failed for order ${order.id}, reverting to retry:`, err);
        const last = liveFailAlertAt.get(order.id);
        if (last === undefined || now.getTime() - last >= LIVE_ALERT_THROTTLE_MS) {
          liveFailAlertAt.set(order.id, now.getTime());
          try {
            adminSocket.notifyDispatchAlert(order.id, order.city_id, `${ALERT} – GO-LIVE FAILED, WILL RETRY`, { kind: "next_day_live_failed" });
          } catch (e2) { logger.error(`nextDayOffer: go-live-failed alert failed for order ${order.id}:`, e2); }
        }
        await prisma.pkg_order.updateMany({
          where: { id: order.id, next_day_stage: STAGE.LIVE, rid: 0, o_status: "Pending" }, data: { next_day_stage: STAGE.ARRANGING },
        });
        continue;
      }
      try {
        adminSocket.notifyDispatchAlert(order.id, order.city_id, `${ALERT} WENT LIVE – DISPATCHING TO NORMAL DRIVERS`, { kind: "next_day_live" });
      } catch (err) {
        logger.error(`nextDayOffer: live alert failed for order ${order.id}:`, err);
      }
      liveFailAlertAt.delete(order.id);
      released += 1;
    } catch (err) {
      logger.error(`nextDayOffer: going live failed for order ${order.id}:`, err);
    }
  }
  return released;
}

async function sweep(now = new Date()) {
  try { await reconcileOffers(now); } catch (err) { logger.error("nextDayOffer: reconcile failed:", err); }
  try { await goLiveDue(now); } catch (err) { logger.error("nextDayOffer: go-live pass failed:", err); }
}

const listOffers = (orderId) => prisma.next_day_daily_offer.findMany({ where: { order_id: Number(orderId) }, orderBy: { id: "asc" } });

module.exports = { listAvailableDailyDrivers, offerToDriver, cascade, onRejected, reconcileOffers, goLiveDue, sweep, listOffers };

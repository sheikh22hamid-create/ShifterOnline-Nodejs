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

  const { pkg, discount } = await pricingEngine.getFirstTierPricingContext(order);
  const sent = await dispatchManager().offerToInterestedRiders(order, [Number(riderId)], pkg, discount, {
    ttlMs: seconds * 1000,
    popupMs: seconds * 1000,
    requireOnline: false,
    fareScale: DAILY_DRIVER_SHARE,
    payloadExtras: { next_day_daily_offer: "1", schedule_date_time: String(order.schedule_date_time || "") },
  });
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
        if (await closeOffer(offer, OFFER.CANCELLED, now)) dismiss(offer.rider_id, offer.order_id, "next_day_closed");
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
        if (await closeOffer(offer, OFFER.EXPIRED, now)) {
          await prisma.tbl_order_requests.updateMany({ where: { order_id: offer.order_id, rider_id: offer.rider_id, status: "sent" }, data: { status: "timeout" } });
          dismiss(offer.rider_id, offer.order_id, "timeout");
          await cascade(offer.order_id, now);
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
        if (await closeOffer(offer, OFFER.CANCELLED, now)) dismiss(offer.rider_id, order.id, "next_day_live");
      }
      await dispatchManager().startDispatch({ ...order, next_day_stage: STAGE.LIVE });
      try {
        adminSocket.notifyDispatchAlert(order.id, order.city_id, `${ALERT} WENT LIVE – DISPATCHING TO NORMAL DRIVERS`, { kind: "next_day_live" });
      } catch (err) {
        logger.error(`nextDayOffer: live alert failed for order ${order.id}:`, err);
      }
      released += 1;
    } catch (err) {
      logger.error(`nextDayOffer: going live failed for order ${order.id}:`, err);
    }
  }
  return released;
}

async function sweep(now = new Date()) {
  await reconcileOffers(now);
  await goLiveDue(now);
}

const listOffers = (orderId) => prisma.next_day_daily_offer.findMany({ where: { order_id: Number(orderId) }, orderBy: { id: "asc" } });

module.exports = { listAvailableDailyDrivers, offerToDriver, cascade, onRejected, reconcileOffers, goLiveDue, sweep, listOffers };

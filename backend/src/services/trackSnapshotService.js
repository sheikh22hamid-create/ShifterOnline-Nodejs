const prisma = require("../config/db");
const logger = require("../utils/logger");
const { normalizeToLast10Digits } = require("../utils/phone");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");
const settings = require("./receiverTrackSettings");
const livePositions = require("./liveDriverPositions");
const etaService = require("./trackEtaService");
const tripRouteService = require("./tripRouteService");
const { receiverPayable } = require("./receiverPayCalc");

const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 15000;
const EXPIRE_AFTER_DELIVERY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const short = (s) => (s ? String(s).slice(0, 80) : null);
const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || null;

const ORDER_SELECT = {
  id: true, rid: true, order_status: true, o_status: true, dmobile: true,
  plat: true, plong: true, dlat: true, dlong: true, paddress: true, daddress: true, drop_time: true, ddate: true,
};

// drop_time / ddate hold IST wall-clock values (see driverOrderHistoryController).
const deliveredAt = (order) => order.drop_time || order.ddate || null;
const isCompleted = (order) => Number(order.order_status) === 5 || order.o_status === "Completed";
function deliveredWindowOpen(order, now) {
  const done = deliveredAt(order);
  return !done || now <= new Date(done).getTime() - IST_OFFSET_MS + EXPIRE_AFTER_DELIVERY_MS;
}

// The order behind a link, or the reason there is none. The link belongs to the order's current drop
// contact, so a changed number kills the old link. Shared with the pay-link and review endpoints.
async function loadLinkedOrder(link) {
  if (!(await settings.isTrackingEnabled())) return { reason: "expired" };
  const order = await prisma.pkg_order.findUnique({ where: { id: link.order_id }, select: ORDER_SELECT });
  if (!order || normalizeToLast10Digits(order.dmobile) !== link.receiver_phone) return { reason: "invalid" };
  return { order };
}

// Money is only ever shown to a receiver who has to pay (a Receiver-pays row exists).
async function payState(orderId) {
  const row = await prisma.order_receiver_pay.findUnique({ where: { order_id: orderId }, select: { status: true } });
  if (!row) return null;
  const s = await prisma.order_settlement.findUnique({
    where: { order_id: orderId }, select: { payer: true, status: true, amount_due: true, receiver_markup: true },
  });
  if (!s) return null;
  const amounts = { amount_due: Number(s.amount_due), markup: Number(s.receiver_markup), total: receiverPayable(s.amount_due, s.receiver_markup) };
  if (row.status === "paid") return { state: "paid", ...amounts };
  if (row.status === "active" && s.payer === "receiver" && s.status === "pending") return { state: "payable", ...amounts };
  return null;
}

async function deliveredExtras(order) {
  const [rider, trip, pay, review] = await Promise.all([
    safe("rider", () => prisma.tbl_rider.findUnique({ where: { id: order.rid }, select: { first_name: true, vehicle_no: true } })),
    safe("trip route", () => tripRouteService.buildRoute(prisma, order.id)),
    safe("pay", () => payState(order.id)),
    safe("review", () => prisma.order_receiver_feedback.findUnique({ where: { order_id: order.id }, select: { id: true } })),
  ]);
  const hasTrail = Boolean(trip && trip.has_trail);
  const distance = trip && Number(trip.distance_km) > 0 ? Math.round(Number(trip.distance_km) * 10) / 10 : null;
  return {
    summary: {
      driver: rider ? { first_name: firstName(rider.first_name), vehicle_no: rider.vehicle_no || null } : null,
      pickup: order.paddress ? { address: short(order.paddress) } : null,
      drop: order.daddress ? { address: short(order.daddress) } : null,
      distance_km: distance,
    },
    trip_route: trip
      ? {
          has_trail: hasTrail,
          points: hasTrail ? etaService.simplify(trip.points.map((p) => [p.lat, p.lng])) : [],
          pickup: trip.final_pickup || trip.pickup || null,
          drop: trip.drop || null,
        }
      : null,
    pay,
    review: { submitted: Boolean(review) },
    help: settings.getHelpConfig(),
    app_url: settings.APP_URL,
  };
}

function toPoint(lat, lng) {
  // Number("") is 0, so a blank column must be rejected before the numeric check.
  if (String(lat ?? "").trim() === "" || String(lng ?? "").trim() === "") return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`trackSnapshot: ${label} failed: ${err && err.message}`);
    return null;
  }
}

// Last known position: the live ping first, then the throttled DB copy. Position is `stale` after 2 minutes.
function currentPosition(riderId, rider, now) {
  // The driver app writes every fix to the DB over REST and to the socket; take whichever is newer.
  const live = livePositions.get(riderId);
  const p = toPoint(rider && rider.rlats, rider && rider.rlongs);
  const dbAt = p && rider.rloc_updated_at ? new Date(rider.rloc_updated_at).getTime() : null;
  let lat; let lng; let heading; let at;
  const useLive = live && (!p || (Number.isFinite(dbAt) ? live.at >= dbAt : true));
  if (useLive) {
    ({ lat, lng, heading, at } = live);
  } else if (p) {
    lat = p.lat; lng = p.lng; heading = 0;
    at = Number.isFinite(dbAt) ? dbAt : null;
  } else {
    return null;
  }
  return {
    lat, lng, heading: Number.isFinite(heading) ? heading : 0,
    updated_at: at ? new Date(at).toISOString() : null,
    stale: at === null || now - at > RIDER_LOCATION_FRESHNESS_MS,
  };
}

async function buildSnapshot(link, { now = Date.now() } = {}) {
  const loaded = await loadLinkedOrder(link);
  if (!loaded.order) return { state: loaded.reason, poll_ms: POLL_IDLE_MS };
  const order = loaded.order;

  const status = Number(order.order_status);
  if (status === 4 || order.o_status === "Cancelled") {
    etaService.clearOrder(order.id);
    return { state: "cancelled", order_id: order.id, poll_ms: POLL_IDLE_MS };
  }
  if (isCompleted(order)) {
    etaService.clearOrder(order.id);
    if (!deliveredWindowOpen(order, now)) return { state: "expired", poll_ms: POLL_IDLE_MS };
    const doneAt = deliveredAt(order);
    return {
      state: "delivered", order_id: order.id, step: 5,
      delivered_at: doneAt ? new Date(doneAt).toISOString().replace("Z", "+05:30") : null,
      poll_ms: POLL_IDLE_MS,
      ...(await deliveredExtras(order)),
    };
  }

  const hasDriver = Number(order.rid) > 0;
  const [rider, timer] = await Promise.all([
    hasDriver
      ? prisma.tbl_rider.findUnique({ where: { id: order.rid }, select: { first_name: true, vehicle_no: true, fmobile: true, rlats: true, rlongs: true, rloc_updated_at: true } })
      : null,
    hasDriver
      ? prisma.pkg_order_wait_timer.findUnique({ where: { order_id_rid: { order_id: order.id, rid: order.rid } }, select: { drop_wait_start: true } })
      : null,
  ]);

  const atDrop = status === 3 && Boolean(timer && timer.drop_wait_start);
  const step = status < 1 ? 0 : status === 1 ? 1 : status === 2 ? 2 : atDrop ? 4 : 3;

  let position = null; let eta = null; let route = null; let pickup = null; let drop = null;
  if (status === 3) {
    const pickupPt = toPoint(order.plat, order.plong);
    const dropPt = toPoint(order.dlat, order.dlong);
    if (pickupPt) pickup = { ...pickupPt, address: short(order.paddress) };
    if (dropPt) drop = { ...dropPt, address: short(order.daddress) };
    position = currentPosition(order.rid, rider, now);
    if (position && !position.stale && !atDrop && dropPt) {
      eta = await safe("eta", () => etaService.getEta(order.id, { lat: position.lat, lng: position.lng }, dropPt));
    }
    if (pickupPt && dropPt) route = await safe("route", () => etaService.getRoute(order.id, pickupPt, dropPt));
  }

  return {
    state: "active", order_id: order.id, step,
    driver: rider ? { first_name: firstName(rider.first_name), vehicle_no: rider.vehicle_no || null, phone: rider.fmobile || null } : null,
    eta, position, route, pickup, drop, delivered_at: null, poll_ms: POLL_ACTIVE_MS,
  };
}

module.exports = { buildSnapshot, loadLinkedOrder, isCompleted, deliveredWindowOpen };


const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const tripRouteService = require("./tripRouteService");

// Read-only share link for a COMPLETED ride's saved route map. The page and the
// JSON behind it only ever read: the stored trail (driver_trip_location) is never
// written from here, and the public payload leaves out everything that is not
// needed to draw the map (no driver, phone, address, fare or order ids).

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const newToken = () => crypto.randomBytes(32).toString("base64url");
const isTokenShape = (token) => TOKEN_SHAPE.test(String(token || ""));

const isCompleted = (order) => Number(order?.order_status) === 5 || order?.o_status === "Completed";

function buildLink(token) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return base ? `${base}/route/${token}` : null;
}

// The customer who owns a completed order gets its (single, stable) link.
async function urlForOwner({ orderId, uid }) {
  const order = await prisma.pkg_order.findFirst({ where: { id: orderId, uid }, select: { id: true, order_status: true, o_status: true } });
  if (!order) return { ok: false, code: "NOT_FOUND", msg: "Order not found." };
  if (!isCompleted(order)) return { ok: false, code: "NOT_COMPLETED", msg: "The route can be shared once the ride is completed." };

  let link = await prisma.order_route_share.findUnique({ where: { order_id: orderId } });
  if (!link) {
    try {
      link = await prisma.order_route_share.create({ data: { order_id: orderId, uid, token: newToken(), created_at: new Date() } });
    } catch (err) {
      // Two taps at once: the other request won the unique order_id; use its row.
      if (err && err.code === "P2002") link = await prisma.order_route_share.findUnique({ where: { order_id: orderId } });
      else throw err;
    }
  }
  const url = buildLink(link.token);
  if (!url) {
    logger.error("routeShareService: PUBLIC_BASE_URL is not configured, cannot build a share link.");
    return { ok: false, code: "NOT_CONFIGURED", msg: "Sharing is not available right now." };
  }
  return { ok: true, url };
}

async function findByToken(token) {
  if (!isTokenShape(token)) return null;
  return prisma.order_route_share.findUnique({ where: { token } });
}

const VIEW_TOUCH_MS = 60 * 1000;
const lastTouched = new Map();
async function touchViewed(id, now = Date.now()) {
  const last = lastTouched.get(id);
  if (last !== undefined && now - last < VIEW_TOUCH_MS) return;
  if (lastTouched.size > 5000) lastTouched.clear();
  lastTouched.set(id, now);
  try {
    await prisma.order_route_share.update({ where: { id }, data: { last_viewed_at: new Date() } });
  } catch (_) {
    // a view counter must never fail a request
  }
}

// What the public page draws. `state` tells the page what to say:
//   ready       - full recorded trail
//   no_trail    - completed, but no usable trail was saved (pins only, with a message)
//   unavailable - not a completed ride (or gone)
async function buildPublicRoute(link) {
  const order = await prisma.pkg_order.findUnique({ where: { id: link.order_id }, select: { id: true, order_status: true, o_status: true, odate: true, ddate: true } });
  if (!order || !isCompleted(order)) return { state: "unavailable" };

  const route = await tripRouteService.buildRoute(prisma, order.id);
  if (!route) return { state: "unavailable" };

  const base = {
    booking_id: `SO${String(order.id).padStart(10, "0")}`,
    date: order.ddate || order.odate || null,
    pickup: route.pickup,
    final_pickup: route.final_pickup,
    stops: route.stops,
    drop: route.drop,
  };
  if (!route.has_trail) return { state: "no_trail", ...base };
  return {
    state: "ready",
    ...base,
    distance_km: route.distance_km,
    start: route.start,
    points: route.points.map((p) => ({ lat: p.lat, lng: p.lng, phase: p.phase, ...(p.gap ? { gap: true } : {}) })),
  };
}

module.exports = { isTokenShape, isCompleted, buildLink, urlForOwner, findByToken, touchViewed, buildPublicRoute };

const prisma = require("../config/db");
const logger = require("../utils/logger");
const otpService = require("./otpService");
const adminSocket = require("../sockets/adminSocket");
const { assignDefaultDeliveryTypes } = require("../utils/assignDefaultDeliveryTypes");
const { newTrialRiderData } = require("../utils/trialRiderData");

// Outside-driver lookup (spec 2026-10-15): while a Booking Guarantee order is held and no Shifter driver is
// available, the admin can ask the partner dispatch service for ONE nearby driver (not on Shifter), call them
// and onboard them. The service books and auto-cancels a trip on its own account per call, so every call is
// rate limited and recorded.
const BASE_URL = (process.env.OUTSIDE_DRIVER_API_URL || "https://rider.shifteronline.com").replace(/\/+$/, "");
const REQUEST_TIMEOUT_MS = 70 * 1000;
const MIN_GAP_MS = 10 * 1000;
const MAX_LOOKUPS_PER_ORDER = 8;
const MAX_REPEAT_RETRIES = 2;
const EVENT = "outside_driver_lookup";
const REGISTERED_EVENT = "outside_driver_registered";
const AWAIT_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_TRIAL_ORDERS = 5;

// Fallback catalog used until (or when) the partner's live /api/vehicles list is unavailable.
const FALLBACK_VEHICLES = Object.freeze([
  { id: 133, name: "2-Wheeler (Bike)" }, { id: 1139, name: "Mini 3-Wheeler" }, { id: 126, name: "3-Wheeler 500kg" },
  { id: 97, name: "Tata Ace / 8ft Truck" }, { id: 91, name: "Pickup 8ft" }, { id: 1, name: "Tata 407" },
]);
const CATALOG_TTL_MS = 10 * 60 * 1000;
let catalog = { at: 0, list: null };

/** The partner's vehicle list (cached); falls back to the known six when it cannot be fetched. */
async function getVehicles(fetchImpl = fetch) {
  if (catalog.list && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.list;
  try {
    const resp = await fetchImpl(`${BASE_URL}/api/vehicles`, { signal: AbortSignal.timeout(8000) });
    if (resp.ok) {
      const body = await resp.json();
      const list = (Array.isArray(body?.vehicles) ? body.vehicles : [])
        .map((v) => ({ id: Number(v.id), name: String(v.name || `Vehicle ${v.id}`), desc: v.desc ? String(v.desc) : undefined }))
        .filter((v) => Number.isInteger(v.id) && v.id > 0);
      if (list.length) { catalog = { at: Date.now(), list }; return list; }
    }
  } catch (err) {
    logger.warn(`outsideDriver: vehicle catalog fetch failed: ${err.message}`);
  }
  return catalog.list || FALLBACK_VEHICLES;
}
const knownVehicleIds = () => (catalog.list || FALLBACK_VEHICLES).map((v) => v.id);
const resetCatalogCache = () => { catalog = { at: 0, list: null }; };

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const inFlight = new Set();

/** Parse one SSE chunk ("data: {...}") into an object, or null when it is not a JSON data line. */
function parseSseEvent(block) {
  const line = String(block).split("\n").find((l) => l.startsWith("data:"));
  if (!line) return null;
  try { return JSON.parse(line.slice(5).trim()); } catch { return null; }
}

function driverFromEvent(evt) {
  const d = evt?.data?.driver;
  if (!d || !d.contactNumber) return null;
  return {
    name: String(d.driverName || "").trim(),
    mobile: String(d.contactNumber).trim(),
    vehicle_number: String(d.vehicleNumber || "").trim(),
    vehicle_name: String(d.vehicleDisplayName || "").trim(),
    fare: Number(d.fare ?? evt.data?.fareDetails?.amount) || null,
  };
}

/** Call the partner stream once; resolves { driver } or { driver: null, reason }. Never throws on API trouble. */
async function callStream({ pickup, drop, vehicleId, fetchImpl = fetch }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(`${BASE_URL}/api/find-driver-stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pickup, drop, vehicleId }),
      signal: ctrl.signal,
    });
    if (!resp.ok || !resp.body) return { driver: null, reason: `api_status_${resp.status}` };
    const decoder = new TextDecoder();
    let buf = "";
    let driver = null;
    let failure = null;
    // Read the stream to its end even after the driver shows up: the partner service auto-cancels the trip it
    // booked (CANCELLING step) and an early disconnect could leave a real trip open.
    for await (const chunk of resp.body) {
      buf += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const evt = parseSseEvent(buf.slice(0, idx));
        buf = buf.slice(idx + 2);
        if (!evt) continue;
        if (evt.step === "DRIVER_FOUND" && !driver) driver = driverFromEvent(evt);
        if (evt.step === "ERROR" || evt.step === "NO_DRIVER") failure = String(evt.step).toLowerCase();
      }
    }
    if (driver) return { driver };
    return { driver: null, reason: failure || "no_driver_found" };
  } catch (err) {
    return { driver: null, reason: ctrl.signal.aborted ? "timeout" : "api_unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

async function previousLookups(orderId) {
  const rows = await prisma.booking_guarantee_audit.findMany({
    where: { order_id: orderId, event: EVENT }, orderBy: { id: "asc" }, select: { created_at: true, meta: true },
  });
  return rows.map((r) => { let m = {}; try { m = JSON.parse(r.meta || "{}"); } catch { /* keep {} */ } return { at: r.created_at, ...m }; });
}

/**
 * Find one outside driver for a held order. Returns { driver|null, reason?, attempts, repeat }.
 * Throws httpError for caller mistakes (not held, rate limited, bad vehicle).
 */
async function lookup({ orderId, vehicleId, adminId, fetchImpl }) {
  const vid = Number(vehicleId);
  if (!knownVehicleIds().includes(vid)) throw httpError(400, "Unsupported vehicle");
  const order = await prisma.pkg_order.findUnique({
    where: { id: orderId },
    select: { id: true, rid: true, order_status: true, o_status: true, plat: true, plong: true, dlat: true, dlong: true, pick_name: true, drop_name: true },
  });
  if (!order) throw httpError(404, "Order not found");
  if (order.rid !== 0 || order.order_status !== 0 || order.o_status !== "Pending") throw httpError(409, "Order is already assigned or closed");
  const caseRow = await prisma.booking_guarantee_case.findUnique({ where: { order_id: orderId }, select: { id: true, status: true } });
  if (!caseRow || caseRow.status !== "open") throw httpError(409, "Outside driver lookup is only for orders held by Booking Guarantee");
  if (inFlight.has(orderId)) throw httpError(429, "A lookup for this order is already running");

  const prior = await previousLookups(orderId);
  if (prior.length >= MAX_LOOKUPS_PER_ORDER) throw httpError(429, "Lookup limit reached for this order");
  const last = prior[prior.length - 1];
  if (last && Date.now() - new Date(last.at).getTime() < MIN_GAP_MS) throw httpError(429, "Please wait a few seconds before trying again");

  const coord = (v) => (String(v ?? "").trim() === "" ? NaN : Number(v));
  const point = (title, lat, lng) => ({ title: title || "Location", subtitle: "", lat: coord(lat), lng: coord(lng) });
  const pickup = point(order.pick_name, order.plat, order.plong);
  const drop = point(order.drop_name, order.dlat, order.dlong);
  if (![pickup.lat, pickup.lng, drop.lat, drop.lng].every(Number.isFinite)) throw httpError(422, "Order has no usable pickup/drop coordinates");

  const seen = new Set(prior.map((p) => p.vehicle_number).filter(Boolean));
  inFlight.add(orderId);
  let result = { driver: null, reason: "no_driver_found" };
  let repeat = false;
  try {
    for (let i = 0; i <= MAX_REPEAT_RETRIES; i += 1) {
      result = await callStream({ pickup, drop, vehicleId: vid, fetchImpl });
      repeat = Boolean(result.driver && seen.has(result.driver.vehicle_number));
      if (!result.driver || !repeat) break;
    }
  } finally {
    inFlight.delete(orderId);
  }

  try {
    await prisma.booking_guarantee_audit.create({
      data: {
        case_id: caseRow.id, order_id: orderId, event: EVENT, admin_id: adminId ?? null,
        meta: JSON.stringify({ vehicle_id: vid, found: Boolean(result.driver), reason: result.reason || null, repeat, ...(result.driver ? { name: result.driver.name, mobile: result.driver.mobile, vehicle_number: result.driver.vehicle_number, fare: result.driver.fare } : {}) }),
      },
    });
  } catch (err) {
    logger.error(`outsideDriver: audit write failed for order ${orderId}:`, err);
  }
  return { driver: result.driver, reason: result.reason || null, repeat, attempts: prior.length + 1, max_attempts: MAX_LOOKUPS_PER_ORDER };
}

async function loadHeldOrder(orderId) {
  const order = await prisma.pkg_order.findUnique({
    where: { id: orderId }, select: { id: true, rid: true, order_status: true, o_status: true, city_id: true, category: true },
  });
  if (!order) throw httpError(404, "Order not found");
  if (order.rid !== 0 || order.order_status !== 0 || order.o_status !== "Pending") throw httpError(409, "Order is already assigned or closed");
  const caseRow = await prisma.booking_guarantee_case.findUnique({ where: { order_id: orderId }, select: { id: true, status: true } });
  if (!caseRow || caseRow.status !== "open") throw httpError(409, "Only orders held by Booking Guarantee can onboard an outside driver");
  return { order, caseRow };
}

/**
 * Put the driver the admin just phoned on the trial roster (find-or-create by mobile, in the order's city) and
 * remember which held order they were onboarded for, so going online can alert the admin.
 */
async function registerTrial({ orderId, name, mobile, vehicleNumber, trialOrders, adminId }) {
  const { order, caseRow } = await loadHeldOrder(orderId);
  const fullName = String(name || "").trim();
  const phone = otpService.normalizeMobile(String(mobile || "").replace(/^0+/, ""));
  if (!fullName) throw httpError(400, "Driver name is required");
  if (!otpService.isValidIndianMobile(phone)) throw httpError(400, "Driver mobile number is not a valid Indian mobile");
  const allowed = trialOrders === undefined || trialOrders === null || trialOrders === "" ? 1 : Number(trialOrders);
  if (!Number.isInteger(allowed) || allowed < 1 || allowed > MAX_TRIAL_ORDERS) throw httpError(400, `Trial orders must be 1 to ${MAX_TRIAL_ORDERS}`);
  const plate = String(vehicleNumber || "").trim().slice(0, 50) || undefined;

  const existing = await prisma.tbl_rider.findFirst({ where: { fmobile: phone } });
  let rider;
  let kind;
  if (existing && Number(existing.city_id) !== Number(order.city_id)) throw httpError(409, "This mobile belongs to a driver in another city");
  if (existing && (existing.trial_status === "active" || (existing.verification_status === "approved" && existing.status === 1))) {
    rider = existing;
    kind = "already_on_shifter";
  } else if (existing) {
    rider = await prisma.tbl_rider.update({
      where: { id: existing.id },
      data: { full_name: fullName, vehicle: order.category, trial_status: "active", trial_orders_allowed: allowed, trial_orders_completed: 0, ...(plate ? { vehicle_no: plate } : {}) },
    });
    await assignDefaultDeliveryTypes(rider.id);
    kind = "trial_activated";
  } else {
    rider = await prisma.tbl_rider.create({
      data: newTrialRiderData({ fullName, mobile: phone, vehicle: order.category, cityId: Number(order.city_id) || 1, trialOrdersAllowed: allowed, vehicleNo: plate }),
    });
    await assignDefaultDeliveryTypes(rider.id);
    kind = "trial_created";
  }
  // rider_id must stay the first key: notifyIfAwaited matches on the literal prefix {"rider_id":N,
  await prisma.booking_guarantee_audit.create({
    data: { case_id: caseRow.id, order_id: orderId, event: REGISTERED_EVENT, admin_id: adminId ?? null, meta: JSON.stringify({ rider_id: rider.id, kind, mobile: phone, name: fullName }) },
  });
  return { rider_id: rider.id, kind, online: rider.a_status === 1 };
}

/** Is the onboarded driver online yet? Only answers for a rider that was registered for this order. */
async function onboardStatus({ orderId, riderId }) {
  const rid = Number(riderId);
  if (!Number.isInteger(rid) || rid <= 0) throw httpError(400, "rider_id is required");
  const link = await prisma.booking_guarantee_audit.findFirst({
    where: { order_id: orderId, event: REGISTERED_EVENT, meta: { startsWith: `{"rider_id":${rid},` } }, select: { id: true },
  });
  if (!link) throw httpError(404, "This driver was not onboarded for this order");
  const [rider, order] = await Promise.all([
    prisma.tbl_rider.findUnique({ where: { id: rid }, select: { a_status: true, status: true, trial_status: true, verification_status: true } }),
    prisma.pkg_order.findUnique({ where: { id: orderId }, select: { rid: true, o_status: true } }),
  ]);
  if (!rider || !order) throw httpError(404, "Not found");
  return { online: rider.a_status === 1 && rider.status === 1, order_open: order.rid === 0 && order.o_status === "Pending" };
}

/** Rider just went online: alert admins when this rider was onboarded for a still-held order. Best-effort. */
async function notifyIfAwaited(rider) {
  try {
    const since = new Date(Date.now() - AWAIT_WINDOW_MS);
    const rows = await prisma.$queryRaw`
      SELECT DISTINCT a.order_id AS order_id FROM booking_guarantee_audit a
      JOIN booking_guarantee_case c ON c.order_id = a.order_id AND c.status = 'open'
      WHERE a.event = ${REGISTERED_EVENT} AND a.created_at >= ${since} AND a.meta LIKE ${`{"rider_id":${Number(rider.id)},%`}`;
    for (const r of rows) {
      adminSocket.notifyDispatchAlert(Number(r.order_id), rider.city_id, `Onboarded driver is online: assign order #${r.order_id} now`, { kind: "outside_driver_online", rider_id: rider.id });
    }
  } catch (err) {
    logger.error(`outsideDriver: online alert failed for rider ${rider?.id}:`, err);
  }
}

module.exports = { getVehicles, resetCatalogCache, registerTrial, onboardStatus, notifyIfAwaited, lookup, parseSseEvent, driverFromEvent, callStream, FALLBACK_VEHICLES, MAX_LOOKUPS_PER_ORDER };

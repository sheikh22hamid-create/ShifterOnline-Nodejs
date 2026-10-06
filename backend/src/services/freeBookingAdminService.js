const prisma = require("../config/db");
const freeBookingService = require("./freeBookingService");
const rules = require("./freeBookingRules");
const logger = require("../utils/logger");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (s) => new Date(`${s}T00:00:00.000Z`);
const bad = (msg) => Object.assign(new Error(msg), { statusCode: 400 });

/** admin = bound to own city; superadmin = chosen city (query or body), null if none given. */
function resolveCityId(user, query = {}, body = {}) {
  if (user?.role !== "superadmin") return user?.city_id != null ? Number(user.city_id) : null;
  const raw = query.city_id ?? body.city_id;
  return raw != null && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

const requireCity = (cityId) => {
  if (!cityId) throw bad("A city is required");
};

async function getSettings(cityId) {
  requireCity(cityId);
  const row = await freeBookingService.getCitySetting(cityId);
  return {
    city_id: Number(cityId),
    enabled: Boolean(row?.enabled),
    offer_start: row?.offer_start ?? null,
    offer_end: row?.offer_end ?? null,
  };
}

async function saveSettings({ cityId, enabled, offerStart, offerEnd, adminId }) {
  requireCity(cityId);
  const on = Boolean(enabled);
  let start = null;
  let end = null;
  if (offerStart || offerEnd || on) {
    start = offerStart ? new Date(offerStart) : null;
    end = offerEnd ? new Date(offerEnd) : null;
    if (on && (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()))) {
      throw bad("Offer start and end are required to turn the offer ON");
    }
    if (start && end && end.getTime() <= start.getTime()) throw bad("Offer end must be after the start");
  }
  const data = { enabled: on, offer_start: start, offer_end: end, updated_by: adminId ?? null };
  return prisma.free_booking_setting.upsert({
    where: { city_id: Number(cityId) },
    create: { city_id: Number(cityId), ...data },
    update: data,
  });
}

const riderName = (r) => r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`;

async function vehiclesByRider(riderIds) {
  if (!riderIds.length) return new Map();
  const rows = await prisma.tbl_vehicle_details.findMany({
    where: { rider_id: { in: riderIds }, status: 1 },
    select: { id: true, rider_id: true, reg_num: true },
  });
  const map = new Map();
  for (const v of rows) if (!map.has(v.rider_id)) map.set(v.rider_id, v);
  return map;
}

async function listPool(cityId) {
  requireCity(cityId);
  const rows = await prisma.free_booking_pool.findMany({ where: { city_id: Number(cityId) }, orderBy: { id: "desc" } });
  const ids = [...new Set(rows.map((r) => r.rider_id))];
  const [riders, vehicles] = await Promise.all([
    ids.length
      ? prisma.tbl_rider.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true, first_name: true, last_name: true, vehicle: true } })
      : [],
    vehiclesByRider(ids),
  ]);
  const byId = new Map(riders.map((r) => [r.id, r]));
  return rows.map((r) => ({
    id: r.id, rider_id: r.rider_id,
    rider_name: byId.get(r.rider_id) ? riderName(byId.get(r.rider_id)) : `Driver #${r.rider_id}`,
    vehicle: byId.get(r.rider_id)?.vehicle ?? null,
    reg_num: vehicles.get(r.rider_id)?.reg_num ?? null,
    valid_from: r.valid_from, valid_to: r.valid_to, active: r.active,
  }));
}

/** Approved, active riders of the city that are not already in the pool today. */
async function listCandidates(cityId, q = "") {
  requireCity(cityId);
  const inPool = await freeBookingService.poolRiderIds(cityId, rules.istDateString());
  const term = String(q || "").trim();
  const riders = await prisma.tbl_rider.findMany({
    where: {
      city_id: Number(cityId), a_status: 1, status: 1,
      id: { notIn: inPool.length ? inPool : [0] },
      ...(term ? { OR: [{ full_name: { contains: term } }, { first_name: { contains: term } }] } : {}),
    },
    select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, vehicle: true },
    orderBy: { id: "desc" },
    take: 100,
  });
  const vehicles = await vehiclesByRider(riders.map((r) => r.id));
  return riders.map((r) => ({
    id: r.id, name: riderName(r), mobile: r.fmobile, vehicle: r.vehicle, reg_num: vehicles.get(r.id)?.reg_num ?? null,
  }));
}

function checkDates(validFrom, validTo) {
  if (!DATE_RE.test(String(validFrom)) || !DATE_RE.test(String(validTo)) || validTo < validFrom) {
    throw bad("Valid dates are required (YYYY-MM-DD), and the end date cannot be before the start date");
  }
}

async function addToPool({ cityId, riderId, validFrom, validTo, adminId }) {
  requireCity(cityId);
  checkDates(validFrom, validTo);
  const rider = await prisma.tbl_rider.findUnique({ where: { id: Number(riderId) }, select: { id: true, city_id: true, a_status: true, status: true } });
  if (!rider) throw bad("Driver not found");
  if (Number(rider.city_id) !== Number(cityId)) throw bad("This driver belongs to another city");
  if (Number(rider.a_status) !== 1 || Number(rider.status) !== 1) throw bad("Only approved, active drivers can join the pool");

  const overlap = await prisma.free_booking_pool.findFirst({
    where: {
      city_id: Number(cityId), rider_id: Number(riderId), active: true,
      valid_from: { lte: asDate(validTo) }, valid_to: { gte: asDate(validFrom) },
    },
  });
  if (overlap) throw bad("This driver is already in the pool for an overlapping period");

  const vehicles = await vehiclesByRider([Number(riderId)]);
  return prisma.free_booking_pool.create({
    data: {
      city_id: Number(cityId), rider_id: Number(riderId),
      vehicle_details_id: vehicles.get(Number(riderId))?.id ?? null,
      valid_from: asDate(validFrom), valid_to: asDate(validTo), active: true, added_by: adminId ?? null,
    },
  });
}

async function ownedPoolRow(id, cityId) {
  const row = await prisma.free_booking_pool.findUnique({ where: { id: Number(id) } });
  if (!row || Number(row.city_id) !== Number(cityId)) throw Object.assign(new Error("Pool entry not found"), { statusCode: 404 });
  return row;
}

async function updatePool(id, cityId, patch = {}) {
  const row = await ownedPoolRow(id, cityId);
  const data = {};
  if (patch.active !== undefined) data.active = Boolean(patch.active);
  const datesChanged = patch.valid_from !== undefined || patch.valid_to !== undefined;
  let from = row.valid_from ? row.valid_from.toISOString().slice(0, 10) : null;
  let to = row.valid_to ? row.valid_to.toISOString().slice(0, 10) : null;
  if (datesChanged) {
    from = patch.valid_from ?? from;
    to = patch.valid_to ?? to;
    checkDates(from, to);
    data.valid_from = asDate(from);
    data.valid_to = asDate(to);
  }
  const willBeActive = data.active !== undefined ? data.active : Boolean(row.active);
  if (willBeActive && (data.active === true || datesChanged)) {
    const overlap = await prisma.free_booking_pool.findFirst({
      where: {
        city_id: Number(cityId), rider_id: row.rider_id, active: true, id: { not: row.id },
        valid_from: { lte: asDate(to) }, valid_to: { gte: asDate(from) },
      },
    });
    if (overlap) throw bad("This driver is already in the pool for an overlapping period");
  }
  return prisma.free_booking_pool.update({ where: { id: Number(id) }, data });
}

async function removeFromPool(id, cityId) {
  await ownedPoolRow(id, cityId);
  await prisma.free_booking_pool.delete({ where: { id: Number(id) } });
}

async function listOrders({ cityId, status, unrestricted = false }) {
  if (!unrestricted && !cityId) throw Object.assign(new Error("Your account is not assigned to a city"), { statusCode: 403 });
  // Bring cancelled trips' rows up to date before listing; a failure here must never break the list.
  try {
    await freeBookingService.reapCancelled();
  } catch (err) {
    logger.warn(`freeBookingAdminService.listOrders: reapCancelled failed: ${err.message}`);
  }
  return prisma.free_booking_order.findMany({
    where: { ...(cityId ? { city_id: Number(cityId) } : {}), ...(status ? { status } : {}) },
    orderBy: { id: "desc" },
    take: 200,
  });
}

/** A single free booking of the city, or null (direct lookup, not a list scan). */
async function findOrderInCity(id, cityId) {
  return prisma.free_booking_order.findFirst({ where: { id: Number(id), city_id: Number(cityId) } });
}

/** A city-bound admin may only lock/unlock customers of their own city; only `unrestricted` (superadmin) skips the check. */
async function assertUserInCity(userId, cityId, unrestricted = false) {
  if (unrestricted) return;
  if (!cityId) throw Object.assign(new Error("Your account is not assigned to a city"), { statusCode: 403 });
  const user = await prisma.tbl_user.findUnique({ where: { id: Number(userId) }, select: { id: true, city_id: true } });
  if (!user || Number(user.city_id) !== Number(cityId)) throw bad("This customer belongs to another city");
}

module.exports = {
  resolveCityId, getSettings, saveSettings, listPool, listCandidates,
  addToPool, updatePool, removeFromPool, listOrders, assertUserInCity, findOrderInCity,
};

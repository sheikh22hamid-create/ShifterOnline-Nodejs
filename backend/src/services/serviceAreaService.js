const prisma = require("../config/db");
const rules = require("./serviceAreaRules");
const settings = require("./serviceAreaSettings");

// City-wise coverage and vehicle No Entry validation (spec 2026-10-29). One place used by the order API (the final
// word) and by the validate-location endpoint the apps call early. With the switch off nothing is checked at all.

/** The vehicle category id from an id, a numeric string or a category name; null when unknown or not given. */
async function resolveCategoryId(category) {
  if (category === null || category === undefined || String(category).trim() === "") return null;
  const asNumber = Number(category);
  if (Number.isInteger(asNumber) && asNumber > 0) return asNumber;
  const row = await prisma.pkg_category.findFirst({ where: { cat_name: String(category).trim() }, select: { id: true } });
  return row ? row.id : null;
}

/**
 * One location, judged by its own kind ('pickup' | 'drop'):
 *  1. it must lie in an active coverage zone of any city (no zone configured = not serviceable);
 *  2. with a vehicle category, it must not lie in an active No Entry Zone of that same kind, that category and a city
 *     whose coverage contains it.
 */
async function validateLocation({ lat, lng, kind, category }) {
  const where = kind === "drop" ? "drop" : "pickup";
  if (!(await settings.isEnforced())) return { ok: true, enforced: false };

  const zones = await prisma.service_zone.findMany({ where: { status: 1, zone_kind: "coverage" } });
  // A coverage zone not tied to a city cannot be matched with No Entry rules, so it does not count as coverage.
  const covering = zones.filter((zone) => Number.isInteger(zone.city_id) && zone.city_id > 0 && rules.containsPoint(zone, lat, lng));
  if (covering.length === 0) {
    return { ok: false, enforced: true, code: "NO_SERVICE_ZONE", message: rules.messageFor(where, "NO_SERVICE_ZONE") };
  }
  const cityIds = [...new Set(covering.map((zone) => zone.city_id).filter((id) => Number.isInteger(id) && id > 0))];

  const categoryId = await resolveCategoryId(category);
  const categoryGiven = category !== null && category !== undefined && String(category).trim() !== "";
  // A vehicle was named but is not one we know: refuse rather than skip its No Entry rules.
  if (categoryGiven && !categoryId) return { ok: false, enforced: true, code: "UNKNOWN_VEHICLE", message: "This vehicle is not available for booking." };
  if (categoryId) {
    const noEntry = await prisma.vehicle_no_entry_zone.findMany({
      where: { status: 1, kind: where, category_id: categoryId, city_id: { in: cityIds } },
    });
    if (noEntry.some((zone) => rules.containsPoint(zone, lat, lng))) {
      return { ok: false, enforced: true, code: "NO_ENTRY", message: rules.messageFor(where, "NO_ENTRY") };
    }
  }
  return { ok: true, enforced: true, city_id: cityIds[0] || null };
}

/** Pickup then drop, each against its own rules; the first failure wins and names which location it was. */
async function validateRoute({ pickup, drop, category }) {
  const pickupResult = await validateLocation({ lat: pickup?.lat, lng: pickup?.lng, kind: "pickup", category });
  if (!pickupResult.ok) return { ...pickupResult, which: "pickup" };
  const dropResult = await validateLocation({ lat: drop?.lat, lng: drop?.lng, kind: "drop", category });
  if (!dropResult.ok) return { ...dropResult, which: "drop" };
  return { ok: true, enforced: pickupResult.enforced, pickup_city_id: pickupResult.city_id ?? null, drop_city_id: dropResult.city_id ?? null };
}

const UNKNOWN_VEHICLE = { ok: false, enforced: true, code: "UNKNOWN_VEHICLE", message: "This vehicle is not available for booking." };

/**
 * A whole booking: pickup, drop and every extra stop (a stop is a place goods are dropped, so it follows the drop rules),
 * checked for each vehicle category the order's packages belong to. The categories come from the packages the server
 * validated, never from a client-sent name. With the switch on and no category resolvable the booking is refused.
 */
async function validateBooking({ pickup, drop, stops = [], categoryIds }) {
  if (!(await settings.isEnforced())) return { ok: true, enforced: false };
  const cats = [...new Set((categoryIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (cats.length === 0) return { ...UNKNOWN_VEHICLE, which: "pickup" };
  let last = { ok: true, enforced: true };
  for (const category of cats) {
    last = await validateRoute({ pickup, drop, category });
    if (!last.ok) return last;
    for (const stop of stops) {
      const result = await validateLocation({ lat: stop?.lat, lng: stop?.lng, kind: "drop", category });
      if (!result.ok) return { ...result, which: "stop" };
    }
  }
  return last;
}

/** The vehicle categories of an existing order, from its package (the server's record), else its stored name. */
async function categoryIdsForOrder(order) {
  const pkg = await prisma.tbl_package.findUnique({ where: { id: Number(order?.delivery_type) || 0 }, select: { cat_id: true } });
  if (pkg && Number(pkg.cat_id) > 0) return [Number(pkg.cat_id)];
  const byName = await resolveCategoryId(order?.category);
  return byName ? [byName] : [];
}

/**
 * Guard for changing one location of an order that already exists (new pickup, new drop, an added stop). Throws
 * Error("SERVICE_AREA_<kind>_<code>") so the controllers can answer with the exact message. A no-op while the switch is off.
 */
async function assertOrderChangeAllowed(order, { kind, lat, lng }) {
  if (!(await settings.isEnforced())) return;
  const cats = await categoryIdsForOrder(order);
  if (cats.length === 0) throw new Error("SERVICE_AREA_UNKNOWN_VEHICLE");
  for (const category of cats) {
    const result = await validateLocation({ lat, lng, kind, category });
    if (!result.ok) throw new Error(`SERVICE_AREA_${kind}_${result.code}`);
  }
}

/** Controller error map entries for assertOrderChangeAllowed: [400, exact message] per kind and reason. */
const SERVICE_AREA_ERRORS = {
  SERVICE_AREA_UNKNOWN_VEHICLE: [400, UNKNOWN_VEHICLE.message],
  ...Object.fromEntries(
    ["pickup", "drop"].flatMap((kind) =>
      ["NO_SERVICE_ZONE", "NO_ENTRY"].map((code) => [`SERVICE_AREA_${kind}_${code}`, [400, rules.messageFor(kind, code)]])),
  ),
};

module.exports = { validateLocation, validateRoute, validateBooking, assertOrderChangeAllowed, categoryIdsForOrder, resolveCategoryId, SERVICE_AREA_ERRORS };

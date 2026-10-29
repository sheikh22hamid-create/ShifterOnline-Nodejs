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
  const covering = zones.filter((zone) => rules.containsPoint(zone, lat, lng));
  if (covering.length === 0) {
    return { ok: false, enforced: true, code: "NO_SERVICE_ZONE", message: rules.messageFor(where, "NO_SERVICE_ZONE") };
  }
  const cityIds = [...new Set(covering.map((zone) => zone.city_id).filter((id) => Number.isInteger(id) && id > 0))];

  const categoryId = await resolveCategoryId(category);
  if (categoryId && cityIds.length > 0) {
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

module.exports = { validateLocation, validateRoute, resolveCategoryId };

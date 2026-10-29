const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("../services/serviceAreaRules");

// Service zones. Two kinds share the table: 'duty' (Daily Driver duty zones, the original behaviour) and 'coverage'
// (a city's pickup service area, spec 2026-10-29). Routes run behind scopeFilter: a city admin has req.scopedCityId
// and can only list, create, edit and delete their own city's zones; a superadmin (scopedCityId null) any city.
// Deleting a 'duty' zone stays superadmin only.
const KINDS = ["duty", "coverage"];

const cityOf = (value) => (value && !isNaN(Number(value)) && Number(value) > 0 ? Number(value) : null);
const polygonText = (value) =>
  value && String(value).trim() !== "" ? (typeof value === "string" ? value.trim() : JSON.stringify(value)) : null;
const fail = (res, status, message) => res.status(status).json({ success: false, message });

/**
 * Lists zones: a superadmin sees all (or one city with ?city_id), a city admin their own city's plus any zone not yet
 * tied to a city. ?kind=duty|coverage narrows the list (the duty-driver pickers ask for duty).
 */
async function listZones(req, res) {
  try {
    const where = {};
    if (KINDS.includes(req.query?.kind)) where.zone_kind = req.query.kind;
    if (req.scopedCityId) where.OR = [{ city_id: req.scopedCityId }, { city_id: null }];
    const zones = await prisma.service_zone.findMany({ where, orderBy: { id: "desc" } });
    return res.json({ success: true, data: zones });
  } catch (err) {
    logger.error("Error listing service zones:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

async function createZone(req, res) {
  try {
    const { name, center_lat, center_lng, radius_km, polygon_geojson } = req.body;
    const zoneKind = req.body.zone_kind === undefined ? "duty" : req.body.zone_kind;
    if (!KINDS.includes(zoneKind)) return fail(res, 400, "Unknown zone type");

    // A city admin always works in their own city, whatever the request says.
    const cityId = req.scopedCityId || cityOf(req.body.city_id);
    if (zoneKind === "coverage" && !cityId) return fail(res, 400, "Choose the city this pickup area belongs to");

    if (!name || center_lat == null || center_lng == null) {
      return fail(res, 400, "Name, Center Latitude, and Center Longitude are required.");
    }
    if (zoneKind === "coverage") {
      const valid = rules.validZonePayload({ name, polygon_geojson, center_lat, center_lng, radius_km });
      if (!valid.ok) return fail(res, 400, valid.error);
    }

    const rKm = radius_km != null && !isNaN(parseFloat(radius_km)) ? parseFloat(radius_km) : 5.0;
    const zone = await prisma.service_zone.create({
      data: {
        name: String(name).trim(),
        city_id: cityId,
        center_lat: parseFloat(center_lat),
        center_lng: parseFloat(center_lng),
        radius_km: rKm,
        polygon_geojson: polygonText(polygon_geojson),
        zone_kind: zoneKind,
        status: 1,
      },
    });
    return res.json({ success: true, message: "Service zone created successfully", data: zone });
  } catch (err) {
    logger.error("Error creating service zone:", err);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
}

/** The zone, if this admin may manage it (a city admin only their own city's); sends the failure itself otherwise. */
async function ownedZone(req, res) {
  const zone = await prisma.service_zone.findUnique({ where: { id: Number(req.params.id) } });
  if (!zone) {
    fail(res, 404, "Zone not found");
    return null;
  }
  if (req.scopedCityId && zone.city_id !== req.scopedCityId) {
    fail(res, 403, "This zone belongs to another city");
    return null;
  }
  return zone;
}

async function updateZone(req, res) {
  try {
    const zone = await ownedZone(req, res);
    if (!zone) return undefined;
    const { name, center_lat, center_lng, radius_km, polygon_geojson, status } = req.body;

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    // Only a superadmin can move a zone to another city.
    if (req.body.city_id !== undefined && !req.scopedCityId) data.city_id = cityOf(req.body.city_id);
    if (center_lat !== undefined) data.center_lat = parseFloat(center_lat);
    if (center_lng !== undefined) data.center_lng = parseFloat(center_lng);
    if (radius_km !== undefined) data.radius_km = parseFloat(radius_km);
    if (polygon_geojson !== undefined) data.polygon_geojson = polygonText(polygon_geojson);
    if (status !== undefined) data.status = Number(status);

    if (zone.zone_kind === "coverage") {
      const valid = rules.validZonePayload({
        name: data.name ?? zone.name,
        polygon_geojson: data.polygon_geojson !== undefined ? data.polygon_geojson : zone.polygon_geojson,
        center_lat: data.center_lat ?? zone.center_lat,
        center_lng: data.center_lng ?? zone.center_lng,
        radius_km: data.radius_km ?? zone.radius_km,
      });
      if (!valid.ok) return fail(res, 400, valid.error);
    }

    const updated = await prisma.service_zone.update({ where: { id: zone.id }, data });
    return res.json({ success: true, message: "Service zone updated successfully", data: updated });
  } catch (err) {
    logger.error("Error updating service zone:", err);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
}

async function deleteZone(req, res) {
  try {
    const zone = await ownedZone(req, res);
    if (!zone) return undefined;
    if (zone.zone_kind !== "coverage" && req.user?.role !== "superadmin") {
      return fail(res, 403, "Only a super admin can delete a duty zone");
    }
    await prisma.service_zone.delete({ where: { id: zone.id } });
    return res.json({ success: true, message: "Service zone deleted successfully" });
  } catch (err) {
    logger.error("Error deleting service zone:", err);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
}

module.exports = {
  listZones,
  createZone,
  updateZone,
  deleteZone,
};

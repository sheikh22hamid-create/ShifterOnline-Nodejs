const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("../services/serviceAreaRules");

// Admin CRUD for vehicle No Entry Zones (spec 2026-10-29). One row = one area for one city + vehicle category + kind
// ('pickup' | 'drop'). A city admin (req.scopedCityId set by scopeFilter) can only touch their own city; a superadmin
// names the city in the body or filters the list with ?city_id.
const KINDS = ["pickup", "drop"];

const fail = (res, status, message) => res.status(status).json({ success: false, message });

/** Centre of the drawn polygon (or the sent centre), so a zone always has the centre fields the table requires. */
function centreOf(body) {
  const polygon = rules.parsePolygon(body.polygon_geojson);
  if (polygon) {
    return {
      center_lat: polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length,
      center_lng: polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length,
    };
  }
  return { center_lat: Number(body.center_lat), center_lng: Number(body.center_lng) };
}

const polygonText = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return typeof value === "string" ? value.trim() : JSON.stringify(value);
};

async function list(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;
    if (req.query.category_id) where.category_id = Number(req.query.category_id);
    if (KINDS.includes(req.query.kind)) where.kind = req.query.kind;
    const rows = await prisma.vehicle_no_entry_zone.findMany({ where, orderBy: { id: "desc" } });
    return res.json({ success: true, data: rows });
  } catch (err) {
    logger.error("noEntryZone.list failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

async function create(req, res) {
  try {
    const body = req.body || {};
    const cityId = req.scopedCityId || Number(body.city_id);
    if (!Number.isInteger(cityId) || cityId <= 0) return fail(res, 400, "Choose a city");
    const categoryId = Number(body.category_id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) return fail(res, 400, "Choose a vehicle category");
    if (!KINDS.includes(body.kind)) return fail(res, 400, "Choose Pickup or Drop No Entry Zone");
    const category = await prisma.pkg_category.findUnique({ where: { id: categoryId } });
    if (!category) return fail(res, 400, "Unknown vehicle category");
    const valid = rules.validZonePayload(body);
    if (!valid.ok) return fail(res, 400, valid.error);
    const centre = centreOf(body);
    const zone = await prisma.vehicle_no_entry_zone.create({
      data: {
        name: String(body.name).trim(), city_id: cityId, category_id: categoryId, kind: body.kind,
        ...centre, radius_km: Number(body.radius_km) > 0 ? Number(body.radius_km) : 1,
        polygon_geojson: polygonText(body.polygon_geojson), status: body.status === 0 ? 0 : 1,
      },
    });
    return res.json({ success: true, message: "No Entry Zone saved", data: zone });
  } catch (err) {
    logger.error("noEntryZone.create failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

/** The zone, if this admin may manage it: a city admin only their own city's. Sends the failure itself otherwise. */
async function ownedZone(req, res) {
  const zone = await prisma.vehicle_no_entry_zone.findUnique({ where: { id: Number(req.params.id) } });
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

async function update(req, res) {
  try {
    const zone = await ownedZone(req, res);
    if (!zone) return undefined;
    const body = req.body || {};
    const data = {};
    if (body.name !== undefined) {
      if (!String(body.name).trim()) return fail(res, 400, "Zone name is required");
      data.name = String(body.name).trim();
    }
    if (body.status !== undefined) data.status = Number(body.status) === 0 ? 0 : 1;
    if (body.kind !== undefined) {
      if (!KINDS.includes(body.kind)) return fail(res, 400, "Choose Pickup or Drop No Entry Zone");
      data.kind = body.kind;
    }
    if (body.category_id !== undefined) {
      const category = await prisma.pkg_category.findUnique({ where: { id: Number(body.category_id) } });
      if (!category) return fail(res, 400, "Unknown vehicle category");
      data.category_id = category.id;
    }
    if (body.polygon_geojson !== undefined || body.center_lat !== undefined || body.radius_km !== undefined) {
      const shape = {
        name: data.name || zone.name,
        polygon_geojson: body.polygon_geojson !== undefined ? body.polygon_geojson : zone.polygon_geojson,
        center_lat: body.center_lat !== undefined ? body.center_lat : zone.center_lat,
        center_lng: body.center_lng !== undefined ? body.center_lng : zone.center_lng,
        radius_km: body.radius_km !== undefined ? body.radius_km : zone.radius_km,
      };
      const valid = rules.validZonePayload(shape);
      if (!valid.ok) return fail(res, 400, valid.error);
      Object.assign(data, centreOf(shape), { polygon_geojson: polygonText(shape.polygon_geojson), radius_km: Number(shape.radius_km) > 0 ? Number(shape.radius_km) : 1 });
    }
    const updated = await prisma.vehicle_no_entry_zone.update({ where: { id: zone.id }, data });
    return res.json({ success: true, message: "No Entry Zone updated", data: updated });
  } catch (err) {
    logger.error("noEntryZone.update failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

async function remove(req, res) {
  try {
    const zone = await ownedZone(req, res);
    if (!zone) return undefined;
    await prisma.vehicle_no_entry_zone.delete({ where: { id: zone.id } });
    return res.json({ success: true, message: "No Entry Zone deleted" });
  } catch (err) {
    logger.error("noEntryZone.remove failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

module.exports = { list, create, update, remove };

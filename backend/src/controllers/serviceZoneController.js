const prisma = require("../config/db");
const logger = require("../utils/logger");

/**
 * Lists all service zones.
 */
async function listZones(req, res) {
  try {
    const zones = await prisma.service_zone.findMany({
      orderBy: { id: "desc" },
    });
    return res.json({ success: true, data: zones });
  } catch (err) {
    logger.error("Error listing service zones:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

/**
 * Creates a new service zone.
 */
async function createZone(req, res) {
  try {
    const { name, city_id, center_lat, center_lng, radius_km, polygon_geojson } = req.body;

    if (!name || center_lat == null || center_lng == null) {
      return res.status(400).json({ success: false, message: "Name, Center Latitude, and Center Longitude are required." });
    }

    const cLat = parseFloat(center_lat);
    const cLng = parseFloat(center_lng);
    const rKm = radius_km != null && !isNaN(parseFloat(radius_km)) ? parseFloat(radius_km) : 5.0;
    const cId = city_id && !isNaN(Number(city_id)) && Number(city_id) > 0 ? Number(city_id) : null;
    const polyGeo = polygon_geojson && String(polygon_geojson).trim() !== ""
      ? (typeof polygon_geojson === "string" ? polygon_geojson.trim() : JSON.stringify(polygon_geojson))
      : null;

    const zone = await prisma.service_zone.create({
      data: {
        name: String(name).trim(),
        city_id: cId,
        center_lat: cLat,
        center_lng: cLng,
        radius_km: rKm,
        polygon_geojson: polyGeo,
        status: 1,
      },
    });

    return res.json({ success: true, message: "Service zone created successfully", data: zone });
  } catch (err) {
    logger.error("Error creating service zone:", err);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
}

/**
 * Updates an existing service zone.
 */
async function updateZone(req, res) {
  try {
    const { id } = req.params;
    const { name, city_id, center_lat, center_lng, radius_km, polygon_geojson, status } = req.body;

    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (city_id !== undefined) {
      data.city_id = city_id && !isNaN(Number(city_id)) && Number(city_id) > 0 ? Number(city_id) : null;
    }
    if (center_lat !== undefined) data.center_lat = parseFloat(center_lat);
    if (center_lng !== undefined) data.center_lng = parseFloat(center_lng);
    if (radius_km !== undefined) data.radius_km = parseFloat(radius_km);
    if (polygon_geojson !== undefined) {
      data.polygon_geojson = polygon_geojson && String(polygon_geojson).trim() !== ""
        ? (typeof polygon_geojson === "string" ? polygon_geojson.trim() : JSON.stringify(polygon_geojson))
        : null;
    }
    if (status !== undefined) data.status = Number(status);

    const updated = await prisma.service_zone.update({
      where: { id: Number(id) },
      data,
    });

    return res.json({ success: true, message: "Service zone updated successfully", data: updated });
  } catch (err) {
    logger.error("Error updating service zone:", err);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
  }
}

/**
 * Deletes a service zone.
 */
async function deleteZone(req, res) {
  try {
    const { id } = req.params;
    await prisma.service_zone.delete({
      where: { id: Number(id) },
    });
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

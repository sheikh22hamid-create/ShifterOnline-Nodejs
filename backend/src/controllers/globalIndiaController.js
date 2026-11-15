const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("../services/globalIndiaSettings");
const globalIndia = require("../services/globalIndiaService");
const rules = require("../services/globalIndiaRules");

// Super-admin view of the Global India fallback (spec 2026-11-15): the switch, which city is "Global India", a coverage
// monitor (every city's geofence count and when it last changed) and a "who serves this pickup?" checker. There is no
// geofence to draw for Global India: its area is India minus every active city geofence, worked out per pickup.

const COVERAGE_TEXT = "Global India Coverage: all serviceable locations within India that are not covered by any active City Admin geofence.";
const fail = (res, status, message) => res.status(status).json({ success: false, message });

async function status(_req, res) {
  try {
    const config = await settings.getConfig({ fresh: true, assumeEnabled: true });
    const live = await settings.getConfig({ fresh: true });
    const [cities, zones] = await Promise.all([
      prisma.tbl_city.findMany({ orderBy: { id: "asc" } }),
      prisma.service_zone.findMany({ where: { status: 1 } }),
    ]);
    const globalId = config.globalCity?.id ?? null;
    const boundary = rules.loadIndiaRings();
    return res.json({
      success: true,
      data: {
        enabled: live.enabled,
        configured_city_id: live.configuredCityId,
        global_city: config.globalCity,
        // The fallback can only do something once a Global India city exists and is active.
        ready: Boolean(config.globalCity),
        coverage_text: COVERAGE_TEXT,
        boundary: { polygons: boundary.length, points: boundary.reduce((n, ring) => n + ring.length, 0) },
        cities: cities.map((city) => {
          const own = zones.filter((zone) => Number(zone.city_id) === Number(city.id));
          const lastChange = own.reduce((latest, zone) => (zone.updated_at && (!latest || zone.updated_at > latest) ? zone.updated_at : latest), null);
          return {
            id: city.id,
            title: city.title,
            active: Number(city.status) === 1,
            is_global: Number(city.id) === Number(globalId),
            geofences: own.length,
            geofence_last_changed: lastChange,
          };
        }),
      },
    });
  } catch (err) {
    logger.error("globalIndiaController.status failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

async function update(req, res) {
  try {
    const { enabled, city_id: cityId } = req.body || {};
    if (cityId !== undefined && cityId !== null && cityId !== "") {
      const city = await prisma.tbl_city.findUnique({ where: { id: Number(cityId) } });
      if (!city) return fail(res, 400, "That city does not exist");
      if (Number(city.status) !== 1) return fail(res, 400, "Choose an active city as Global India");
      await settings.setValue(settings.CITY_KEY, Number(cityId));
    } else if (cityId === null || cityId === "") {
      await settings.setValue(settings.CITY_KEY, "");
    }
    if (enabled !== undefined) {
      // Turning it on needs a Global India city, otherwise it would silently do nothing for uncovered areas.
      if (enabled === true || enabled === "1" || enabled === 1 || enabled === "true") {
        const probe = await settings.getConfig({ fresh: true, assumeEnabled: true });
        if (!probe.globalCity) return fail(res, 400, "Set the Global India city first (an active city, or one titled \"Global India\").");
        await settings.setValue(settings.ENABLED_KEY, "1");
      } else {
        await settings.setValue(settings.ENABLED_KEY, "0");
      }
    }
    return status(req, res);
  } catch (err) {
    logger.error("globalIndiaController.update failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

/** Who would serve a pickup right now (works while the switch is off too: says what it WOULD do). */
async function check(req, res) {
  try {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return fail(res, 400, "Enter a valid latitude and longitude");
    }
    const live = await settings.getConfig({ fresh: true });
    const decision = await globalIndia.resolve(lat, lng, { ignoreSwitch: true });
    return res.json({
      success: true,
      data: {
        switch_enabled: live.enabled,
        result: decision.kind, // city | global | no_global | outside_india
        city_id: decision.cityId || null,
        city_name: decision.cityName || null,
        geofence: decision.kind === "city" ? { id: decision.zoneId, name: decision.zoneName } : null,
      },
    });
  } catch (err) {
    logger.error("globalIndiaController.check failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

module.exports = { status, update, check };

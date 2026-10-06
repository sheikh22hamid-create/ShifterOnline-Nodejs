const prisma = require("../config/db");
const logger = require("../utils/logger");

const KEYS = Object.freeze({ enabled: "receiver_tracking_enabled" });
const OFF = new Set(["0", "false", "off", "no"]);
const KEY_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;
const STYLE_SHAPE = /^[a-z0-9-]{1,40}$/;
const ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';

// Default ON when the row is missing or empty (the admin Settings page shows it as enabled);
// fail closed when the setting cannot be read, so a broken read never starts sending links.
async function isTrackingEnabled() {
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: [KEYS.enabled] } } });
    const value = rows && rows[0] ? String(rows[0].setting_value ?? "").trim().toLowerCase() : "";
    if (value === "") return true;
    return !OFF.has(value);
  } catch (err) {
    logger.error("isTrackingEnabled: failed to read settings, treating tracking as disabled:", err);
    return false;
  }
}

// The key ships inside the page (it is a public, domain-restricted MapTiler key), so both values
// are shape-checked before they are put into a URL.
function getMapConfig(env = process.env) {
  const key = String(env.MAPTILER_KEY || "").trim();
  if (!KEY_SHAPE.test(key)) return { tileUrl: null, attribution: "" };
  const rawStyle = String(env.MAPTILER_STYLE || "").trim();
  const style = STYLE_SHAPE.test(rawStyle) ? rawStyle : "streets-v2";
  return { tileUrl: `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}.png?key=${key}`, attribution: ATTRIBUTION };
}

module.exports = { KEYS, isTrackingEnabled, getMapConfig };

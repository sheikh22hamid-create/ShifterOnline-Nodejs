const { resolveLocationTitle, sanitizeTitle, extractAreaFromAddress } = require("../utils/addressTitle");

function isFiniteCoord(v) {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "boolean") return false;
  return Number.isFinite(Number(v));
}

/**
 * Main Area title for one side of an order. A non-empty client title wins
 * without a lookup; otherwise reverse-geocode. Coordinates are read only and
 * passed through untouched. If Google reverse-geocoding fails/returns null,
 * falls back to parsing the locality from the raw address string. Never throws.
 */
async function resolveSideTitle(lat, lng, clientTitle, rawAddress) {
  const client = sanitizeTitle(clientTitle);
  if (client) return client;
  if (isFiniteCoord(lat) && isFiniteCoord(lng)) {
    try {
      const geo = await resolveLocationTitle(lat, lng);
      if (geo) return geo;
    } catch (_) {}
  }
  if (typeof rawAddress === "string" && rawAddress.trim()) {
    try {
      return extractAreaFromAddress(rawAddress);
    } catch (_) {}
  }
  return null;
}

async function resolveOrderTitles({
  plat,
  plong,
  dlat,
  dlong,
  clientPickupTitle,
  clientDropTitle,
  paddress,
  daddress,
} = {}) {
  const [pickup_title, drop_title] = await Promise.all([
    resolveSideTitle(plat, plong, clientPickupTitle, paddress),
    resolveSideTitle(dlat, dlong, clientDropTitle, daddress),
  ]);
  return { pickup_title, drop_title };
}

module.exports = { resolveSideTitle, resolveOrderTitles };

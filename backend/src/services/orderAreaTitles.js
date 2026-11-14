const { resolveLocationTitle, sanitizeTitle } = require("../utils/addressTitle");

function isFiniteCoord(v) {
  if (v === null || v === undefined || v === "") return false;
  if (typeof v === "boolean") return false;
  return Number.isFinite(Number(v));
}

/**
 * Main Area title for one side of an order. A non-empty client title wins
 * without a lookup; otherwise reverse-geocode. Coordinates are read only and
 * passed through untouched. Never throws.
 */
async function resolveSideTitle(lat, lng, clientTitle) {
  const client = sanitizeTitle(clientTitle);
  if (client) return client;
  if (!isFiniteCoord(lat) || !isFiniteCoord(lng)) return null;
  try {
    return (await resolveLocationTitle(lat, lng)) || null;
  } catch (_) {
    return null;
  }
}

async function resolveOrderTitles({
  plat,
  plong,
  dlat,
  dlong,
  clientPickupTitle,
  clientDropTitle,
} = {}) {
  const [pickup_title, drop_title] = await Promise.all([
    resolveSideTitle(plat, plong, clientPickupTitle),
    resolveSideTitle(dlat, dlong, clientDropTitle),
  ]);
  return { pickup_title, drop_title };
}

module.exports = { resolveSideTitle, resolveOrderTitles };

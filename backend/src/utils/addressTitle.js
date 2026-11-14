const logger = require("./logger");

/**
 * "Main Area" (recognisable locality, e.g. Khajrana) for a pickup/drop point.
 *
 * Only these Google address-component types can become a Main Area, in this
 * order. City / district / state / PIN / Plus Code are never a Main Area: if
 * none of these types is present the title is left empty (a wrong locality is
 * worse than none).
 */
const MAIN_AREA_PRIORITY = Object.freeze([
  "sublocality_level_1",
  "neighborhood",
  "sublocality",
  "sublocality_level_2",
]);

const TITLE_MAX_LENGTH = 120;
const DEFAULT_TIMEOUT_MS = 2000;
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

// Plus Code as the first token: full/short codes ("7JMH+4X", "PWD4+0X") and
// the loose "pwd40+" style seen in app addresses. A token of 2-8 letters/digits,
// a "+", then 0-3 letters/digits.
const PLUS_CODE_TOKEN = /^[A-Za-z0-9]{2,8}\+[A-Za-z0-9]{0,3}$/;

function isPlusCode(text) {
  if (typeof text !== "string") return false;
  const first = text.trim().split(/[\s,]+/)[0];
  return !!first && PLUS_CODE_TOKEN.test(first);
}

function sanitizeTitle(value) {
  if (typeof value !== "string") return null;
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_MAX_LENGTH)
    .trim();
  return cleaned ? cleaned : null;
}

function emptyParts() {
  return { mainArea: "", route: "", premise: "", city: "", district: "", state: "", pin: "", plusCode: "" };
}

function parseGoogleAddressComponents(components) {
  const out = emptyParts();
  if (!Array.isArray(components)) return out;

  const byType = {};
  for (const c of components) {
    if (!c || !Array.isArray(c.types)) continue;
    const name = typeof c.long_name === "string" ? c.long_name.trim() : "";
    if (!name) continue;
    for (const t of c.types) {
      if (!(t in byType)) byType[t] = name;
    }
  }

  for (const type of MAIN_AREA_PRIORITY) {
    const name = byType[type];
    if (name && !isPlusCode(name)) {
      out.mainArea = name;
      break;
    }
  }
  out.route = byType.route || "";
  out.premise = byType.premise || byType.street_number || "";
  out.city = byType.locality || "";
  out.district = byType.administrative_area_level_2 || byType.administrative_area_level_3 || "";
  out.state = byType.administrative_area_level_1 || "";
  out.pin = byType.postal_code || "";
  out.plusCode = byType.plus_code || "";
  return out;
}

function pickMainAreaFromResults(results) {
  if (!Array.isArray(results)) return "";
  for (const r of results) {
    const { mainArea } = parseGoogleAddressComponents(r && r.address_components);
    if (mainArea) return mainArea;
  }
  return "";
}

function stripLeadingPlusCode(rawAddress) {
  if (typeof rawAddress !== "string") return "";
  const parts = rawAddress.split(",").map((p) => p.trim());
  if (parts.length && isPlusCode(parts[0])) parts.shift();
  return parts.filter(Boolean).join(", ");
}

/**
 * Display formatter. With structured components, mainArea comes from them;
 * with a raw string only, a leading Plus Code is stripped and mainArea is ""
 * (no guessing a locality from comma positions).
 */
function formatAddressForDisplay({ components, rawAddress } = {}) {
  const parts = parseGoogleAddressComponents(components);
  let formattedAddress = "";
  if (typeof rawAddress === "string" && rawAddress.trim()) {
    formattedAddress = stripLeadingPlusCode(rawAddress);
  } else if (Array.isArray(components)) {
    const statePin = [parts.state, parts.pin].filter(Boolean).join(" ");
    formattedAddress = [parts.premise, parts.route, parts.mainArea, parts.city, statePin]
      .filter(Boolean)
      .join(", ");
  }
  return { mainArea: parts.mainArea, formattedAddress };
}

/**
 * Reverse-geocodes a point to its Main Area. Never throws; null on any
 * failure (no key, HTTP error, bad JSON, non-OK status, timeout, no locality).
 * lat/lng are only read to build the request URL.
 */
async function resolveLocationTitle(lat, lng, opts = {}) {
  const apiKey = opts.apiKey || process.env.GOOGLE_MAPS_API_KEY;
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch : null);
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS;

  if (!apiKey) {
    logger.warn("resolveLocationTitle: GOOGLE_MAPS_API_KEY is not set; skipping Main Area lookup.");
    return null;
  }
  if (!fetchImpl) return null;

  const url =
    `${GEOCODE_URL}?latlng=${lat},${lng}` + `&language=en&key=${encodeURIComponent(apiKey)}`;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      resolve({ timedOut: true });
    }, timeoutMs);
  });

  try {
    const work = (async () => {
      const res = await fetchImpl(url, controller ? { signal: controller.signal } : undefined);
      if (!res || !res.ok) {
        logger.warn(`resolveLocationTitle: HTTP ${res ? res.status : "no response"} for ${lat},${lng}`);
        return { title: null };
      }
      const data = await res.json();
      if (!data || data.status !== "OK") {
        logger.warn(`resolveLocationTitle: status ${data && data.status} for ${lat},${lng}`);
        return { title: null };
      }
      return { title: sanitizeTitle(pickMainAreaFromResults(data.results)) };
    })();
    // Swallow a late rejection after the timeout wins the race.
    work.catch(() => {});

    const outcome = await Promise.race([work, timeout]);
    if (outcome.timedOut) {
      logger.warn(`resolveLocationTitle: timed out after ${timeoutMs}ms for ${lat},${lng}`);
      return null;
    }
    return outcome.title;
  } catch (err) {
    logger.error(`resolveLocationTitle error for ${lat},${lng}:`, err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  MAIN_AREA_PRIORITY,
  isPlusCode,
  sanitizeTitle,
  parseGoogleAddressComponents,
  pickMainAreaFromResults,
  formatAddressForDisplay,
  resolveLocationTitle,
};

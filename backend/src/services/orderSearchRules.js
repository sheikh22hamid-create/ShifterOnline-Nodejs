// Pure rules for System 2 (Vehicle Category First) and the city-wise Booking Guarantee
// (spec 2026-10-12). No I/O here: orderSearchSettings.js feeds these the rows it loaded.

const SYSTEM = Object.freeze({ DRIVER_AVAILABILITY: 1, VEHICLE_FIRST: 2 });
const DEFAULT_SEARCH_SECONDS = 60;
const LIMITS = Object.freeze({
  radiusKm: [1, 30],
  searchSeconds: [15, 600],
  adminWindowMinutes: [1, 1440],
});

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const inRange = (n, [lo, hi]) => Number.isFinite(n) && n >= lo && n <= hi;
const blank = (v) => v === null || v === undefined || v === "";

function defaultSettings() {
  return {
    searchSystem: SYSTEM.DRIVER_AVAILABILITY,
    searchRadiusKm: null,
    driverSearchSeconds: DEFAULT_SEARCH_SECONDS,
    guaranteeEnabled: false,
    adminWindowMinutes: null,
    guaranteeReferralsRequired: 1,
    guaranteeStartTime: null,
    guaranteeEndTime: null,
  };
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const cleanTime = (v) => (typeof v === "string" && TIME_RE.test(v.trim()) ? v.trim() : null);

/**
 * Whether `now` falls inside the city's daily compensation window (IST "HH:MM", end exclusive; a window like
 * 22:00-06:00 wraps past midnight). No window set (either side missing) = all day, as before.
 */
function isWithinGuaranteeWindow(settings, now = new Date()) {
  const start = cleanTime(settings?.guaranteeStartTime);
  const end = cleanTime(settings?.guaranteeEndTime);
  if (!start || !end) return true;
  const ist = new Date(now.getTime() + 330 * 60 * 1000);
  const cur = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === e) return true;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** A city_order_settings row (snake_case DB columns) as the camelCase settings object; bad values fall back per field. */
function normalizeRow(row) {
  const d = defaultSettings();
  if (!row) return d;
  const radius = blank(row.search_radius_km) ? null : Number(row.search_radius_km);
  const seconds = blank(row.driver_search_seconds) ? d.driverSearchSeconds : Number(row.driver_search_seconds);
  const windowMin = blank(row.admin_window_minutes) ? null : Number(row.admin_window_minutes);
  const refs = Number(row.guarantee_referrals_required);
  const startTime = cleanTime(row.guarantee_start_time);
  const endTime = cleanTime(row.guarantee_end_time);
  return {
    searchSystem: Number(row.search_system) === SYSTEM.VEHICLE_FIRST ? SYSTEM.VEHICLE_FIRST : SYSTEM.DRIVER_AVAILABILITY,
    searchRadiusKm: radius !== null && inRange(radius, LIMITS.radiusKm) ? radius : null,
    driverSearchSeconds: inRange(seconds, LIMITS.searchSeconds) ? Math.round(seconds) : DEFAULT_SEARCH_SECONDS,
    guaranteeEnabled: Boolean(row.guarantee_enabled),
    adminWindowMinutes: windowMin !== null && inRange(windowMin, LIMITS.adminWindowMinutes) ? Math.round(windowMin) : null,
    guaranteeReferralsRequired: Number.isInteger(refs) && refs >= 1 ? refs : 1,
    // Both or neither: a half-set window is ignored (all day) rather than guessed at.
    guaranteeStartTime: startTime && endTime ? startTime : null,
    guaranteeEndTime: startTime && endTime ? endTime : null,
  };
}

const toBool = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";

/** Validates admin input (camelCase). Returns only the keys that were sent; throws a 400 on the first bad value. */
function validateSettingsInput(input = {}) {
  const out = {};
  if (input.searchSystem !== undefined) {
    const n = blank(input.searchSystem) ? NaN : Number(input.searchSystem);
    if (n !== SYSTEM.DRIVER_AVAILABILITY && n !== SYSTEM.VEHICLE_FIRST) throw badRequest("search_system must be 1 or 2");
    out.searchSystem = n;
  }
  if (input.searchRadiusKm !== undefined) {
    if (blank(input.searchRadiusKm)) out.searchRadiusKm = null;
    else {
      const n = Number(input.searchRadiusKm);
      if (!inRange(n, LIMITS.radiusKm)) throw badRequest("search_radius_km must be between 1 and 30");
      out.searchRadiusKm = n;
    }
  }
  if (input.driverSearchSeconds !== undefined) {
    const n = blank(input.driverSearchSeconds) ? NaN : Number(input.driverSearchSeconds);
    if (!Number.isInteger(n) || !inRange(n, LIMITS.searchSeconds)) {
      throw badRequest("driver_search_seconds must be a whole number between 15 and 600");
    }
    out.driverSearchSeconds = n;
  }
  if (input.guaranteeEnabled !== undefined) out.guaranteeEnabled = toBool(input.guaranteeEnabled);
  if (input.adminWindowMinutes !== undefined) {
    if (blank(input.adminWindowMinutes)) out.adminWindowMinutes = null;
    else {
      const n = Number(input.adminWindowMinutes);
      if (!Number.isInteger(n) || !inRange(n, LIMITS.adminWindowMinutes)) {
        throw badRequest("admin_window_minutes must be a whole number between 1 and 1440");
      }
      out.adminWindowMinutes = n;
    }
  }
  if (input.guaranteeReferralsRequired !== undefined) {
    const n = blank(input.guaranteeReferralsRequired) ? NaN : Number(input.guaranteeReferralsRequired);
    if (!Number.isInteger(n) || n < 1) throw badRequest("guarantee_referrals_required must be a whole number of at least 1");
    out.guaranteeReferralsRequired = n;
  }
  const hasStart = input.guaranteeStartTime !== undefined;
  const hasEnd = input.guaranteeEndTime !== undefined;
  if (hasStart || hasEnd) {
    const start = hasStart && !blank(input.guaranteeStartTime) ? String(input.guaranteeStartTime).trim() : null;
    const end = hasEnd && !blank(input.guaranteeEndTime) ? String(input.guaranteeEndTime).trim() : null;
    if (!start && !end) {
      out.guaranteeStartTime = null;
      out.guaranteeEndTime = null;
    } else {
      if (!start || !end) throw badRequest("guarantee_start_time and guarantee_end_time must be set together");
      if (!TIME_RE.test(start) || !TIME_RE.test(end)) throw badRequest("guarantee times must be in HH:MM (24-hour) format");
      if (start === end) throw badRequest("guarantee start and end time cannot be the same");
      out.guaranteeStartTime = start;
      out.guaranteeEndTime = end;
    }
  }
  return out;
}

const searchDeadline = (now, seconds) => new Date(now.getTime() + Number(seconds) * 1000);

const isSystem2Order = (order) => Number(order?.search_system) === SYSTEM.VEHICLE_FIRST;

function hasSearchTimeLeft(order, now = new Date()) {
  if (!isSystem2Order(order) || !order.search_deadline_at) return false;
  return now.getTime() < new Date(order.search_deadline_at).getTime();
}

const FUTURE_BOOKING_TYPES = new Set(["2", "3", "scheduled", "next_day", "nextday"]);
/** false for scheduled / next-day values, in both the numeric (orders) and string (vehicle list) spellings. */
const isInstantBookingType = (value) => !FUTURE_BOOKING_TYPES.has(String(value ?? "now").trim().toLowerCase());

module.exports = {
  SYSTEM, DEFAULT_SEARCH_SECONDS, LIMITS,
  defaultSettings, normalizeRow, validateSettingsInput, isWithinGuaranteeWindow,
  searchDeadline, isSystem2Order, hasSearchTimeLeft, isInstantBookingType,
};

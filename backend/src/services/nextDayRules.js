// Pure rules for the Next-Day Daily Driver offer flow (spec 2026-10-13). No I/O.
const { haversineKm } = require("../utils/geoDistance");

const DEFAULT_DISCOUNT_PERCENT = 10; // admin-editable (nextDaySettings); the share a Daily Driver keeps is 100 - this
const MAX_DISCOUNT_PERCENT = 50;
const DEFAULT_LIVE_TIME = "14:00";
const STAGE = Object.freeze({ ARRANGING: "arranging", LIVE: "live" });
const OFFER = Object.freeze({ OFFERED: "offered", ACCEPTED: "accepted", REJECTED: "rejected", EXPIRED: "expired", CANCELLED: "cancelled" });

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** A usable discount percent (0..50), else the default; never throws. */
function normalizeDiscountPercent(percent) {
  const n = typeof percent === "string" && percent.trim() === "" ? NaN : Number(percent);
  return percent !== null && percent !== undefined && Number.isFinite(n) && n >= 0 && n <= MAX_DISCOUNT_PERCENT
    ? n
    : DEFAULT_DISCOUNT_PERCENT;
}

/** Fraction of the fare a Daily Driver keeps, e.g. 0.9 for a 10% discount. */
const driverShare = (percent) => Math.round((100 - normalizeDiscountPercent(percent)) * 100) / 10000;

/** The Daily Driver's earning for a next-day order and the discount difference admin settles. */
function splitDailyDriverFare(fare, percent = DEFAULT_DISCOUNT_PERCENT) {
  const total = round2(fare);
  const driverEarning = round2(total * (100 - normalizeDiscountPercent(percent)) / 100);
  return { driverEarning, discount: round2(total - driverEarning) };
}

function parseLiveTime(value) {
  return typeof value === "string" && TIME_RE.test(value.trim()) ? value.trim() : DEFAULT_LIVE_TIME;
}

/** UTC instant of `liveTime` (IST wall clock) on `scheduleDate` ("YYYY-MM-DD"); null when the date is unusable. */
function liveAtFor(scheduleDate, liveTime) {
  const date = String(scheduleDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = new Date(`${date}T${parseLiveTime(liveTime)}:00+05:30`);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Nearest-to-pickup first; riders with no usable location go last (stable). */
function rankByPickupDistance(order, riders) {
  const plat = Number(order.plat);
  const plong = Number(order.plong);
  const keyed = riders.map((rider, index) => {
    const lat = Number(rider.rlats);
    const lng = Number(rider.rlongs);
    const known = rider.rlats != null && rider.rlongs != null && Number.isFinite(lat) && Number.isFinite(lng);
    return { rider, index, distance: known ? haversineKm(plat, plong, lat, lng) : Infinity };
  });
  keyed.sort((a, b) => a.distance - b.distance || a.index - b.index);
  return keyed.map((k) => k.rider);
}

module.exports = { DEFAULT_DISCOUNT_PERCENT, MAX_DISCOUNT_PERCENT, normalizeDiscountPercent, driverShare, DEFAULT_LIVE_TIME, STAGE, OFFER, splitDailyDriverFare, parseLiveTime, liveAtFor, rankByPickupDistance };

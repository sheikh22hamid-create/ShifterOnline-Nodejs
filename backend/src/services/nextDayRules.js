// Pure rules for the Next-Day Daily Driver offer flow (spec 2026-10-13). No I/O.
const { haversineKm } = require("../utils/geoDistance");

const DAILY_DRIVER_SHARE = 0.9;
const DEFAULT_LIVE_TIME = "14:00";
const STAGE = Object.freeze({ ARRANGING: "arranging", LIVE: "live" });
const OFFER = Object.freeze({ OFFERED: "offered", ACCEPTED: "accepted", REJECTED: "rejected", EXPIRED: "expired", CANCELLED: "cancelled" });

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** The Daily Driver's earning for a next-day order and the 10% difference admin settles. */
function splitDailyDriverFare(fare) {
  const total = round2(fare);
  const driverEarning = round2(total * DAILY_DRIVER_SHARE);
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

module.exports = { DAILY_DRIVER_SHARE, DEFAULT_LIVE_TIME, STAGE, OFFER, splitDailyDriverFare, parseLiveTime, liveAtFor, rankByPickupDistance };

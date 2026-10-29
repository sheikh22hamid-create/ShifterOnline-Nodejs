// Pure rules for Low Fare Booking (spec 2026-10-27): the customer's date + pickup window, the discounted fare, and
// when an order is open to drivers. No I/O. Times are IST wall clock, returned as UTC instants.
const MAX_DISCOUNT_PERCENT = 50;
const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const istDay = (ms) => new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
const atIst = (date, time) => new Date(`${date}T${time}:00+05:30`);

function validateWindow(input, now, cfg) {
  const { date, from, until } = input || {};
  if (typeof date !== "string" || !DATE_RE.test(date) || Number.isNaN(atIst(date, "00:00").getTime()) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    return { ok: false, error: "Choose a valid date" };
  }
  const today = istDay(now.getTime());
  const tomorrow = istDay(now.getTime() + DAY_MS);
  const last = istDay(now.getTime() + cfg.maxDaysAhead * DAY_MS);
  if (date < tomorrow) return { ok: false, error: "Choose a date from tomorrow onwards" };
  if (date > last) return { ok: false, error: `You can book at most ${cfg.maxDaysAhead} days ahead` };
  if (typeof from !== "string" || !TIME_RE.test(from)) return { ok: false, error: "Choose a valid start time" };
  if (typeof until !== "string" || !TIME_RE.test(until)) return { ok: false, error: "Choose a valid end time" };
  const liveAt = atIst(date, from);
  const liveUntil = atIst(date, until);
  if (liveUntil.getTime() <= liveAt.getTime()) return { ok: false, error: "End time must be after the start time" };
  if (liveUntil.getTime() - liveAt.getTime() > cfg.maxWindowHours * 3600 * 1000) {
    return { ok: false, error: `The time window cannot be longer than ${cfg.maxWindowHours} hours` };
  }
  if (liveAt.getTime() <= now.getTime() || today >= date) return { ok: false, error: "Choose a date from tomorrow onwards" };
  return { ok: true, liveAt, liveUntil };
}

/** Model-1 fare minus the admin percentage (clamped 0..50), 2 decimals; the two parts always add up to the fare. */
function discountedFare(model1, percent) {
  const fare = Math.max(0, round2(model1));
  const pct = Math.min(MAX_DISCOUNT_PERCENT, Math.max(0, Number.isFinite(Number(percent)) ? Number(percent) : 0));
  const discountAmount = round2((fare * pct) / 100);
  return { discounted: round2(fare - discountAmount), discountAmount };
}

/** From the window start up to, but not including, its end; only for a low_fare order. */
function isOpenNow(order, now) {
  if (!order || order.next_day_stage !== "low_fare" || !order.next_day_live_at || !order.next_day_live_until) return false;
  const t = now.getTime();
  return t >= new Date(order.next_day_live_at).getTime() && t < new Date(order.next_day_live_until).getTime();
}

/** What the admin sees for a low_fare order: Cancelled / Expired / Accepted / Waiting to open / Open. */
function statusOf(order, now, expireReason = "No driver accepted in the booking window") {
  if (String(order.o_status) === "Cancelled") return order.cancel_reason === expireReason ? "Expired" : "Cancelled";
  if (Number(order.rid) > 0) return "Accepted";
  const t = now.getTime();
  if (t < new Date(order.next_day_live_at).getTime()) return "Waiting to open";
  if (t < new Date(order.next_day_live_until).getTime()) return "Open";
  return "Expired";
}

module.exports = { validateWindow, discountedFare, isOpenNow, statusOf, MAX_DISCOUNT_PERCENT };

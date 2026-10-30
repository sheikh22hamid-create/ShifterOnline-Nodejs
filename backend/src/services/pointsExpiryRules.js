// Points expiry (spec 2026-10-30). Pure rules, no I/O.
//
// Points live as one counter (referral_points on tbl_user / tbl_rider) plus the ledger tbl_referral_point_log. Every
// credit row can carry its own expiry (expires_at). Redemptions never recorded which credit they used, so expiry works
// on "lots" rebuilt by replaying a user's ledger oldest-first: a redemption consumes the lot that expires soonest
// (lots that never expire last). That is also what the user would want: the points about to expire are spent first.

const ACTIVITIES = Object.freeze({
  successful_referral: "Successful Referral", // referral reward when the referred person completes a ride
  number_sharing: "Number Sharing",           // reward for a shared number (lead) that turns into a customer/driver
  referral_sent: "Referral Sent",             // sign-up bonus: the points credited because a referral was used
});
const USER_TYPES = Object.freeze(["USER", "DRIVER"]);
const UNITS = Object.freeze(["days", "weeks", "months"]);
const MAX_VALUE = { days: 3650, weeks: 520, months: 120 };

const isActivity = (a) => Object.prototype.hasOwnProperty.call(ACTIVITIES, a);
const activityLabel = (a) => ACTIVITIES[a] || "Points";

/** One duration entry -> { value, unit } or null (= points of this activity never expire). Throws on bad input. */
function parseDuration(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw.value);
  const unit = String(raw.unit || "").toLowerCase();
  if (!UNITS.includes(unit)) throw new Error("Expiry unit must be days, weeks or months");
  if (!Number.isInteger(value) || value <= 0) throw new Error("Expiry duration must be a whole number greater than 0");
  if (value > MAX_VALUE[unit]) throw new Error(`Expiry duration is too long (max ${MAX_VALUE[unit]} ${unit})`);
  return { value, unit };
}

/**
 * Merge an admin update into the stored config. `incoming` only has to name what changes, so saving Customer rows can
 * never overwrite Driver rows. A null entry clears that row (back to "never expires").
 */
function mergeConfig(existing, incoming) {
  const out = JSON.parse(JSON.stringify(existing || {}));
  for (const [activity, perType] of Object.entries(incoming || {})) {
    if (!isActivity(activity)) throw new Error(`Unknown reward activity: ${activity}`);
    if (perType === null || typeof perType !== "object") throw new Error(`Invalid expiry settings for ${activity}`);
    for (const [type, raw] of Object.entries(perType)) {
      if (!USER_TYPES.includes(type)) throw new Error(`Unknown user type: ${type}`);
      out[activity] = out[activity] || {};
      const parsed = parseDuration(raw);
      if (parsed) out[activity][type] = parsed;
      else delete out[activity][type];
    }
    if (out[activity] && !Object.keys(out[activity]).length) delete out[activity];
  }
  return out;
}

/** The configured duration for an activity and recipient type, or null when none is set (no default is invented). */
function durationFor(config, activity, userType) {
  const d = config?.[activity]?.[userType];
  if (!d) return null;
  try { return parseDuration(d); } catch { return null; }
}

/** credit time + duration. Months are calendar months (10 Jan + 3 months = 10 Apr); a short target month clamps to its last day. */
function addDuration(from, { value, unit }) {
  const d = new Date(from.getTime());
  if (unit === "days") d.setUTCDate(d.getUTCDate() + value);
  else if (unit === "weeks") d.setUTCDate(d.getUTCDate() + value * 7);
  else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + value);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  }
  return d;
}

const durationText = ({ value, unit }) => `${value} ${value === 1 ? unit.replace(/s$/, "") : unit}`;

/** "10 Apr 2027" in India time (what the apps and the admin panel show). */
function formatExpiryDate(date) {
  return new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

/** "Successful Referral: +100 points | Expires on: 10 Apr 2027" (no expiry part when the credit never expires). */
function describeCredit(activity, points, expiresAt) {
  return `${activityLabel(activity)}: +${points} points${expiresAt ? ` | Expires on: ${formatExpiryDate(expiresAt)}` : ""}`;
}
const expiryNote = (activity) => `Points Expired – ${activityLabel(activity)}`;

// Ledger sources that hand redeemed points back (a cancelled ride). They restore the lots the points came from, so a
// redeem-then-cancel can never turn expiring points into points that never expire.
const REFUND_SOURCES = new Set(["ride_discount_refund"]);

/**
 * Replay a user's ledger (rows in id order) into lots.
 *  - a credit (points > 0) opens a lot (expires_at null = never expires)
 *  - a refund credit gives points back to the lots the latest redemptions took them from, as long as that lot had not
 *    expired by then; whatever cannot go back opens a new lot that does not expire
 *  - an expiry row (origin_log_id set) reduces exactly its own lot
 *  - any other debit consumes lots that were still valid at that moment, soonest-expiring first
 * Debits beyond what the ledger can explain (points that predate the ledger) are ignored.
 * Returns Map(lotId -> { id, activity, points, remaining, expires_at }).
 */
function replayLots(rows) {
  const lots = new Map();
  const taken = []; // what each redemption took from which lot, oldest first
  for (const r of rows) {
    const pts = Number(r.points) || 0;
    if (pts > 0) {
      let left = pts;
      if (REFUND_SOURCES.has(r.source)) {
        const at = new Date(r.created_at);
        for (let i = taken.length - 1; i >= 0 && left > 0; i--) {
          const t = taken[i];
          const lot = lots.get(t.lotId);
          if (t.take <= 0 || !lot || (lot.expires_at && lot.expires_at <= at)) continue;
          const back = Math.min(t.take, left);
          lot.remaining += back;
          t.take -= back;
          left -= back;
        }
      }
      if (left > 0) lots.set(r.id, { id: r.id, activity: r.activity || null, points: left, remaining: left, expires_at: r.expires_at ? new Date(r.expires_at) : null });
    } else if (pts < 0 && r.origin_log_id) {
      const lot = lots.get(r.origin_log_id);
      if (lot) lot.remaining = Math.max(0, lot.remaining - -pts);
    } else if (pts < 0) {
      let need = -pts;
      const at = new Date(r.created_at);
      const open = [...lots.values()]
        .filter((l) => l.remaining > 0 && (!l.expires_at || l.expires_at > at))
        .sort((a, b) => (a.expires_at ? a.expires_at.getTime() : Infinity) - (b.expires_at ? b.expires_at.getTime() : Infinity) || a.id - b.id);
      for (const l of open) {
        if (need <= 0) break;
        const take = Math.min(l.remaining, need);
        l.remaining -= take;
        need -= take;
        taken.push({ lotId: l.id, take });
      }
    }
  }
  return lots;
}

module.exports = { ACTIVITIES, USER_TYPES, UNITS, isActivity, activityLabel, parseDuration, mergeConfig, durationFor, addDuration, durationText, formatExpiryDate, describeCredit, expiryNote, replayLots };

// Pure rules for the Booking Guarantee executive queue (spec 2026-10-14). No I/O: guaranteeQueueService feeds
// these the rows it loaded.

const DEFAULTS = Object.freeze({
  execQueueEnabled: false,
  execDefaultCapacity: 5,
  reminderPct: 50,
  escalatePct: 75,
  autoReassignIdleMinutes: null,
});
const LIMITS = Object.freeze({ capacity: [1, 200], pct: [1, 99], idleMinutes: [1, 1440] });

const ACTION_TYPES = Object.freeze([
  "viewed", "search_started", "driver_contacted", "contact_outcome", "driver_assigned", "escalated", "note", "resolution_attempt",
]);
const MEANINGFUL_TYPES = new Set(["search_started", "driver_contacted", "contact_outcome", "driver_assigned", "escalated", "resolution_attempt"]);
const MIN_NOTE_LENGTH = 10;

const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });
const blank = (v) => v === null || v === undefined || v === "";
const inRange = (n, [lo, hi]) => Number.isInteger(n) && n >= lo && n <= hi;
const toBool = (v) => v === true || v === 1 || v === "1" || String(v).toLowerCase() === "true";

/** A city_order_settings row (snake_case) as the camelCase queue settings; bad values fall back per field. */
function normalizeQueueRow(row) {
  const d = { ...DEFAULTS };
  if (!row) return d;
  const cap = Number(row.exec_default_capacity);
  const rem = Number(row.reminder_pct);
  const esc = Number(row.escalate_pct);
  const idle = blank(row.auto_reassign_idle_minutes) ? null : Number(row.auto_reassign_idle_minutes);
  const pctsOk = inRange(rem, LIMITS.pct) && inRange(esc, LIMITS.pct) && rem < esc;
  return {
    execQueueEnabled: Boolean(row.exec_queue_enabled),
    execDefaultCapacity: inRange(cap, LIMITS.capacity) ? cap : d.execDefaultCapacity,
    reminderPct: pctsOk ? rem : d.reminderPct,
    escalatePct: pctsOk ? esc : d.escalatePct,
    autoReassignIdleMinutes: idle !== null && inRange(idle, LIMITS.idleMinutes) ? idle : null,
  };
}

/** Validates admin input (camelCase). Returns only the keys that were sent; throws a 400 on the first bad value. */
function validateQueueInput(input = {}, current = DEFAULTS) {
  const out = {};
  if (input.execQueueEnabled !== undefined) out.execQueueEnabled = toBool(input.execQueueEnabled);
  if (input.execDefaultCapacity !== undefined) {
    const n = blank(input.execDefaultCapacity) ? NaN : Number(input.execDefaultCapacity);
    if (!inRange(n, LIMITS.capacity)) throw badRequest("exec_default_capacity must be a whole number between 1 and 200");
    out.execDefaultCapacity = n;
  }
  if (input.reminderPct !== undefined) {
    const n = blank(input.reminderPct) ? NaN : Number(input.reminderPct);
    if (!inRange(n, LIMITS.pct)) throw badRequest("reminder_pct must be a whole number between 1 and 99");
    out.reminderPct = n;
  }
  if (input.escalatePct !== undefined) {
    const n = blank(input.escalatePct) ? NaN : Number(input.escalatePct);
    if (!inRange(n, LIMITS.pct)) throw badRequest("escalate_pct must be a whole number between 1 and 99");
    out.escalatePct = n;
  }
  if (input.autoReassignIdleMinutes !== undefined) {
    if (blank(input.autoReassignIdleMinutes)) out.autoReassignIdleMinutes = null;
    else {
      const n = Number(input.autoReassignIdleMinutes);
      if (!inRange(n, LIMITS.idleMinutes)) throw badRequest("auto_reassign_idle_minutes must be a whole number between 1 and 1440");
      out.autoReassignIdleMinutes = n;
    }
  }
  const reminder = out.reminderPct ?? current.reminderPct;
  const escalate = out.escalatePct ?? current.escalatePct;
  if ((out.reminderPct !== undefined || out.escalatePct !== undefined) && !(reminder < escalate)) {
    throw badRequest("reminder_pct must be lower than escalate_pct");
  }
  return out;
}

const effectiveCapacity = (candidate, defaultCapacity) => (Number.isInteger(candidate.capacity) && candidate.capacity > 0 ? candidate.capacity : defaultCapacity);

/** Eligible candidates (available, below capacity), best first: lowest load/capacity, longest idle (NULL first), lowest id. */
function rankCandidates(candidates, defaultCapacity) {
  return candidates
    .map((c) => ({ ...c, capacity: effectiveCapacity(c, defaultCapacity) }))
    .filter((c) => c.available && c.load < c.capacity)
    .sort((a, b) => {
      const ra = a.load / a.capacity;
      const rb = b.load / b.capacity;
      if (ra !== rb) return ra - rb;
      const ta = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : -Infinity;
      const tb = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : -Infinity;
      if (ta !== tb) return ta - tb;
      return a.adminId - b.adminId;
    })
    .map((c) => ({ adminId: c.adminId, load: c.load, capacity: c.capacity }));
}

function unassignedReason(candidates) {
  if (!candidates.length) return "none_in_city";
  if (!candidates.some((c) => c.available)) return "all_unavailable";
  return "all_at_capacity";
}

const ms = (d) => new Date(d).getTime();

/** Percent (0-100) of the ORIGINAL guarantee window that has elapsed. A zero/negative window counts as fully elapsed. */
function elapsedPct(c, now = new Date()) {
  const total = ms(c.deadline_at) - ms(c.opened_at);
  if (!(total > 0)) return 100;
  return Math.min(100, Math.max(0, ((now.getTime() - ms(c.opened_at)) / total) * 100));
}

const isReminderDue = (c, city, now = new Date()) => !c.reminded_at && elapsedPct(c, now) >= city.reminderPct;
const isEscalationDue = (c, city, now = new Date()) => !c.escalated_at && elapsedPct(c, now) >= city.escalatePct;

/** Owner has done nothing meaningful for autoReassignIdleMinutes AND at least minRemainingMs is left for a handover. */
function isIdle(c, city, now, minRemainingMs) {
  if (!city.autoReassignIdleMinutes || !c.owner_assigned_at) return false;
  if (ms(c.deadline_at) - now.getTime() < minRemainingMs) return false;
  const touched = Math.max(ms(c.owner_assigned_at), c.last_action_at ? ms(c.last_action_at) : 0);
  return now.getTime() - touched >= city.autoReassignIdleMinutes * 60 * 1000;
}

const isMeaningful = (type, note) => {
  if (type === "note") return String(note ?? "").trim().length >= MIN_NOTE_LENGTH;
  return MEANINGFUL_TYPES.has(type);
};

module.exports = {
  DEFAULTS, LIMITS, ACTION_TYPES, MEANINGFUL_TYPES, MIN_NOTE_LENGTH,
  normalizeQueueRow, validateQueueInput, effectiveCapacity, rankCandidates, unassignedReason,
  elapsedPct, isReminderDue, isEscalationDue, isIdle, isMeaningful,
};

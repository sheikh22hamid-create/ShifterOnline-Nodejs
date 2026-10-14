// Pure request-body builders and client-side validation for the supervisor
// queue and workload page. They mirror the server rules so a bad value is
// caught before the request, and every body is strictly typed (integers,
// real booleans, null) the way the API expects.

export const REASON_MAX_LENGTH = 200
export const CAPACITY_MIN = 1
export const CAPACITY_MAX = 200
export const PCT_MIN = 1
export const PCT_MAX = 99
export const IDLE_MIN = 1
export const IDLE_MAX = 1440

// Whole, non-negative decimal digits only ('1e3', '1.5', '-2', 'abc' are rejected).
export function parseWhole(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null
  const s = String(value ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}

const inRange = (n, min, max) => n !== null && n >= min && n <= max

// ---- reassign ----

// Returns a message, or null when the reassign form can be sent.
export function validateReassign({ target, reason }) {
  if (!String(reason ?? '').trim()) return 'A reason is required'
  if (String(reason).trim().length > REASON_MAX_LENGTH) return `The reason can be at most ${REASON_MAX_LENGTH} characters`
  const t = String(target ?? '').trim()
  if (t !== '') {
    const id = parseWhole(t)
    if (id === null || id < 1) return 'Choose a valid executive'
  }
  return null
}

export function buildReassignBody({ target, reason }) {
  const t = String(target ?? '').trim()
  return {
    target_admin_id: t === '' ? null : parseWhole(t),
    reason: String(reason ?? '').trim().slice(0, REASON_MAX_LENGTH),
  }
}

// ---- executive profile ----

// `capacity` is the raw input value ('' means "use the city default" = null);
// leave it undefined to not touch it. `available` must be a real boolean.
export function validateProfilePatch({ capacity, available }) {
  if (capacity === undefined && available === undefined) return 'Nothing to update'
  if (capacity !== undefined && String(capacity ?? '').trim() !== '') {
    if (!inRange(parseWhole(capacity), CAPACITY_MIN, CAPACITY_MAX)) {
      return `Capacity must be a whole number from ${CAPACITY_MIN} to ${CAPACITY_MAX}`
    }
  }
  if (available !== undefined && typeof available !== 'boolean') return 'Availability must be true or false'
  return null
}

export function buildProfileBody({ capacity, available }) {
  const body = {}
  if (capacity !== undefined) body.capacity = String(capacity ?? '').trim() === '' ? null : parseWhole(capacity)
  if (available !== undefined) body.available = available
  return body
}

// ---- city settings ----

export function validateSettings(s) {
  if (typeof s?.exec_queue_enabled !== 'boolean') return 'The queue switch must be on or off'
  if (!inRange(parseWhole(s.exec_default_capacity), CAPACITY_MIN, CAPACITY_MAX)) {
    return `Default capacity must be a whole number from ${CAPACITY_MIN} to ${CAPACITY_MAX}`
  }
  const rem = parseWhole(s.reminder_pct)
  const esc = parseWhole(s.escalate_pct)
  if (!inRange(rem, PCT_MIN, PCT_MAX)) return `Reminder percent must be a whole number from ${PCT_MIN} to ${PCT_MAX}`
  if (!inRange(esc, PCT_MIN, PCT_MAX)) return `Escalate percent must be a whole number from ${PCT_MIN} to ${PCT_MAX}`
  if (rem >= esc) return 'The reminder percent must be lower than the escalate percent'
  const idle = String(s.auto_reassign_idle_minutes ?? '').trim()
  if (idle !== '' && !inRange(parseWhole(idle), IDLE_MIN, IDLE_MAX)) {
    return `Auto-reassign minutes must be blank or a whole number from ${IDLE_MIN} to ${IDLE_MAX}`
  }
  return null
}

// cityId is only passed for a superadmin (admins are pinned server-side).
export function buildSettingsBody(s, cityId) {
  const idle = String(s.auto_reassign_idle_minutes ?? '').trim()
  const body = {
    exec_queue_enabled: s.exec_queue_enabled,
    guarantee_recover_on_cancel: Boolean(s.guarantee_recover_on_cancel),
    exec_default_capacity: parseWhole(s.exec_default_capacity),
    reminder_pct: parseWhole(s.reminder_pct),
    escalate_pct: parseWhole(s.escalate_pct),
    auto_reassign_idle_minutes: idle === '' ? null : parseWhole(idle),
  }
  if (cityId !== undefined && cityId !== null && cityId !== '') body.city_id = parseWhole(cityId)
  return body
}

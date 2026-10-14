// Pure helpers for the executive guarantee workspace. Kept free of React so the
// request-body shapes can be checked in isolation. They mirror the server rules
// for POST /booking-guarantee/exec/cases/:orderId/actions.

export const ACTIONS = [
  { value: 'search_started', label: 'Started driver search' },
  { value: 'driver_contacted', label: 'Contacted a driver' },
  { value: 'contact_outcome', label: 'Recorded a contact outcome' },
  { value: 'resolution_attempt', label: 'Other resolution attempt' },
  { value: 'note', label: 'Note (min 10 characters)' },
]

export const OUTCOMES = [
  { value: 'agreed', label: 'Agreed to take it' },
  { value: 'declined', label: 'Declined' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'unreachable', label: 'Unreachable' },
]

export const NOTE_MIN_LENGTH = 10
export const NOTE_MAX_LENGTH = 500
const DRIVER_ID_TYPES = ['driver_contacted', 'contact_outcome']
const OUTCOME_CODES = OUTCOMES.map((o) => o.value)

export function parseDriverId(value) {
  const s = String(value ?? '').trim()
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) && n > 0 ? n : null
}

// Returns the validation message for an action form, or null when it can be sent.
export function validateAction({ type, outcome, note, driverId }) {
  if (!ACTIONS.some((a) => a.value === type)) return 'Choose an action'
  if (type === 'contact_outcome' && !OUTCOME_CODES.includes(outcome)) return 'Choose an outcome'
  const trimmed = String(note ?? '').trim()
  if (type === 'note' && trimmed.length < NOTE_MIN_LENGTH) return `A note needs at least ${NOTE_MIN_LENGTH} characters`
  if (DRIVER_ID_TYPES.includes(type) && String(driverId ?? '').trim() !== '' && parseDriverId(driverId) === null) {
    return 'Driver id must be a positive whole number'
  }
  return null
}

export function buildActionBody({ type, outcome, note, driverId }) {
  const body = { type }
  const meta = {}
  const trimmed = String(note ?? '').trim().slice(0, NOTE_MAX_LENGTH)
  if (trimmed) meta.note = trimmed
  if (type === 'contact_outcome' && OUTCOME_CODES.includes(outcome)) {
    body.result = outcome
    meta.outcome = outcome
  }
  if (DRIVER_ID_TYPES.includes(type)) {
    const id = parseDriverId(driverId)
    if (id !== null) body.driver_id = id
  }
  if (Object.keys(meta).length > 0) body.meta = meta
  return body
}

export function buildEscalateBody(note) {
  const reason = String(note ?? '').trim().slice(0, NOTE_MAX_LENGTH)
  return { type: 'escalated', meta: { reason: reason || 'Needs supervisor help' } }
}

export function groupActiveCases(active) {
  const list = Array.isArray(active) ? active : []
  return {
    escalated: list.filter((c) => c.queue_state === 'escalated'),
    fresh: list.filter((c) => c.queue_state === 'assigned'),
    working: list.filter((c) => c.queue_state === 'in_progress'),
  }
}

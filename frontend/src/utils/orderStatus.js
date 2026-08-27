export const ORDER_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'pickup', label: 'Pickup' },
  { value: 'on_route', label: 'On Route' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const TONE_BY_O_STATUS = {
  Pending: 'warning',
  Processing: 'info',
  Pickup: 'info',
  On_Route: 'info',
  Completed: 'success',
  Cancelled: 'danger',
}

const LABEL_BY_O_STATUS = {
  On_Route: 'On Route',
}

export function orderStatusTone(oStatus) {
  return TONE_BY_O_STATUS[oStatus] ?? 'neutral'
}

export function orderStatusLabel(oStatus) {
  return LABEL_BY_O_STATUS[oStatus] ?? oStatus ?? '—'
}

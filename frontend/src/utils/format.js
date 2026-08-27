const currencyFormatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 })
const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export function formatCurrency(value) {
  const n = Number(value)
  return currencyFormatter.format(Number.isFinite(n) ? n : 0)
}

export function formatDateTime(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFormatter.format(d)
}

export function truncate(text, max = 28) {
  if (!text) return '—'
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function formatDistanceKm(meters) {
  const n = Number(meters)
  if (!Number.isFinite(n) || n < 0) return '—'
  return `${(n / 1000).toFixed(1)} km`
}

export function formatEta(seconds) {
  const n = Number(seconds)
  if (!Number.isFinite(n) || n < 0) return '—'
  const minutes = Math.round(n / 60)
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

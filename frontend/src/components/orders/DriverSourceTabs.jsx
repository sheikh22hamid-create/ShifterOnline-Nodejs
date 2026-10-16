// "All drivers | Daily Drivers (n)" filter shown on the manual-assign pickers for scheduled, next-day and
// Booking Guarantee orders, so the admin can hand the order to a Daily Driver first.
export default function DriverSourceTabs({ value, onChange, dailyCount, loading = false }) {
  const tabs = [
    { id: 'all', label: 'All drivers' },
    { id: 'daily', label: loading ? 'Daily Drivers…' : `Daily Drivers (${dailyCount})` },
  ]
  return (
    <div className="mb-3 flex gap-2" role="tablist" aria-label="Driver filter">
      {tabs.map((t) => {
        const active = value === t.id
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className="rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors"
            style={{
              borderColor: active ? 'var(--brand)' : 'var(--border)',
              background: active ? 'var(--brand-soft)' : 'transparent',
              color: active ? 'var(--brand)' : 'var(--ink-muted)',
            }}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

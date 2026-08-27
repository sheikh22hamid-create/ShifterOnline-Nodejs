import { TrendingUp, TrendingDown } from 'lucide-react'

const TREND_VARS = {
  success: ['var(--success)', 'var(--success-soft)'],
  danger: ['var(--danger)', 'var(--danger-soft)'],
  neutral: ['var(--ink-muted)', 'var(--bg)'],
}

function TrendPill({ tone = 'neutral', label }) {
  const [color, bg] = TREND_VARS[tone] ?? TREND_VARS.neutral
  const Icon = tone === 'success' ? TrendingUp : tone === 'danger' ? TrendingDown : null
  return (
    <span
      className="mt-2 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ color, background: bg }}
    >
      {Icon && <Icon size={11} strokeWidth={2.5} />}
      {label}
    </span>
  )
}

export default function KpiCard({ label, value, loading, icon: Icon, iconColor, iconBg, trendLabel, trendTone, size = 'lg' }) {
  const isLg = size === 'lg'

  return (
    <div
      className="kpi-card group relative flex flex-col overflow-hidden rounded-xl p-4"
      style={{ '--glow': iconColor ? `${iconColor}33` : 'var(--border-strong)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div
          className="text-[11px] font-medium uppercase"
          style={{ color: 'var(--ink-faint)', letterSpacing: '0.06em' }}
        >
          {label}
        </div>
        {Icon && (
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ background: iconBg || 'var(--bg)', color: iconColor || 'var(--ink-muted)' }}
          >
            <Icon size={16} strokeWidth={2} />
          </div>
        )}
      </div>

      {loading ? (
        <div className={`mt-3 h-7 rounded ${isLg ? 'w-24' : 'w-16'}`} style={{ background: 'var(--border)' }} />
      ) : (
        <div
          className={`font-mono-data mt-1 font-bold tracking-tight ${isLg ? 'text-[26px]' : 'text-[19px]'}`}
          style={{ color: 'var(--ink)' }}
        >
          {value}
        </div>
      )}

      {!loading && trendLabel && <TrendPill tone={trendTone} label={trendLabel} />}
    </div>
  )
}

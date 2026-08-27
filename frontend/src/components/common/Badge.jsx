const TONE_VARS = {
  success: ['var(--success)', 'var(--success-soft)', 'var(--success-soft-border)'],
  danger: ['var(--danger)', 'var(--danger-soft)', 'var(--danger-soft-border)'],
  warning: ['var(--warning)', 'var(--warning-soft)', 'var(--warning-soft-border)'],
  info: ['var(--info)', 'var(--info-soft)', 'var(--info-soft-border)'],
  brand: ['var(--brand)', 'var(--brand-soft)', 'var(--brand-soft-border)'],
  neutral: ['var(--ink-muted)', 'var(--bg)', 'var(--border)'],
}

export default function Badge({ tone = 'neutral', children }) {
  const [color, bg, border] = TONE_VARS[tone] ?? TONE_VARS.neutral
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ color, background: bg, borderColor: border }}
    >
      {children}
    </span>
  )
}

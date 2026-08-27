export default function ComingSoon({ title, description, icon: Icon }) {
  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        {title}
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        {description}
      </p>

      <div
        className="surface-card mt-5 flex flex-col items-center justify-center gap-3 rounded-xl px-6 py-16 text-center"
        style={{ borderStyle: 'dashed' }}
      >
        {Icon && (
          <div
            className="flex h-11 w-11 items-center justify-center rounded-full"
            style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
          >
            <Icon size={20} />
          </div>
        )}
        <p className="max-w-xs text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          This screen is wired into the API contract but the data views land in the next build pass.
        </p>
      </div>
    </div>
  )
}

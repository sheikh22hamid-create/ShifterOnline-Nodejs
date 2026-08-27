import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-2 text-center" style={{ background: 'var(--bg)' }}>
      <div className="font-mono-data text-[13px]" style={{ color: 'var(--brand)' }}>
        404
      </div>
      <h1 className="text-[18px] font-semibold" style={{ color: 'var(--ink)' }}>
        Page not found
      </h1>
      <Link to="/dashboard" className="mt-2 text-[13px] font-medium underline" style={{ color: 'var(--brand)' }}>
        Back to dashboard
      </Link>
    </div>
  )
}

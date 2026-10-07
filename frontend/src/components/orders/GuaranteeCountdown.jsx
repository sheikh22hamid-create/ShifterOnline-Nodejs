import { useEffect, useState } from 'react'

function format(ms) {
  if (ms <= 0) return 'Expired'
  const total = Math.floor(ms / 1000)
  const m = String(Math.floor(total / 60)).padStart(2, '0')
  const s = String(total % 60).padStart(2, '0')
  return `${m}:${s}`
}

/** Live mm:ss countdown to a Booking Guarantee deadline (ISO string). */
export default function GuaranteeCountdown({ deadline }) {
  const target = new Date(deadline).getTime()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  if (!Number.isFinite(target)) return null
  const left = target - now
  return (
    <span className="font-mono-data" style={{ color: left <= 60000 ? 'var(--danger)' : 'var(--ink)' }}>
      {format(left)}
    </span>
  )
}

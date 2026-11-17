import { useEffect, useState } from 'react'
import api from '../../services/api'

// Why the WhatsApp option is unavailable, from GET /riders/:id/whatsapp-eligibility.
const REASON_TEXT = {
  disabled: 'WhatsApp orders are switched off',
  bot_offline: 'WhatsApp bot is not connected',
  not_trial: 'Only for active Trial Drivers',
  not_found: 'Driver not found',
}
const CHECK_FAILED = 'Could not check WhatsApp eligibility'

export const WHATSAPP_HELP_TEXT = 'The order and every step will be sent to the driver on WhatsApp. Ask them to share Live Location.'

/**
 * App / WhatsApp choice for assigning an order to a Trial Driver. Defaults to App; the WhatsApp radio is enabled only
 * when the backend says this rider is eligible. A failed eligibility check never blocks the App path.
 */
export default function DriverChannelChoice({ riderId, value, onChange, disabled }) {
  const [elig, setElig] = useState(null) // { riderId, eligible, reason, done } | { riderId, error: true }

  useEffect(() => {
    if (!riderId) return undefined
    let cancelled = false
    api.get(`/riders/${riderId}/whatsapp-eligibility`)
      .then((res) => {
        const d = res.data?.data || {}
        if (!cancelled) setElig({ riderId, eligible: Boolean(d.eligible), reason: d.reason, done: Number(d.whatsapp_orders_done) || 0 })
      })
      .catch(() => { if (!cancelled) setElig({ riderId, error: true }) })
    return () => { cancelled = true }
  }, [riderId])

  const current = elig?.riderId === riderId ? elig : null
  const whatsappAllowed = Boolean(current?.eligible)
  let note = null
  if (!current) note = 'Checking WhatsApp eligibility…'
  else if (current.error) note = CHECK_FAILED
  else if (!current.eligible) note = REASON_TEXT[current.reason] || 'WhatsApp is not available for this driver'

  const radio = 'flex items-center gap-1.5 text-[12.5px]'
  return (
    <div className="grid gap-1" role="radiogroup" aria-label="How the driver gets this order">
      <div className="flex flex-wrap items-center gap-4">
        <label className={radio} style={{ color: 'var(--ink)' }}>
          <input type="radio" name={`driver-channel-${riderId}`} value="app" checked={value !== 'whatsapp'} disabled={disabled} onChange={() => onChange('app')} />
          App
        </label>
        <label className={radio} style={{ color: whatsappAllowed ? 'var(--ink)' : 'var(--ink-faint)' }}>
          <input type="radio" name={`driver-channel-${riderId}`} value="whatsapp" checked={value === 'whatsapp'} disabled={disabled || !whatsappAllowed} onChange={() => onChange('whatsapp')} />
          WhatsApp
        </label>
      </div>
      {note && <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{note}</span>}
      {current && !current.error && current.eligible && (
        <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>WhatsApp orders done: {current.done}</span>
      )}
    </div>
  )
}

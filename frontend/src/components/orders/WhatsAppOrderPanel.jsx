import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../services/api'
import { useToast } from '../../context/ToastContext'
import Badge from '../common/Badge'

const POLL_MS = 5000
// Steps the executive cannot advance; polling stops on the terminal ones.
const TERMINAL_STEPS = new Set(['done', 'cancelled'])
const NO_ADVANCE_STEPS = new Set(['done', 'cancelled', 'unknown'])
const inputStyle = { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }
const inputClass = 'rounded-lg border px-3 py-2 text-[13px]'

function ago(iso, now) {
  if (!iso) return null
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000)
  if (!Number.isFinite(mins)) return null
  return mins < 1 ? 'just now' : `${mins} min ago`
}

/** Live state of a WhatsApp-channel order for the executive, with "Do next step for driver". */
export default function WhatsAppOrderPanel({ orderId, onStepDone }) {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const [status, setStatus] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [confirming, setConfirming] = useState(null) // the step id the executive is confirming
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/orders/${orderId}/whatsapp-status`)
      if (!mountedRef.current) return
      setStatus(res.data?.data || null)
      setLoadError('')
    } catch (err) {
      if (mountedRef.current) setLoadError(err?.response?.data?.message || 'Could not load the WhatsApp status')
    } finally {
      if (mountedRef.current) setNow(Date.now())
    }
  }, [orderId])

  const step = status?.step || ''
  const stepKey = step.split(':')[0]
  const terminal = TERMINAL_STEPS.has(stepKey)

  // Poll every 5 s until the order is done or cancelled; skip ticks while a step request is in flight.
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (terminal) return undefined
    const timer = setInterval(() => { if (!busyRef.current) load() }, POLL_MS)
    return () => clearInterval(timer)
  }, [terminal, load])

  const doStep = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const res = await api.post(`/orders/${orderId}/whatsapp-step`, status?.needs_otp ? { otp: otp.trim() } : {})
      toastRef.current.success(res.data?.message || 'Step done')
      if (mountedRef.current) { setConfirming(null); setOtp('') }
      onStepDone?.()
    } catch (err) {
      toastRef.current.error(err?.response?.data?.message || 'Could not do the step')
    } finally {
      busyRef.current = false
      if (mountedRef.current) setBusy(false)
      await load()
    }
  }

  if (!status && !loadError) {
    return <div className="text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>Loading WhatsApp status…</div>
  }
  if (status && status.channel !== 'whatsapp') return null

  const lastReply = ago(status?.last_reply_at, now)
  const lastLocation = ago(status?.last_location_at, now)
  const canAdvance = Boolean(status) && !NO_ADVANCE_STEPS.has(stepKey)
  // If the driver moves on while the dialog is open, it closes: never confirm a step the executive did not see.
  const confirmOpen = confirming !== null && confirming === step
  const row = 'flex justify-between gap-3 text-[12.5px]'

  return (
    <div className="grid gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
      <div className="flex items-center justify-between gap-2">
        <Badge tone="success">WhatsApp</Badge>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>{status?.step_label || '—'}</span>
      </div>
      {loadError && <p className="text-[12px]" style={{ color: 'var(--danger)' }}>{loadError}</p>}
      {status && (
        <>
          <div className={row} style={{ color: 'var(--ink-muted)' }}><span>Last reply</span><span>{lastReply || 'no reply yet'}</span></div>
          <div className={row} style={{ color: 'var(--ink-muted)' }}><span>Location</span><span>{lastLocation || 'not shared'}</span></div>
        </>
      )}
      {canAdvance && confirmOpen && (
        <div className="grid gap-2 rounded-lg border p-3 text-[13px]" style={{ borderColor: 'var(--warning)', background: 'var(--warning-soft)', color: 'var(--ink)' }}>
          <span>Do this step for the driver: <b>{status.step_label}</b>? The driver is told the next step on WhatsApp.</span>
          {status.needs_otp && (
            <input
              aria-label="OTP"
              inputMode="numeric"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="OTP from the customer"
              className={inputClass}
              style={inputStyle}
            />
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy || (status.needs_otp && !otp.trim())} onClick={doStep} className="rounded-lg px-3 py-1.5 font-semibold disabled:opacity-50" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
              {busy ? 'Working…' : 'Confirm'}
            </button>
            <button type="button" disabled={busy} onClick={() => { setConfirming(null); setOtp('') }} className="rounded-lg border px-3 py-1.5 disabled:opacity-50" style={{ borderColor: 'var(--border)' }}>Back</button>
          </div>
        </div>
      )}
      {canAdvance && !confirmOpen && (
        <div>
          <button type="button" onClick={() => { setConfirming(step); setOtp('') }} className="rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold" style={{ borderColor: 'var(--brand)', color: 'var(--brand)' }}>
            Do next step for driver
          </button>
        </div>
      )}
    </div>
  )
}

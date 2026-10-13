import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const inputClass = 'mt-1 w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60'
const inputStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }
const errMsg = (err, fallback) => err?.response?.data?.message || fallback

const EMPTY = { offer_seconds: '', live_time: '', discount_percent: '' }
const fromApi = (d = {}) => ({
  offer_seconds: String(d.offer_seconds ?? ''),
  live_time: String(d.live_time ?? ''),
  discount_percent: String(d.discount_percent ?? ''),
})

/**
 * Next-day booking settings (global, spec 2026-10-13). Everyone with access to the page can read them; only a
 * superadmin can change them (the server enforces it too).
 */
export default function NextDaySettingsCard() {
  const toast = useToast()
  const toastRef = useRef(toast)
  useEffect(() => { toastRef.current = toast })
  const { user } = useAuth()
  const canEdit = user?.role === 'superadmin'

  const [form, setForm] = useState(EMPTY)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/orders/next-day/settings')
      setForm(fromApi(res.data?.data))
      setLoaded(true)
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not load next-day settings'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function save() {
    setSaving(true)
    try {
      const res = await api.put('/orders/next-day/settings', {
        offer_seconds: form.offer_seconds,
        live_time: form.live_time,
        discount_percent: form.discount_percent,
      })
      setForm(fromApi(res.data?.data))
      toastRef.current.success('Next-day settings saved')
    } catch (err) {
      toastRef.current.error(errMsg(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  const disabled = !canEdit || !loaded || saving

  return (
    <div className="surface-card mt-4 rounded-xl p-4">
      <p className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>Next-day settings</p>
      <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
        Apply to all cities. A change affects new offers and orders completed after it; orders already completed keep their recorded discount.
      </p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="nd_offer_seconds">Offer timeout (seconds, 15–600)</label>
          <input id="nd_offer_seconds" type="number" min="15" max="600" step="1" value={form.offer_seconds} onChange={set('offer_seconds')} disabled={disabled} className={inputClass} style={inputStyle} />
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>How long a Daily Driver has to accept before the next one is tried.</p>
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="nd_live_time">Go-live time (IST)</label>
          <input id="nd_live_time" type="time" value={form.live_time} onChange={set('live_time')} disabled={disabled} className={inputClass} style={inputStyle} />
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>On the trip day, an order with no Daily Driver goes live to Normal Drivers at this time.</p>
        </div>
        <div>
          <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }} htmlFor="nd_discount_percent">Daily Driver discount (%, 0–50)</label>
          <input id="nd_discount_percent" type="number" min="0" max="50" step="0.5" value={form.discount_percent} onChange={set('discount_percent')} disabled={disabled} className={inputClass} style={inputStyle} />
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>A Daily Driver earns this much less than the fare on a next-day order. The difference is recorded for admin to deduct at settlement.</p>
        </div>
      </div>
      {canEdit ? (
        <button
          type="button"
          onClick={save}
          disabled={disabled}
          className="mt-3 rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      ) : (
        <p className="mt-3 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>Only a superadmin can change these.</p>
      )}
    </div>
  )
}

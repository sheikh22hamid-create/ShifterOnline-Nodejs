import { useCallback, useEffect, useState } from 'react'
import { PackageOpen } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'

// Loading/Unloading (saaman uthana) enable toggle (spec 2026-11-24, Phase 1). The feature ships OFF;
// the owner turns it ON per city here. Backed by the labour_enabled app_setting ({ global, cities });
// the server sanitizes whatever we send, so a city is ON when global is ON or its own switch is ON.

const errMsg = (err, fb) => err?.response?.data?.msg || err?.response?.data?.message || fb

function Toggle({ on, disabled, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50"
      style={{ background: on ? 'var(--brand)' : 'var(--border)' }}
    >
      <span
        className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
        style={{ transform: on ? 'translateX(22px)' : 'translateX(2px)' }}
      />
    </button>
  )
}

export default function LabourSettings() {
  const toast = useToast()
  const fetcher = useCallback(async () => {
    const res = await api.get('/labour/settings')
    return res.data
  }, [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)

  const [global, setGlobal] = useState(false)
  const [cities, setCities] = useState({}) // { "<cityId>": true } — only the ON ones
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setGlobal(Boolean(data.enabled?.global))
    setCities({ ...(data.enabled?.cities || {}) })
  }, [data])

  const cityList = data?.cities || []
  const activeCount = global ? cityList.length : Object.keys(cities).length

  const toggleCity = (id, on) => {
    setCities((c) => {
      const next = { ...c }
      if (on) next[String(id)] = true
      else delete next[String(id)]
      return next
    })
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const res = await api.put('/labour/settings', { global, cities })
      setGlobal(Boolean(res.data.enabled?.global))
      setCities({ ...(res.data.enabled?.cities || {}) })
      toast?.success?.('Loading/Unloading setting save ho gayi.')
      refetch()
    } catch (err) {
      toast?.error?.(errMsg(err, 'Save nahi ho paya.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 grid gap-4">
      <div className="flex items-center gap-2">
        <PackageOpen size={20} style={{ color: 'var(--brand)' }} />
        <h1 className="text-[18px] font-bold" style={{ color: 'var(--ink)' }}>Loading/Unloading Setup</h1>
        <Badge tone={activeCount > 0 ? 'success' : 'neutral'}>{activeCount > 0 ? `${activeCount} city ON` : 'OFF'}</Badge>
      </div>
      <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Jin cities me ON karoge, wahan customers ko booking par <b>saaman uthana (loading/unloading)</b> ka
        opt-in option dikhega. Default OFF rehta hai.
      </p>

      {loading ? (
        <div className="py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>Loading...</div>
      ) : error ? (
        <div className="rounded-lg border p-4 text-[13px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>{error}</div>
      ) : (
        <div className="grid gap-4">
          <div className="rounded-xl border p-4 flex items-center justify-between gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div>
              <div className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Saari cities (global)</div>
              <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>Global ON = har city me ON (neeche ke city toggles tab lock rehte hain).</div>
            </div>
            <Toggle on={global} disabled={saving} onChange={setGlobal} />
          </div>

          <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)', borderBottom: '1px solid var(--border)' }}>
              Per city
            </div>
            {cityList.length === 0 ? (
              <div className="p-4 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>Koi active city nahi mili.</div>
            ) : (
              cityList.map((c) => {
                const on = global || Boolean(cities[String(c.id)])
                return (
                  <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <span className="text-[14px]" style={{ color: 'var(--ink)' }}>{c.title}</span>
                    <Toggle on={on} disabled={saving || global} onChange={(v) => toggleCity(c.id, v)} />
                  </div>
                )
              })
            )}
          </div>

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="justify-self-start rounded-lg px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: '#fff' }}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}

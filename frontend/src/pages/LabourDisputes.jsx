import { useCallback, useState } from 'react'
import { PackageCheck, RefreshCw } from 'lucide-react'
import api from '../services/api'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import { formatDateTime } from '../utils/format'

// Loading/Unloading labour dispute queue (spec 2026-11-24, Phase 1). Per-city pending disputes with
// the evidence an executive needs — the customer's declared snapshot, any on-site correction + photo,
// and the escrowed amount — then Release (to driver) / Refund (to customer) / Split (amount) + note.
// The money is conserved server-side (driver + refund = held total); this screen only chooses the split.

const money = (n) => `₹${Number(n ?? 0).toFixed(0)}`
const errMsg = (err, fallback) => err?.response?.data?.msg || err?.response?.data?.message || fallback
const inputStyle = { background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }
const inputClass = 'w-full rounded-lg border px-3 py-2 text-[13px]'

const SIZE_LABEL = { small: 'Chhota', medium: 'Medium', large: 'Bada' }
const FLOOR_LABEL = { ground: 'Ground', f1_2: '1-2 floor', f3plus: '3+ floor' }
const QTY_LABEL = { q15: '≤15', q15_40: '15-40', q40plus: '40+' }
const ACCESS_LABEL = { shutter: 'Shutter', stack_inside: 'Andar rakhna', loft_basement: 'Loft/Basement' }

function parseDeclared(raw) {
  if (!raw) return null
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return null
  }
}

function DeclaredSummary({ raw, label }) {
  const d = parseDeclared(raw)
  if (!d || !Array.isArray(d.legs) || d.legs.length === 0) return null
  const mode = d.mode === 'shop' ? 'Dukaan/Godown' : 'Ghar/Flat'
  return (
    <div className="rounded-lg border p-2.5" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--ink-faint)' }}>
        {label} · {mode}{d.heavyItem ? ' · ⚠ Bhaari saaman' : ''}
      </div>
      <div className="grid gap-1">
        {d.legs.map((leg, i) => (
          <div key={leg.role ?? i} className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
            <span className="font-semibold capitalize" style={{ color: 'var(--ink)' }}>{leg.role || `leg ${i + 1}`}:</span>{' '}
            {d.mode === 'shop'
              ? `${QTY_LABEL[leg.qty] ?? leg.qty ?? '—'} items · ${ACCESS_LABEL[leg.access] ?? leg.access ?? '—'}`
              : `${SIZE_LABEL[leg.size] ?? leg.size ?? '—'} · ${FLOOR_LABEL[leg.floor] ?? leg.floor ?? '—'}${leg.lift ? ' · Lift' : ''}`}
          </div>
        ))}
      </div>
    </div>
  )
}

function DisputeCard({ dispute, onResolved }) {
  const toast = useToast()
  const [note, setNote] = useState('')
  const [driverAmount, setDriverAmount] = useState('')
  const [busy, setBusy] = useState('')

  const held = Number(dispute.held_total ?? 0)

  async function resolve(action) {
    if (busy) return
    const body = { action, note: note.trim() || undefined }
    if (action === 'split') {
      const amt = Number(driverAmount)
      if (!Number.isFinite(amt) || amt < 0 || amt > held) {
        toast?.error?.(`Driver ka hissa 0 se ${money(held)} ke beech hona chahiye.`)
        return
      }
      body.driver_amount = amt
    }
    setBusy(action)
    try {
      const res = await api.post(`/labour/disputes/${dispute.dispute_id}/resolve`, body)
      const r = res.data || {}
      toast?.success?.(`Settle ho gaya — driver ${money(r.driver)}, refund ${money(r.refund)}.`)
      onResolved()
    } catch (err) {
      toast?.error?.(errMsg(err, 'Resolve nahi ho paya.'))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="rounded-xl border p-4 grid gap-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>Order #{dispute.order_id}</div>
          <div className="text-[12px] mt-0.5" style={{ color: 'var(--ink-faint)' }}>{formatDateTime(dispute.raised_at)}</div>
        </div>
        <Badge tone={dispute.raised_by === 'driver' ? 'brand' : 'info'}>
          {dispute.raised_by === 'driver' ? 'Driver ne uthaya' : 'Customer ne uthaya'}
        </Badge>
      </div>

      {dispute.reason ? (
        <div className="rounded-lg border p-2.5 text-[13px]" style={{ background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
          <span className="font-semibold" style={{ color: 'var(--ink)' }}>Wajah: </span>{dispute.reason}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-[13px]">
        <div><span style={{ color: 'var(--ink-faint)' }}>Escrow (held): </span><span className="font-bold" style={{ color: 'var(--ink)' }}>{money(held)}</span></div>
        <div><span style={{ color: 'var(--ink-faint)' }}>Base: </span><span style={{ color: 'var(--ink-muted)' }}>{money(dispute.base)}</span></div>
        {Number(dispute.extra) > 0 ? (
          <div>
            <span style={{ color: 'var(--ink-faint)' }}>Extra: </span>
            <span style={{ color: 'var(--ink-muted)' }}>{money(dispute.extra)}</span>{' '}
            <Badge tone={dispute.extra_approved ? 'success' : 'warning'}>{dispute.extra_approved ? 'approved' : 'not approved'}</Badge>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <DeclaredSummary raw={dispute.declared} label="Customer ne bataya" />
        <DeclaredSummary raw={dispute.extra_declared} label="Driver ne jagah par bataya" />
      </div>

      {dispute.extra_photo ? (
        <a href={dispute.extra_photo} target="_blank" rel="noreferrer" className="text-[13px] font-semibold" style={{ color: 'var(--brand)' }}>
          Driver ka photo dekhein ↗
        </a>
      ) : null}

      <textarea
        className={inputClass}
        style={inputStyle}
        rows={2}
        maxLength={2000}
        placeholder="Note (optional) — dono ko dikhega"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => resolve('release')}
          className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid var(--success-soft-border)' }}
        >
          {busy === 'release' ? '...' : `Driver ko do (${money(held)})`}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => resolve('refund')}
          className="rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger-soft-border)' }}
        >
          {busy === 'refund' ? '...' : `Customer ko refund (${money(held)})`}
        </button>
        <div className="flex items-center gap-1.5">
          <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>Split: driver ₹</span>
          <input
            type="number"
            min={0}
            max={held}
            value={driverAmount}
            onChange={(e) => setDriverAmount(e.target.value)}
            className="w-20 rounded-lg border px-2 py-1.5 text-[13px]"
            style={inputStyle}
            placeholder="0"
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => resolve('split')}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand-soft)', color: 'var(--brand)', border: '1px solid var(--brand-soft-border)' }}
          >
            {busy === 'split' ? '...' : 'Split karo'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function LabourDisputes() {
  const fetcher = useCallback(async () => {
    const res = await api.get('/labour/disputes')
    return res.data?.disputes ?? []
  }, [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const disputes = data ?? []

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 grid gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PackageCheck size={20} style={{ color: 'var(--brand)' }} />
          <h1 className="text-[18px] font-bold" style={{ color: 'var(--ink)' }}>Loading/Unloading Disputes</h1>
          {disputes.length > 0 ? <Badge tone="warning">{disputes.length} pending</Badge> : null}
        </div>
        <button
          type="button"
          onClick={refetch}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-semibold"
          style={{ ...inputStyle }}
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>Loading...</div>
      ) : error ? (
        <div className="rounded-lg border p-4 text-[13px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>{error}</div>
      ) : disputes.length === 0 ? (
        <div className="py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>Koi pending dispute nahi 🎉</div>
      ) : (
        disputes.map((d) => <DisputeCard key={d.dispute_id} dispute={d} onResolved={refetch} />)
      )}
    </div>
  )
}

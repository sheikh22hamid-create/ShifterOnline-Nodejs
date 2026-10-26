import { useCallback, useEffect, useState } from 'react'
import { Eye, Search } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import Drawer from '../components/common/Drawer'
import { formatCurrency, formatDateTime, truncate } from '../utils/format'

// Read-only monitor of Customise Orders (negotiated jobs). Drivers are assigned only through the customer accepting
// an offer, so this page has no assign or edit actions.
const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'open', label: 'Bargaining' },
  { value: 'converted', label: 'Converted' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
]
const REALTIME_EVENTS = ['admin:new_order', 'admin:order_status_update']

function statusTone(status) {
  if (status === 'open') return 'warning'
  if (status === 'converted') return 'success'
  if (status === 'cancelled' || status === 'expired') return 'danger'
  return 'neutral'
}

const SEGMENT_LABELS = { pickup_wait: 'Pickup waiting', pickup_load: 'Pickup loading', drop: 'Drop waiting and unloading' }
const segmentLabel = (segment) => SEGMENT_LABELS[segment] || (segment.startsWith('stop_') ? `Stop ${segment.slice(5)} (waiting, loading, unloading)` : segment)

const offerTone = (status) => (status === 'accepted' ? 'success' : status === 'active' ? 'info' : 'neutral')

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-[12.5px]">
      <span style={{ color: 'var(--ink-muted)' }}>{label}</span>
      <span className="text-right" style={{ color: 'var(--ink)' }}>{children ?? '—'}</span>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{title}</h3>
      <div className="surface-card rounded-xl px-3.5 py-2">{children}</div>
    </section>
  )
}

const FIELD = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const EMPTY_POLICY = { mode: 'normal', fixed: 0, percent: 0, admin_share: 0 }

function PolicyEditor({ title, value, onChange }) {
  const special = value.mode === 'special'
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="mb-2 text-[12.5px] font-semibold" style={{ color: 'var(--ink)' }}>{title}</div>
      <select value={value.mode} onChange={set('mode')} className="mb-2 w-full rounded-lg border px-2 py-1.5 text-[12.5px]" style={FIELD}>
        <option value="normal">Normal (usual rate-card charge)</option>
        <option value="special">Special (fixed + % of fare)</option>
      </select>
      {special && (
        <div className="grid grid-cols-3 gap-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
          <label>Fixed (₹)<input type="number" min="0" value={value.fixed} onChange={set('fixed')} className="mt-0.5 w-full rounded-lg border px-2 py-1 text-[12.5px]" style={FIELD} /></label>
          <label>% of fare<input type="number" min="0" max="100" value={value.percent} onChange={set('percent')} className="mt-0.5 w-full rounded-lg border px-2 py-1 text-[12.5px]" style={FIELD} /></label>
          <label>Admin share %<input type="number" min="0" max="100" value={value.admin_share} onChange={set('admin_share')} className="mt-0.5 w-full rounded-lg border px-2 py-1 text-[12.5px]" style={FIELD} /></label>
        </div>
      )}
    </div>
  )
}

function CancellationPolicy() {
  const toast = useToast()
  const fetcher = useCallback(() => api.get('/customise-settings').then((res) => res.data.data), [])
  const { data, loading } = useApiQuery(fetcher)
  const [driver, setDriver] = useState(EMPTY_POLICY)
  const [customer, setCustomer] = useState(EMPTY_POLICY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!data) return
    setDriver(data.driver)
    setCustomer(data.customer)
  }, [data])

  async function save() {
    setSaving(true)
    try {
      await api.put('/customise-settings', { driver, customer })
      toast.success('Cancellation policy saved.')
    } catch (err) {
      toast.error(err?.response?.data?.message || 'Could not save the policy.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <details className="surface-card mt-4 rounded-xl p-4">
      <summary className="cursor-pointer text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>Cancellation policy</summary>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
        Special charge = fixed amount + % of the agreed fare (never more than the fare). The admin keeps its share; the rest goes to the other party.
        Normal keeps the usual rate-card charge. Applies to your city{data && data.city_id == null ? ' (all cities, the default)' : ''}.
      </p>
      {loading ? <div className="mt-3 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>Loading…</div> : (
        <>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <PolicyEditor title="Driver cancels after assignment" value={driver} onChange={setDriver} />
            <PolicyEditor title="Customer cancels after assignment" value={customer} onChange={setCustomer} />
          </div>
          <button type="button" disabled={saving} onClick={save} className="mt-3 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--brand)' }}>
            {saving ? 'Saving…' : 'Save policy'}
          </button>
        </>
      )}
    </details>
  )
}

function DetailDrawer({ order, onClose }) {
  const fetcher = useCallback(() => api.get(`/customise-orders/${order.id}`).then((res) => res.data.data), [order.id])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(REALTIME_EVENTS, refetch)
  const o = data?.order

  return (
    <Drawer open onClose={onClose} title={`Customise Order #${order.id}`} subtitle={order.customer?.name || `Customer #${order.uid}`} width={560}>
      {loading && <div style={{ color: 'var(--ink-muted)' }}>Loading…</div>}
      {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
      {o && (
        <>
          <Section title="Status">
            <Row label="Status"><Badge tone={statusTone(o.status)}>{o.status}</Badge></Row>
            <Row label="Customer">{order.customer ? `${order.customer.name || ''} ${order.customer.mobile ? '· ' + order.customer.mobile : ''}` : `#${o.uid}`}</Row>
            <Row label="Customer's offer">{formatCurrency(o.initial_fare)}</Row>
            <Row label="Final agreed fare">{o.agreed_fare != null ? formatCurrency(o.agreed_fare) : null}</Row>
            <Row label="Assigned driver">{o.agreed_rider_id ? `#${o.agreed_rider_id}` : null}</Row>
            <Row label="Ride order">{o.pkg_order_id ? `#${o.pkg_order_id}` : null}</Row>
            <Row label="Bargaining starts">{formatDateTime(o.bargain_start_at)}</Row>
            <Row label="Expires">{formatDateTime(o.expires_at)}</Row>
            <Row label="Vehicle category">{o.category_name || 'Any'}</Row>
          </Section>

          <Section title="Route">
            <Row label="Pickup">{o.p_address}{o.p_exact ? '' : ' (approximate)'}</Row>
            {data.stops.map((s) => <Row key={s.id} label={`Stop ${s.seq} (${s.kind})`}>{s.address}</Row>)}
            <Row label="Drop">{o.d_address}</Row>
          </Section>

          <Section title="Goods">
            <Row label="Description">{o.goods_desc}</Row>
            <Row label="Quantity">{o.goods_qty}</Row>
            <Row label="Weight">{o.goods_weight_kg} kg</Row>
            <Row label="Size (L×W×H cm)">{[o.goods_len_cm, o.goods_wid_cm, o.goods_hgt_cm].every((v) => v != null) ? `${o.goods_len_cm} × ${o.goods_wid_cm} × ${o.goods_hgt_cm}` : null}</Row>
            <Row label="Packing notes">{o.packing_notes}</Row>
          </Section>

          <Section title="Pickup handling">
            <Row label="Floor / carry">{`${o.p_floor} / ${o.p_carry_m} m`}</Row>
            <Row label="Helpers">{o.p_helpers}</Row>
            <Row label="Loading / waiting">{`${o.p_load_min} min / ${o.p_wait_min} min`}</Row>
            <Row label="Notes">{o.p_notes}</Row>
          </Section>

          <Section title="Drop handling">
            <Row label="Floor / carry">{`${o.d_floor} / ${o.d_carry_m} m`}</Row>
            <Row label="Helpers">{o.d_helpers}</Row>
            <Row label="Unloading / waiting">{`${o.d_unload_min} min / ${o.d_wait_min} min`}</Row>
            <Row label="Notes">{o.d_notes}</Row>
          </Section>

          <Section title={`Offers (${data.offers.length})`}>
            {data.offers.length === 0 && <div className="py-1 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>No offers yet.</div>}
            {data.offers.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[12.5px]" style={{ borderTop: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--ink)' }}>{f.driver_name || `Driver #${f.rider_id}`} <span style={{ color: 'var(--ink-faint)' }}>{f.vehicle}</span></span>
                <span className="flex items-center gap-2">
                  <b className="font-mono-data">{formatCurrency(f.amount)}</b>
                  <Badge tone={offerTone(f.status)}>{f.kind} · {f.status}</Badge>
                  <span style={{ color: 'var(--ink-faint)' }}>{formatDateTime(f.created_at)}</span>
                </span>
              </div>
            ))}
          </Section>

          <Section title="Timers and extra charges">
            {data.timers.length === 0 && <div className="py-1 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>Recorded when the trip is completed.</div>}
            {data.timers.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-[12.5px]" style={{ borderTop: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--ink)' }}>{segmentLabel(t.segment)}</span>
                <span className="flex items-center gap-3" style={{ color: 'var(--ink-muted)' }}>
                  <span>selected {t.selected_min} min</span>
                  <span>actual {Math.round((t.elapsed_seconds / 60) * 10) / 10} min</span>
                  <b className="font-mono-data" style={{ color: Number(t.charge) > 0 ? 'var(--danger)' : 'var(--ink)' }}>{formatCurrency(t.charge)}</b>
                </span>
              </div>
            ))}
            {data.timers.length > 0 && (
              <div className="flex justify-between pt-1.5 text-[12.5px]" style={{ borderTop: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--ink-muted)' }}>Extra charges in total</span>
                <b className="font-mono-data">{formatCurrency(data.timers.reduce((sum, t) => sum + Number(t.charge || 0), 0))}</b>
              </div>
            )}
          </Section>

          <Section title="Rides and reassignment history">
            {data.rides.length === 0 && <div className="py-1 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>No ride has been created yet.</div>}
            {data.rides.map((r, i) => (
              <div key={r.id} className="py-1.5 text-[12.5px]" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span style={{ color: 'var(--ink)' }}>Ride #{r.id} · {r.driver_name || `Driver #${r.rid}`}{r.vehicle ? ` (${r.vehicle})` : ''}{i < data.rides.length - 1 || r.o_status === 'Cancelled' ? '' : ' · current'}</span>
                  <Badge tone={r.o_status === 'Completed' ? 'success' : r.o_status === 'Cancelled' ? 'danger' : 'info'}>{r.o_status}</Badge>
                </div>
                <div className="flex flex-wrap justify-between gap-2" style={{ color: 'var(--ink-muted)' }}>
                  <span>Fare {formatCurrency(r.total_dcharge)}</span>
                  <span>Advance {formatCurrency(r.advance_payment || 0)} · {Number(r.payment_status) === 1 ? 'paid' : 'unpaid'}</span>
                </div>
                {r.cancel_reason && <div style={{ color: 'var(--ink-faint)' }}>{r.cancel_reason}</div>}
              </div>
            ))}
          </Section>

          <Section title="Cancellation and penalties">
            {data.fees.length === 0 && <div className="py-1 text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>No cancellation penalty applied.</div>}
            {data.fees.map((f) => (
              <div key={f.id} className="py-1.5 text-[12.5px]" style={{ borderTop: '1px solid var(--border)' }}>
                <div className="flex justify-between gap-3">
                  <span style={{ color: 'var(--ink)' }}>{f.side === 'driver' ? `Driver #${f.payer_id} cancelled` : 'Customer cancelled'} ({f.mode})</span>
                  <b className="font-mono-data">{formatCurrency(f.charge)}</b>
                </div>
                <div className="flex justify-between gap-3" style={{ color: 'var(--ink-muted)' }}>
                  <span>Admin share {formatCurrency(f.admin_share)}</span>
                  <span>To {f.side === 'driver' ? 'customer' : 'driver'} {formatCurrency(f.recipient_amount)}</span>
                </div>
                {f.reason && <div style={{ color: 'var(--ink-faint)' }}>{f.reason}</div>}
              </div>
            ))}
          </Section>

          <Section title="History">
            {data.events.map((e) => (
              <div key={e.id} className="flex justify-between gap-3 py-1 text-[12px]">
                <span style={{ color: 'var(--ink)' }}>{e.type.replace(/_/g, ' ')}{e.rider_id ? ` · driver #${e.rider_id}` : ''}</span>
                <span style={{ color: 'var(--ink-faint)' }}>{formatDateTime(e.created_at)}</span>
              </div>
            ))}
          </Section>
        </>
      )}
    </Drawer>
  )
}

export default function CustomiseOrders() {
  const { hasRole } = useAuth()
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)

  const fetcher = useCallback(
    () => api.get('/customise-orders', { params: { status: status !== 'all' ? status : undefined } }).then((res) => res.data.data),
    [status],
  )
  const { data: orders, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(REALTIME_EVENTS, refetch)

  const rows = (orders || []).filter((o) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [o.id, o.goods_desc, o.p_address, o.d_address, o.customer?.name].some((v) => String(v ?? '').toLowerCase().includes(q))
  })

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>Customise Orders</h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Negotiated jobs: the customer names a price, drivers accept or counter, and the customer picks one. Monitoring only.
      </p>

      {hasRole('superadmin', 'admin') && <CancellationPolicy />}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatus(f.value)}
              className="rounded-full border px-3 py-1 text-[12.5px] font-medium"
              style={{
                borderColor: status === f.value ? 'var(--brand)' : 'var(--border)',
                background: status === f.value ? 'var(--brand-soft)' : 'transparent',
                color: status === f.value ? 'var(--brand)' : 'var(--ink-muted)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }} />
          <input
            type="text"
            placeholder="Search goods, address, customer, ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-64 rounded-lg border py-1.5 pl-8 pr-2.5 text-[12.5px] outline-none"
            style={FIELD_STYLE}
          />
        </div>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Order', 'Goods / route', 'Customer', 'Offer', 'Offers', 'Final fare', 'Window', 'Status', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-4 py-6" style={{ color: 'var(--ink-muted)' }}>Loading…</td></tr>}
              {!loading && error && <tr><td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--danger)' }}>{error}</td></tr>}
              {!loading && !error && rows.length === 0 && <tr><td colSpan={9} className="px-4 py-10 text-center" style={{ color: 'var(--ink-faint)' }}>No Customise Orders match.</td></tr>}
              {!loading && !error && rows.map((o) => (
                <tr key={o.id} className="cursor-pointer hover:bg-black/[0.02]" style={{ borderTop: '1px solid var(--border)' }} onClick={() => setSelected(o)}>
                  <td className="font-mono-data whitespace-nowrap px-4 py-2.5 font-medium" style={{ color: 'var(--ink)' }}>#{o.id}</td>
                  <td className="max-w-[280px] px-4 py-2.5">
                    <div className="truncate font-medium" style={{ color: 'var(--ink)' }}>{truncate(o.goods_desc, 45)}</div>
                    <div className="truncate text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>{truncate(o.p_address, 22)} → {truncate(o.d_address, 22)}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>{o.customer?.name || `#${o.uid}`}</td>
                  <td className="font-mono-data whitespace-nowrap px-4 py-2.5">{formatCurrency(o.initial_fare)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><Badge tone={o.offer_count > 0 ? 'info' : 'neutral'}>{o.offer_count}</Badge></td>
                  <td className="font-mono-data whitespace-nowrap px-4 py-2.5">{o.agreed_fare != null ? formatCurrency(o.agreed_fare) : '—'}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(o.bargain_start_at)} – {formatDateTime(o.expires_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5"><Badge tone={statusTone(o.status)}>{o.status}</Badge></td>
                  <td className="px-4 py-2.5 text-right"><Eye size={15} style={{ color: 'var(--ink-faint)' }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && <DetailDrawer key={selected.id} order={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

import { useCallback, useState } from 'react'
import { Eye, Search } from 'lucide-react'
import api from '../services/api'
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
                <span style={{ color: 'var(--ink)' }}>{SEGMENT_LABELS[t.segment] || t.segment}</span>
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

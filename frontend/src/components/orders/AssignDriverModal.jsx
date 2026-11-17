import { useCallback, useState } from 'react'
import { Search, Bike } from 'lucide-react'
import api from '../../services/api'
import Modal from '../common/Modal'
import useApiQuery from '../../hooks/useApiQuery'
import useDebouncedValue from '../../hooks/useDebouncedValue'
import OutsideDriverPanel from './OutsideDriverPanel'
import DriverSourceTabs from './DriverSourceTabs'
import useDailyDriversForOrder from '../../hooks/useDailyDriversForOrder'
import DriverChannelChoice, { WHATSAPP_HELP_TEXT } from './DriverChannelChoice'

export default function AssignDriverModal({ open, order, onClose, onAssigned }) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [selectedId, setSelectedId] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [channel, setChannel] = useState('app')
  // Driver filter: All (online) | Trial Drivers (online or offline) | Daily Drivers (scheduled-type orders only).
  const [source, setSource] = useState('all')
  const trialTab = source === 'trial'

  const fetcher = useCallback(() => {
    if (!open || !order) return Promise.resolve([])
    // The order's city plus drivers of other cities near the pickup (as dispatch offers it), same vehicle only.
    // Trial tab lists offline Trial Drivers too: they can be given the order over WhatsApp.
    return api
      .get(`/orders/${order.id}/assign-candidates`, { params: { source: trialTab ? 'trial' : 'all', search: debouncedSearch || undefined } })
      .then((res) => res.data.data)
  }, [open, order, debouncedSearch, trialTab])
  const { data, loading, error: loadError } = useApiQuery(fetcher)
  const allDrivers = data ?? []
  // Daily Driver filter (scheduled / next-day / Booking Guarantee orders only; hidden otherwise).
  const daily = useDailyDriversForOrder(order?.id, open)
  const showDaily = source === 'daily' && daily.applicable
  const dailyMatches = debouncedSearch.trim()
    ? daily.drivers.filter((d) =>
        `${d.full_name ?? ''} ${d.fmobile ?? ''}`.toLowerCase().includes(debouncedSearch.trim().toLowerCase()))
    : daily.drivers
  const drivers = showDaily ? dailyMatches : allDrivers
  const listLoading = showDaily ? daily.loading : loading
  const error = submitError || (loadError ? 'Could not load eligible drivers.' : '')

  const selected = drivers.find((d) => d.id === selectedId) || null
  const isTrial = selected?.trial_status === 'active'
  const viaWhatsapp = isTrial && channel === 'whatsapp'
  // Only the Trial tab lists offline drivers; one of them can only be given the order over WhatsApp. The All / Daily
  // tabs keep their old behaviour (their lists are already filtered server-side).
  const offlineBlocked = trialTab && Boolean(selected) && !selected.online && !viaWhatsapp

  function selectDriver(id) {
    setSelectedId(id)
    setChannel('app')
  }

  function changeSource(next) {
    setSource(next)
    selectDriver(null)
  }

  async function handleAssign() {
    if (!selectedId) return
    setSubmitting(true)
    setSubmitError('')
    try {
      await api.post(`/orders/${order.id}/assign-rider`, viaWhatsapp ? { rider_id: selectedId, channel: 'whatsapp' } : { rider_id: selectedId })
      onAssigned()
    } catch (err) {
      setSubmitError(err.response?.data?.message || 'Could not assign this driver.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign driver — Order #${order?.id}`}
      width={440}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedId || submitting || offlineBlocked}
            onClick={handleAssign}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Assigning…' : 'Assign'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <DriverSourceTabs
        value={source}
        onChange={changeSource}
        dailyCount={daily.drivers.length}
        loading={daily.loading}
        showDaily={daily.applicable}
        showTrial
      />

      <div className="mb-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <Search size={14} style={{ color: 'var(--ink-faint)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or mobile"
          className="flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
        {listLoading && (
          <p className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
            Loading eligible drivers…
          </p>
        )}
        {!listLoading && drivers.length === 0 && (
          <p className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
            {showDaily
              ? `No available Daily Drivers for this ${order?.category} order.`
              : trialTab
                ? `No active ${order?.category} Trial Drivers in this city or near the pickup.`
                : `No online, approved ${order?.category} drivers found nearby.`}
          </p>
        )}
        {!listLoading &&
          drivers.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => selectDriver(d.id)}
              className="flex w-full items-center gap-3 border-b px-3 py-2.5 text-left last:border-b-0 transition-colors"
              style={{
                borderColor: 'var(--border)',
                background: selectedId === d.id ? 'var(--brand-soft)' : 'transparent',
              }}
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                <Bike size={14} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                  {d.full_name || `Driver #${d.id}`}
                </div>
                <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                  {d.fmobile} · {d.vehicle_no || 'no plate'}
                  {trialTab && (d.online ? ' · online' : ' · offline')}
                  {d.distance_km != null && ` · ${d.distance_km} km`}
                  {d.other_city && ' · other city'}
                </div>
              </div>
              <div className="font-mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                ₹{d.wallet_balance}
              </div>
            </button>
          ))}
      </div>

      {isTrial && (
        <div className="mt-3 grid gap-1.5 rounded-lg border px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <span className="text-[12px] font-semibold" style={{ color: 'var(--ink-muted)' }}>Order kaise complete hoga?</span>
          <DriverChannelChoice riderId={selectedId} value={channel} onChange={setChannel} disabled={submitting} eligibility={selected?.whatsapp} />
          {viaWhatsapp && (
            <span className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>{WHATSAPP_HELP_TEXT}</span>
          )}
        </div>
      )}
      {offlineBlocked && (
        <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
          {isTrial ? 'This driver is offline. Choose WhatsApp, or ask them to go online in the app.' : 'This driver is offline.'}
        </p>
      )}

      {order?.o_status === 'Pending' && <OutsideDriverPanel order={order} onAssigned={onAssigned} />}
    </Modal>
  )
}

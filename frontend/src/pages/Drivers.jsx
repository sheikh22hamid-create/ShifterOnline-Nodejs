import { useCallback, useState } from 'react'
import { Search, Eye, Users, Radio, Navigation, ShieldAlert } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import useApiQuery from '../hooks/useApiQuery'
import KpiCard from '../components/common/KpiCard'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import DriverDetailDrawer from '../components/drivers/DriverDetailDrawer'
import { approvalTone, approvalLabel, onlineTone, onlineLabel, verificationTone } from '../utils/driverStatus'
import { formatCurrency } from '../utils/format'
import useDebouncedValue from '../hooks/useDebouncedValue'

const LIMIT = 20
const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }

export default function Drivers() {
  const { hasRole } = useAuth()
  const isSuperadmin = hasRole('superadmin')

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [verificationStatus, setVerificationStatus] = useState('')
  const [cityId, setCityId] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)

  const citiesFetcher = useCallback(() => (isSuperadmin ? api.get('/cities').then((res) => res.data.data) : Promise.resolve([])), [isSuperadmin])
  const { data: cities } = useApiQuery(citiesFetcher)

  const vehiclesFetcher = useCallback(() => api.get('/vehicles').then((res) => res.data.data), [])
  const { data: vehicles } = useApiQuery(vehiclesFetcher)

  // adminRiderController.list has no server-side pagination or vehicle
  // filter — pages and the vehicle filter are applied client-side below.
  // city_id only narrows anything for superadmin (admin/executive are
  // already hard-scoped to their own city server-side).
  const fetcher = useCallback(
    () =>
      api
        .get('/riders', { params: { search: debouncedSearch || undefined, verification_status: verificationStatus || undefined, city_id: cityId || undefined } })
        .then((res) => res.data),
    [debouncedSearch, verificationStatus, cityId]
  )
  const { data, loading, error, refetch } = useApiQuery(fetcher)

  const busyFetcher = useCallback(() => api.get('/fleet/live-tracking').then((res) => res.data.data), [])
  const { data: liveTracking } = useApiQuery(busyFetcher)
  const busyCount = liveTracking?.filter((r) => r.status === 'on_trip').length ?? 0

  const allDrivers = data?.data ?? []
  const drivers = vehicle ? allDrivers.filter((d) => d.vehicle === vehicle) : allDrivers
  const total = drivers.length
  const meta = data?.meta ?? null

  const pageRows = drivers.slice((page - 1) * LIMIT, page * LIMIT)

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Drivers Fleet
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Fleet directory with live status.
      </p>

      {meta && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:max-w-2xl sm:grid-cols-4">
          <KpiCard label="Total drivers" value={meta.total_drivers} icon={Users} size="sm" />
          <KpiCard label="Online now" value={meta.online_drivers} icon={Radio} iconColor="var(--success)" iconBg="var(--success-soft)" size="sm" />
          <KpiCard label="On a trip" value={busyCount} icon={Navigation} iconColor="var(--brand)" iconBg="var(--brand-soft)" size="sm" />
          <KpiCard label="KYC pending" value={meta.pending_kyc} icon={ShieldAlert} iconColor="var(--warning)" iconBg="var(--warning-soft)" size="sm" />
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <Search size={14} style={{ color: 'var(--ink-faint)' }} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search name, mobile, plate…"
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>
        {isSuperadmin && (
          <select
            value={cityId}
            onChange={(e) => {
              setCityId(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
            style={FIELD_STYLE}
          >
            <option value="">All cities</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        <select
          value={vehicle}
          onChange={(e) => {
            setVehicle(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
          style={FIELD_STYLE}
        >
          <option value="">All vehicle types</option>
          {vehicles?.map((v) => (
            <option key={v.id} value={v.title}>
              {v.title}
            </option>
          ))}
        </select>
        <select
          value={verificationStatus}
          onChange={(e) => {
            setVerificationStatus(e.target.value)
            setPage(1)
          }}
          className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
          style={FIELD_STYLE}
        >
          <option value="">All KYC statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Driver', 'Vehicle', 'City', 'Status', 'KYC', 'Wallet', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={7} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No drivers match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                pageRows.map((d) => (
                  <tr
                    key={d.id}
                    className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                    style={{ borderTop: '1px solid var(--border)' }}
                    onClick={() => setSelectedId(d.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{d.full_name || `Driver #${d.id}`}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {d.fmobile}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {d.vehicle}
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {d.vehicle_no}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {d.city_name}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="flex gap-1">
                        <Badge tone={approvalTone(d.status)}>{approvalLabel(d.status)}</Badge>
                        <Badge tone={onlineTone(d.a_status)}>{onlineLabel(d.a_status)}</Badge>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={verificationTone(d.verification_status)}>{d.verification_status}</Badge>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(d.wallet_balance)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Eye size={15} style={{ color: 'var(--ink-faint)' }} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
      </div>

      {selectedId && <DriverDetailDrawer key={selectedId} riderId={selectedId} onClose={() => setSelectedId(null)} onChanged={refetch} />}
    </div>
  )
}

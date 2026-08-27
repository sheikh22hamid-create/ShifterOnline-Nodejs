import { useCallback, useState } from 'react'
import { Search, Eye } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import CustomerDetailDrawer from '../components/customers/CustomerDetailDrawer'
import { formatCurrency, formatDateTime } from '../utils/format'
import useDebouncedValue from '../hooks/useDebouncedValue'

const LIMIT = 25
const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }

export default function Customers() {
  const { hasRole } = useAuth()
  const isSuperadmin = hasRole('superadmin')

  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const [cityId, setCityId] = useState('')
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState(null)

  const citiesFetcher = useCallback(() => (isSuperadmin ? api.get('/cities').then((res) => res.data.data) : Promise.resolve([])), [isSuperadmin])
  const { data: cities } = useApiQuery(citiesFetcher)

  const fetcher = useCallback(
    () => api.get('/customers', { params: { search: debouncedSearch || undefined, city_id: cityId || undefined, page, limit: LIMIT } }).then((res) => res.data),
    [debouncedSearch, cityId, page]
  )
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const customers = data?.data ?? []
  const total = data?.total ?? 0

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Customers
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Directory, wallet, and trip history.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded-lg border px-3 py-1.5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <Search size={14} style={{ color: 'var(--ink-faint)' }} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="Search name or mobile…"
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
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Customer', 'City', 'Wallet', 'Orders', 'Status', 'Joined', ''].map((h) => (
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
              {!loading && !error && customers.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No customers match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                customers.map((c) => (
                  <tr
                    key={c.id}
                    className="cursor-pointer transition-colors hover:bg-black/[0.02]"
                    style={{ borderTop: '1px solid var(--border)' }}
                    onClick={() => setSelectedId(c.id)}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{c.fname || `Customer #${c.id}`}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {c.mobile}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {c.city_name || '—'}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(c.wallet)}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {c.total_orders}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={c.status === 1 ? 'success' : 'danger'}>{c.status === 1 ? 'Active' : 'Blocked'}</Badge>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(c.registered_at)}
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

      {selectedId && <CustomerDetailDrawer key={selectedId} customerId={selectedId} onClose={() => setSelectedId(null)} onChanged={refetch} />}
    </div>
  )
}

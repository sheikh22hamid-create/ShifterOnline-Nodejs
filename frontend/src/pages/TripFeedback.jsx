import { useCallback, useState } from 'react'
import { Search, Star, MessageSquareText, OctagonAlert } from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import { formatDateTime, truncate } from '../utils/format'

const LIMIT = 25
const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const HEADERS = ['Order', 'Driver', 'Customer', 'Customer Rating', 'Pickup Location', 'Drop Location', 'Pickup-to-Drop Road', 'No Entry Zone', 'Submitted']

const CUSTOMER_TYPES = { commercial: 'Commercial', home_shifting: 'Home shifting' }

function Stars({ value }) {
  if (!value) return <span style={{ color: 'var(--ink-faint)' }}>—</span>
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="inline-flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star key={n} size={13} fill={n <= value ? '#F59E0B' : 'none'} style={{ color: n <= value ? '#F59E0B' : 'var(--border)' }} />
        ))}
      </span>
      <span className="font-mono-data text-[12px]" style={{ color: 'var(--ink-muted)' }}>{value}/5</span>
    </span>
  )
}

export default function TripFeedback() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [noEntry, setNoEntry] = useState('')
  const [rating, setRating] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const fetcher = useCallback(
    () =>
      api
        .get('/trip-feedback', {
          params: {
            page,
            limit: LIMIT,
            search: search.trim() || undefined,
            no_entry: noEntry || undefined,
            rating: rating || undefined,
            from: from || undefined,
            to: to || undefined,
          },
        })
        .then((res) => res.data),
    [page, search, noEntry, rating, from, to]
  )
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(['admin:order_status_update'], refetch)

  const rows = data?.data || []
  const total = data?.total || 0
  const hasFilter = Boolean(search || noEntry || rating || from || to)

  // Any filter change goes back to the first page.
  const onFilter = (setter) => (e) => {
    setter(e.target.value)
    setPage(1)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          Trip Feedback
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          What drivers reported after each completed trip: customer, pickup, drop and road ratings, plus any no-entry zone.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }} />
          <input
            type="text"
            placeholder="Order ID, driver or customer name"
            value={search}
            onChange={onFilter(setSearch)}
            className="w-64 rounded-lg border py-1.5 pl-8 pr-2.5 text-[12.5px] outline-none"
            style={FIELD_STYLE}
          />
        </div>
        <select value={noEntry} onChange={onFilter(setNoEntry)} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none" style={FIELD_STYLE}>
          <option value="">No Entry Zone: All</option>
          <option value="yes">No Entry Zone: Yes</option>
          <option value="no">No Entry Zone: No</option>
        </select>
        <select value={rating} onChange={onFilter(setRating)} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none" style={FIELD_STYLE}>
          <option value="">Any rating</option>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              Has a {n}-star rating
            </option>
          ))}
        </select>
        <input type="date" value={from} onChange={onFilter(setFrom)} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none" style={FIELD_STYLE} aria-label="From date" />
        <input type="date" value={to} onChange={onFilter(setTo)} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none" style={FIELD_STYLE} aria-label="To date" />
        {hasFilter && (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setNoEntry('')
              setRating('')
              setFrom('')
              setTo('')
              setPage(1)
            }}
            className="text-[12px] font-medium underline"
            style={{ color: 'var(--ink-muted)' }}
          >
            Clear
          </button>
        )}
      </div>

      <div className="surface-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {HEADERS.map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={HEADERS.length} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-12 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    <MessageSquareText size={22} className="mx-auto mb-2" />
                    No trip feedback found.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-black/[0.02]" style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="font-mono-data font-medium" style={{ color: 'var(--ink)' }}>#{r.order_id}</div>
                      {r.customer_type && (
                        <div className="mt-0.5">
                          <Badge tone="info">{CUSTOMER_TYPES[r.customer_type] || r.customer_type}</Badge>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="whitespace-nowrap font-medium" style={{ color: 'var(--ink)' }}>{r.driver_name}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{r.driver_mobile || `#${r.driver_id}`}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="whitespace-nowrap font-medium" style={{ color: 'var(--ink)' }}>{r.customer_name}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{r.customer_mobile || `#${r.customer_id}`}</div>
                    </td>
                    <td className="px-4 py-2.5"><Stars value={r.customer_rating} /></td>
                    <td className="px-4 py-2.5">
                      <Stars value={r.pickup_location_rating} />
                      {r.pickup && <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-faint)' }} title={r.pickup}>{truncate(r.pickup, 34)}</div>}
                    </td>
                    <td className="px-4 py-2.5">
                      <Stars value={r.drop_location_rating} />
                      {r.drop && <div className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-faint)' }} title={r.drop}>{truncate(r.drop, 34)}</div>}
                    </td>
                    <td className="px-4 py-2.5"><Stars value={r.route_rating} /></td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      {r.no_entry_zone === null || r.no_entry_zone === undefined ? (
                        <span style={{ color: 'var(--ink-faint)' }}>—</span>
                      ) : r.no_entry_zone ? (
                        <Badge tone="danger"><OctagonAlert size={11} /> Yes</Badge>
                      ) : (
                        <Badge tone="success">No</Badge>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(r.created_at)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
      </div>
    </div>
  )
}

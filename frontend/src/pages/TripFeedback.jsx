import { useCallback, useState } from 'react'
import { Search, Star, MessageSquareText, OctagonAlert, UserCheck, Truck, Quote, Package } from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import useRealtimeSync from '../hooks/useRealtimeSync'
import Badge from '../components/common/Badge'
import Pagination from '../components/common/Pagination'
import { formatDateTime, truncate } from '../utils/format'

const LIMIT = 25
const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

const DRIVER_HEADERS = ['Order', 'Driver', 'Customer', 'Customer Rating', 'Pickup Location', 'Drop Location', 'Pickup-to-Drop Road', 'No Entry Zone', 'Submitted']
const CUSTOMER_HEADERS = ['Order', 'Customer', 'Driver', 'Driver Rating', 'Delivery Speed', 'Vehicle Condition', 'Feedback Tags', 'Customer Comment', 'Submitted']
const RECEIVER_HEADERS = ['Order', 'Receiver', 'Driver', 'Driver Rating', 'Delivery Speed', 'Feedback Tags', 'Receiver Comment', 'Submitted']


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
  const [tab, setTab] = useState('driver') // 'driver' | 'customer' | 'receiver'
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [noEntry, setNoEntry] = useState('')
  const [rating, setRating] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const endpoint = tab === 'customer' ? '/customer-feedback' : tab === 'receiver' ? '/receiver-feedback' : '/trip-feedback'
  const headers = tab === 'driver' ? DRIVER_HEADERS : tab === 'receiver' ? RECEIVER_HEADERS : CUSTOMER_HEADERS

  const fetcher = useCallback(
    () =>
      api
        .get(endpoint, {
          params: {
            page,
            limit: LIMIT,
            search: search.trim() || undefined,
            no_entry: tab === 'driver' ? (noEntry || undefined) : undefined,
            rating: rating || undefined,
            from: from || undefined,
            to: to || undefined,
          },
        })
        .then((res) => res.data),
    [endpoint, tab, page, search, noEntry, rating, from, to]
  )
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  useRealtimeSync(['admin:order_status_update'], refetch)

  const rows = data?.data || []
  const total = data?.total || 0
  const hasFilter = Boolean(search || (tab === 'driver' && noEntry) || rating || from || to)

  const switchTab = (newTab) => {
    if (tab === newTab) return
    setTab(newTab)
    setPage(1)
    setSearch('')
    setNoEntry('')
    setRating('')
    setFrom('')
    setTo('')
  }

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
          {tab === 'driver'
            ? 'What drivers reported after each completed trip: customer, pickup, drop and road ratings, plus any no-entry zone.'
            : tab === 'receiver'
            ? 'What receivers said on the public tracking page after delivery: driver rating, delivery speed, tags and comments.'
            : 'What customers reported after trip completion & payment: driver rating, delivery speed, vehicle condition, tags and comments.'}
        </p>
      </div>

      {/* Segmented Tab Switcher */}
      <div className="inline-flex rounded-xl p-1 shadow-sm border" style={{ borderColor: 'var(--border)', background: 'var(--bg-muted, rgba(0,0,0,0.03))' }}>
        <button
          type="button"
          onClick={() => switchTab('driver')}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all"
          style={{
            background: tab === 'driver' ? 'var(--surface, #ffffff)' : 'transparent',
            color: tab === 'driver' ? 'var(--brand, #16A34A)' : 'var(--ink-muted)',
            boxShadow: tab === 'driver' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          <Truck size={15} />
          <span>Driver Feedback</span>
        </button>
        <button
          type="button"
          onClick={() => switchTab('customer')}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all"
          style={{
            background: tab === 'customer' ? 'var(--surface, #ffffff)' : 'transparent',
            color: tab === 'customer' ? 'var(--brand, #16A34A)' : 'var(--ink-muted)',
            boxShadow: tab === 'customer' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          <UserCheck size={15} />
          <span>Customer Feedback</span>
        </button>
        <button
          type="button"
          onClick={() => switchTab('receiver')}
          className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium transition-all"
          style={{
            background: tab === 'receiver' ? 'var(--surface, #ffffff)' : 'transparent',
            color: tab === 'receiver' ? 'var(--brand, #16A34A)' : 'var(--ink-muted)',
            boxShadow: tab === 'receiver' ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          <Package size={15} />
          <span>Receiver Feedback</span>
        </button>
      </div>


      {/* Filter Row */}
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

        {tab === 'driver' && (
          <select value={noEntry} onChange={onFilter(setNoEntry)} className="rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none" style={FIELD_STYLE}>
            <option value="">No Entry Zone: All</option>
            <option value="yes">No Entry Zone: Yes</option>
            <option value="no">No Entry Zone: No</option>
          </select>
        )}

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
                {headers.map((h) => (
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
                    <td colSpan={headers.length} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={headers.length} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={headers.length} className="px-4 py-12 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    <MessageSquareText size={22} className="mx-auto mb-2" />
                    No {tab} feedback found.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-black/[0.02]" style={{ borderTop: '1px solid var(--border)' }}>
                    {tab === 'driver' ? (
                      /* Driver Feedback Row */
                      <>
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
                      </>
                    ) : tab === 'receiver' ? (
                      /* Receiver Feedback Row */
                      <>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <div className="font-mono-data font-medium" style={{ color: 'var(--ink)' }}>#{r.order_id}</div>
                          {r.goods_type && (
                            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>{r.goods_type}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="font-mono-data font-medium" style={{ color: 'var(--ink)' }}>{r.receiver_mobile}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="whitespace-nowrap font-medium" style={{ color: 'var(--ink)' }}>{r.driver_name}</div>
                          <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{r.driver_mobile || `#${r.driver_id}`}</div>
                        </td>
                        <td className="px-4 py-2.5"><Stars value={r.driver_rating} /></td>
                        <td className="px-4 py-2.5"><Stars value={r.delivery_rating} /></td>
                        <td className="px-4 py-2.5">
                          {r.feedback_tags ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {r.feedback_tags.split(',').map((tag, idx) => (
                                <Badge key={idx} tone="neutral" className="text-[10.5px]">
                                  {tag.trim()}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--ink-faint)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 max-w-[220px]">
                          {r.comment ? (
                            <div className="flex items-start gap-1 text-[12px] italic" style={{ color: 'var(--ink-muted)' }}>
                              <Quote size={11} className="shrink-0 mt-0.5" style={{ color: 'var(--brand)' }} />
                              <span title={r.comment}>{truncate(r.comment, 55)}</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--ink-faint)' }}>—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(r.created_at)}</td>
                      </>
                    ) : (
                      /* Customer Feedback Row */
                      <>
                        <td className="whitespace-nowrap px-4 py-2.5">
                          <div className="font-mono-data font-medium" style={{ color: 'var(--ink)' }}>#{r.order_id}</div>
                          {r.goods_type && (
                            <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>{r.goods_type}</div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="whitespace-nowrap font-medium" style={{ color: 'var(--ink)' }}>{r.customer_name}</div>
                          <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{r.customer_mobile || `#${r.customer_id}`}</div>
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="whitespace-nowrap font-medium" style={{ color: 'var(--ink)' }}>{r.driver_name}</div>
                          <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>{r.driver_mobile || `#${r.driver_id}`}</div>
                        </td>
                        <td className="px-4 py-2.5"><Stars value={r.driver_rating} /></td>
                        <td className="px-4 py-2.5"><Stars value={r.delivery_rating} /></td>
                        <td className="px-4 py-2.5"><Stars value={r.vehicle_rating} /></td>
                        <td className="px-4 py-2.5">
                          {r.feedback_tags ? (
                            <div className="flex flex-wrap gap-1 max-w-[200px]">
                              {r.feedback_tags.split(',').map((tag, idx) => (
                                <Badge key={idx} tone="neutral" className="text-[10.5px]">
                                  {tag.trim()}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--ink-faint)' }}>—</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 max-w-[220px]">
                          {r.comment ? (
                            <div className="flex items-start gap-1 text-[12px] italic" style={{ color: 'var(--ink-muted)' }}>
                              <Quote size={11} className="shrink-0 mt-0.5" style={{ color: 'var(--brand)' }} />
                              <span title={r.comment}>{truncate(r.comment, 55)}</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--ink-faint)' }}>—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>{formatDateTime(r.created_at)}</td>
                      </>
                    )}
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

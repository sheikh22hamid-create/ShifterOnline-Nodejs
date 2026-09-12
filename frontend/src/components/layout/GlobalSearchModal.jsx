import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  X,
  Package,
  Users,
  UserCircle,
  ExternalLink,
  ChevronRight,
  Clock,
  MapPin,
  Truck,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Phone,
  Radio,
} from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { NAV_GROUPS } from '../../config/navigation'
import { formatCurrency, formatDateTime } from '../../utils/format'

export default function GlobalSearchModal({ open, onClose, onSelectOrder }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState({ orders: [], drivers: [], customers: [] })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  // Focus input when modal opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults({ orders: [], drivers: [], customers: [] })
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Flattened navigation pages accessible to the current user
  const allowedNavPages = useMemo(() => {
    const role = user?.role || 'executive'
    const pages = []
    NAV_GROUPS.forEach((grp) => {
      grp.items.forEach((item) => {
        if (!item.roles || item.roles.includes(role)) {
          pages.push({
            ...item,
            group: grp.group,
          })
        }
      })
    })
    return pages
  }, [user?.role])

  // Matched navigation pages
  const matchedPages = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) {
      // Default quick navigation actions when no query
      return allowedNavPages.slice(0, 5)
    }
    return allowedNavPages.filter((p) =>
      p.label.toLowerCase().includes(q) ||
      p.to.toLowerCase().includes(q) ||
      p.group.toLowerCase().includes(q)
    )
  }, [query, allowedNavPages])

  // Debounced API search for orders, drivers, and customers
  useEffect(() => {
    const q = query.trim()
    if (!q || q.length < 1) {
      setResults({ orders: [], drivers: [], customers: [] })
      setLoading(false)
      return
    }

    setLoading(true)
    const timeout = setTimeout(async () => {
      try {
        const res = await api.get('/search', { params: { q } })
        if (res.data?.success) {
          setResults(res.data.results || { orders: [], drivers: [], customers: [] })
        }
      } catch (err) {
        console.error('Global search error:', err)
      } finally {
        setLoading(false)
      }
    }, 200)

    return () => clearTimeout(timeout)
  }, [query])

  // Flatten all items into a single list for keyboard navigation (Up/Down/Enter)
  const allFlattenedItems = useMemo(() => {
    const list = []
    // 1. Navigation pages
    matchedPages.forEach((p) => {
      list.push({ type: 'page', data: p, key: `page-${p.to}-${p.label}` })
    })
    // 2. Orders
    results.orders.forEach((o) => {
      list.push({ type: 'order', data: o, key: `order-${o.id}` })
    })
    // 3. Drivers
    results.drivers.forEach((d) => {
      list.push({ type: 'driver', data: d, key: `driver-${d.id}` })
    })
    // 4. Customers
    results.customers.forEach((c) => {
      list.push({ type: 'customer', data: c, key: `customer-${c.id}` })
    })
    return list
  }, [matchedPages, results])

  // Reset selected index when items change
  useEffect(() => {
    setSelectedIndex(0)
  }, [allFlattenedItems.length])

  // Scroll active item into view
  useEffect(() => {
    const activeEl = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  function handleSelect(item) {
    if (!item) return
    onClose()

    if (item.type === 'page') {
      navigate(item.data.to)
    } else if (item.type === 'order') {
      if (typeof onSelectOrder === 'function') {
        onSelectOrder(item.data.id)
      } else {
        navigate(`/orders?search=${encodeURIComponent(item.data.id)}`)
      }
    } else if (item.type === 'driver') {
      navigate(`/drivers?search=${encodeURIComponent(item.data.mobile || item.data.name)}`)
    } else if (item.type === 'customer') {
      navigate(`/customers?search=${encodeURIComponent(item.data.mobile || item.data.name)}`)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1 < allFlattenedItems.length ? prev + 1 : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 >= 0 ? prev - 1 : allFlattenedItems.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (allFlattenedItems[selectedIndex]) {
        handleSelect(allFlattenedItems[selectedIndex])
      }
    }
  }

  if (!open) return null

  let runningIndex = 0

  return (
    <div className="fixed inset-0 z-[99999] flex items-start justify-center p-4 sm:p-6 md:p-20">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        onKeyDown={handleKeyDown}
        className="relative w-full max-w-2xl overflow-hidden rounded-2xl border shadow-2xl transition-all animate-in fade-in zoom-in-95 duration-200"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* Search Input Bar */}
        <div
          className="flex items-center gap-3 border-b px-4 py-3.5"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
        >
          <Search size={18} className="shrink-0" style={{ color: 'var(--brand)' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order #, customer name/phone, driver name/vno, or page..."
            className="flex-1 bg-transparent text-[14px] font-medium outline-none placeholder:text-[var(--ink-faint)]"
            style={{ color: 'var(--ink)' }}
          />
          {loading && (
            <div className="flex h-4 w-4 animate-spin rounded-full border-2 border-[var(--brand)] border-t-transparent" />
          )}
          {query && !loading && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                inputRef.current?.focus()
              }}
              className="rounded p-1 hover:bg-black/5"
              style={{ color: 'var(--ink-faint)' }}
            >
              <X size={14} />
            </button>
          )}
          <kbd
            className="hidden sm:inline-flex rounded border px-1.5 py-0.5 font-mono-data text-[10px] font-medium"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)', background: 'var(--surface)' }}
          >
            ESC
          </kbd>
        </div>

        {/* Results Body */}
        <div
          ref={listRef}
          className="max-h-[60vh] overflow-y-auto p-2 scrollbar-thin"
          style={{ background: 'var(--surface)' }}
        >
          {/* No results message */}
          {query.trim() && !loading && allFlattenedItems.length === 0 && (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl" style={{ background: 'var(--bg)' }}>
                <Search size={22} style={{ color: 'var(--ink-faint)' }} />
              </div>
              <p className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                No results found for &ldquo;{query}&rdquo;
              </p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Try searching by Order ID, Customer Mobile, Driver Name, or Vehicle Number.
              </p>
            </div>
          )}

          {/* 1. Navigation Pages */}
          {matchedPages.length > 0 && (
            <div className="mb-2">
              <div
                className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--ink-faint)' }}
              >
                {query.trim() ? 'Navigation & Pages' : 'Quick Jumps'}
              </div>
              <div className="space-y-0.5">
                {matchedPages.map((page) => {
                  const idx = runningIndex++
                  const isSelected = selectedIndex === idx
                  const Icon = page.icon || ArrowRight
                  return (
                    <button
                      key={page.to + page.label}
                      type="button"
                      data-index={idx}
                      onClick={() => handleSelect({ type: 'page', data: page })}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all"
                      style={{
                        background: isSelected ? 'var(--brand-soft)' : 'transparent',
                        color: isSelected ? 'var(--brand)' : 'var(--ink)',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            background: isSelected ? 'var(--brand)' : 'var(--bg)',
                            color: isSelected ? 'var(--brand-ink)' : 'var(--ink-muted)',
                          }}
                        >
                          <Icon size={14} />
                        </div>
                        <div className="truncate text-[13px] font-medium">{page.label}</div>
                      </div>
                      <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                        <span>{page.group}</span>
                        <ChevronRight size={12} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 2. Orders */}
          {results.orders.length > 0 && (
            <div className="mb-2">
              <div
                className="flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--ink-faint)' }}
              >
                <span>Orders ({results.orders.length})</span>
                <span className="text-[10px] font-normal lowercase">click to view details</span>
              </div>
              <div className="space-y-0.5">
                {results.orders.map((order) => {
                  const idx = runningIndex++
                  const isSelected = selectedIndex === idx
                  return (
                    <button
                      key={order.id}
                      type="button"
                      data-index={idx}
                      onClick={() => handleSelect({ type: 'order', data: order })}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all"
                      style={{
                        background: isSelected ? 'var(--brand-soft)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            background: isSelected ? 'var(--brand)' : 'var(--bg)',
                            color: isSelected ? 'var(--brand-ink)' : 'var(--brand)',
                          }}
                        >
                          <Package size={15} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono-data text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                              Order #{order.id}
                            </span>
                            <span
                              className="rounded-full px-2 py-0.2 text-[10px] font-bold uppercase"
                              style={{
                                background:
                                  order.status === 'Completed'
                                    ? 'var(--success-soft)'
                                    : order.status === 'Cancelled'
                                    ? 'var(--danger-soft)'
                                    : 'var(--brand-soft)',
                                color:
                                  order.status === 'Completed'
                                    ? 'var(--success)'
                                    : order.status === 'Cancelled'
                                    ? 'var(--danger)'
                                    : 'var(--brand)',
                              }}
                            >
                              {order.status}
                            </span>
                            {order.city_name && (
                              <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                                · {order.city_name}
                              </span>
                            )}
                          </div>
                          <div className="truncate text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {order.customer?.name ? `Customer: ${order.customer.name}` : ''}
                            {order.driver?.name ? ` · Driver: ${order.driver.name}` : ''}
                            {order.pickup_address ? ` · ${order.pickup_address}` : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 pl-3">
                        <div className="font-mono-data text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                          {formatCurrency(order.total_fare)}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                          {formatDateTime(order.date)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 3. Drivers */}
          {results.drivers.length > 0 && (
            <div className="mb-2">
              <div
                className="flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--ink-faint)' }}
              >
                <span>Drivers Fleet ({results.drivers.length})</span>
              </div>
              <div className="space-y-0.5">
                {results.drivers.map((driver) => {
                  const idx = runningIndex++
                  const isSelected = selectedIndex === idx
                  return (
                    <button
                      key={driver.id}
                      type="button"
                      data-index={idx}
                      onClick={() => handleSelect({ type: 'driver', data: driver })}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all"
                      style={{
                        background: isSelected ? 'var(--brand-soft)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            background: isSelected ? 'var(--brand)' : 'var(--bg)',
                            color: isSelected ? 'var(--brand-ink)' : 'var(--success)',
                          }}
                        >
                          <Truck size={15} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                              {driver.name}
                            </span>
                            <span
                              className="flex items-center gap-1 rounded-full px-2 py-0.2 text-[10px] font-semibold"
                              style={{
                                background: driver.online ? 'var(--success-soft)' : 'var(--bg)',
                                color: driver.online ? 'var(--success)' : 'var(--ink-faint)',
                              }}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ background: driver.online ? 'var(--success)' : 'var(--ink-faint)' }}
                              />
                              {driver.online ? 'Online' : 'Offline'}
                            </span>
                            {driver.vehicle_no && (
                              <span className="font-mono-data text-[11px] rounded px-1.5 py-0.5 font-bold" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
                                {driver.vehicle_no}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {driver.mobile && <span>📞 {driver.mobile}</span>}
                            {driver.city_name && <span>· {driver.city_name}</span>}
                            {driver.approval_status && <span>· KYC: {driver.approval_status}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: 'var(--brand)' }}>
                        <span>View Fleet</span>
                        <ChevronRight size={13} />
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* 4. Customers */}
          {results.customers.length > 0 && (
            <div className="mb-2">
              <div
                className="flex items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--ink-faint)' }}
              >
                <span>Customers ({results.customers.length})</span>
              </div>
              <div className="space-y-0.5">
                {results.customers.map((cust) => {
                  const idx = runningIndex++
                  const isSelected = selectedIndex === idx
                  return (
                    <button
                      key={cust.id}
                      type="button"
                      data-index={idx}
                      onClick={() => handleSelect({ type: 'customer', data: cust })}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition-all"
                      style={{
                        background: isSelected ? 'var(--brand-soft)' : 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                          style={{
                            background: isSelected ? 'var(--brand)' : 'var(--bg)',
                            color: isSelected ? 'var(--brand-ink)' : 'var(--info)',
                          }}
                        >
                          <UserCircle size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold" style={{ color: 'var(--ink)' }}>
                              {cust.name}
                            </span>
                            {cust.plan_type && cust.plan_type !== 'NORMAL' && (
                              <span
                                className="rounded-full px-2 py-0.2 text-[10px] font-bold uppercase"
                                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                              >
                                {cust.plan_type}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                            {cust.mobile && <span>📞 {cust.mobile}</span>}
                            {cust.email && <span>· {cust.email}</span>}
                            {cust.city_name && <span>· {cust.city_name}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 pl-3">
                        <div className="font-mono-data text-[12.5px] font-bold" style={{ color: 'var(--ink)' }}>
                          {formatCurrency(cust.wallet)}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                          Wallet Balance
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer Hotkey Legend */}
        <div
          className="flex items-center justify-between border-t px-4 py-2.5 text-[11px]"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink-faint)' }}
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded border px-1 py-0.5 font-mono-data text-[10px]" style={{ borderColor: 'var(--border)' }}>↑</kbd>
              <kbd className="rounded border px-1 py-0.5 font-mono-data text-[10px]" style={{ borderColor: 'var(--border)' }}>↓</kbd>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border px-1.5 py-0.5 font-mono-data text-[10px]" style={{ borderColor: 'var(--border)' }}>↵</kbd>
              <span>to select</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border px-1.5 py-0.5 font-mono-data text-[10px]" style={{ borderColor: 'var(--border)' }}>ESC</kbd>
              <span>to close</span>
            </span>
          </div>
          <div className="font-mono-data text-[10.5px]">Shifter Search 2.0</div>
        </div>
      </div>
    </div>
  )
}

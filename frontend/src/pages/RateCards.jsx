import { useCallback, useMemo, useState } from 'react'
import { Plus, Pencil, Trash2, Bike, Truck, Car, Zap, Search, Layers, Clock } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import RateCardFormModal from '../components/ratecards/RateCardFormModal'
import { formatCurrency } from '../utils/format'

function getVehicleIcon(catName) {
  const name = String(catName || '').toLowerCase()
  if (name.includes('bike') || name.includes('scooter') || name.includes('cycle') || name.includes('motorcycle')) {
    return <Bike size={13} />
  }
  if (name.includes('loader') || name.includes('electric') || name.includes('e-loader') || name.includes('e loader')) {
    return <Zap size={13} />
  }
  if (name.includes('3') || name.includes('auto') || name.includes('three') || name.includes('rickshaw')) {
    return <Car size={13} />
  }
  if (name.includes('4') || name.includes('truck') || name.includes('four') || name.includes('van') || name.includes('tata')) {
    return <Truck size={13} />
  }
  return <Truck size={13} />
}

function getVehicleTone(catName) {
  const name = String(catName || '').toLowerCase()
  if (name.includes('bike') || name.includes('scooter')) return 'success'
  if (name.includes('loader') || name.includes('electric') || name.includes('e-loader') || name.includes('e loader')) return 'brand'
  if (name.includes('3') || name.includes('auto') || name.includes('three')) return 'warning'
  if (name.includes('4') || name.includes('truck') || name.includes('four')) return 'info'
  return 'neutral'
}

export default function RateCards() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin')

  const fetcher = useCallback(() => api.get('/rate-cards').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const rateCards = data?.data ?? []

  const categoriesFetcher = useCallback(() => api.get('/categories').then((res) => res.data.data), [])
  const { data: categories = [] } = useApiQuery(categoriesFetcher)

  const [selectedCategory, setSelectedCategory] = useState('ALL')
  const [selectedType, setSelectedType] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')

  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Map of categories by ID for quick lookup fallback
  const categoryMap = useMemo(() => {
    const map = new Map()
    for (const cat of categories) {
      map.set(cat.id, cat)
    }
    return map
  }, [categories])

  // Aggregate category counts
  const categoryCounts = useMemo(() => {
    const counts = {}
    for (const rc of rateCards) {
      const catName = rc.vehicle_type || rc.category_name || categoryMap.get(rc.cat_id)?.cat_name || 'Other'
      counts[catName] = (counts[catName] || 0) + 1
    }
    return counts
  }, [rateCards, categoryMap])

  // Filtered rate cards
  const filteredRateCards = useMemo(() => {
    return rateCards.filter((rc) => {
      const vehicleName = rc.vehicle_type || rc.category_name || categoryMap.get(rc.cat_id)?.cat_name || 'Other'
      
      // Category filter
      if (selectedCategory !== 'ALL' && vehicleName.toLowerCase() !== selectedCategory.toLowerCase()) {
        return false
      }

      // Type filter (USER vs DRIVER)
      if (selectedType !== 'ALL' && rc.type !== selectedType) {
        return false
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const titleMatch = (rc.title || '').toLowerCase().includes(q)
        const vehicleMatch = vehicleName.toLowerCase().includes(q)
        const typeMatch = (rc.type || '').toLowerCase().includes(q)
        if (!titleMatch && !vehicleMatch && !typeMatch) {
          return false
        }
      }

      return true
    })
  }, [rateCards, selectedCategory, selectedType, searchQuery, categoryMap])

  // Unique category list for tabs
  const categoryTabs = useMemo(() => {
    const defaultList = ['Bike', '3 Wheeler', '4 Wheeler', 'E Loader']
    const presentCats = new Set(
      rateCards.map((rc) => rc.vehicle_type || rc.category_name || categoryMap.get(rc.cat_id)?.cat_name).filter(Boolean)
    )
    for (const cat of categories) {
      if (cat.cat_name) presentCats.add(cat.cat_name)
    }
    for (const def of defaultList) {
      presentCats.add(def)
    }
    return Array.from(presentCats)
  }, [rateCards, categories, categoryMap])

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/rate-cards/${deleteTarget.id}`)
      toast.success('Rate card deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this rate card.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Rate Cards & Vehicle Pricing
          </h1>
          <p className="mt-0.5 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Vehicle models (Model 1–5) and pricing tiers for Bike, E Loader, 3 Wheeler & 4 Wheeler.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold shadow-xs transition-opacity hover:opacity-90"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Plus size={14} /> New rate card
          </button>
        )}
      </div>

      {/* Category Pills / Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() => setSelectedCategory('ALL')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all ${
            selectedCategory === 'ALL'
              ? 'shadow-xs font-semibold'
              : 'opacity-70 hover:opacity-100'
          }`}
          style={{
            background: selectedCategory === 'ALL' ? 'var(--brand)' : 'var(--bg-muted)',
            color: selectedCategory === 'ALL' ? 'var(--brand-ink)' : 'var(--ink)',
            border: '1px solid',
            borderColor: selectedCategory === 'ALL' ? 'var(--brand)' : 'var(--border)',
          }}
        >
          <Layers size={13} />
          All Vehicles
          <span
            className="ml-1 rounded-full px-1.5 py-0.2 text-[10.5px]"
            style={{
              background: selectedCategory === 'ALL' ? 'rgba(0,0,0,0.15)' : 'var(--border)',
              color: selectedCategory === 'ALL' ? 'var(--brand-ink)' : 'var(--ink-muted)',
            }}
          >
            {rateCards.length}
          </span>
        </button>

        {categoryTabs.map((catName) => {
          const count = categoryCounts[catName] || 0
          const isSelected = selectedCategory.toLowerCase() === catName.toLowerCase()
          return (
            <button
              key={catName}
              type="button"
              onClick={() => setSelectedCategory(isSelected ? 'ALL' : catName)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-all ${
                isSelected
                  ? 'shadow-xs font-semibold'
                  : 'opacity-75 hover:opacity-100'
              }`}
              style={{
                background: isSelected ? 'var(--ink)' : 'var(--bg-muted)',
                color: isSelected ? 'var(--bg)' : 'var(--ink)',
                border: '1px solid',
                borderColor: isSelected ? 'var(--ink)' : 'var(--border)',
              }}
            >
              {getVehicleIcon(catName)}
              {catName}
              {count > 0 && (
                <span
                  className="ml-1 rounded-full px-1.5 py-0.2 text-[10.5px]"
                  style={{
                    background: isSelected ? 'rgba(255,255,255,0.2)' : 'var(--border)',
                    color: isSelected ? 'var(--bg)' : 'var(--ink-muted)',
                  }}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }} />
          <input
            type="text"
            placeholder="Search by vehicle (Bike, 3 Wheeler...) or model..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border py-1.5 pl-8 pr-3 text-[12.5px] outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="rounded-lg border px-2.5 py-1.5 text-[12px] font-medium outline-none"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
          >
            <option value="ALL">All Applicability (Customer & Driver)</option>
            <option value="USER">Customer Fare (USER)</option>
            <option value="DRIVER">Driver Earning (DRIVER)</option>
          </select>
        </div>
      </div>

      {/* Rate Cards Table */}
      <div className="surface-card overflow-hidden rounded-xl border" style={{ borderColor: 'var(--border)' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {[
                  'Vehicle Type',
                  'Model / Title',
                  'Min Fare',
                  'Per KM',
                  'Night Surge',
                  'Driver Share',
                  'Wait Policy',
                  'Status',
                  canManage ? 'Actions' : undefined,
                ]
                  .filter((h) => h !== undefined)
                  .map((h) => (
                    <th
                      key={h}
                      className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide"
                      style={{ color: 'var(--ink-faint)' }}
                    >
                      {h}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={9} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}

              {!loading && error && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && filteredRateCards.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-muted)' }}>
                    No rate cards match your selected vehicle filter or search query.
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                filteredRateCards.map((rc) => {
                  const vehicleName = rc.vehicle_type || rc.category_name || categoryMap.get(rc.cat_id)?.cat_name || 'Vehicle'
                  const vehicleTone = getVehicleTone(vehicleName)

                  return (
                    <tr key={rc.id} className="transition-colors hover:bg-black/2 dark:hover:bg-white/2" style={{ borderTop: '1px solid var(--border)' }}>
                      {/* Vehicle Type Column */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tone={vehicleTone}>
                          <span className="flex items-center gap-1.5 font-semibold">
                            {getVehicleIcon(vehicleName)}
                            {vehicleName}
                          </span>
                        </Badge>
                      </td>

                      {/* Model / Title Column */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="font-medium" style={{ color: 'var(--ink)' }}>
                          {rc.title}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          {rc.type === 'USER' ? 'Customer Fare' : 'Driver Earning'}
                        </div>
                      </td>

                      {/* Min Fare */}
                      <td className="font-mono-data whitespace-nowrap px-4 py-3 font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(rc.min_charge)}
                      </td>

                      {/* Per KM */}
                      <td className="font-mono-data whitespace-nowrap px-4 py-3" style={{ color: 'var(--ink-muted)' }}>
                        {formatCurrency(rc.per_km_charge)} / km
                      </td>

                      {/* Night Surge */}
                      <td className="font-mono-data whitespace-nowrap px-4 py-3" style={{ color: 'var(--ink-muted)' }}>
                        <div>{rc.night_charge_percent}%</div>
                        {rc.start_time && rc.end_time && (
                          <div className="flex items-center gap-1 text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                            <Clock size={10} /> {rc.start_time} - {rc.end_time}
                          </div>
                        )}
                      </td>

                      {/* Driver Share / Commission */}
                      <td className="font-mono-data whitespace-nowrap px-4 py-3" style={{ color: 'var(--ink-muted)' }}>
                        <div>{rc.driver_per_percent}%</div>
                        {rc.service_charge_percent > 0 && (
                          <div className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                            {rc.service_charge_percent}% fee
                          </div>
                        )}
                      </td>

                      {/* Waiting Policy */}
                      <td className="font-mono-data whitespace-nowrap px-4 py-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                        <div>{rc.free_waiting_time || 0} min free</div>
                        <div className="text-[10.5px]" style={{ color: 'var(--ink-faint)' }}>
                          {formatCurrency(rc.waiting_charge || 0)}/min after
                        </div>
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap px-4 py-3">
                        <Badge tone={rc.status === 1 ? 'success' : 'neutral'}>
                          {rc.status === 1 ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>

                      {/* Actions */}
                      {canManage && (
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setFormTarget(rc)}
                              className="rounded p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                              style={{ color: 'var(--ink-muted)' }}
                              title="Edit rate card"
                              aria-label="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(rc)}
                              className="rounded p-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                              style={{ color: 'var(--danger)' }}
                              title="Delete rate card"
                              aria-label="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>

      {canManage && (
        <>
          <RateCardFormModal
            open={formTarget !== undefined}
            rateCard={formTarget}
            onClose={() => setFormTarget(undefined)}
            onSaved={() => {
              toast.success(formTarget ? 'Rate card updated.' : 'Rate card created.')
              setFormTarget(undefined)
              refetch()
            }}
          />
          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title="Delete rate card"
            footer={
              <>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  className="rounded-lg border px-3 py-1.5 text-[13px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--danger)' }}
                >
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            }
          >
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Delete <strong style={{ color: 'var(--ink)' }}>{deleteTarget?.vehicle_type ? `${deleteTarget.vehicle_type} - ` : ''}{deleteTarget?.title}</strong>? This is blocked if any driver is currently enabled for it.
            </p>
          </Modal>
        </>
      )}
    </div>
  )
}


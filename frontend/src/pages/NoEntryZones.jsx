import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Ban, Edit2, Plus, Trash2, X } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import ZoneMapDrawer from '../components/zones/ZoneMapDrawer'
import Badge from '../components/common/Badge'

// Vehicle-wise No Entry Zones (spec 2026-10-29): for one city and one vehicle category, the areas where pickup (or
// drop) is not allowed. Pickup and Drop zones are kept apart; many zones per combination. A city admin is locked to
// their own city by the API; a super admin picks the city.
const KINDS = [
  { value: 'pickup', label: 'Pickup No Entry Zones' },
  { value: 'drop', label: 'Drop No Entry Zones' },
]

const EMPTY_FORM = {
  name: '',
  center_lat: '25.1800',
  center_lng: '75.8300',
  radius_km: '1.0',
  polygon_geojson: '',
  status: 1,
}

export default function NoEntryZones() {
  const toast = useToast()
  // Kept in a ref so showing a toast never re-triggers the list fetch.
  const toastRef = useRef(toast)
  toastRef.current = toast
  const { hasRole, user } = useAuth()
  const [searchParams] = useSearchParams()
  const isSuper = hasRole('superadmin')
  const canEdit = hasRole('superadmin', 'admin')

  const [cities, setCities] = useState([])
  const [categories, setCategories] = useState([])
  const [cityId, setCityId] = useState(isSuper ? searchParams.get('city_id') || '' : String(user?.city_id || ''))
  const [categoryId, setCategoryId] = useState('')
  const [kind, setKind] = useState('pickup')
  const [zones, setZones] = useState([])
  const [loading, setLoading] = useState(false)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [shapeMode, setShapeMode] = useState('polygon')
  const [form, setForm] = useState(EMPTY_FORM)

  useEffect(() => {
    api.get('/cities').then((res) => setCities(res.data.data || res.data || [])).catch(() => {})
    // The vehicle categories are whatever is configured, never a fixed list.
    api.get('/categories').then((res) => setCategories((res.data.data || []).filter((c) => c.cat_status === 1))).catch(() => {})
  }, [])

  const ready = Boolean(cityId && categoryId)

  const fetchZones = useCallback(() => {
    if (!ready) {
      setZones([])
      return
    }
    setLoading(true)
    api
      .get('/no-entry-zones', { params: { city_id: cityId, category_id: categoryId, kind } })
      .then((res) => setZones(res.data.data || []))
      .catch((err) => toastRef.current.error(err.response?.data?.message || 'Could not load the zones'))
      .finally(() => setLoading(false))
  }, [ready, cityId, categoryId, kind])

  useEffect(() => {
    fetchZones()
  }, [fetchZones])

  const categoryName = useMemo(() => categories.find((c) => String(c.id) === String(categoryId))?.cat_name || '', [categories, categoryId])
  const cityTitle = useMemo(() => {
    const c = cities.find((x) => String(x.id) === String(cityId))
    return c ? c.title || c.name || `City #${c.id}` : ''
  }, [cities, cityId])

  function openCreate() {
    setEditing(null)
    setShapeMode('polygon')
    setForm(EMPTY_FORM)
    setModalOpen(true)
  }

  function openEdit(z) {
    setEditing(z)
    setShapeMode(z.polygon_geojson ? 'polygon' : 'circle')
    setForm({
      name: z.name,
      center_lat: String(z.center_lat),
      center_lng: String(z.center_lng),
      radius_km: String(z.radius_km || '1.0'),
      polygon_geojson: z.polygon_geojson || '',
      status: z.status,
    })
    setModalOpen(true)
  }

  function handleMapChange(updates) {
    setForm((prev) => ({
      ...prev,
      center_lat: String(updates.center_lat),
      center_lng: String(updates.center_lng),
      radius_km: String(updates.radius_km),
      polygon_geojson: updates.polygon_geojson || '',
    }))
  }

  async function save() {
    if (!form.name.trim()) {
      toast.error('Zone name is required')
      return
    }
    const payload = {
      name: form.name.trim(),
      center_lat: parseFloat(form.center_lat),
      center_lng: parseFloat(form.center_lng),
      radius_km: parseFloat(form.radius_km) || 1,
      polygon_geojson: form.polygon_geojson && form.polygon_geojson.trim() !== '' ? form.polygon_geojson : null,
      status: Number(form.status),
    }
    try {
      if (editing) {
        await api.put(`/no-entry-zones/${editing.id}`, payload)
      } else {
        await api.post('/no-entry-zones', { ...payload, city_id: Number(cityId), category_id: Number(categoryId), kind })
      }
      setModalOpen(false)
      toast.success('No Entry Zone saved')
      fetchZones()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not save the zone')
    }
  }

  async function toggleStatus(z) {
    try {
      await api.put(`/no-entry-zones/${z.id}`, { status: z.status === 1 ? 0 : 1 })
      fetchZones()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update the zone')
    }
  }

  async function remove(z) {
    if (!window.confirm(`Delete the No Entry Zone "${z.name}"?`)) return
    try {
      await api.delete(`/no-entry-zones/${z.id}`)
      fetchZones()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete the zone')
    }
  }

  const selectStyle = { background: 'var(--bg)', borderColor: 'var(--border)', color: 'var(--ink)' }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          <Ban className="text-amber-600" />
          No Entry Zones
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Choose a city and a vehicle category, then mark where that vehicle may not pick up or may not drop. A restriction applies only to the vehicle category and the pickup/drop type it was drawn for.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-2xl border p-4 sm:grid-cols-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
        <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
          City
          <select
            value={cityId}
            disabled={!isSuper}
            onChange={(e) => setCityId(e.target.value)}
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
            style={selectStyle}
          >
            <option value="">-- Select city --</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.title || c.name || `City #${c.id}`}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
          Vehicle category
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none"
            style={selectStyle}
          >
            <option value="">-- Select vehicle category --</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.cat_name}</option>
            ))}
          </select>
        </label>
        <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>
          Zone type
          <div className="mt-1 flex rounded-xl border p-1" style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}>
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className="flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition"
                style={{
                  background: kind === k.value ? 'var(--surface)' : 'transparent',
                  color: kind === k.value ? 'var(--ink)' : 'var(--ink-muted)',
                  boxShadow: kind === k.value ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {k.value === 'pickup' ? 'Pickup' : 'Drop'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!ready ? (
        <div className="rounded-2xl border p-10 text-center text-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
          Select a city and a vehicle category to see and mark its No Entry Zones.
        </div>
      ) : (
        <div className="rounded-2xl border shadow-sm" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              {KINDS.find((k) => k.value === kind).label} · {categoryName} · {cityTitle}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-700"
              >
                <Plus size={14} />
                Mark No Entry Zone
              </button>
            )}
          </div>
          {loading ? (
            <div className="p-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>Loading...</div>
          ) : zones.length === 0 ? (
            <div className="p-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
              No {kind} No Entry Zones for this vehicle in this city yet.
            </div>
          ) : (
            <ul>
              {zones.map((z) => (
                <li key={z.id} className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 first:border-t-0" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <div className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>{z.name}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <Badge tone={z.status === 1 ? 'success' : 'neutral'}>{z.status === 1 ? 'Active' : 'Disabled'}</Badge>
                      {z.polygon_geojson ? 'Drawn area' : `Circle ${z.radius_km} km`}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1.5">
                      <button type="button" onClick={() => toggleStatus(z)} className="rounded-lg border px-2.5 py-1.5 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}>
                        {z.status === 1 ? 'Disable' : 'Enable'}
                      </button>
                      <button type="button" onClick={() => openEdit(z)} className="rounded-lg p-2" style={{ color: 'var(--info, #1d4ed8)', background: 'var(--info-soft, #eff4ff)' }} title="Edit on map">
                        <Edit2 size={15} />
                      </button>
                      <button type="button" onClick={() => remove(z)} className="rounded-lg p-2" style={{ color: 'var(--danger, #b91c1c)', background: 'var(--danger-soft, #fef2f2)' }} title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-5">
          <div className="flex max-h-[95vh] w-full max-w-5xl flex-col rounded-2xl border p-6 shadow-2xl" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <div className="mb-4 flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold" style={{ color: 'var(--ink)' }}>
                  <Ban className="text-amber-600" />
                  {editing ? 'Edit' : 'Mark'} {kind === 'pickup' ? 'Pickup' : 'Drop'} No Entry Zone
                </h2>
                <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-muted)' }}>
                  {categoryName} · {cityTitle}. Draw the area where this vehicle may not {kind === 'pickup' ? 'pick up' : 'drop'}.
                </p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} style={{ color: 'var(--ink-muted)' }}>
                <X size={20} />
              </button>
            </div>
            <div className="grid flex-1 grid-cols-1 gap-5 overflow-y-auto pr-1 lg:grid-cols-12">
              <div className="flex flex-col justify-between space-y-3.5 lg:col-span-4">
                <div className="space-y-3.5">
                  <label className="block text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                    Zone name
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="e.g. Old city lanes"
                      className="mt-1 w-full rounded-xl border px-3.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                      style={selectStyle}
                    />
                  </label>
                  <label className="block text-xs font-semibold" style={{ color: 'var(--ink)' }}>
                    Status
                    <select
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: Number(e.target.value) })}
                      className="mt-1 w-full rounded-xl border px-3.5 py-2 text-xs outline-none"
                      style={selectStyle}
                    >
                      <option value={1}>Active</option>
                      <option value={0}>Disabled</option>
                    </select>
                  </label>
                </div>
                <div className="flex justify-end gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                  <button type="button" onClick={() => setModalOpen(false)} className="rounded-xl px-4 py-2 text-xs font-semibold" style={{ background: 'var(--bg)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}>
                    Cancel
                  </button>
                  <button type="button" onClick={save} className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700">
                    Save No Entry Zone
                  </button>
                </div>
              </div>
              <div className="flex min-h-[420px] flex-col lg:col-span-8">
                <ZoneMapDrawer
                  centerLat={form.center_lat}
                  centerLng={form.center_lng}
                  radiusKm={form.radius_km}
                  polygonGeojson={form.polygon_geojson}
                  shapeMode={shapeMode}
                  onShapeModeChange={setShapeMode}
                  onChange={handleMapChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

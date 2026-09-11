import { useState, useEffect } from 'react'
import {
  MapPin,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  XCircle,
  Search,
  Layers,
  Map as MapIcon,
  LayoutGrid,
  X,
  Circle,
  Square,
  Hexagon,
  Sparkles,
} from 'lucide-react'
import api from '../services/api'
import ZoneMapDrawer from '../components/zones/ZoneMapDrawer'
import AllZonesOverviewMap from '../components/zones/AllZonesOverviewMap'

export default function ServiceZones() {
  const [zones, setZones] = useState([])
  const [cities, setCities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState('grid') // 'grid' | 'map'

  // Create / Edit Modal State
  const [modalOpen, setModalOpen] = useState(false)
  const [editingZone, setEditingZone] = useState(null)
  const [shapeMode, setShapeMode] = useState('circle') // 'circle' | 'square' | 'polygon'

  const [form, setForm] = useState({
    name: '',
    city_id: '',
    center_lat: '25.1800',
    center_lng: '75.8300',
    radius_km: '5.0',
    polygon_geojson: '',
    status: 1,
  })

  useEffect(() => {
    fetchZones()
    api.get('/cities').then((res) => setCities(res.data.data || res.data || [])).catch(() => {})
  }, [])

  function fetchZones() {
    setLoading(true)
    api
      .get('/service-zones')
      .then((res) => setZones(res.data.data || []))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false))
  }

  function openCreate() {
    setEditingZone(null)
    setShapeMode('circle')
    setForm({
      name: '',
      city_id: cities[0]?.id || '',
      center_lat: '25.1800',
      center_lng: '75.8300',
      radius_km: '5.0',
      polygon_geojson: '',
      status: 1,
    })
    setModalOpen(true)
  }

  function openEdit(z) {
    setEditingZone(z)

    // Detect shape mode from existing polygon
    let detectedMode = 'circle'
    if (z.polygon_geojson) {
      try {
        const parsed = typeof z.polygon_geojson === 'string' ? JSON.parse(z.polygon_geojson) : z.polygon_geojson
        if (Array.isArray(parsed)) {
          detectedMode = parsed.length === 5 ? 'square' : 'polygon'
        }
      } catch (e) {}
    }

    setShapeMode(detectedMode)
    setForm({
      name: z.name,
      city_id: z.city_id || '',
      center_lat: String(z.center_lat),
      center_lng: String(z.center_lng),
      radius_km: String(z.radius_km || '5.0'),
      polygon_geojson: z.polygon_geojson || '',
      status: z.status,
    })
    setModalOpen(true)
  }

  // Handle map drawer parameter updates
  function handleMapDrawerChange(updates) {
    setForm((prev) => ({
      ...prev,
      center_lat: String(updates.center_lat),
      center_lng: String(updates.center_lng),
      radius_km: String(updates.radius_km),
      polygon_geojson: updates.polygon_geojson || '',
    }))
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!form.name.trim()) {
      alert('Zone Name is required')
      return
    }

    try {
      if (editingZone) {
        await api.put(`/service-zones/${editingZone.id}`, form)
      } else {
        await api.post('/service-zones', form)
      }
      setModalOpen(false)
      fetchZones()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save service zone')
    }
  }

  async function handleDelete(id) {
    if (!window.confirm('Are you sure you want to delete this service zone?')) return
    try {
      await api.delete(`/service-zones/${id}`)
      fetchZones()
    } catch (err) {
      alert('Failed to delete zone')
    }
  }

  const filtered = zones.filter((z) =>
    z.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-6">
      {/* HEADER BAR */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight flex items-center gap-2" style={{ color: 'var(--ink)' }}>
            <MapPin className="text-blue-600" />
            Service Zones & Geofences
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Draw circle, square, or custom polygon operating boundaries on the interactive map for Monthly Dedicated Drivers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div
            className="flex p-1 rounded-xl border text-xs"
            style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
          >
            <button
              onClick={() => setViewMode('grid')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition"
              style={{
                background: viewMode === 'grid' ? 'var(--surface)' : 'transparent',
                color: viewMode === 'grid' ? 'var(--ink)' : 'var(--ink-muted)',
                boxShadow: viewMode === 'grid' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <LayoutGrid size={14} />
              Grid Cards
            </button>
            <button
              onClick={() => setViewMode('map')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition"
              style={{
                background: viewMode === 'map' ? 'var(--surface)' : 'transparent',
                color: viewMode === 'map' ? 'var(--ink)' : 'var(--ink-muted)',
                boxShadow: viewMode === 'map' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <MapIcon size={14} />
              All Zones Map
            </button>
          </div>

          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition"
          >
            <Plus size={18} />
            Mark Zone on Map
          </button>
        </div>
      </div>

      {/* SEARCH BAR (Grid View Only) */}
      {viewMode === 'grid' && (
        <div
          className="flex items-center gap-3 p-3 rounded-2xl border shadow-sm"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <Search size={18} style={{ color: 'var(--ink-faint)' }} className="ml-2" />
          <input
            type="text"
            placeholder="Search zone by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>
      )}

      {/* CONTENT: GRID CARDS OR FULL OVERVIEW MAP */}
      {viewMode === 'map' ? (
        <div
          className="p-4 rounded-2xl border shadow-sm space-y-3"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--ink)' }}>
              <Sparkles size={14} className="text-amber-500" />
              Showing {zones.length} Configured Geofenced Service Zones
            </span>
            <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Click any zone shape on map to view details or edit
            </span>
          </div>
          <AllZonesOverviewMap zones={zones} onEditZone={openEdit} />
        </div>
      ) : loading ? (
        <div className="flex justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl border p-12 text-center shadow-sm"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
        >
          <Layers size={40} className="mx-auto mb-3" style={{ color: 'var(--ink-faint)' }} />
          <h3 className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>No Service Zones Found</h3>
          <p className="text-xs mt-1" style={{ color: 'var(--ink-muted)' }}>
            Click "Mark Zone on Map" to draw circles or squares on the interactive map.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((z) => {
            const isPolygon = Boolean(z.polygon_geojson)
            return (
              <div
                key={z.id}
                className="rounded-2xl border p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>{z.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md"
                          style={{
                            background: isPolygon ? 'var(--brand-soft, #fdf1e8)' : 'var(--info-soft, #eff4ff)',
                            color: isPolygon ? 'var(--brand, #c2540a)' : 'var(--info, #1d4ed8)',
                            borderColor: isPolygon ? 'var(--brand-soft-border, #f3d6b8)' : 'var(--info-soft-border, #c3d4f7)',
                          }}
                        >
                          {isPolygon ? <Square size={12} /> : <Circle size={12} />}
                          {isPolygon ? 'Custom Geofence Box' : `Circle (${z.radius_km} km)`}
                        </span>
                      </div>
                    </div>
                    <span
                      className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
                      style={{
                        background: z.status === 1 ? 'var(--success-soft, #ecfdf3)' : 'var(--bg)',
                        color: z.status === 1 ? 'var(--success, #15803d)' : 'var(--ink-muted)',
                      }}
                    >
                      {z.status === 1 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {z.status === 1 ? 'Active' : 'Disabled'}
                    </span>
                  </div>

                  <div
                    className="mt-4 space-y-1.5 text-xs p-3 rounded-xl border"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex justify-between" style={{ color: 'var(--ink-muted)' }}>
                      <span className="font-medium">Center Coordinates:</span>
                      <span className="font-mono" style={{ color: 'var(--ink)' }}>
                        {Number(z.center_lat).toFixed(4)}, {Number(z.center_lng).toFixed(4)}
                      </span>
                    </div>
                    <div className="flex justify-between" style={{ color: 'var(--ink-muted)' }}>
                      <span className="font-medium">Coverage Area:</span>
                      <span className="font-medium" style={{ color: 'var(--ink)' }}>
                        {isPolygon ? 'Custom Polygon Boundary' : `~${Math.round(Math.PI * Math.pow(Number(z.radius_km || 5), 2))} sq km`}
                      </span>
                    </div>
                  </div>
                </div>

                <div
                  className="mt-5 pt-4 border-t flex items-center justify-end gap-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <button
                    onClick={() => openEdit(z)}
                    className="p-2 rounded-lg transition hover:opacity-80"
                    style={{ color: 'var(--info, #1d4ed8)', background: 'var(--info-soft, #eff4ff)' }}
                    title="Edit Zone on Map"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(z.id)}
                    className="p-2 rounded-lg transition hover:opacity-80"
                    style={{ color: 'var(--danger, #b91c1c)', background: 'var(--danger-soft, #fef2f2)' }}
                    title="Delete Zone"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* INTERACTIVE MAP-BASED CREATE / EDIT MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-5">
          <div
            className="rounded-2xl max-w-5xl w-full p-6 shadow-2xl border max-h-[95vh] flex flex-col justify-between"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          >
            {/* Modal Header */}
            <div
              className="flex items-center justify-between border-b pb-3 mb-4"
              style={{ borderColor: 'var(--border)' }}
            >
              <div>
                <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--ink)' }}>
                  <MapPin className="text-blue-600" />
                  {editingZone ? 'Edit Service Zone on Map' : 'Mark New Service Zone on Map'}
                </h2>
                <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
                  Click on the map or use the drawing tools to mark the operational boundary for drivers.
                </p>
              </div>
              <button onClick={() => setModalOpen(false)} style={{ color: 'var(--ink-muted)' }} className="hover:opacity-80">
                <X size={20} />
              </button>
            </div>

            {/* Split Layout: Form on Left, Interactive Map on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 overflow-y-auto pr-1">
              {/* Left Column: Form Details (4 Cols) */}
              <div className="lg:col-span-4 space-y-3.5 flex flex-col justify-between">
                <div className="space-y-3.5">
                  <div>
                    <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>Zone Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Central City Hub"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1 w-full rounded-xl border px-3.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                      style={{
                        background: 'var(--bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--ink)',
                      }}
                    />
                  </div>

                  {cities.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>City</label>
                      <select
                        value={form.city_id}
                        onChange={(e) => setForm({ ...form, city_id: e.target.value })}
                        className="mt-1 w-full rounded-xl border px-3.5 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500"
                        style={{
                          background: 'var(--bg)',
                          borderColor: 'var(--border)',
                          color: 'var(--ink)',
                        }}
                      >
                        <option value="">-- All Cities --</option>
                        {cities.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title || c.name || `City #${c.id}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Geofence Parameters Summary */}
                  <div
                    className="p-3.5 rounded-xl border space-y-2 text-xs"
                    style={{ background: 'var(--bg)', borderColor: 'var(--border)' }}
                  >
                    <span className="font-bold uppercase text-[10px] tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                      Geofence Parameters
                    </span>

                    <div className="flex justify-between" style={{ color: 'var(--ink-muted)' }}>
                      <span>Shape Type:</span>
                      <span className="font-semibold capitalize flex items-center gap-1" style={{ color: 'var(--ink)' }}>
                        {shapeMode === 'circle' && <Circle size={12} className="text-blue-500" />}
                        {shapeMode === 'square' && <Square size={12} className="text-emerald-500" />}
                        {shapeMode === 'polygon' && <Hexagon size={12} className="text-purple-500" />}
                        {shapeMode}
                      </span>
                    </div>

                    <div className="flex justify-between" style={{ color: 'var(--ink-muted)' }}>
                      <span>Center Lat / Lng:</span>
                      <span className="font-mono font-medium" style={{ color: 'var(--ink)' }}>
                        {Number(form.center_lat).toFixed(4)}, {Number(form.center_lng).toFixed(4)}
                      </span>
                    </div>

                    <div className="flex justify-between" style={{ color: 'var(--ink-muted)' }}>
                      <span>Effective Radius:</span>
                      <span className="font-mono font-semibold" style={{ color: 'var(--info, #1d4ed8)' }}>
                        {form.radius_km} km
                      </span>
                    </div>

                    {form.polygon_geojson && (
                      <div className="pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                        <span className="text-[10px] block mb-0.5" style={{ color: 'var(--ink-faint)' }}>Polygon Boundary GeoJSON:</span>
                        <div
                          className="font-mono text-[10px] p-1.5 rounded-lg max-h-16 overflow-y-auto border"
                          style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
                        >
                          {form.polygon_geojson}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  className="pt-3 border-t flex justify-end gap-2"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-xl px-4 py-2 text-xs font-semibold transition hover:opacity-80"
                    style={{ background: 'var(--bg)', color: 'var(--ink-muted)', border: '1px solid var(--border)' }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    className="rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white hover:bg-blue-700 shadow-sm transition"
                  >
                    Save Service Zone
                  </button>
                </div>
              </div>

              {/* Right Column: Interactive Map Drawer (8 Cols) */}
              <div className="lg:col-span-8 min-h-[420px] flex flex-col">
                <ZoneMapDrawer
                  centerLat={form.center_lat}
                  centerLng={form.center_lng}
                  radiusKm={form.radius_km}
                  polygonGeojson={form.polygon_geojson}
                  shapeMode={shapeMode}
                  onShapeModeChange={setShapeMode}
                  onChange={handleMapDrawerChange}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

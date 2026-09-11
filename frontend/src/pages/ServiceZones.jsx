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
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <MapPin className="text-blue-600 dark:text-blue-400" />
            Service Zones & Geofences
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Draw circle, square, or custom polygon operating boundaries on the interactive map for Monthly Dedicated Drivers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
            <button
              onClick={() => setViewMode('grid')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <LayoutGrid size={14} />
              Grid Cards
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                viewMode === 'map'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
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
        <div className="flex items-center gap-3 bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
          <Search size={18} className="text-slate-400 ml-2" />
          <input
            type="text"
            placeholder="Search zone by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-transparent text-sm text-slate-900 dark:text-white outline-none"
          />
        </div>
      )}

      {/* CONTENT: GRID CARDS OR FULL OVERVIEW MAP */}
      {viewMode === 'map' ? (
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
              <Sparkles size={14} className="text-amber-500" />
              Showing {zones.length} Configured Geofenced Service Zones
            </span>
            <span className="text-xs text-slate-400">Click any zone shape on map to view details or edit</span>
          </div>
          <AllZonesOverviewMap zones={zones} onEditZone={openEdit} />
        </div>
      ) : loading ? (
        <div className="flex justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-500">
          <Layers size={40} className="mx-auto text-slate-400 mb-3" />
          <h3 className="font-semibold text-slate-700 dark:text-slate-300">No Service Zones Found</h3>
          <p className="text-sm mt-1">Click "Mark Zone on Map" to draw circles or squares on the interactive map.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((z) => {
            const isPolygon = Boolean(z.polygon_geojson)
            return (
              <div
                key={z.id}
                className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">{z.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                            isPolygon
                              ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400'
                              : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400'
                          }`}
                        >
                          {isPolygon ? <Square size={12} /> : <Circle size={12} />}
                          {isPolygon ? 'Custom Geofence Box' : `Circle (${z.radius_km} km)`}
                        </span>
                      </div>
                    </div>
                    <span
                      className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
                        z.status === 1
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {z.status === 1 ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {z.status === 1 ? 'Active' : 'Disabled'}
                    </span>
                  </div>

                  <div className="mt-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                    <div className="flex justify-between">
                      <span className="font-medium">Center Coordinates:</span>
                      <span className="font-mono">{Number(z.center_lat).toFixed(4)}, {Number(z.center_lng).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="font-medium">Coverage Area:</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {isPolygon ? 'Custom Polygon Boundary' : `~${Math.round(Math.PI * Math.pow(Number(z.radius_km || 5), 2))} sq km`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                  <button
                    onClick={() => openEdit(z)}
                    className="p-2 text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                    title="Edit Zone on Map"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(z.id)}
                    className="p-2 text-slate-600 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-3 sm:p-5">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-5xl w-full p-6 shadow-2xl border border-slate-200 dark:border-slate-800 max-h-[95vh] flex flex-col justify-between">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <MapPin className="text-blue-600" />
                  {editingZone ? 'Edit Service Zone on Map' : 'Mark New Service Zone on Map'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click on the map or use the drawing tools to mark the operational boundary for drivers.
                </p>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            {/* Split Layout: Form on Left, Interactive Map on Right */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 overflow-y-auto pr-1">
              {/* Left Column: Form Details (4 Cols) */}
              <div className="lg:col-span-4 space-y-3.5 flex flex-col justify-between">
                <div className="space-y-3.5">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Zone Name</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Central City Hub"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {cities.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">City</label>
                      <select
                        value={form.city_id}
                        onChange={(e) => setForm({ ...form, city_id: e.target.value })}
                        className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
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
                  <div className="bg-slate-50 dark:bg-slate-800/60 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                    <span className="font-bold text-slate-800 dark:text-slate-200 uppercase text-[10px] tracking-wider">
                      Geofence Parameters
                    </span>

                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Shape Type:</span>
                      <span className="font-semibold text-slate-900 dark:text-white capitalize flex items-center gap-1">
                        {shapeMode === 'circle' && <Circle size={12} className="text-blue-500" />}
                        {shapeMode === 'square' && <Square size={12} className="text-emerald-500" />}
                        {shapeMode === 'polygon' && <Hexagon size={12} className="text-purple-500" />}
                        {shapeMode}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Center Lat / Lng:</span>
                      <span className="font-mono font-medium text-slate-900 dark:text-white">
                        {Number(form.center_lat).toFixed(4)}, {Number(form.center_lng).toFixed(4)}
                      </span>
                    </div>

                    <div className="flex justify-between text-slate-600 dark:text-slate-400">
                      <span>Effective Radius:</span>
                      <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">
                        {form.radius_km} km
                      </span>
                    </div>

                    {form.polygon_geojson && (
                      <div className="pt-1 border-t border-slate-200 dark:border-slate-700">
                        <span className="text-[10px] text-slate-400 block mb-0.5">Polygon Boundary GeoJSON:</span>
                        <div className="font-mono text-[10px] text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900 p-1.5 rounded-lg max-h-16 overflow-y-auto">
                          {form.polygon_geojson}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
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

import { useState, useEffect } from 'react'
import { MapPin, Plus, Edit2, Trash2, CheckCircle2, XCircle, Search, Layers } from 'lucide-react'
import api from '../services/api'

export default function ServiceZones() {
  const [zones, setZones] = useState([])
  const [cities, setCities] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editingZone, setEditingZone] = useState(null)

  const [form, setForm] = useState({
    name: '',
    city_id: '',
    center_lat: '',
    center_lng: '',
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
    setForm({
      name: z.name,
      city_id: z.city_id || '',
      center_lat: String(z.center_lat),
      center_lng: String(z.center_lng),
      radius_km: String(z.radius_km),
      polygon_geojson: z.polygon_geojson || '',
      status: z.status,
    })
    setModalOpen(true)
  }

  async function handleSave(e) {
    e.preventDefault()
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <MapPin className="text-blue-600 dark:text-blue-400" />
            Service Zones & Geofences
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Define operating geofence zones, center coordinates, and radii for Monthly Dedicated Drivers.
          </p>
        </div>

        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition"
        >
          <Plus size={18} />
          Create Service Zone
        </button>
      </div>

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

      {loading ? (
        <div className="flex justify-center p-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-500">
          <Layers size={40} className="mx-auto text-slate-400 mb-3" />
          <h3 className="font-semibold text-slate-700 dark:text-slate-300">No Service Zones Found</h3>
          <p className="text-sm mt-1">Create your first geofenced service zone to assign monthly drivers.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((z) => (
            <div
              key={z.id}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">{z.name}</h3>
                    <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-0.5">
                      Radius: {z.radius_km} km
                    </p>
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

                <div className="mt-4 space-y-1.5 text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl">
                  <div className="flex justify-between">
                    <span className="font-medium">Center Lat / Lng:</span>
                    <span>{Number(z.center_lat).toFixed(4)}, {Number(z.center_lng).toFixed(4)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-medium">Boundary:</span>
                    <span>{z.polygon_geojson ? 'Custom Polygon Geofence' : `Circle (${z.radius_km} km)`}</span>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  onClick={() => openEdit(z)}
                  className="p-2 text-slate-600 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => handleDelete(z.id)}
                  className="p-2 text-slate-600 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-lg w-full p-6 shadow-xl border border-slate-200 dark:border-slate-800">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-4">
              {editingZone ? 'Edit Service Zone' : 'Create New Service Zone'}
            </h2>

            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Zone Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Central City Hub"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Center Latitude</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="25.1800"
                    value={form.center_lat}
                    onChange={(e) => setForm({ ...form, center_lat: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Center Longitude</label>
                  <input
                    type="number"
                    step="any"
                    required
                    placeholder="75.8300"
                    value={form.center_lng}
                    onChange={(e) => setForm({ ...form, center_lng: e.target.value })}
                    className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">Radius (Kilometers)</label>
                <input
                  type="number"
                  step="0.1"
                  required
                  placeholder="5.0"
                  value={form.radius_km}
                  onChange={(e) => setForm({ ...form, radius_km: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Optional Polygon GeoJSON Coordinates (Array of [lat, lng])
                </label>
                <textarea
                  rows={3}
                  placeholder='[[25.18, 75.83], [25.19, 75.84], [25.17, 75.85]]'
                  value={form.polygon_geojson}
                  onChange={(e) => setForm({ ...form, polygon_geojson: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2.5 text-xs font-mono text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 shadow-sm transition"
                >
                  Save Zone
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

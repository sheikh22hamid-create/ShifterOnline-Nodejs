import { useEffect, useRef, useState, useCallback } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Circle, Square, Hexagon, Search, Navigation, Undo, Trash2, MapPin } from 'lucide-react'

// Custom Center Icon
const centerIcon = L.divIcon({
  className: '',
  html: `<div style="
    background: #2563eb;
    color: #fff;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 10px rgba(0,0,0,0.35);
    border: 2.5px solid #ffffff;
    cursor: grab;
  ">
    <div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff;"></div>
  </div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
})

// Custom Vertex Icon for Polygons
const vertexIcon = (index) =>
  L.divIcon({
    className: '',
    html: `<div style="
    background: #7c3aed;
    color: #fff;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: bold;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    border: 2px solid #ffffff;
  ">
    ${index + 1}
  </div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  })

export default function ZoneMapDrawer({
  centerLat,
  centerLng,
  radiusKm,
  polygonGeojson,
  shapeMode = 'circle', // 'circle' | 'square' | 'polygon'
  onShapeModeChange,
  onChange,
}) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)

  // Layers
  const centerMarkerRef = useRef(null)
  const shapeLayerRef = useRef(null)
  const vertexMarkersRef = useRef([])

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [squareSizeKm, setSquareSizeKm] = useState(Number(radiusKm) ? Number(radiusKm) * 1.5 : 5.0)

  // Polygon points local state if in polygon mode
  const [polygonPoints, setPolygonPoints] = useState(() => {
    if (polygonGeojson) {
      try {
        const parsed = typeof polygonGeojson === 'string' ? JSON.parse(polygonGeojson) : polygonGeojson
        if (Array.isArray(parsed) && parsed.length >= 3) {
          return parsed.map((pt) => [Number(pt[0]), Number(pt[1])])
        }
      } catch (e) {}
    }
    return []
  })

  const latNum = Number(centerLat) || 25.18
  const lngNum = Number(centerLng) || 75.83
  const radNum = Number(radiusKm) || 5.0

  // 1. Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    const map = L.map(mapContainerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([latNum, lngNum], 12)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })
    resizeObserver.observe(mapContainerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  // 2. Handle Map Click depending on active Shape Mode
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleMapClick = (e) => {
      const { lat, lng } = e.latlng
      const roundedLat = Math.round(lat * 1000000) / 1000000
      const roundedLng = Math.round(lng * 1000000) / 1000000

      if (shapeMode === 'circle') {
        onChange({
          center_lat: roundedLat,
          center_lng: roundedLng,
          radius_km: radNum,
          polygon_geojson: '',
        })
      } else if (shapeMode === 'square') {
        updateSquareGeofence(roundedLat, roundedLng, squareSizeKm)
      } else if (shapeMode === 'polygon') {
        const newPoints = [...polygonPoints, [roundedLat, roundedLng]]
        setPolygonPoints(newPoints)
        updatePolygonGeofence(newPoints)
      }
    }

    map.on('click', handleMapClick)
    return () => {
      map.off('click', handleMapClick)
    }
  }, [shapeMode, radNum, squareSizeKm, polygonPoints, onChange])

  // Helper: Update Square shape
  const updateSquareGeofence = useCallback(
    (cLat, cLng, sizeKm) => {
      const dLat = sizeKm / 2 / 111.32
      const dLng = sizeKm / 2 / (111.32 * Math.cos((cLat * Math.PI) / 180))

      const nw = [Math.round((cLat + dLat) * 1000000) / 1000000, Math.round((cLng - dLng) * 1000000) / 1000000]
      const ne = [Math.round((cLat + dLat) * 1000000) / 1000000, Math.round((cLng + dLng) * 1000000) / 1000000]
      const se = [Math.round((cLat - dLat) * 1000000) / 1000000, Math.round((cLng + dLng) * 1000000) / 1000000]
      const sw = [Math.round((cLat - dLat) * 1000000) / 1000000, Math.round((cLng - dLng) * 1000000) / 1000000]

      const poly = [nw, ne, se, sw, nw]
      const diagRadius = Math.round(Math.sqrt(sizeKm * sizeKm * 2) * 0.5 * 10) / 10

      onChange({
        center_lat: cLat,
        center_lng: cLng,
        radius_km: diagRadius,
        polygon_geojson: JSON.stringify(poly),
      })
    },
    [onChange]
  )

  // Helper: Update Polygon shape
  const updatePolygonGeofence = useCallback(
    (pts) => {
      if (pts.length === 0) return

      let sumLat = 0
      let sumLng = 0
      pts.forEach((p) => {
        sumLat += p[0]
        sumLng += p[1]
      })
      const avgLat = Math.round((sumLat / pts.length) * 1000000) / 1000000
      const avgLng = Math.round((sumLng / pts.length) * 1000000) / 1000000

      // Calculate approximate max radius from centroid
      let maxDist = 0
      pts.forEach((p) => {
        const dLat = (p[0] - avgLat) * 111.32
        const dLng = (p[1] - avgLng) * (111.32 * Math.cos((avgLat * Math.PI) / 180))
        const dist = Math.sqrt(dLat * dLat + dLng * dLng)
        if (dist > maxDist) maxDist = dist
      })

      const closedPoly = pts.length >= 3 ? [...pts, pts[0]] : pts

      onChange({
        center_lat: avgLat,
        center_lng: avgLng,
        radius_km: Math.max(1, Math.round(maxDist * 10) / 10),
        polygon_geojson: JSON.stringify(closedPoly),
      })
    },
    [onChange]
  )

  // 3. Render Center Marker and Overlay Shapes on map
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Clean previous shape layer
    if (shapeLayerRef.current) {
      shapeLayerRef.current.remove()
      shapeLayerRef.current = null
    }
    // Clean vertex markers
    vertexMarkersRef.current.forEach((m) => m.remove())
    vertexMarkersRef.current = []

    // Center marker (for circle and square)
    if (shapeMode !== 'polygon') {
      if (!centerMarkerRef.current) {
        const marker = L.marker([latNum, lngNum], {
          icon: centerIcon,
          draggable: true,
        }).addTo(map)

        marker.on('dragend', () => {
          const pos = marker.getLatLng()
          const cLat = Math.round(pos.lat * 1000000) / 1000000
          const cLng = Math.round(pos.lng * 1000000) / 1000000

          if (shapeMode === 'circle') {
            onChange({
              center_lat: cLat,
              center_lng: cLng,
              radius_km: radNum,
              polygon_geojson: '',
            })
          } else if (shapeMode === 'square') {
            updateSquareGeofence(cLat, cLng, squareSizeKm)
          }
        })
        centerMarkerRef.current = marker
      } else {
        centerMarkerRef.current.setLatLng([latNum, lngNum])
      }
    } else if (centerMarkerRef.current) {
      centerMarkerRef.current.remove()
      centerMarkerRef.current = null
    }

    // Render Overlay based on shapeMode
    if (shapeMode === 'circle') {
      shapeLayerRef.current = L.circle([latNum, lngNum], {
        radius: radNum * 1000,
        color: '#2563eb',
        fillColor: '#3b82f6',
        fillOpacity: 0.22,
        weight: 2.5,
      }).addTo(map)
    } else if (shapeMode === 'square') {
      const dLat = squareSizeKm / 2 / 111.32
      const dLng = squareSizeKm / 2 / (111.32 * Math.cos((latNum * Math.PI) / 180))
      const bounds = [
        [latNum - dLat, lngNum - dLng],
        [latNum + dLat, lngNum + dLng],
      ]

      shapeLayerRef.current = L.rectangle(bounds, {
        color: '#059669',
        fillColor: '#10b981',
        fillOpacity: 0.22,
        weight: 2.5,
      }).addTo(map)
    } else if (shapeMode === 'polygon') {
      if (polygonPoints.length >= 3) {
        shapeLayerRef.current = L.polygon(polygonPoints, {
          color: '#7c3aed',
          fillColor: '#8b5cf6',
          fillOpacity: 0.25,
          weight: 2.5,
        }).addTo(map)
      } else if (polygonPoints.length === 2) {
        shapeLayerRef.current = L.polyline(polygonPoints, {
          color: '#7c3aed',
          weight: 3,
          dashArray: '6, 6',
        }).addTo(map)
      }

      // Draw vertex pins
      polygonPoints.forEach((pt, idx) => {
        const vm = L.marker(pt, {
          icon: vertexIcon(idx),
        }).addTo(map)
        vertexMarkersRef.current.push(vm)
      })
    }
  }, [latNum, lngNum, radNum, shapeMode, squareSizeKm, polygonPoints, updateSquareGeofence, onChange])

  // Search Address / City
  async function handleSearch(e) {
    e?.preventDefault()
    if (!searchQuery.trim() || !mapRef.current) return

    setSearching(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1`
      )
      const data = await res.json()
      if (data && data.length > 0) {
        const hit = data[0]
        const lat = parseFloat(hit.lat)
        const lng = parseFloat(hit.lon)
        mapRef.current.flyTo([lat, lng], 13, { duration: 1.2 })

        if (shapeMode === 'circle') {
          onChange({
            center_lat: lat,
            center_lng: lng,
            radius_km: radNum,
            polygon_geojson: '',
          })
        } else if (shapeMode === 'square') {
          updateSquareGeofence(lat, lng, squareSizeKm)
        }
      } else {
        alert('Location not found. Please try a different query.')
      }
    } catch (err) {
      console.error('Search error:', err)
    } finally {
      setSearching(false)
    }
  }

  // Polygon Clear & Undo
  function handleUndoPolygonPoint() {
    if (polygonPoints.length === 0) return
    const updated = polygonPoints.slice(0, -1)
    setPolygonPoints(updated)
    updatePolygonGeofence(updated)
  }

  function handleClearPolygon() {
    setPolygonPoints([])
    onChange({
      center_lat: latNum,
      center_lng: lngNum,
      radius_km: 5.0,
      polygon_geojson: '',
    })
  }

  return (
    <div className="flex flex-col h-full space-y-3">
      {/* SHAPE SELECTOR & TOOLS BAR */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-100 dark:bg-slate-800/80 p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs">
        {/* Shape Mode Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              onShapeModeChange('circle')
              onChange({
                center_lat: latNum,
                center_lng: lngNum,
                radius_km: radNum,
                polygon_geojson: '',
              })
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
              shapeMode === 'circle'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            <Circle size={14} />
            Circle Geofence
          </button>

          <button
            type="button"
            onClick={() => {
              onShapeModeChange('square')
              updateSquareGeofence(latNum, lngNum, squareSizeKm)
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
              shapeMode === 'square'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            <Square size={14} />
            Square / Box
          </button>

          <button
            type="button"
            onClick={() => {
              onShapeModeChange('polygon')
              if (polygonPoints.length === 0) {
                setPolygonPoints([
                  [latNum + 0.02, lngNum - 0.02],
                  [latNum + 0.02, lngNum + 0.02],
                  [latNum - 0.02, lngNum + 0.02],
                  [latNum - 0.02, lngNum - 0.02],
                ])
                updatePolygonGeofence([
                  [latNum + 0.02, lngNum - 0.02],
                  [latNum + 0.02, lngNum + 0.02],
                  [latNum - 0.02, lngNum + 0.02],
                  [latNum - 0.02, lngNum - 0.02],
                ])
              }
            }}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
              shapeMode === 'polygon'
                ? 'bg-purple-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600'
            }`}
          >
            <Hexagon size={14} />
            Custom Polygon
          </button>
        </div>

        {/* Location Search Bar */}
        <form onSubmit={handleSearch} className="flex items-center gap-1.5 flex-1 max-w-xs">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search area (e.g. Kota, Jaipur)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            type="submit"
            disabled={searching}
            className="px-2.5 py-1 bg-slate-800 dark:bg-slate-700 text-white rounded-lg text-xs font-semibold hover:bg-slate-900 transition disabled:opacity-50"
          >
            {searching ? '...' : 'Go'}
          </button>
        </form>
      </div>

      {/* SHAPE CONTROLS & HINT BANNER */}
      {shapeMode === 'circle' && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-blue-50/70 dark:bg-blue-950/30 p-2.5 rounded-xl border border-blue-100 dark:border-blue-900/50 text-xs text-blue-900 dark:text-blue-200">
          <div className="flex items-center gap-2">
            <MapPin size={15} className="text-blue-600" />
            <span>
              Click map or drag the blue marker to set center. <b>Radius: {radNum} km</b>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-[11px]">Radius:</span>
            <input
              type="range"
              min="0.5"
              max="25"
              step="0.5"
              value={radNum}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                onChange({
                  center_lat: latNum,
                  center_lng: lngNum,
                  radius_km: val,
                  polygon_geojson: '',
                })
              }}
              className="w-28 accent-blue-600 cursor-pointer"
            />
            <span className="font-mono font-bold w-12 text-right">{radNum} km</span>
          </div>
        </div>
      )}

      {shapeMode === 'square' && (
        <div className="flex flex-wrap items-center justify-between gap-3 bg-emerald-50/70 dark:bg-emerald-950/30 p-2.5 rounded-xl border border-emerald-100 dark:border-emerald-900/50 text-xs text-emerald-900 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <Square size={15} className="text-emerald-600" />
            <span>
              Click map or drag marker to center the square box. <b>Box Side: {squareSizeKm} km</b>
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="font-semibold text-[11px]">Box Side:</span>
            <input
              type="range"
              min="1"
              max="30"
              step="1"
              value={squareSizeKm}
              onChange={(e) => {
                const val = parseFloat(e.target.value)
                setSquareSizeKm(val)
                updateSquareGeofence(latNum, lngNum, val)
              }}
              className="w-28 accent-emerald-600 cursor-pointer"
            />
            <span className="font-mono font-bold w-12 text-right">{squareSizeKm} km</span>
          </div>
        </div>
      )}

      {shapeMode === 'polygon' && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-purple-50/70 dark:bg-purple-950/30 p-2.5 rounded-xl border border-purple-100 dark:border-purple-900/50 text-xs text-purple-900 dark:text-purple-200">
          <div className="flex items-center gap-2">
            <Hexagon size={15} className="text-purple-600" />
            <span>
              Click on the map to add boundary points (<b>{polygonPoints.length} points</b> placed)
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleUndoPolygonPoint}
              disabled={polygonPoints.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 rounded-lg border border-purple-200 dark:border-purple-800 hover:bg-purple-100 transition disabled:opacity-40"
            >
              <Undo size={12} />
              Undo
            </button>
            <button
              type="button"
              onClick={handleClearPolygon}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-rose-50 text-rose-600 rounded-lg border border-rose-200 hover:bg-rose-100 transition"
            >
              <Trash2 size={12} />
              Clear
            </button>
          </div>
        </div>
      )}

      {/* LEAFLET MAP CONTAINER */}
      <div className="relative flex-1 min-h-[360px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-inner">
        <div ref={mapContainerRef} className="w-full h-full min-h-[360px]" />

        {/* Floating Controls */}
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1.5">
          <button
            type="button"
            title="Recenter Map"
            onClick={() => {
              if (mapRef.current) {
                mapRef.current.setView([latNum, lngNum], 13)
              }
            }}
            className="p-2 bg-white dark:bg-slate-800 rounded-lg shadow-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition"
          >
            <Navigation size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}

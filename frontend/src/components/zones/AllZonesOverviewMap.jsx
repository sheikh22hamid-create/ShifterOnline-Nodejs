import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const ZONE_COLORS = [
  '#2563eb', // Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#7c3aed', // Purple
  '#dc2626', // Red
  '#0891b2', // Cyan
  '#e11d48', // Rose
]

export default function AllZonesOverviewMap({ zones = [], onEditZone }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerGroupRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: false,
    }).setView([25.18, 75.83], 11)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map)

    layerGroupRef.current = L.layerGroup().addTo(map)
    mapRef.current = map

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize()
    })
    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layerGroup = layerGroupRef.current
    if (!map || !layerGroup) return

    layerGroup.clearLayers()
    const bounds = []

    zones.forEach((z, idx) => {
      const color = ZONE_COLORS[idx % ZONE_COLORS.length]
      const lat = Number(z.center_lat)
      const lng = Number(z.center_lng)
      if (!lat || !lng) return

      bounds.push([lat, lng])

      // Check if custom polygon
      let hasPolygon = false
      if (z.polygon_geojson) {
        try {
          const parsed = typeof z.polygon_geojson === 'string' ? JSON.parse(z.polygon_geojson) : z.polygon_geojson
          if (Array.isArray(parsed) && parsed.length >= 3) {
            hasPolygon = true
            const poly = L.polygon(parsed, {
              color,
              fillColor: color,
              fillOpacity: 0.22,
              weight: 2,
            }).addTo(layerGroup)

            poly.bindTooltip(`<b>${z.name}</b><br/>Custom Boundary`, { sticky: true })
            poly.bindPopup(`
              <div style="font-family: sans-serif; font-size: 12px; padding: 4px;">
                <h4 style="margin: 0 0 4px 0; font-weight: bold; color: #0f172a;">${z.name}</h4>
                <p style="margin: 0 0 8px 0; color: #64748b;">Type: Polygon Geofence</p>
                <button id="edit-zone-btn-${z.id}" style="background: #2563eb; color: #fff; border: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; cursor: pointer;">
                  Edit Zone
                </button>
              </div>
            `)

            poly.on('popupopen', () => {
              const btn = document.getElementById(`edit-zone-btn-${z.id}`)
              if (btn) btn.onclick = () => onEditZone && onEditZone(z)
            })
          }
        } catch (e) {}
      }

      if (!hasPolygon) {
        // Circle Geofence
        const radiusMeters = (Number(z.radius_km) || 5.0) * 1000
        const circle = L.circle([lat, lng], {
          radius: radiusMeters,
          color,
          fillColor: color,
          fillOpacity: 0.2,
          weight: 2,
        }).addTo(layerGroup)

        circle.bindTooltip(`<b>${z.name}</b><br/>Radius: ${z.radius_km} km`, { sticky: true })
        circle.bindPopup(`
          <div style="font-family: sans-serif; font-size: 12px; padding: 4px;">
            <h4 style="margin: 0 0 4px 0; font-weight: bold; color: #0f172a;">${z.name}</h4>
            <p style="margin: 0 0 8px 0; color: #64748b;">Radius: ${z.radius_km} km</p>
            <button id="edit-zone-btn-${z.id}" style="background: #2563eb; color: #fff; border: none; padding: 4px 10px; border-radius: 6px; font-weight: 600; cursor: pointer;">
              Edit Zone
            </button>
          </div>
        `)

        circle.on('popupopen', () => {
          const btn = document.getElementById(`edit-zone-btn-${z.id}`)
          if (btn) btn.onclick = () => onEditZone && onEditZone(z)
        })
      }

      // Add Center Pin
      const pinIcon = L.divIcon({
        className: '',
        html: `<div style="
          background: ${color};
          color: #fff;
          width: 22px;
          height: 22px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: bold;
          box-shadow: 0 2px 6px rgba(0,0,0,0.35);
          border: 2px solid #ffffff;
        ">
          ${idx + 1}
        </div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      })

      L.marker([lat, lng], { icon: pinIcon }).addTo(layerGroup)
    })

    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 })
    }
  }, [zones, onEditZone])

  return (
    <div
      className="relative w-full h-[550px] rounded-2xl overflow-hidden border shadow-sm"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  )
}

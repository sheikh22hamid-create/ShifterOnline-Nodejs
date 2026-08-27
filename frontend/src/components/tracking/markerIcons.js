import L from 'leaflet'

const BIKE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="M5 17 9 10h4l3 4h4"/><path d="M9 10 8 6H5"/></svg>'

const AUTO_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/><path d="M4 18h1M4 10h12l3 4v4h-2M6 10V6h6l3 4"/></svg>'

const TRUCK_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="9" width="13" height="7"/><path d="M14 12h4l3 3v1h-2"/><circle cx="6" cy="17" r="1.6"/><circle cx="16" cy="17" r="1.6"/></svg>'

const PACKAGE_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>'

const FLAG_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3v18"/><path d="M5 4h6l1 2h6l-2 4h-6l-1-2H5z"/></svg>'

// The rider's `vehicle` field is free text entered at KYC time, not an
// enum — this is a best-effort keyword match, not an exact classification.
export function vehicleCategoryFromText(text = '') {
  const t = text.toLowerCase()
  if (/bike|scooter|moped|motor ?cycle/.test(t)) return 'bike'
  if (/auto|rickshaw|3[\s-]?wheel|three[\s-]?wheel|tuk/.test(t)) return 'auto'
  return 'truck'
}

const VEHICLE_SVG = { bike: BIKE_SVG, auto: AUTO_SVG, truck: TRUCK_SVG }

// The glyph is wrapped in its own `.driver-heading` span so callers can
// rotate just the vehicle silhouette in place (via direct style mutation on
// the live marker element) without tearing down and rebuilding the divIcon
// on every GPS ping.
export function createDriverIcon({ category = 'truck', color = '#f59e0b' } = {}) {
  return L.divIcon({
    className: '',
    html: `
      <div class="driver-marker">
        <span class="driver-beacon" style="--beacon-color:${color}"></span>
        <span class="driver-glyph" style="background:${color}">
          <span class="driver-heading">${VEHICLE_SVG[category] ?? TRUCK_SVG}</span>
        </span>
      </div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  })
}

function stopBadgeIcon({ color, glyph, label }) {
  return L.divIcon({
    className: '',
    html: `
      <div class="stop-badge">
        <span class="stop-badge-icon" style="--badge-color:${color}">${glyph}</span>
        <span class="stop-badge-label" style="--badge-color:${color}">${label}</span>
      </div>`,
    iconSize: [64, 44],
    iconAnchor: [32, 13],
  })
}

export function createPickupIcon() {
  return stopBadgeIcon({ color: '#f59e0b', glyph: PACKAGE_SVG, label: 'PICKUP' })
}

export function createDropoffIcon() {
  return stopBadgeIcon({ color: '#10b981', glyph: FLAG_SVG, label: 'DROP' })
}

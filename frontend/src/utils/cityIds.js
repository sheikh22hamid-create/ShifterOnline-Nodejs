// Rate cards keep cities in a legacy comma-separated column (tbl_package.city_id).
// Empty or "0" means every city, the same rule the booking API uses (packageMatchesCity).

export function parseCityIds(value) {
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export function isAllCities(value) {
  const ids = parseCityIds(value)
  return ids.length === 0 || (ids.length === 1 && ids[0] === '0')
}

/** Add or remove one city. Removing the last one goes back to "0" (all cities), never to an empty value. */
export function toggleCityId(value, id) {
  const key = String(id)
  const current = isAllCities(value) ? [] : parseCityIds(value).filter((x) => x !== '0')
  const next = current.includes(key) ? current.filter((x) => x !== key) : [...current, key]
  if (next.length === 0) return '0'
  return [...new Set(next)].sort((a, b) => Number(a) - Number(b)).join(',')
}

export function cityIdsLabel(value, cities = []) {
  if (isAllCities(value)) return 'All cities'
  const byId = new Map(cities.map((c) => [String(c.id), c.title]))
  return parseCityIds(value)
    .map((id) => byId.get(id) || `City #${id}`)
    .join(', ')
}

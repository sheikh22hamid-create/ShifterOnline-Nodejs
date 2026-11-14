// Utility functions for Main Area / Locality extraction and distance formatting

const INDIAN_STATES = new Set([
  'andhra pradesh', 'ap',
  'arunachal pradesh',
  'assam',
  'bihar', 'br',
  'chhattisgarh', 'cg',
  'goa',
  'gujarat', 'gj',
  'haryana', 'hr',
  'himachal pradesh', 'hp',
  'jharkhand', 'jh',
  'karnataka', 'ka',
  'kerala', 'kl',
  'madhya pradesh', 'mp',
  'maharashtra', 'mh',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'odisha', 'or',
  'punjab', 'pb',
  'rajasthan', 'rj',
  'sikkim',
  'tamil nadu', 'tn',
  'telangana', 'ts',
  'tripura',
  'uttar pradesh', 'up',
  'uttarakhand', 'uk',
  'west bengal', 'wb',
  'delhi', 'nct of delhi',
  'chandigarh',
  'jammu and kashmir', 'jk',
  'ladakh',
  'puducherry',
  'india', 'bharat',
])

const PLUS_CODE_TOKEN = /^[A-Za-z0-9]{2,8}\+[A-Za-z0-9]{0,4}$/
const UNIT_NUMBER_REGEX = /^(?:(?:plot|h\.?no\.?|flat|room|block|sector|shop|house|building)\s*#?\s*[a-z0-9\/-]+|#?[a-z0-9\/-]*\d[a-z0-9\/-]*)$/i
const LANDMARK_PREFIX_REGEX = /^(?:near|opp|opposite|behind|beside|in front of)\b|\b(?:point|store|shop|hospital|hotel|restaurant|mall|plaza|complex)\b/i
const ROAD_REGEX = /\b(?:road|rd|marg|street|lane|gali|highway|bypass)\b/i

export function isPlusCode(text) {
  if (typeof text !== 'string') return false
  const first = text.trim().split(/[\s,]+/)[0]
  return Boolean(first && PLUS_CODE_TOKEN.test(first))
}

/**
 * Extracts a recognizable Main Area / Locality name from a raw address string.
 * Used as a fallback when `pickup_title` or `drop_title` is not stored in DB.
 */
export function extractAreaFromAddress(rawAddress) {
  if (typeof rawAddress !== 'string') return null
  const cleaned = rawAddress.trim()
  if (!cleaned) return null

  const parts = cleaned.split(',').map((p) => p.trim()).filter(Boolean)
  if (!parts.length) return null

  const candidates = []
  for (const part of parts) {
    if (isPlusCode(part)) continue
    const lower = part.toLowerCase().replace(/[\d\s]+$/g, '').trim()
    if (INDIAN_STATES.has(lower) || /^\d{5,6}$/.test(part) || /^(india|bharat)$/i.test(part)) continue
    candidates.push(part)
  }
  if (!candidates.length) return null

  let idx = 0
  if (candidates.length > 1 && UNIT_NUMBER_REGEX.test(candidates[idx])) {
    idx++
  }
  if (candidates.length > idx + 1 && (ROAD_REGEX.test(candidates[idx]) || LANDMARK_PREFIX_REGEX.test(candidates[idx]))) {
    idx++
  }
  return candidates[idx] || candidates[0]
}

/**
 * Format total trip distance in KM with exact distinction between
 * road route distance vs. straight-line distance.
 */
export function formatTripDistance(order) {
  if (!order) return null
  if (order.trip_distance_text) {
    return {
      text: order.trip_distance_text,
      kind: order.trip_distance_kind || 'road',
    }
  }
  const dist = Number(order.distance)
  if (Number.isFinite(dist) && dist >= 0) {
    const formatted = dist % 1 === 0 ? dist.toFixed(1) : dist.toFixed(2)
    return {
      text: `${formatted} KM`,
      kind: 'road',
    }
  }
  return null
}

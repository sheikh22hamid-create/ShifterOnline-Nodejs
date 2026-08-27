// Legacy DB rows store image paths like "images/vehicle/x.jpg" or
// "images/category/x.png" — already relative to the legacy PHP site's
// public_html/admin root, not this app's origin. VITE_IMAGE_BASE_URL points
// at wherever that root is served from (see backend/src/app.js's
// LEGACY_IMAGES_DIR static mount, or a real CDN/domain if one exists).
const DEFAULT_BASE_URL = 'http://localhost:5000'

export function resolveImageUrl(path) {
  if (!path) return null
  if (/^https?:\/\//.test(path)) return path
  const base = import.meta.env.VITE_IMAGE_BASE_URL || DEFAULT_BASE_URL
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

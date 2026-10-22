import { NAV_GROUPS } from '../config/navigation'

// Executive sidebar access. `user.sidebar_modules` is an array of nav paths when an admin restricted this
// executive, or null/undefined when unrestricted (every other role, and executives created before the feature).
// The API enforces the same list (backend/src/config/executiveModules.js); this only keeps the UI honest.

export const EXECUTIVE_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items.filter((i) => i.roles.includes('executive')).map((i) => ({ ...i, group: g.group })))

export function isRestrictedExecutive(user) {
  return user?.role === 'executive' && Array.isArray(user.sidebar_modules)
}

export function canSeeNavItem(user, item) {
  if (!user || !item.roles.includes(user.role)) return false
  return !isRestrictedExecutive(user) || user.sidebar_modules.includes(item.to)
}

/** The sidebar module a URL belongs to (longest matching nav path), or null for pages outside the sidebar. */
export function moduleForPath(pathname) {
  let best = null
  for (const { to } of EXECUTIVE_NAV_ITEMS) {
    if ((pathname === to || pathname.startsWith(`${to}/`)) && (!best || to.length > best.length)) best = to
  }
  return best
}

export function canOpenPath(user, pathname) {
  if (!isRestrictedExecutive(user)) return true
  const module = moduleForPath(pathname)
  return module === null || user.sidebar_modules.includes(module)
}

/** Where a restricted executive should land: the first enabled tab in sidebar order, or null if none. */
export function firstAllowedPath(user) {
  if (!isRestrictedExecutive(user)) return '/dashboard'
  const first = EXECUTIVE_NAV_ITEMS.find((i) => user.sidebar_modules.includes(i.to))
  return first ? first.to : null
}

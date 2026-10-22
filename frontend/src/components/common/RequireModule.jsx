import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { canOpenPath, firstAllowedPath, isRestrictedExecutive } from '../../utils/access'

/** Keeps a restricted executive on the tabs an admin enabled for them (typed URLs, bookmarks, the post-login
 * redirect). The API enforces the same list; this just avoids landing them on pages that would only 403. */
export default function RequireModule() {
  const { user } = useAuth()
  const { pathname } = useLocation()

  if (canOpenPath(user, pathname)) return <Outlet />

  const fallback = firstAllowedPath(user)
  if (fallback && fallback !== pathname) return <Navigate to={fallback} replace />

  return (
    <div className="flex h-64 flex-col items-center justify-center gap-2 text-center" style={{ color: 'var(--ink-muted)' }}>
      <Lock size={22} />
      <p className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
        {isRestrictedExecutive(user) ? 'No modules enabled for your account' : 'Access restricted'}
      </p>
      <p className="max-w-sm text-[12.5px]">Ask your admin to enable the tabs you need.</p>
    </div>
  )
}

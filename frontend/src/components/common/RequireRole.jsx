import { Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'

/** Frontend-side gate matching the backend's authorize() checks — the API
 * enforces this for real, this just avoids sending a role to a page that
 * would only ever 403 for them. */
export default function RequireRole({ roles, children }) {
  const { hasRole } = useAuth()
  if (!hasRole(...roles)) return <Navigate to="/dashboard" replace />
  return children
}

export const QUEUE_ALERT_KINDS = ['guarantee_assigned', 'guarantee_reminder', 'guarantee_escalated', 'guarantee_unassigned']

/**
 * The admin socket broadcasts every dispatch alert to every connected admin, so each client decides locally whether
 * an executive-queue alert is for them: an executive only for cases they own; a city admin for their city; a
 * superadmin for every city. Unassigned alerts go to supervisors only.
 */
export function queueAlertVisibleTo(data, user) {
  if (!data || !user || !QUEUE_ALERT_KINDS.includes(data.kind)) return false
  if (user.role === 'superadmin') return true
  if (user.role === 'admin') return Number(data.city_id) === Number(user.city_id)
  if (user.role === 'executive') {
    if (data.kind === 'guarantee_unassigned') return false
    return data.owner_admin_id != null && Number(data.owner_admin_id) === Number(user.id)
  }
  return false
}

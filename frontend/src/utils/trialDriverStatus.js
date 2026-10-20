// Derived status of a guarantee case in the automated trial-driver flow (spec 2026-10-20). Nothing is stored:
// it is read off the case row (owner, status, search_state) and its latest offered driver.
export function trialStatusLabel(c) {
  if (!c) return null
  if (c.status === 'resolved_assigned') return { label: 'Order Assigned', tone: 'success' }
  if (c.status && c.status !== 'open') return null
  const cand = c.candidate_status ?? c.candidate?.status ?? null
  if (c.owner_admin_id) return cand ? { label: 'Engaged', tone: 'info' } : null
  if (cand === 'ready') return { label: 'Pending in Queue', tone: 'warning' }
  if (cand === 'rejected') return { label: 'Driver Rejected · searching next', tone: 'danger' }
  if (c.search_state === 'exhausted') return { label: 'Search limit reached', tone: 'danger' }
  if (c.search_state === 'searching') return { label: 'Searching for driver', tone: 'neutral' }
  return null
}

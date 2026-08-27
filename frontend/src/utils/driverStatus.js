export function approvalTone(status) {
  return status === 1 ? 'success' : 'danger'
}
export function approvalLabel(status) {
  return status === 1 ? 'Approved' : 'Blocked'
}
export function onlineTone(aStatus) {
  return aStatus === 1 ? 'success' : 'neutral'
}
export function onlineLabel(aStatus) {
  return aStatus === 1 ? 'Online' : 'Offline'
}
export function verificationTone(status) {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

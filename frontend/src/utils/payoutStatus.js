export const PAYOUT_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
]

export function payoutStatusTone(status) {
  if (status === 'approved' || status === 'paid') return 'success'
  if (status === 'rejected' || status === 'failed') return 'danger'
  return 'warning'
}

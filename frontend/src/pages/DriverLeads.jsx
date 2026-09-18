import { useCallback, useState, useMemo } from 'react'
import {
  PhoneCall,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Users,
  Search,
  RefreshCw,
  Phone,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'
import KpiCard from '../components/common/KpiCard'
import Modal from '../components/common/Modal'
import { formatDateTime } from '../utils/format'

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending Verification' },
  { value: 'verified', label: 'Verified' },
  { value: 'converted', label: 'Converted (Rewarded)' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'all', label: 'All Leads' },
]

export default function DriverLeads() {
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [verifyTarget, setVerifyTarget] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)

  const fetcher = useCallback(
    () =>
      api
        .get('/driver-leads', { params: { status: statusFilter } })
        .then((res) => res.data),
    [statusFilter]
  )

  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const leads = data?.data ?? []
  const counts = data?.counts ?? {
    pending: 0,
    verified: 0,
    converted: 0,
    rejected: 0,
    expired: 0,
    total: 0,
  }

  // Filter in memory by search query (name, phone, driver name, driver phone)
  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads
    const q = searchQuery.toLowerCase().trim()
    return leads.filter((item) => {
      const name = (item.name || '').toLowerCase()
      const phone = (item.phone || '').toLowerCase()
      const driverName = (item.driver?.name || '').toLowerCase()
      const driverMobile = (item.driver?.mobile || '').toLowerCase()
      const driverId = String(item.driver_id || '')
      return (
        name.includes(q) ||
        phone.includes(q) ||
        driverName.includes(q) ||
        driverMobile.includes(q) ||
        driverId.includes(q)
      )
    })
  }, [leads, searchQuery])

  // Verify lead after phone call
  async function handleVerify(lead) {
    setActionBusy(true)
    try {
      await api.post(`/driver-leads/${lead.id}/verify`)
      toast.success(`Lead for ${lead.name || lead.phone} verified successfully!`)
      setVerifyTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to verify lead.')
    } finally {
      setActionBusy(false)
    }
  }

  // Reject lead
  async function handleReject(lead) {
    setActionBusy(true)
    try {
      await api.post(`/driver-leads/${lead.id}/reject`)
      toast.success(`Lead for ${lead.name || lead.phone} marked as rejected.`)
      setRejectTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject lead.')
    } finally {
      setActionBusy(false)
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'verified':
        return <Badge tone="info">✓ Verified</Badge>
      case 'converted':
        return <Badge tone="success">🎉 Rewarded (1st Ride)</Badge>
      case 'rejected':
        return <Badge tone="danger">✕ Rejected</Badge>
      case 'expired':
        return <Badge tone="neutral">⌛ Expired</Badge>
      case 'pending':
      default:
        return <Badge tone="warning">⏳ Pending Call</Badge>
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1
            className="text-[19px] font-semibold tracking-tight"
            style={{ color: 'var(--ink)' }}
          >
            Driver Contact Leads
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Customer numbers referred by driver partners. Call to verify and
            award reward points on their first ride.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={loading}
          className="flex items-center gap-1.5 self-start rounded-lg border px-3 py-1.5 text-[12.5px] font-medium transition-colors hover:bg-[var(--bg-hover)] sm:self-auto"
          style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* KPI Cards */}
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Pending Verification"
          value={counts.pending}
          loading={loading}
          icon={Clock}
          iconColor="var(--warning)"
          iconBg="var(--warning-soft)"
          trendLabel={counts.pending > 0 ? `${counts.pending} to call` : 'All clear'}
          trendTone={counts.pending > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Verified (Awaiting Ride)"
          value={counts.verified}
          loading={loading}
          icon={ShieldCheck}
          iconColor="var(--info)"
          iconBg="var(--info-soft)"
          trendLabel="Valid for 45 days"
          trendTone="neutral"
        />
        <KpiCard
          label="Converted (Rewarded)"
          value={counts.converted}
          loading={loading}
          icon={Sparkles}
          iconColor="var(--success)"
          iconBg="var(--success-soft)"
          trendLabel="1st ride completed"
          trendTone="success"
        />
        <KpiCard
          label="Total Leads"
          value={counts.total}
          loading={loading}
          icon={Users}
          iconColor="var(--brand)"
          iconBg="var(--brand-soft)"
          trendLabel="Submitted by drivers"
          trendTone="neutral"
        />
      </div>

      {/* Filters & Search Bar */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const countVal = counts[f.value]
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                style={{
                  borderColor:
                    statusFilter === f.value ? 'var(--brand)' : 'var(--border)',
                  background:
                    statusFilter === f.value
                      ? 'var(--brand-soft)'
                      : 'transparent',
                  color:
                    statusFilter === f.value
                      ? 'var(--brand)'
                      : 'var(--ink-muted)',
                }}
              >
                <span>{f.label}</span>
                {countVal !== undefined && (
                  <span
                    className="rounded-full px-1.5 py-0.2 text-[10px] font-semibold"
                    style={{
                      background:
                        statusFilter === f.value
                          ? 'var(--brand)'
                          : 'var(--border)',
                      color:
                        statusFilter === f.value
                          ? '#ffffff'
                          : 'var(--ink-muted)',
                    }}
                  >
                    {countVal}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--ink-faint)' }}
          />
          <input
            type="text"
            placeholder="Search contact or driver..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border py-1.5 pl-8 pr-3 text-[12.5px] outline-none transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg)',
              color: 'var(--ink)',
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {[
                  'Contact Lead',
                  'Referred By Driver',
                  'Status',
                  'Submitted At',
                  'Expires At',
                  'Action',
                ].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={6} className="px-4 py-3">
                      <div
                        className="h-4 animate-pulse rounded"
                        style={{ background: 'var(--border)' }}
                      />
                    </td>
                  </tr>
                ))}

              {!loading && error && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-[13px]"
                    style={{ color: 'var(--danger)' }}
                  >
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && filteredLeads.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-12 text-center text-[13px]"
                    style={{ color: 'var(--ink-faint)' }}
                  >
                    <PhoneCall
                      size={28}
                      className="mx-auto mb-2 opacity-40"
                      style={{ color: 'var(--ink-muted)' }}
                    />
                    No leads found for current filter.
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                filteredLeads.map((item) => (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-[var(--bg-hover)]"
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    {/* Contact details */}
                    <td className="px-4 py-3">
                      <div
                        className="font-medium"
                        style={{ color: 'var(--ink)' }}
                      >
                        {item.name || 'Unnamed Contact'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[12px]">
                        <a
                          href={`tel:${item.phone}`}
                          className="flex items-center gap-1 font-mono hover:underline"
                          style={{ color: 'var(--brand)' }}
                          title="Click to call"
                        >
                          <Phone size={11} />
                          {item.phone}
                        </a>
                      </div>
                    </td>

                    {/* Submitting Driver */}
                    <td className="px-4 py-3">
                      <div
                        className="font-medium"
                        style={{ color: 'var(--ink)' }}
                      >
                        {item.driver?.name || `Driver #${item.driver_id}`}
                      </div>
                      <div
                        className="mt-0.5 flex items-center gap-1.5 text-[11.5px]"
                        style={{ color: 'var(--ink-muted)' }}
                      >
                        <span>ID: #{item.driver_id}</span>
                        {item.driver?.mobile && (
                          <>
                            <span>•</span>
                            <span className="font-mono">{item.driver.mobile}</span>
                          </>
                        )}
                      </div>
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3">{getStatusBadge(item.status)}</td>

                    {/* Submitted At */}
                    <td
                      className="whitespace-nowrap px-4 py-3 text-[12px]"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {item.submitted_at
                        ? formatDateTime(item.submitted_at)
                        : '—'}
                    </td>

                    {/* Expires At */}
                    <td
                      className="whitespace-nowrap px-4 py-3 text-[12px]"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      {item.expires_at
                        ? formatDateTime(item.expires_at)
                        : item.status === 'pending'
                        ? 'Upon verification'
                        : '—'}
                    </td>

                    {/* Actions */}
                    <td className="whitespace-nowrap px-4 py-3">
                      {item.status === 'pending' ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setVerifyTarget(item)}
                            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ background: 'var(--success)' }}
                          >
                            <CheckCircle2 size={13} />
                            Verify
                          </button>
                          <button
                            type="button"
                            onClick={() => setRejectTarget(item)}
                            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--danger-soft)]"
                            style={{
                              borderColor: 'var(--danger-soft-border)',
                              color: 'var(--danger)',
                            }}
                          >
                            <XCircle size={13} />
                            Reject
                          </button>
                        </div>
                      ) : item.status === 'verified' ? (
                        <span
                          className="text-[11.5px]"
                          style={{ color: 'var(--info)' }}
                        >
                          Awaiting 1st Ride
                        </span>
                      ) : item.status === 'converted' ? (
                        <span
                          className="text-[11.5px] font-medium"
                          style={{ color: 'var(--success)' }}
                        >
                          Reward Given
                        </span>
                      ) : (
                        <span
                          className="text-[11.5px]"
                          style={{ color: 'var(--ink-faint)' }}
                        >
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verify Modal */}
      {verifyTarget && (
        <Modal
          title="Verify Contact Lead"
          onClose={() => !actionBusy && setVerifyTarget(null)}
        >
          <div className="space-y-3 text-[13px]">
            <p style={{ color: 'var(--ink)' }}>
              Are you sure you want to verify this lead?
            </p>
            <div
              className="rounded-lg p-3"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <div>
                <strong>Contact:</strong> {verifyTarget.name || 'Unnamed'} (
                <a
                  href={`tel:${verifyTarget.phone}`}
                  style={{ color: 'var(--brand)' }}
                >
                  {verifyTarget.phone}
                </a>
                )
              </div>
              <div className="mt-1">
                <strong>Referred By:</strong>{' '}
                {verifyTarget.driver?.name || `Driver #${verifyTarget.driver_id}`}{' '}
                (ID: #{verifyTarget.driver_id})
              </div>
            </div>
            <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              Once verified, the lead will remain active for 45 days. When this
              person installs the app and completes their first ride, the
              referring driver will receive 100 Reward Points and become their
              Favorite Driver.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setVerifyTarget(null)}
                className="rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => handleVerify(verifyTarget)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--success)' }}
              >
                <CheckCircle2 size={14} />
                {actionBusy ? 'Verifying...' : 'Confirm Verification'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectTarget && (
        <Modal
          title="Reject Contact Lead"
          onClose={() => !actionBusy && setRejectTarget(null)}
        >
          <div className="space-y-3 text-[13px]">
            <p style={{ color: 'var(--ink)' }}>
              Are you sure you want to reject this lead?
            </p>
            <div
              className="rounded-lg p-3"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}
            >
              <div>
                <strong>Contact:</strong> {rejectTarget.name || 'Unnamed'} (
                {rejectTarget.phone})
              </div>
              <div className="mt-1">
                <strong>Referred By:</strong>{' '}
                {rejectTarget.driver?.name || `Driver #${rejectTarget.driver_id}`}
              </div>
            </div>
            <p className="text-[12px]" style={{ color: 'var(--danger)' }}>
              This lead will be marked as rejected and will not qualify for
              referral rewards when they sign up.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => setRejectTarget(null)}
                className="rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => handleReject(rejectTarget)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
                style={{ background: 'var(--danger)' }}
              >
                <XCircle size={14} />
                {actionBusy ? 'Rejecting...' : 'Reject Lead'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

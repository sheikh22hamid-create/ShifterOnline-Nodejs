import { useCallback, useState, useMemo } from 'react'
import {
  UserPlus,
  Clock,
  CheckCircle2,
  XCircle,
  PhoneCall,
  Phone,
  Search,
  RefreshCw,
  Send,
  AlertTriangle,
} from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'
import KpiCard from '../components/common/KpiCard'
import { formatDateTime } from '../utils/format'

const STATUS_FILTERS = [
  { value: 'pending', label: 'Pending Follow-up' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'registered', label: 'Registered' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'all', label: 'All' },
]

const STALE_DAYS_THRESHOLD = 3

function daysSince(dateStr) {
  if (!dateStr) return 0
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (24 * 60 * 60 * 1000))
}

export default function RegistrationLeads() {
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('pending')
  const [searchQuery, setSearchQuery] = useState('')
  const [actionBusy, setActionBusy] = useState(null)

  const fetcher = useCallback(
    () => api.get('/registration-leads', { params: { status: statusFilter } }).then((res) => res.data),
    [statusFilter]
  )

  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const leads = data?.data ?? []
  const counts = data?.counts ?? { pending: 0, contacted: 0, registered: 0, dismissed: 0, total: 0 }

  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads
    const q = searchQuery.toLowerCase().trim()
    return leads.filter((item) => (item.phone || '').toLowerCase().includes(q))
  }, [leads, searchQuery])

  async function handleSendReminder(lead) {
    setActionBusy(lead.id)
    try {
      const res = await api.post(`/registration-leads/${lead.id}/send-reminder`)
      const sent = res.data?.data
      if (sent?.whatsapp) {
        toast.success(`Reminder sent to ${lead.phone} via WhatsApp! 🚀`)
      } else {
        toast.warning('WhatsApp Bot is offline. SMS reminder was still attempted.')
      }
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send reminder.')
    } finally {
      setActionBusy(null)
    }
  }

  async function handleStatusChange(lead, status) {
    setActionBusy(lead.id)
    try {
      await api.post(`/registration-leads/${lead.id}/status`, { status })
      toast.success(`Marked ${lead.phone} as ${status}.`)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to update status.')
    } finally {
      setActionBusy(null)
    }
  }

  function getStatusBadge(status) {
    switch (status) {
      case 'contacted':
        return <Badge tone="info">📞 Contacted</Badge>
      case 'registered':
        return <Badge tone="success">✓ Registered</Badge>
      case 'dismissed':
        return <Badge tone="neutral">✕ Dismissed</Badge>
      case 'pending':
      default:
        return <Badge tone="warning">⏳ Pending</Badge>
    }
  }

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Incomplete Registrations
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Drivers who verified their mobile OTP but never finished the registration form. Call or nudge them to complete it.
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

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard
          label="Pending Follow-up"
          value={counts.pending}
          loading={loading}
          icon={Clock}
          iconColor="var(--warning)"
          iconBg="var(--warning-soft)"
          trendLabel={counts.pending > 0 ? `${counts.pending} to contact` : 'All clear'}
          trendTone={counts.pending > 0 ? 'danger' : 'success'}
        />
        <KpiCard
          label="Contacted"
          value={counts.contacted}
          loading={loading}
          icon={PhoneCall}
          iconColor="var(--info)"
          iconBg="var(--info-soft)"
          trendLabel="Awaiting form"
          trendTone="neutral"
        />
        <KpiCard
          label="Registered"
          value={counts.registered}
          loading={loading}
          icon={CheckCircle2}
          iconColor="var(--success)"
          iconBg="var(--success-soft)"
          trendLabel="Completed signup"
          trendTone="success"
        />
        <KpiCard
          label="Total Tracked"
          value={counts.total}
          loading={loading}
          icon={UserPlus}
          iconColor="var(--brand)"
          iconBg="var(--brand-soft)"
          trendLabel="OTP verified"
          trendTone="neutral"
        />
      </div>

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
                  borderColor: statusFilter === f.value ? 'var(--brand)' : 'var(--border)',
                  background: statusFilter === f.value ? 'var(--brand-soft)' : 'transparent',
                  color: statusFilter === f.value ? 'var(--brand)' : 'var(--ink-muted)',
                }}
              >
                <span>{f.label}</span>
                {countVal !== undefined && (
                  <span
                    className="rounded-full px-1.5 py-0.2 text-[10px] font-semibold"
                    style={{
                      background: statusFilter === f.value ? 'var(--brand)' : 'var(--border)',
                      color: statusFilter === f.value ? '#ffffff' : 'var(--ink-muted)',
                    }}
                  >
                    {countVal}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }} />
          <input
            type="text"
            placeholder="Search phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border py-1.5 pl-8 pr-3 text-[12.5px] outline-none transition-colors"
            style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
          />
        </div>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Phone', 'Status', 'OTP Verified', 'Last Reminder', 'Action'].map((h) => (
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
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}

              {!loading && error && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}

              {!loading && !error && filteredLeads.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    <UserPlus size={28} className="mx-auto mb-2 opacity-40" style={{ color: 'var(--ink-muted)' }} />
                    No leads found for current filter.
                  </td>
                </tr>
              )}

              {!loading &&
                !error &&
                filteredLeads.map((item) => {
                  const stale = item.status === 'pending' && daysSince(item.otp_verified_at) >= STALE_DAYS_THRESHOLD
                  return (
                    <tr
                      key={item.id}
                      className="transition-colors hover:bg-[var(--bg-hover)]"
                      style={{ borderTop: '1px solid var(--border)' }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <a
                            href={`tel:${item.phone}`}
                            className="flex items-center gap-1 font-mono font-medium hover:underline"
                            style={{ color: 'var(--brand)' }}
                            title="Click to call"
                          >
                            <Phone size={11} />
                            {item.phone}
                          </a>
                          {stale && (
                            <span title={`Pending ${daysSince(item.otp_verified_at)}+ days`}>
                              <AlertTriangle size={12} style={{ color: 'var(--danger)' }} />
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">{getStatusBadge(item.status)}</td>

                      <td
                        className="whitespace-nowrap px-4 py-3 text-[12px]"
                        style={{ color: stale ? 'var(--danger)' : 'var(--ink-muted)' }}
                      >
                        {item.otp_verified_at ? formatDateTime(item.otp_verified_at) : '—'}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                        {item.last_reminder_sent_at
                          ? `${formatDateTime(item.last_reminder_sent_at)} (${item.reminder_count}x)`
                          : 'Never'}
                      </td>

                      <td className="whitespace-nowrap px-4 py-3">
                        {item.status === 'registered' ? (
                          <span className="text-[11.5px] font-medium" style={{ color: 'var(--success)' }}>
                            Signed up ✓
                          </span>
                        ) : item.status === 'dismissed' ? (
                          <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                            —
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={actionBusy === item.id}
                              onClick={() => handleSendReminder(item)}
                              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                              style={{ background: 'var(--brand)' }}
                              title="Send WhatsApp/SMS reminder"
                            >
                              <Send size={12} />
                              Remind
                            </button>
                            {item.status === 'pending' && (
                              <button
                                type="button"
                                disabled={actionBusy === item.id}
                                onClick={() => handleStatusChange(item, 'contacted')}
                                className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
                                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                                title="Mark as contacted"
                              >
                                <PhoneCall size={12} />
                                Contacted
                              </button>
                            )}
                            <button
                              type="button"
                              disabled={actionBusy === item.id}
                              onClick={() => handleStatusChange(item, 'dismissed')}
                              className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--danger-soft)]"
                              style={{ borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
                              title="Dismiss lead"
                            >
                              <XCircle size={12} />
                              Dismiss
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

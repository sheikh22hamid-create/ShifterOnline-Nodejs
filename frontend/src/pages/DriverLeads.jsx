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
  Send,
  MessageCircle,
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
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'customer' | 'driver'
  const [searchQuery, setSearchQuery] = useState('')
  const [verifyTarget, setVerifyTarget] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)

  const fetcher = useCallback(
    () =>
      api
        .get('/driver-leads', { params: { status: statusFilter, type: typeFilter } })
        .then((res) => res.data),
    [statusFilter, typeFilter]
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
    customer_total: 0,
    driver_total: 0,
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
      const res = await api.post(`/driver-leads/${lead.id}/verify`)
      const invite = res.data?.invite
      if (invite?.whatsapp) {
        toast.success(`Verified & WhatsApp invite sent automatically to ${lead.phone}! 🚀`)
      } else {
        toast.success(`Lead for ${lead.name || lead.phone} verified successfully!`)
        if (invite && !invite.whatsapp) {
          toast.info(`WhatsApp Bot is offline. Click the green 'WA' button to send invite manually.`)
        }
      }
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

  // Manually trigger WhatsApp invite via WhatsApp Bot
  async function handleSendInvite(lead) {
    setActionBusy(true)
    try {
      const res = await api.post(`/driver-leads/${lead.id}/send-invite`)
      const isOk = res.data?.data?.whatsapp
      if (isOk) {
        toast.success(`WhatsApp invite sent automatically to ${lead.phone}! 🚀`)
      } else {
        toast.warning(res.data?.message || 'WhatsApp Bot is offline. Use the green WA button to send directly.')
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send invite.')
    } finally {
      setActionBusy(false)
    }
  }

  function getWhatsAppWebLink(item) {
    const leadName = item.name || ''
    const driverName = item.driver?.name || ''
    const greeting = leadName ? `Namaste ${leadName} ji! 🙏` : `Namaste! 🙏`
    const referrer = driverName ? `Aapke dost *${driverName}* (Shifter Partner)` : `Shifter Partner`
    const isDriverLead = item.lead_type === 'driver'

    const text = isDriverLead
      ? `${greeting}\n\n` +
        `${referrer} ne aapko *Shifter Online Driver Partner* ke roop me judne ke liye invite kiya hai. 🚚\n\n` +
        `Apni gadi (Tata Ace, Pickup, Bolero, 3-Wheeler) Shifter ke sath jodein aur daily behtareen kamai karein!\n\n` +
        `📲 *Shifter Driver App* abhi download karein aur direct register karein:\n` +
        `👉 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n` +
        `Driver Helpline: +91 9109114515\n` +
        `— *Team Shifter Online*`
      : `${greeting}\n\n` +
        `${referrer} ne aapko *Shifter Online* recommend kiya hai. 🚚\n\n` +
        `Ab kisi bhi saman ko bhejna, mini-truck ya tempo book karna hua behad aasan aur kifayati!\n\n` +
        `📲 *Shifter Customer App* abhi download karein aur apni pehli booking par special discount paiye:\n` +
        `👉 https://play.google.com/store/apps/details?id=com.shifter.online\n\n` +
        `Helpline: +91 9999908008\n` +
        `— *Team Shifter Online*`

    return `https://wa.me/91${item.phone}?text=${encodeURIComponent(text)}`
  }

  function getLeadTypeBadge(type) {
    if (type === 'driver') {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700 ring-1 ring-inset ring-purple-600/20 dark:bg-purple-950/40 dark:text-purple-300">
          🚚 Driver
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300">
        👤 Customer
      </span>
    )
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
            Contacts referred by driver partners. Call to verify and award referral rewards.
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

      {/* Lead Category Switcher (Customer vs Driver Leads) */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={() => setTypeFilter('all')}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${
            typeFilter === 'all'
              ? 'bg-[var(--brand)] text-white shadow-sm'
              : 'border hover:bg-[var(--bg-hover)]'
          }`}
          style={typeFilter !== 'all' ? { borderColor: 'var(--border)', color: 'var(--ink)' } : {}}
        >
          <span>All Leads</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${typeFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
            {counts.total}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter('customer')}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${
            typeFilter === 'customer'
              ? 'bg-blue-600 text-white shadow-sm'
              : 'border hover:bg-[var(--bg-hover)]'
          }`}
          style={typeFilter !== 'customer' ? { borderColor: 'var(--border)', color: 'var(--ink)' } : {}}
        >
          <span>👤 Customer Leads</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${typeFilter === 'customer' ? 'bg-white/20 text-white' : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'}`}>
            {counts.customer_total}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTypeFilter('driver')}
          className={`flex items-center gap-2 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-all ${
            typeFilter === 'driver'
              ? 'bg-purple-600 text-white shadow-sm'
              : 'border hover:bg-[var(--bg-hover)]'
          }`}
          style={typeFilter !== 'driver' ? { borderColor: 'var(--border)', color: 'var(--ink)' } : {}}
        >
          <span>🚚 Driver Partner Leads</span>
          <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${typeFilter === 'driver' ? 'bg-white/20 text-white' : 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300'}`}>
            {counts.driver_total}
          </span>
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
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-medium"
                          style={{ color: 'var(--ink)' }}
                        >
                          {item.name || 'Unnamed Contact'}
                        </span>
                        {getLeadTypeBadge(item.lead_type)}
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
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setVerifyTarget(item)}
                            className="flex items-center gap-1 rounded-md px-2.5 py-1 text-[11.5px] font-semibold text-white transition-opacity hover:opacity-90"
                            style={{ background: 'var(--success)' }}
                            title="Verify lead after phone call"
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
                            title="Reject lead"
                          >
                            <XCircle size={13} />
                            Reject
                          </button>
                          <a
                            href={getWhatsAppWebLink(item)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-[#25D366]/10"
                            style={{
                              borderColor: '#25D366',
                              color: '#25D366',
                            }}
                            title="Open WhatsApp Web to chat/send link"
                          >
                            <MessageCircle size={13} />
                            WA
                          </a>
                        </div>
                      ) : item.status === 'verified' ? (
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[11.5px]"
                            style={{ color: 'var(--info)' }}
                          >
                            Awaiting Ride
                          </span>
                          <button
                            type="button"
                            disabled={actionBusy}
                            onClick={() => handleSendInvite(item)}
                            className="flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors hover:bg-[var(--brand-soft)] disabled:opacity-50"
                            style={{
                              borderColor: 'var(--brand)',
                              color: 'var(--brand)',
                            }}
                            title="Send/Resend invite SMS & WhatsApp"
                          >
                            <Send size={11} />
                            Send Invite
                          </button>
                          <a
                            href={getWhatsAppWebLink(item)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium"
                            style={{
                              borderColor: '#25D366',
                              color: '#25D366',
                            }}
                            title="Open WhatsApp Web"
                          >
                            <MessageCircle size={11} />
                          </a>
                        </div>
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
          open={Boolean(verifyTarget)}
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
              <div className="mt-1 flex items-center gap-2">
                <strong>Category:</strong>
                {getLeadTypeBadge(verifyTarget.lead_type)}
              </div>
              <div className="mt-1">
                <strong>Referred By:</strong>{' '}
                {verifyTarget.driver?.name || `Driver #${verifyTarget.driver_id}`}{' '}
                (ID: #{verifyTarget.driver_id})
              </div>
            </div>
            <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              Once verified, the lead will remain active for 45 days. An automated
              welcome invite with the {verifyTarget.lead_type === 'driver' ? 'Driver Partner App' : 'Customer App'} download link will be dispatched via
              <strong> WhatsApp Bot</strong> to this contact.
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
          open={Boolean(rejectTarget)}
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
              <div className="mt-1 flex items-center gap-2">
                <strong>Category:</strong>
                {getLeadTypeBadge(rejectTarget.lead_type)}
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

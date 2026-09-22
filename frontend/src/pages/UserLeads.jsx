import { useCallback, useState, useMemo } from 'react'
import {
  Users,
  PhoneCall,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Search,
  RefreshCw,
  Phone,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  Send,
  MessageCircle,
  Download,
  FileSpreadsheet,
  Coins,
  User,
  Filter,
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

export default function UserLeads() {
  const toast = useToast()
  const [statusFilter, setStatusFilter] = useState('pending')
  const [typeFilter, setTypeFilter] = useState('all') // 'all' | 'customer' | 'driver'
  const [userFilter, setUserFilter] = useState('') // '' | specific user_id
  const [searchQuery, setSearchQuery] = useState('')
  const [verifyTarget, setVerifyTarget] = useState(null)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [exporting, setExporting] = useState(false)

  const fetcher = useCallback(
    () =>
      api
        .get('/user-leads', {
          params: {
            status: statusFilter,
            type: typeFilter,
            user_id: userFilter || undefined,
          },
        })
        .then((res) => res.data),
    [statusFilter, typeFilter, userFilter]
  )

  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const leads = data?.data ?? []
  const submitterUsers = data?.users ?? []
  const counts = data?.counts ?? {
    pending: 0,
    verified: 0,
    converted: 0,
    rejected: 0,
    expired: 0,
    total: 0,
    customer_total: 0,
    driver_total: 0,
    total_reward_points: 0,
  }

  // Filter in memory by search query
  const filteredLeads = useMemo(() => {
    if (!searchQuery.trim()) return leads
    const q = searchQuery.toLowerCase().trim()
    return leads.filter((item) => {
      const name = (item.name || '').toLowerCase()
      const phone = (item.phone || '').toLowerCase()
      const userName = (item.user?.name || '').toLowerCase()
      const userMobile = (item.user?.mobile || '').toLowerCase()
      const userId = String(item.user_id || '')
      return (
        name.includes(q) ||
        phone.includes(q) ||
        userName.includes(q) ||
        userMobile.includes(q) ||
        userId.includes(q)
      )
    })
  }, [leads, searchQuery])

  // Download Excel / CSV File
  async function handleExportExcel() {
    try {
      setExporting(true)
      const res = await api.get('/user-leads/export', {
        params: {
          status: statusFilter,
          type: typeFilter,
          user_id: userFilter || undefined,
        },
        responseType: 'blob',
      })

      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      const dateStr = new Date().toISOString().split('T')[0]
      a.href = url
      a.download = `User_Contact_Referrals_${dateStr}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(url)

      toast.success('Excel/CSV export downloaded successfully! 📊')
    } catch (err) {
      toast.error('Failed to export Excel file: ' + (err.message || 'Unknown error'))
    } finally {
      setExporting(false)
    }
  }

  // Verify lead after ops call
  async function handleVerify(lead) {
    setActionBusy(true)
    try {
      const res = await api.post(`/user-leads/${lead.id}/verify`)
      const invite = res.data?.invite
      if (invite?.whatsapp) {
        toast.success(`Verified & WhatsApp invite sent automatically to ${lead.phone}! 🚀`)
      } else {
        toast.success(`Lead for ${lead.name || lead.phone} verified successfully!`)
      }
      setVerifyTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to verify lead')
    } finally {
      setActionBusy(false)
    }
  }

  // Reject lead
  async function handleReject(lead) {
    setActionBusy(true)
    try {
      await api.post(`/user-leads/${lead.id}/reject`)
      toast.success(`Lead for ${lead.phone} marked as rejected`)
      setRejectTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reject lead')
    } finally {
      setActionBusy(false)
    }
  }

  // Helper for WhatsApp click-to-chat
  function getWhatsAppUrl(item) {
    const isDriver = item.lead_type === 'driver'
    const referrer = item.user?.name ? `Aapke dost *${item.user.name}*` : 'Aapke ek saathi'
    const greeting = item.name ? `Namaste *${item.name}* ji! 🙏` : 'Namaste ji! 🙏'

    const text = isDriver
      ? `${greeting}\n\n` +
        `${referrer} ne aapko *Shifter Online Driver Partner* ke roop me judne ke liye invite kiya hai. 🚚\n\n` +
        `Apni gadi (Tata Ace, Pickup, Bolero, 3-Wheeler) Shifter ke sath jodein aur daily behtareen kamai karein!\n\n` +
        `📲 *Shifter Driver App* abhi download karein aur direct register karein:\n` +
        `👉 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n` +
        `Driver Helpline: +91 9109114515\n` +
        `— *Team Shifter Online*`
      : `${greeting}\n\n` +
        `${referrer} ne aapko *Shifter Online* recommend kiya hai. 📦\n\n` +
        `Ab kisi bhi saman ko bhejna, shifting ya tempo book karna hua behad aasan aur kifayati!\n\n` +
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
          🚚 Driver Partner
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20 dark:bg-blue-950/40 dark:text-blue-300">
        👤 Customer Lead
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1
              className="text-[20px] font-bold tracking-tight"
              style={{ color: 'var(--ink)' }}
            >
              User Contact Referrals
            </h1>
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[11px] font-bold text-orange-700 dark:bg-orange-950/50 dark:text-orange-300">
              User App Leads
            </span>
          </div>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Track & manage contacts submitted by app users for Customer bookings and Driver partner onboarding.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Export Excel Button */}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exporting || loading}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-[12.5px] font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-50"
          >
            <FileSpreadsheet size={15} />
            <span>{exporting ? 'Exporting...' : 'Download Excel'}</span>
          </button>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => refetch()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors hover:bg-[var(--bg-hover)]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* KPI Cards (6 metrics) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Total User Leads"
          value={counts.total}
          icon={Users}
          color="indigo"
          subtext="All submitted"
        />
        <KpiCard
          label="Customer Leads"
          value={counts.customer_total}
          icon={User}
          color="sky"
          subtext={`${counts.total > 0 ? Math.round((counts.customer_total / counts.total) * 100) : 0}% share`}
        />
        <KpiCard
          label="Driver Leads"
          value={counts.driver_total}
          icon={PhoneCall}
          color="purple"
          subtext={`${counts.total > 0 ? Math.round((counts.driver_total / counts.total) * 100) : 0}% share`}
        />
        <KpiCard
          label="Pending Verification"
          value={counts.pending}
          icon={Clock}
          color="amber"
          subtext="Need ops call"
        />
        <KpiCard
          label="Verified"
          value={counts.verified}
          icon={CheckCircle2}
          color="blue"
          subtext="Invited / Ready"
        />
        <KpiCard
          label="Rewarded (Points)"
          value={`${counts.converted} (${counts.total_reward_points || counts.converted * 100} pts)`}
          icon={Coins}
          color="emerald"
          subtext="Completed 1st Ride"
        />
      </div>

      {/* Target Category Tabs: All vs Customer vs Driver */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center gap-2">
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
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                typeFilter === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
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
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                typeFilter === 'customer' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
              }`}
            >
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
            <span>🚚 Driver Leads</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                typeFilter === 'driver' ? 'bg-white/20 text-white' : 'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300'
              }`}
            >
              {counts.driver_total}
            </span>
          </button>
        </div>

        {/* User Filter Dropdown */}
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-slate-400" />
          <select
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="rounded-lg border bg-[var(--bg-card)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--ink)] shadow-sm outline-none focus:ring-1 focus:ring-[var(--brand)]"
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="">All Submitting Users</option>
            {submitterUsers.map((u) => (
              <option key={u.id} value={u.id}>
                User #{u.id}: {u.name} ({u.mobile})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Status Pills & Search Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-lg px-3 py-1 text-[12px] font-medium transition-all ${
                statusFilter === f.value
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
              }`}
            >
              {f.label}
              {counts[f.value] !== undefined && f.value !== 'all' ? ` (${counts[f.value]})` : ''}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search contact, user, phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border bg-[var(--bg-card)] py-1.5 pl-9 pr-3 text-[13px] text-[var(--ink)] placeholder-slate-400 outline-none transition-colors focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]"
            style={{ borderColor: 'var(--border)' }}
          />
        </div>
      </div>

      {/* Main Table */}
      <div
        className="overflow-hidden rounded-xl border bg-[var(--bg-card)] shadow-sm"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead
              className="border-b text-[11.5px] uppercase tracking-wider text-slate-500"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-hover)' }}
            >
              <tr>
                <th className="px-4 py-3 font-semibold">Contact Info</th>
                <th className="px-4 py-3 font-semibold">Target Category</th>
                <th className="px-4 py-3 font-semibold">Submitted By (User)</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Reward Status</th>
                <th className="px-4 py-3 font-semibold">Submitted Date</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-[var(--brand)]" />
                    Loading user referral leads...
                  </td>
                </tr>
              ) : filteredLeads.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    <Users size={32} className="mx-auto mb-2 text-slate-400" />
                    <p className="font-semibold text-[var(--ink)]">No leads found</p>
                    <p className="text-[12px] text-slate-400">
                      {searchQuery
                        ? 'No leads matching your search query.'
                        : 'No user-submitted leads in this category.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredLeads.map((item) => (
                  <tr
                    key={item.id}
                    className="transition-colors hover:bg-[var(--bg-hover)]"
                  >
                    {/* Contact Info */}
                    <td className="px-4 py-3">
                      <div className="font-semibold" style={{ color: 'var(--ink)' }}>
                        {item.name || 'Unnamed Contact'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[12px] text-slate-500">
                        <span className="font-mono">{item.phone}</span>
                        <a
                          href={`tel:${item.phone}`}
                          className="text-blue-600 hover:text-blue-700"
                          title="Call Contact"
                        >
                          <Phone size={12} />
                        </a>
                      </div>
                    </td>

                    {/* Target Category */}
                    <td className="px-4 py-3">
                      {getLeadTypeBadge(item.lead_type)}
                    </td>

                    {/* Referrer User */}
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setUserFilter(String(item.user_id))}
                        className="group text-left"
                        title="Click to view all leads from this user"
                      >
                        <div className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-200 group-hover:text-[var(--brand)]">
                          <span>{item.user?.name || `User #${item.user_id}`}</span>
                          <span className="text-[11px] text-slate-400">#{item.user_id}</span>
                        </div>
                        <div className="text-[11.5px] text-slate-400 font-mono">
                          {item.user?.mobile || 'No mobile'}
                        </div>
                      </button>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {getStatusBadge(item.status)}
                    </td>

                    {/* Reward */}
                    <td className="px-4 py-3">
                      {item.status === 'converted' ? (
                        <div className="flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
                          <Coins size={13} />
                          <span>100 pts credited</span>
                        </div>
                      ) : (
                        <span className="text-[11.5px] text-slate-400">Pending 1st Ride</span>
                      )}
                    </td>

                    {/* Submitted Date */}
                    <td className="px-4 py-3 text-[12px] text-slate-500">
                      <div>{formatDateTime(item.submitted_at)}</div>
                      {item.expires_at && item.status === 'verified' && (
                        <div className="text-[11px] text-amber-600">
                          Expires: {formatDateTime(item.expires_at)}
                        </div>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* WhatsApp Direct Link */}
                        <a
                          href={getWhatsAppUrl(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300"
                          title="Open WhatsApp Chat"
                        >
                          <MessageCircle size={12} />
                          <span>WA</span>
                        </a>

                        {/* Verify button if pending */}
                        {item.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => setVerifyTarget(item)}
                            className="flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1 text-[11.5px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/20 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-300"
                          >
                            <CheckCircle2 size={12} />
                            <span>Verify</span>
                          </button>
                        )}

                        {/* Reject button if pending */}
                        {item.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => setRejectTarget(item)}
                            className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11.5px] font-semibold text-red-700 ring-1 ring-inset ring-red-600/20 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-300"
                          >
                            <XCircle size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Verify Confirmation Modal */}
      {verifyTarget && (
        <Modal
          isOpen={true}
          onClose={() => setVerifyTarget(null)}
          title="Verify User Referral Lead"
        >
          <div className="space-y-4 text-[13.5px]">
            <p className="text-slate-600 dark:text-slate-300">
              Aap <strong className="text-[var(--ink)]">{verifyTarget.name || verifyTarget.phone}</strong>{' '}
              (<span className="font-mono font-semibold">{verifyTarget.phone}</span>) ko verify kar rahe hain.
            </p>

            <div className="rounded-lg bg-slate-50 p-3 text-[12.5px] dark:bg-slate-900 border" style={{ borderColor: 'var(--border)' }}>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Target Category:</span>
                <span className="font-semibold">{verifyTarget.lead_type === 'driver' ? '🚚 Driver Partner' : '👤 Customer'}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Referred By:</span>
                <span className="font-semibold">{verifyTarget.user?.name || `User #${verifyTarget.user_id}`}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Verification Window:</span>
                <span className="font-semibold text-blue-600">45 Days</span>
              </div>
            </div>

            <p className="text-[12px] text-slate-500">
              🚀 Verify karne par system automatically WhatsApp Bot ke through{' '}
              {verifyTarget.lead_type === 'driver' ? 'Driver Partner App' : 'Customer Booking App'}{' '}
              ka download link bhej dega.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setVerifyTarget(null)}
                className="rounded-lg border px-4 py-2 text-[13px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => handleVerify(verifyTarget)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {actionBusy ? 'Verifying...' : 'Verify & Send Invite'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Confirmation Modal */}
      {rejectTarget && (
        <Modal
          isOpen={true}
          onClose={() => setRejectTarget(null)}
          title="Reject Referral Lead"
        >
          <div className="space-y-4 text-[13.5px]">
            <p className="text-slate-600 dark:text-slate-300">
              Kya aap <strong className="text-[var(--ink)]">{rejectTarget.name || rejectTarget.phone}</strong>{' '}
              ko reject karna chahte hain?
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setRejectTarget(null)}
                className="rounded-lg border px-4 py-2 text-[13px] font-medium hover:bg-slate-100 dark:hover:bg-slate-800"
                style={{ borderColor: 'var(--border)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={actionBusy}
                onClick={() => handleReject(rejectTarget)}
                className="rounded-lg bg-red-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionBusy ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

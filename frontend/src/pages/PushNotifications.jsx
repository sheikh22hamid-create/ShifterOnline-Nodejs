import { useState, useEffect, useCallback } from 'react'
import {
  Send,
  Bell,
  Sparkles,
  Users,
  Truck,
  UserCheck,
  AlertTriangle,
  Gift,
  Info,
  Clock,
  CheckCircle2,
  RefreshCw,
  Smartphone,
  ExternalLink,
  Zap,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import Badge from '../components/common/Badge'

const TEMPLATES = [
  {
    name: '🎁 20% Driver Incentive',
    target_type: 'all_drivers',
    notification_type: 'offer',
    title: 'Weekend Bonus: Earn Extra 20%! 🚀',
    message: 'Complete 5 trips this weekend and unlock a 20% bonus directly in your wallet. Open your app and start taking rides now!',
  },
  {
    name: '🏷️ Customer Promo Discount',
    target_type: 'all_customers',
    notification_type: 'offer',
    title: 'Flat ₹100 OFF On Your Next Move! 🚚',
    message: 'Planning to shift goods or house? Use code SHIFTER100 at checkout and enjoy instant ₹100 discount!',
  },
  {
    name: '⚠️ Rain / Traffic Alert',
    target_type: 'all_everyone',
    notification_type: 'urgent',
    title: 'Monsoon Safety & High Demand Alert 🌧️',
    message: 'Heavy rain expected in multiple areas. Please drive safely and expect slight dispatch delays. Surge rates may apply.',
  },
  {
    name: '📢 New App Features',
    target_type: 'all_everyone',
    notification_type: 'general',
    title: 'Exciting New Update Available! ⭐',
    message: 'We have updated Shifter Online with faster booking, real-time live vehicle tracking, and smoother payments.',
  },
]

export default function PushNotifications() {
  const { hasRole, user } = useAuth()
  const toast = useToast()
  const canSend = hasRole('superadmin', 'admin')

  const [targetType, setTargetType] = useState('all_everyone')
  const [notificationType, setNotificationType] = useState('offer')
  const [cityId, setCityId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [previewDevice, setPreviewDevice] = useState('customer') // 'driver' or 'customer'

  const [cities, setCities] = useState([])
  const [history, setHistory] = useState([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [sending, setSending] = useState(false)

  // Fetch cities for city-targeted pushes
  useEffect(() => {
    api
      .get('/cities')
      .then((res) => setCities(res.data?.data || []))
      .catch(() => {})
  }, [])

  // Fetch broadcast history
  const fetchHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const res = await api.get('/notifications/history')
      setHistory(res.data?.data || [])
    } catch {
      // ignore
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  function applyTemplate(tmpl) {
    setTargetType(tmpl.target_type)
    setNotificationType(tmpl.notification_type)
    setTitle(tmpl.title)
    setMessage(tmpl.message)
    toast.info(`Applied template: "${tmpl.name}"`)
  }

  async function handleSend(e) {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Please enter a notification title.')
      return
    }
    if (!message.trim()) {
      toast.error('Please enter a notification message / description.')
      return
    }

    setSending(true)
    try {
      const payload = {
        target_type: targetType,
        notification_type: notificationType,
        title: title.trim(),
        message: message.trim(),
        image_url: imageUrl.trim() || undefined,
        city_id: cityId ? parseInt(cityId, 10) : undefined,
        target_identifier: targetId ? targetId.trim() : undefined,
        target_id: targetId ? targetId.trim() : undefined,
      }

      const res = await api.post('/notifications/send', payload)
      toast.success(res.data?.message || 'Notification broadcasted successfully!')
      // Clear form
      setTitle('')
      setMessage('')
      setImageUrl('')
      setTargetId('')
      fetchHistory()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to send notification.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Banner & Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'rgba(234, 88, 12, 0.15)', color: 'var(--brand)' }}
            >
              <Bell size={18} />
            </span>
            <h1 className="text-[20px] font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
              Push Notifications & Announcements
            </h1>
          </div>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Broadcast instant FCM Push Notifications and custom offer banners directly to Drivers and Customers apps.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchHistory}
            disabled={loadingHistory}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--surface)',
              color: 'var(--ink)',
            }}
          >
            <RefreshCw size={13} className={loadingHistory ? 'animate-spin' : ''} /> Refresh History
          </button>
        </div>
      </div>

      {/* Quick Templates Bar */}
      <div className="surface-card rounded-xl p-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={14} style={{ color: 'var(--brand)' }} />
          <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            1-Click Quick Templates
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {TEMPLATES.map((tmpl) => (
            <button
              key={tmpl.name}
              type="button"
              onClick={() => applyTemplate(tmpl)}
              className="rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition hover:border-[var(--brand)]"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface-muted)',
                color: 'var(--ink)',
              }}
            >
              {tmpl.name}
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Composer Form on Left, Live Mobile Preview on Right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Composer Card (7 cols) */}
        <div
          className="surface-card rounded-xl p-5 lg:col-span-7"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              Compose Notification
            </h2>
            <span className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              Powered by Firebase Cloud Messaging
            </span>
          </div>

          <form onSubmit={handleSend} className="mt-4 space-y-4">
            {/* Target Audience */}
            <div>
              <label className="block text-[12.5px] font-medium mb-1.5" style={{ color: 'var(--ink)' }}>
                Target Audience <span style={{ color: 'var(--danger)' }}>*</span>
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { id: 'all_everyone', label: 'Everyone (All)', icon: Users },
                  { id: 'all_drivers', label: 'All Drivers', icon: Truck },
                  { id: 'all_customers', label: 'All Customers', icon: UserCheck },
                  { id: 'city_drivers', label: 'Drivers by City', icon: Truck },
                  { id: 'specific_driver', label: 'Driver (Mobile / ID)', icon: Zap },
                  { id: 'specific_customer', label: 'Customer (Mobile / ID)', icon: Zap },
                ].map((item) => {
                  const Icon = item.icon
                  const isSelected = targetType === item.id
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setTargetType(item.id)}
                      className={`flex items-center gap-1.5 rounded-lg border p-2 text-left text-[12px] font-medium transition ${
                        isSelected ? 'border-[var(--brand)] shadow-sm' : 'border-[var(--border)]'
                      }`}
                      style={{
                        background: isSelected ? 'rgba(234, 88, 12, 0.1)' : 'var(--surface-muted)',
                        color: isSelected ? 'var(--brand)' : 'var(--ink)',
                      }}
                    >
                      <Icon size={14} />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* City selector if city targeting */}
            {targetType === 'city_drivers' && (
              <div>
                <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink)' }}>
                  Select City
                </label>
                <select
                  value={cityId}
                  onChange={(e) => setCityId(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-[13px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface-muted)',
                    color: 'var(--ink)',
                  }}
                >
                  <option value="">All Operational Cities</option>
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.city_name || c.name || `City #${c.id}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Specific Mobile Number / ID input */}
            {(targetType === 'specific_driver' || targetType === 'specific_customer') && (
              <div>
                <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--ink)' }}>
                  {targetType === 'specific_driver' ? 'Driver Mobile Number (or ID)' : 'Customer Mobile Number (or ID)'}
                </label>
                <input
                  type="text"
                  placeholder="Enter 10-digit mobile number (e.g. 9876543210) or ID"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-[13px]"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--surface-muted)',
                    color: 'var(--ink)',
                  }}
                  required
                />
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Enter {targetType === 'specific_driver' ? 'driver' : 'customer'}&apos;s 10-digit mobile number (or their system ID).
                </p>
              </div>
            )}

            {/* Notification Type */}
            <div>
              <label className="block text-[12.5px] font-medium mb-1.5" style={{ color: 'var(--ink)' }}>
                Notification Category / Intent
              </label>
              <div className="flex flex-wrap gap-2">
                {[
                  { id: 'offer', label: 'Offer & Promo 🎁', color: 'orange' },
                  { id: 'urgent', label: 'Urgent Alert ⚠️', color: 'red' },
                  { id: 'general', label: 'Announcement 📢', color: 'blue' },
                  { id: 'update', label: 'Service Update ⚡', color: 'green' },
                ].map((type) => (
                  <button
                    key={type.id}
                    type="button"
                    onClick={() => setNotificationType(type.id)}
                    className="rounded-full border px-3 py-1 text-[12px] font-medium transition"
                    style={{
                      borderColor: notificationType === type.id ? 'var(--brand)' : 'var(--border)',
                      background:
                        notificationType === type.id ? 'rgba(234, 88, 12, 0.15)' : 'var(--surface-muted)',
                      color: notificationType === type.id ? 'var(--brand)' : 'var(--ink-muted)',
                    }}
                  >
                    {type.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                  Notification Title <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {title.length}/60 chars
                </span>
              </div>
              <input
                type="text"
                maxLength={60}
                placeholder="e.g. Special Discount: Flat ₹100 Off Today!"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--surface-muted)',
                  color: 'var(--ink)',
                }}
                required
              />
            </div>

            {/* Message Body */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                  Message Description <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  {message.length}/200 chars
                </span>
              </div>
              <textarea
                rows={3}
                maxLength={200}
                placeholder="Write your promo offer details, incentive bonus, or announcement clearly..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--surface-muted)',
                  color: 'var(--ink)',
                }}
                required
              />
            </div>

            {/* Banner Image URL (Optional) */}
            <div>
              <label className="block text-[12.5px] font-medium mb-1" style={{ color: 'var(--ink)' }}>
                Offer Banner Image URL <span className="text-[11.5px] font-normal" style={{ color: 'var(--ink-muted)' }}>(Optional)</span>
              </label>
              <input
                type="url"
                placeholder="https://example.com/promotions/diwali-offer.jpg"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-[13px]"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--surface-muted)',
                  color: 'var(--ink)',
                }}
              />
              <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                Image will show as rich banner in mobile notification tray and in-app message inbox.
              </p>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={sending || !canSend}
                className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-[14px] font-semibold text-white shadow-md transition hover:opacity-95 disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                {sending ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Broadcasting Notification...
                  </>
                ) : (
                  <>
                    <Send size={16} /> Broadcast Push Notification
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {/* Live Device Preview (5 cols) */}
        <div className="space-y-4 lg:col-span-5">
          <div
            className="surface-card rounded-xl p-4"
            style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-1.5">
                <Smartphone size={16} style={{ color: 'var(--brand)' }} />
                <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                  Live Mobile Tray Preview
                </h3>
              </div>

              {/* App Switcher */}
              <div className="flex rounded-lg p-0.5 border" style={{ borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('customer')}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                    previewDevice === 'customer' ? 'bg-[var(--brand)] text-white' : ''
                  }`}
                  style={{ color: previewDevice === 'customer' ? '#fff' : 'var(--ink-muted)' }}
                >
                  Customer App
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('driver')}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition ${
                    previewDevice === 'driver' ? 'bg-[var(--brand)] text-white' : ''
                  }`}
                  style={{ color: previewDevice === 'driver' ? '#fff' : 'var(--ink-muted)' }}
                >
                  Driver App
                </button>
              </div>
            </div>

            {/* Smartphone Mockup */}
            <div className="mt-4 flex justify-center">
              <div
                className="w-full max-w-[340px] rounded-[24px] p-3 shadow-2xl border-4"
                style={{
                  background: '#090D14',
                  borderColor: '#1e293b',
                  color: '#fff',
                }}
              >
                {/* Status Bar */}
                <div className="flex items-center justify-between px-2 text-[10px] text-slate-400">
                  <span>9:41</span>
                  <div className="flex items-center gap-1">
                    <span>5G</span>
                    <span>100%</span>
                  </div>
                </div>

                {/* Notification Item */}
                <div
                  className="mt-3 rounded-2xl p-3 transition"
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    backdropFilter: 'blur(10px)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                  }}
                >
                  {/* Push Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-5 w-5 items-center justify-center rounded-md text-[10px] font-bold"
                        style={{ background: 'var(--brand)', color: '#fff' }}
                      >
                        S
                      </div>
                      <span className="text-[11px] font-semibold text-slate-200">
                        {previewDevice === 'driver' ? 'Shifter Partner' : 'Shifter Online'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400">now</span>
                  </div>

                  {/* Push Body */}
                  <div className="mt-2">
                    <h4 className="text-[13px] font-bold text-white line-clamp-1">
                      {title || 'Special Promotion Alert 🎁'}
                    </h4>
                    <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-300 line-clamp-3">
                      {message ||
                        'Get flat ₹100 discount on your scheduled moves this week! Open app to claim.'}
                    </p>
                  </div>

                  {/* Push Banner Preview if URL provided */}
                  {imageUrl ? (
                    <div className="mt-2.5 overflow-hidden rounded-lg border border-slate-700 bg-slate-800">
                      <img
                        src={imageUrl}
                        alt="Promo Banner Preview"
                        className="h-28 w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                    </div>
                  ) : null}
                </div>

                <div className="mt-3 text-center text-[10px] text-slate-500">
                  Swipe down to view or tap to open app
                </div>
              </div>
            </div>

            {/* In-app database storage note */}
            <div
              className="mt-4 rounded-lg p-2.5 text-[11.5px] leading-relaxed"
              style={{ background: 'var(--surface-muted)', color: 'var(--ink-muted)' }}
            >
              <div className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--ink)' }}>
                <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
                Dual Delivery Architecture:
              </div>
              Notifications are sent in real-time through <strong>FCM Push</strong>, and also stored into Driver inbox (<code>tbl_rnoti</code>) & Customer inbox (<code>tbl_notification</code>) so users never miss them.
            </div>
          </div>
        </div>
      </div>

      {/* Broadcast History Table */}
      <div
        className="surface-card rounded-xl overflow-hidden"
        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Clock size={16} style={{ color: 'var(--brand)' }} />
            <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
              Recent Broadcast History
            </h3>
          </div>
          <span className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
            Showing last {history.length} broadcast records
          </span>
        </div>

        {history.length === 0 ? (
          <div className="p-8 text-center" style={{ color: 'var(--ink-muted)' }}>
            <Bell size={28} className="mx-auto mb-2 opacity-40" />
            <p className="text-[13px]">No notifications sent in this session yet.</p>
            <p className="text-[11.5px]">Sent announcements will appear here with recipient stats.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead
                className="border-b text-[11px] uppercase tracking-wider font-medium"
                style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)', background: 'var(--surface-muted)' }}
              >
                <tr>
                  <th className="px-4 py-2.5">Time</th>
                  <th className="px-4 py-2.5">Title & Message</th>
                  <th className="px-4 py-2.5">Target</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5 text-right">Recipients</th>
                  <th className="px-4 py-2.5 text-right">FCM Delivered</th>
                  <th className="px-4 py-2.5">Admin</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {history.map((h) => (
                  <tr key={h.id} className="hover:bg-slate-500/5 transition">
                    <td className="px-4 py-3 whitespace-nowrap text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                      {new Date(h.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}
                      <div className="text-[10.5px]">
                        {new Date(h.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-semibold text-[13px]" style={{ color: 'var(--ink)' }}>
                        {h.title}
                      </div>
                      <div className="text-[11.5px] truncate" style={{ color: 'var(--ink-muted)' }}>
                        {h.message}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className="inline-flex items-center rounded px-2 py-0.5 text-[11px] font-medium"
                        style={{
                          background: 'rgba(59, 130, 246, 0.12)',
                          color: '#3b82f6',
                        }}
                      >
                        {h.target_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize"
                        style={{
                          background:
                            h.notification_type === 'offer'
                              ? 'rgba(234, 88, 12, 0.15)'
                              : 'rgba(100, 116, 139, 0.15)',
                          color: h.notification_type === 'offer' ? 'var(--brand)' : 'var(--ink)',
                        }}
                      >
                        {h.notification_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium" style={{ color: 'var(--ink)' }}>
                      {h.total_targeted}
                      <div className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                        {h.drivers_count} drivers • {h.customers_count} users
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold" style={{ color: 'var(--success)' }}>
                      {h.fcm_sent || 0}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {h.sent_by}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

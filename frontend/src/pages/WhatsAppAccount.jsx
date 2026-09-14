import { useState, useEffect } from 'react'
import {
  Smartphone,
  QrCode,
  LogOut,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Send,
  Lock,
  ArrowRightLeft,
  ShieldCheck,
  Info,
  KeyRound,
  MessageSquare
} from 'lucide-react'
import api from '../services/api'

export default function WhatsAppAccount() {
  const [loading, setLoading] = useState(true)
  const [statusData, setStatusData] = useState({
    status: 'DISCONNECTED',
    connectedPhone: null,
    qrCode: null,
    pairingCode: null,
  })
  const [message, setMessage] = useState(null) // { type: 'success' | 'error', text: '' }

  // Pairing Code Modal/State
  const [phoneInput, setPhoneInput] = useState('')
  const [pairingLoading, setPairingLoading] = useState(false)

  // Account Switch Modal/State
  const [showSwitchModal, setShowSwitchModal] = useState(false)
  const [switchPhoneInput, setSwitchPhoneInput] = useState('')
  const [switchLoading, setSwitchLoading] = useState(false)

  // Logout Confirmation Modal
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [logoutLoading, setLogoutLoading] = useState(false)

  // Test Notification Tool State
  const [testPhone, setTestPhone] = useState('')
  const [testMsg, setTestMsg] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000) // Auto refresh status every 5s
    return () => clearInterval(interval)
  }, [])

  async function fetchStatus() {
    try {
      // Use relative endpoint to whatsapp status
      const res = await api.get('/../whatsapp/status')
      if (res.data.success || res.data.Result) {
        setStatusData(res.data.data || {})
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp account status:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleRequestPairingCode(e) {
    e?.preventDefault()
    if (!phoneInput.trim()) return

    setPairingLoading(true)
    setMessage(null)
    try {
      const res = await api.post('/../whatsapp/request-pairing-code', { phone: phoneInput })
      if (res.data.success || res.data.Result) {
        setMessage({ type: 'success', text: `🎉 Pairing code generated: ${res.data.pairingCode}. Enter this on your phone in WhatsApp Linked Devices!` })
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to request pairing code:', err)
      setMessage({ type: 'error', text: err.response?.data?.msg || 'Failed to request pairing code.' })
    } finally {
      setPairingLoading(false)
    }
  }

  async function handleSwitchAccount(e) {
    e?.preventDefault()
    setSwitchLoading(true)
    setMessage(null)
    try {
      const res = await api.post('/../whatsapp/switch-account', { phone: switchPhoneInput || null })
      if (res.data.success || res.data.Result) {
        setMessage({ type: 'success', text: '✅ Previous session safely disconnected. New WhatsApp pairing process initiated!' })
        setShowSwitchModal(false)
        setSwitchPhoneInput('')
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to switch WhatsApp account:', err)
      setMessage({ type: 'error', text: err.response?.data?.msg || 'Failed to switch WhatsApp account.' })
    } finally {
      setSwitchLoading(false)
    }
  }

  async function handleLogoutAccount() {
    setLogoutLoading(true)
    setMessage(null)
    try {
      const res = await api.post('/../whatsapp/logout')
      if (res.data.success || res.data.Result) {
        setMessage({ type: 'success', text: '🔒 WhatsApp account disconnected & session invalidated successfully.' })
        setShowLogoutModal(false)
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to logout WhatsApp account:', err)
      setMessage({ type: 'error', text: err.response?.data?.msg || 'Failed to logout WhatsApp account.' })
    } finally {
      setLogoutLoading(false)
    }
  }

  async function handleSendTestNotification(e) {
    e?.preventDefault()
    if (!testPhone.trim() || !testMsg.trim()) return

    setSendingTest(true)
    setMessage(null)
    try {
      const res = await api.post('/../whatsapp/send-notification', { phone: testPhone, message: testMsg })
      if (res.data.success || res.data.Result) {
        setMessage({ type: 'success', text: `🚀 Test notification sent successfully to ${testPhone}!` })
        setTestMsg('')
      }
    } catch (err) {
      console.error('Failed to send test notification:', err)
      setMessage({ type: 'error', text: err.response?.data?.msg || 'Failed to send WhatsApp notification.' })
    } finally {
      setSendingTest(false)
    }
  }

  const isConnected = statusData.status === 'CONNECTED'
  const isAwaiting = statusData.status === 'AWAITING_PAIRING_CODE' || statusData.status === 'AWAITING_QR_SCAN'

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 surface-card">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <Smartphone size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                WhatsApp Account Management
              </h1>
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{
                  background: isConnected ? 'var(--success-soft)' : isAwaiting ? 'var(--warning-soft)' : 'var(--danger-soft)',
                  color: isConnected ? 'var(--success)' : isAwaiting ? 'var(--warning)' : 'var(--danger)',
                  border: `1px solid ${isConnected ? 'var(--success-soft-border)' : 'var(--border)'}`,
                }}
              >
                ● {statusData.status}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              Super Admin Control: Securely monitor, pair, switch, or logout the WhatsApp Bot account.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-[var(--surface-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh Status
          </button>

          {isConnected && (
            <>
              <button
                type="button"
                onClick={() => setShowSwitchModal(true)}
                className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                <ArrowRightLeft size={14} />
                Switch Account
              </button>

              <button
                type="button"
                onClick={() => setShowLogoutModal(true)}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--danger)' }}
              >
                <LogOut size={14} />
                Logout Account
              </button>
            </>
          )}
        </div>
      </div>

      {/* Alert Notification */}
      {message && (
        <div
          className="flex items-center justify-between rounded-lg border px-4 py-3 text-xs"
          style={{
            background: message.type === 'success' ? 'var(--success-soft)' : 'var(--danger-soft)',
            borderColor: message.type === 'success' ? 'var(--success-soft-border)' : 'var(--danger-soft-border)',
            color: message.type === 'success' ? 'var(--success)' : 'var(--danger)',
          }}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
            <span className="font-medium">{message.text}</span>
          </div>
          <button type="button" onClick={() => setMessage(null)} className="font-bold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Account Status Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Connection Status Card */}
        <div className="rounded-xl border p-5 surface-card md:col-span-2">
          <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
              <ShieldCheck size={18} style={{ color: 'var(--brand)' }} />
              <span>Active WhatsApp Session Overview</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
              <Lock size={13} />
              <span>Super Admin Secured</span>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border p-4" style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Connection State
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-base font-bold" style={{ color: isConnected ? 'var(--success)' : 'var(--ink)' }}>
                <span className={`h-3 w-3 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                {statusData.status}
              </div>
            </div>

            <div className="rounded-lg border p-4" style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
              <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Connected Phone Number
              </div>
              <div className="mt-1.5 font-mono-data text-base font-bold" style={{ color: 'var(--ink)' }}>
                {statusData.connectedPhone ? `+${statusData.connectedPhone}` : 'No phone linked'}
              </div>
            </div>
          </div>

          {/* Quick Pairing / Instructions if disconnected */}
          {!isConnected && (
            <div className="mt-5 rounded-xl border p-4" style={{ background: 'var(--brand-soft)', borderColor: 'var(--border)' }}>
              <h3 className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                <KeyRound size={15} />
                Connect WhatsApp Account via Phone Pairing Code
              </h3>
              <p className="mt-1 text-[12px] text-amber-800/80">
                Enter the target business WhatsApp phone number (with country code, e.g. <code>919109114515</code>) to generate an 8-digit pairing code.
              </p>

              <form onSubmit={handleRequestPairingCode} className="mt-3 flex gap-2">
                <input
                  type="text"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="Enter phone with country code (e.g. 919876543210)"
                  className="w-full rounded-lg border px-3.5 py-2 text-xs outline-none focus:border-amber-500"
                  style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
                />
                <button
                  type="submit"
                  disabled={pairingLoading || !phoneInput.trim()}
                  className="rounded-lg px-4 py-2 text-xs font-semibold whitespace-nowrap transition-opacity disabled:opacity-50"
                  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                >
                  {pairingLoading ? 'Requesting…' : 'Get Pairing Code'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Pairing / QR Code Display Panel */}
        <div className="rounded-xl border p-5 surface-card flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 border-b pb-3 text-xs font-semibold" style={{ color: 'var(--ink)', borderColor: 'var(--border)' }}>
              <QrCode size={16} style={{ color: 'var(--brand)' }} />
              <span>Authentication Pairing State</span>
            </div>

            <div className="mt-4 flex flex-col items-center justify-center text-center">
              {statusData.pairingCode ? (
                <div className="my-2 w-full rounded-xl border p-4 surface-card text-center">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                    Your 8-Digit Pairing Code
                  </div>
                  <div className="mt-2 font-mono-data text-3xl font-extrabold tracking-widest text-amber-600">
                    {statusData.pairingCode}
                  </div>
                  <p className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                    Open WhatsApp ➔ Linked Devices ➔ Link with phone number instead ➔ Enter this code.
                  </p>
                </div>
              ) : statusData.qrCode ? (
                <div className="my-2 p-2 rounded-xl border bg-white shadow-sm">
                  <p className="text-[11px] font-bold text-gray-700 mb-2">Scan QR Code in WhatsApp</p>
                  <pre className="text-[9px] font-mono leading-none bg-black text-white p-2 rounded overflow-x-auto">
                    {statusData.qrCode.slice(0, 40)}…
                  </pre>
                </div>
              ) : isConnected ? (
                <div className="my-6 flex flex-col items-center">
                  <CheckCircle2 size={44} className="text-emerald-500" />
                  <p className="mt-2 text-xs font-bold text-emerald-600">Bot Session Active</p>
                  <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    WhatsApp bot is currently running & responsive.
                  </p>
                </div>
              ) : (
                <div className="my-6 flex flex-col items-center">
                  <Info size={40} className="text-amber-500" />
                  <p className="mt-2 text-xs font-bold text-amber-600">Waiting for Pairing</p>
                  <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                    Request pairing code or start account switch to connect.
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg p-3 text-[11px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
            🔒 Credentials are authenticated directly with WhatsApp Web endpoints. No raw session keys are exposed to frontend.
          </div>
        </div>
      </div>

      {/* Manual Test Notification Tool */}
      <div className="rounded-xl border p-5 surface-card">
        <div className="flex items-center gap-2 border-b pb-3 text-sm font-semibold" style={{ color: 'var(--ink)', borderColor: 'var(--border)' }}>
          <MessageSquare size={18} style={{ color: 'var(--brand)' }} />
          <span>Outbound WhatsApp Notification Test Console</span>
        </div>

        <form onSubmit={handleSendTestNotification} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3 items-end">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--ink-muted)' }}>
              Recipient Phone Number
            </label>
            <input
              type="text"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="e.g. 919876543210"
              className="w-full rounded-lg border px-3 py-2 text-xs outline-none"
              style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--ink-muted)' }}>
              Message Text
            </label>
            <input
              type="text"
              value={testMsg}
              onChange={(e) => setTestMsg(e.target.value)}
              placeholder="Type notification text..."
              className="w-full rounded-lg border px-3 py-2 text-xs outline-none"
              style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={sendingTest || !testPhone.trim() || !testMsg.trim() || !isConnected}
              className="flex items-center justify-center gap-2 rounded-lg w-full py-2.5 text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Send size={14} />
              {sendingTest ? 'Sending…' : 'Send Test Notification'}
            </button>
          </div>
        </form>
      </div>

      {/* Switch Account Modal */}
      {showSwitchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border p-6 surface-card shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                <ArrowRightLeft size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
                  Switch WhatsApp Account
                </h3>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Replace current connected account with a new number.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
              ⚠️ Switching account will terminate the existing WhatsApp socket session and clean up stored session authentication files.
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--ink)' }}>
                New WhatsApp Phone Number (Optional)
              </label>
              <input
                type="text"
                value={switchPhoneInput}
                onChange={(e) => setSwitchPhoneInput(e.target.value)}
                placeholder="Enter phone with country code (e.g. 919876543210)"
                className="w-full rounded-lg border px-3.5 py-2.5 text-xs outline-none focus:border-amber-500"
                style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSwitchModal(false)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSwitchAccount}
                disabled={switchLoading}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: 'var(--brand)' }}
              >
                {switchLoading ? 'Switching…' : 'Confirm & Switch Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border p-6 surface-card shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-600">
                <LogOut size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
                  Logout Connected WhatsApp Account?
                </h3>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Confirm session termination
                </p>
              </div>
            </div>

            <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
              Are you sure you want to logout the connected WhatsApp account? The active session will be disconnected and stored credentials will be safely deleted.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLogoutModal(false)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleLogoutAccount}
                disabled={logoutLoading}
                className="rounded-lg px-4 py-2 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
                style={{ background: 'var(--danger)' }}
              >
                {logoutLoading ? 'Disconnecting…' : 'Yes, Logout & Disconnect'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

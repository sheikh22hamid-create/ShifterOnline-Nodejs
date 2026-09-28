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
  MessageSquare,
  Sparkles
} from 'lucide-react'
import QRCode from 'react-qr-code'
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

  // Connection Method Toggle: 'qr' | 'pairing'
  const [connectTab, setConnectTab] = useState('qr')

  // Pairing Code State
  const [phoneInput, setPhoneInput] = useState('')
  const [pairingLoading, setPairingLoading] = useState(false)

  // QR Code Generation State
  const [qrLoading, setQrLoading] = useState(false)

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
    const interval = setInterval(fetchStatus, 4000) // Auto refresh status every 4s
    return () => clearInterval(interval)
  }, [])

  async function fetchStatus() {
    try {
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

  async function handleRequestQrCode() {
    setQrLoading(true)
    setMessage(null)
    try {
      const res = await api.post('/../whatsapp/request-qr')
      if (res.data.success || res.data.Result) {
        setMessage({ type: 'success', text: '🔄 Fresh QR code generation initiated. Scan below with WhatsApp!' })
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to request QR code:', err)
      setMessage({ type: 'error', text: err.response?.data?.msg || 'Failed to generate QR code.' })
    } finally {
      setQrLoading(false)
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
              Super Admin Control: Securely monitor, pair with QR / Code, switch, or logout the WhatsApp Bot account.
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

      {/* Main Account & Authentication Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column: Connection Overview & Method Selector (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          {/* Active Session Overview */}
          <div className="rounded-xl border p-5 surface-card">
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
          </div>

          {/* Connection Mode Selection (When Not Connected) */}
          {!isConnected && (
            <div className="rounded-xl border p-5 surface-card">
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink)' }}>
                  <Sparkles size={16} style={{ color: 'var(--brand)' }} />
                  <span>Choose Connection Method</span>
                </div>

                {/* Tabs */}
                <div className="flex items-center rounded-lg p-0.5 border" style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => setConnectTab('qr')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      connectTab === 'qr'
                        ? 'bg-[var(--brand)] text-[var(--brand-ink)] shadow-sm'
                        : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <QrCode size={14} />
                    Scan QR Code
                  </button>
                  <button
                    type="button"
                    onClick={() => setConnectTab('pairing')}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                      connectTab === 'pairing'
                        ? 'bg-[var(--brand)] text-[var(--brand-ink)] shadow-sm'
                        : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <KeyRound size={14} />
                    Phone Pairing Code
                  </button>
                </div>
              </div>

              {/* Tab 1: QR Code Instructions & Refresh */}
              {connectTab === 'qr' && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    Scan the live QR Code shown on the right panel using WhatsApp on your mobile device:
                  </p>
                  <div className="rounded-lg border p-3.5 space-y-2 text-xs" style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)' }}>
                    <div className="flex items-start gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-bold text-[var(--brand)]">1</span>
                      <span style={{ color: 'var(--ink)' }}>Open <strong>WhatsApp</strong> on your mobile phone.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-bold text-[var(--brand)]">2</span>
                      <span style={{ color: 'var(--ink)' }}>Tap <strong>Menu (⋮)</strong> or <strong>Settings ➔ Linked Devices</strong>.</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-[11px] font-bold text-[var(--brand)]">3</span>
                      <span style={{ color: 'var(--ink)' }}>Tap <strong>Link a Device</strong> and point your camera at the QR code.</span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleRequestQrCode}
                      disabled={qrLoading}
                      className="flex items-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
                      style={{ background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }}
                    >
                      <RefreshCw size={14} className={qrLoading ? 'animate-spin' : ''} />
                      {qrLoading ? 'Generating QR Code…' : '🔄 Refresh / Generate New QR Code'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tab 2: Phone Pairing Code Form */}
              {connectTab === 'pairing' && (
                <div className="mt-4 space-y-3">
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    Enter target WhatsApp phone number with country code (e.g. <code>919109114515</code>) to generate an 8-digit pairing code:
                  </p>

                  <form onSubmit={handleRequestPairingCode} className="flex gap-2">
                    <input
                      type="text"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="Enter phone with country code (e.g. 919876543210)"
                      className="w-full rounded-lg border px-3.5 py-2.5 text-xs outline-none focus:border-amber-500"
                      style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
                    />
                    <button
                      type="submit"
                      disabled={pairingLoading || !phoneInput.trim()}
                      className="rounded-lg px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-opacity disabled:opacity-50"
                      style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                    >
                      {pairingLoading ? 'Generating…' : 'Get Pairing Code'}
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Column: Live QR Code & Pairing Code Visual Display (5 cols) */}
        <div className="lg:col-span-5">
          <div className="rounded-xl border p-5 surface-card h-full flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between border-b pb-3 text-xs font-semibold" style={{ color: 'var(--ink)', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2">
                  <QrCode size={16} style={{ color: 'var(--brand)' }} />
                  <span>WhatsApp Authentication Screen</span>
                </div>
                {statusData.qrCode && !isConnected && (
                  <span className="rounded-full bg-emerald-500/10 text-emerald-600 px-2 py-0.5 text-[10px] font-bold animate-pulse">
                    Live QR Ready
                  </span>
                )}
              </div>

              <div className="mt-4 flex flex-col items-center justify-center text-center">
                {/* 1. If Connected */}
                {isConnected ? (
                  <div className="my-8 flex flex-col items-center">
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                      <CheckCircle2 size={50} />
                    </div>
                    <p className="mt-3 text-sm font-bold text-emerald-600">WhatsApp Bot Connected</p>
                    <p className="mt-1 max-w-xs text-xs" style={{ color: 'var(--ink-muted)' }}>
                      Bot is online, listening to user queries and ready to assist.
                    </p>
                  </div>
                ) : statusData.pairingCode ? (
                  /* 2. Pairing Code View */
                  <div className="my-3 w-full rounded-2xl border p-5 surface-card text-center shadow-md">
                    <div className="text-xs font-bold uppercase tracking-wider text-amber-600">
                      Your 8-Digit Pairing Code
                    </div>
                    <div className="mt-3 font-mono-data text-4xl font-extrabold tracking-widest text-amber-600 select-all">
                      {statusData.pairingCode}
                    </div>
                    <p className="mt-3 text-xs" style={{ color: 'var(--ink-muted)' }}>
                      Open WhatsApp ➔ Linked Devices ➔ <strong>Link with phone number instead</strong> ➔ Enter code above.
                    </p>
                  </div>
                ) : statusData.qrCode ? (
                  /* 3. Real Interactive QR Code Display */
                  <div className="my-2 flex flex-col items-center">
                    <div className="p-4 rounded-2xl bg-white border shadow-lg">
                      <QRCode
                        value={statusData.qrCode}
                        size={210}
                        bgColor="#ffffff"
                        fgColor="#0f172a"
                        level="M"
                      />
                    </div>
                    <p className="mt-3 text-xs font-bold" style={{ color: 'var(--ink)' }}>
                      📱 Scan QR code with WhatsApp Camera
                    </p>
                    <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      QR code updates automatically.
                    </p>
                  </div>
                ) : (
                  /* 4. Waiting State */
                  <div className="my-8 flex flex-col items-center">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 mb-3">
                      <Info size={36} />
                    </div>
                    <p className="text-xs font-bold text-amber-600">Waiting for Authentication</p>
                    <p className="mt-1 max-w-xs text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                      Click <strong>"Refresh / Generate QR Code"</strong> or enter your phone number to start pairing.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 rounded-lg p-3 text-[11px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
              🔒 Credentials authenticate directly with WhatsApp Web Multi-Device protocol.
            </div>
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
                  Replace current connected account with a new number or fresh QR.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">
              ⚠️ Switching account will terminate the existing WhatsApp socket session and clean up stored session authentication files.
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--ink)' }}>
                New WhatsApp Phone Number (Optional - Leave blank for QR scan)
              </label>
              <input
                type="text"
                value={switchPhoneInput}
                onChange={(e) => setSwitchPhoneInput(e.target.value)}
                placeholder="Enter phone (e.g. 919876543210) or leave blank for QR"
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
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                {switchLoading ? 'Switching…' : 'Proceed to Switch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Logout Account Modal */}
      {showLogoutModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border p-6 surface-card shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10 text-red-600">
                <LogOut size={22} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
                  Disconnect WhatsApp Account
                </h3>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Are you sure you want to log out the WhatsApp bot?
                </p>
              </div>
            </div>

            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              This will immediately disconnect the active WhatsApp bot session and invalidate authentication credentials.
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
                {logoutLoading ? 'Disconnecting…' : 'Confirm Logout'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  MessageSquare,
  Send,
  Users,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Sparkles,
  Phone,
  Tag,
  ExternalLink,
  Info,
  Clock,
  AlertCircle,
  Truck,
  UserCheck,
  UserPlus,
  HelpCircle,
  ShieldCheck,
  Save,
  RotateCcw,
  Image as ImageIcon,
  Video,
  Trash2,
  Upload,
  Play,
  Film,
  X,
  FileText,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

export default function WhatsAppBroadcast() {
  const { hasRole, user } = useAuth()
  const toast = useToast()
  const canSend = hasRole('superadmin', 'admin', 'executive')
  const isSuperAdmin = hasRole('superadmin')
  const canEditPermanentTemplate = hasRole('superadmin', 'admin')

  // WhatsApp bot connection state
  const [botStatus, setBotStatus] = useState({
    status: 'UNKNOWN',
    connectedPhone: null,
  })
  const [loadingStatus, setLoadingStatus] = useState(true)

  // Templates
  const [templates, setTemplates] = useState([])
  const [loadingTemplates, setLoadingTemplates] = useState(true)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')

  // Form inputs
  const [rawRecipients, setRawRecipients] = useState('')
  const [campaignName, setCampaignName] = useState('Customer App Outreach')
  const [messageText, setMessageText] = useState('')

  // Media Attachment state
  const [attachment, setAttachment] = useState(null) // { url, relativePath, type: 'image' | 'video', name, size }
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const imageInputRef = useRef(null)
  const videoInputRef = useRef(null)

  // Template saving states
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [resettingTemplate, setResettingTemplate] = useState(false)

  // Dispatch & Progress state
  const [sending, setSending] = useState(false)
  const [dispatchResult, setDispatchResult] = useState(null)
  const [showConfirmModal, setShowConfirmModal] = useState(false)

  // Quick import loading
  const [importLoading, setImportLoading] = useState(false)

  // Fetch bot status
  const fetchStatus = useCallback(async () => {
    try {
      setLoadingStatus(true)
      const res = await api.get('/../whatsapp/status')
      if (res.data?.success || res.data?.Result) {
        setBotStatus(res.data.data || {})
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp status:', err)
    } finally {
      setLoadingStatus(false)
    }
  }, [])

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    try {
      setLoadingTemplates(true)
      const res = await api.get('/../whatsapp/templates')
      if (res.data?.success || res.data?.Result) {
        const list = res.data.data || []
        setTemplates(list)
        if (list.length > 0 && !selectedTemplateId) {
          const first = list[0]
          setSelectedTemplateId(first.id)
          setMessageText(first.message || '')
          setCampaignName(first.title.replace(/[^\w\s-]/gi, '').trim())
          if (first.media_url) {
            setAttachment({
              url: first.media_url,
              type: first.media_type || 'image',
              name: first.media_filename || 'Saved Media Attachment',
            })
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp templates:', err)
      toast.error('Failed to load message templates.')
    } finally {
      setLoadingTemplates(false)
    }
  }, [selectedTemplateId, toast])

  useEffect(() => {
    fetchStatus()
    fetchTemplates()
    const interval = setInterval(fetchStatus, 8000)
    return () => clearInterval(interval)
  }, [fetchStatus, fetchTemplates])

  // Currently active template object
  const currentTemplate = useMemo(() => {
    return templates.find((t) => t.id === selectedTemplateId) || null
  }, [templates, selectedTemplateId])

  // Parse and normalize phone numbers entered in textarea
  const parsedRecipients = useMemo(() => {
    if (!rawRecipients.trim()) return []
    const lines = rawRecipients.split(/[\n,;\t]+/)
    const seen = new Set()
    const valid = []

    for (let line of lines) {
      let clean = line.replace(/\D/g, '')
      if (clean.length === 10) {
        clean = `91${clean}`
      }
      if (clean.length >= 10 && clean.length <= 15 && !seen.has(clean)) {
        seen.add(clean)
        valid.push(clean)
      }
    }
    return valid
  }, [rawRecipients])

  // Select a template
  function handleSelectTemplate(tpl) {
    setSelectedTemplateId(tpl.id)
    setMessageText(tpl.message || '')
    setCampaignName(tpl.title.replace(/[^\w\s-]/gi, '').trim())
    if (tpl.media_url) {
      setAttachment({
        url: tpl.media_url,
        type: tpl.media_type || 'image',
        name: tpl.media_filename || (tpl.media_type === 'video' ? 'Attached Video' : 'Attached Image'),
      })
    } else {
      setAttachment(null)
    }
    toast.info(`Applied template: "${tpl.title}"`)
  }

  // Check if current message/attachment differs from the permanent saved version
  const hasUnsavedEdits = useMemo(() => {
    if (!currentTemplate) return false
    const msgChanged = messageText.trim() !== (currentTemplate.message || '').trim()
    const mediaChanged = (attachment?.url || null) !== (currentTemplate.media_url || null)
    return msgChanged || mediaChanged
  }, [currentTemplate, messageText, attachment])

  // Feature 1: Save Template permanently in DB
  async function handleSaveTemplate() {
    if (!selectedTemplateId) {
      toast.error('Please select a template first.')
      return
    }
    if (!messageText.trim() && !attachment?.url) {
      toast.error('Message text or media attachment is required.')
      return
    }

    setSavingTemplate(true)
    try {
      const res = await api.put(`/../whatsapp/templates/${selectedTemplateId}`, {
        message: messageText.trim(),
        media_url: attachment?.url || null,
        media_type: attachment?.type || null,
        media_filename: attachment?.name || null,
      })

      if (res.data?.success || res.data?.Result) {
        toast.success(`Template "${currentTemplate?.title || selectedTemplateId}" saved permanently!`)
        const updatedTpl = res.data.data
        setTemplates((prev) =>
          prev.map((t) => (t.id === selectedTemplateId ? { ...t, ...updatedTpl } : t))
        )
      }
    } catch (err) {
      console.error('Failed to save template:', err)
      toast.error(err.response?.data?.msg || err.message || 'Failed to permanently save template.')
    } finally {
      setSavingTemplate(false)
    }
  }

  // Feature 1: Reset to latest saved version in DB
  function handleResetToSavedTemplate() {
    if (!currentTemplate) return
    setMessageText(currentTemplate.message || '')
    if (currentTemplate.media_url) {
      setAttachment({
        url: currentTemplate.media_url,
        type: currentTemplate.media_type || 'image',
        name: currentTemplate.media_filename || 'Saved Media Attachment',
      })
    } else {
      setAttachment(null)
    }
    toast.info('Reverted to latest saved template content.')
  }

  // Feature 1: Reset to original factory pre-made default
  async function handleResetToFactoryDefault() {
    if (!selectedTemplateId) return
    setResettingTemplate(true)
    try {
      const res = await api.post(`/../whatsapp/templates/${selectedTemplateId}/reset`)
      if (res.data?.success || res.data?.Result) {
        const resetTpl = res.data.data
        setTemplates((prev) =>
          prev.map((t) => (t.id === selectedTemplateId ? { ...t, ...resetTpl } : t))
        )
        setMessageText(resetTpl.message || '')
        setAttachment(null)
        toast.success('Template restored to original default!')
      }
    } catch (err) {
      console.error('Failed to reset template:', err)
      toast.error(err.response?.data?.msg || err.message || 'Failed to reset template.')
    } finally {
      setResettingTemplate(false)
    }
  }

  // Feature 2: Media upload handler (Images up to 10MB, Videos up to 16MB)
  async function handleMediaFileSelect(e, targetType) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = '' // Reset input

    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase()
    const isVideo = targetType === 'video' || ['.mp4', '.3gp', '.mov'].includes(ext)

    // Size limit
    const maxBytes = isVideo ? 16 * 1024 * 1024 : 10 * 1024 * 1024
    if (file.size > maxBytes) {
      toast.error(
        `File is too large (${(file.size / (1024 * 1024)).toFixed(1)}MB). Max size for ${
          isVideo ? 'videos is 16 MB' : 'images is 10 MB'
        }.`
      )
      return
    }

    // Format validation
    const allowedExts = isVideo ? ['.mp4', '.3gp', '.mov'] : ['.jpg', '.jpeg', '.png', '.webp']
    if (!allowedExts.includes(ext)) {
      toast.error(
        `Unsupported format (${ext}). Allowed: ${allowedExts.join(', ')}`
      )
      return
    }

    setUploadingMedia(true)
    try {
      const formData = new FormData()
      formData.append('media', file)

      const res = await api.post('/../whatsapp/upload-media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })

      if (res.data?.success || res.data?.Result) {
        const data = res.data.data
        setAttachment({
          url: data.url,
          relativePath: data.relativePath,
          type: data.mediaType || (isVideo ? 'video' : 'image'),
          name: file.name,
          size: file.size,
        })
        toast.success(`${isVideo ? 'Video' : 'Image'} attached successfully!`)
      }
    } catch (err) {
      console.error('Media upload failed:', err)
      toast.error(err.response?.data?.msg || err.message || 'Failed to upload media.')
    } finally {
      setUploadingMedia(false)
    }
  }

  // Quick import from registration leads
  async function handleImportIncompleteLeads() {
    setImportLoading(true)
    try {
      const res = await api.get('/registration-leads', { params: { status: 'all' } })
      const list = res.data?.data || []
      const phones = list.map((item) => item.phone).filter(Boolean)
      if (phones.length === 0) {
        toast.warning('No incomplete registration leads found.')
        return
      }
      appendPhones(phones)
      toast.success(`Imported ${phones.length} numbers from Incomplete Leads!`)
    } catch (err) {
      console.error('Import error:', err)
      toast.error('Failed to import from registration leads.')
    } finally {
      setImportLoading(false)
    }
  }

  // Quick import from driver leads
  async function handleImportDriverLeads() {
    setImportLoading(true)
    try {
      const res = await api.get('/driver-leads', { params: { status: 'all' } })
      const list = res.data?.data || []
      const phones = list.map((item) => item.phone).filter(Boolean)
      if (phones.length === 0) {
        toast.warning('No driver leads found.')
        return
      }
      appendPhones(phones)
      toast.success(`Imported ${phones.length} numbers from Driver Leads!`)
    } catch (err) {
      console.error('Import error:', err)
      toast.error('Failed to import from driver leads.')
    } finally {
      setImportLoading(false)
    }
  }

  // Quick import from user contact referrals
  async function handleImportUserLeads() {
    setImportLoading(true)
    try {
      const res = await api.get('/user-leads')
      const list = res.data?.data || []
      const phones = list.map((item) => item.phone).filter(Boolean)
      if (phones.length === 0) {
        toast.warning('No user leads found.')
        return
      }
      appendPhones(phones)
      toast.success(`Imported ${phones.length} numbers from User Referral Leads!`)
    } catch (err) {
      console.error('Import error:', err)
      toast.error('Failed to import from user leads.')
    } finally {
      setImportLoading(false)
    }
  }

  function appendPhones(newPhones) {
    const existing = rawRecipients.trim()
    const joined = newPhones.join('\n')
    if (!existing) {
      setRawRecipients(joined)
    } else {
      setRawRecipients(`${existing}\n${joined}`)
    }
  }

  // Handle broadcast submission
  async function executeBroadcast() {
    if (parsedRecipients.length === 0) {
      toast.error('Please enter at least one valid 10-15 digit phone number.')
      return
    }
    if (!messageText.trim() && !attachment?.url) {
      toast.error('Message text or media attachment is required.')
      return
    }
    if (botStatus.status !== 'CONNECTED') {
      toast.error('WhatsApp Bot is disconnected. Please connect in WhatsApp Account settings first.')
      return
    }

    setSending(true)
    setShowConfirmModal(false)
    setDispatchResult(null)

    try {
      const res = await api.post('/../whatsapp/send-broadcast', {
        recipients: parsedRecipients,
        message: messageText.trim(),
        campaignName: campaignName || 'WhatsApp Outreach',
        mediaUrl: attachment?.url || null,
        mediaType: attachment?.type || null,
      })

      if (res.data?.success || res.data?.Result) {
        const data = res.data
        setDispatchResult(data)
        toast.success(`Broadcast completed: ${data.sent} sent, ${data.failed} failed!`)
      }
    } catch (err) {
      console.error('Broadcast failed:', err)
      toast.error(err.response?.data?.msg || err.message || 'Broadcast failed to execute.')
    } finally {
      setSending(false)
    }
  }

  const isConnected = botStatus.status === 'CONNECTED'
  const filteredTemplates = categoryFilter === 'all'
    ? templates
    : templates.filter((t) => t.category === categoryFilter)

  function formatBytes(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  return (
    <div className="space-y-6">
      {/* Hidden File Inputs for Media Upload */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => handleMediaFileSelect(e, 'image')}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/mp4,video/3gpp,video/quicktime"
        style={{ display: 'none' }}
        onChange={(e) => handleMediaFileSelect(e, 'video')}
      />

      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 surface-card">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <MessageSquare size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                WhatsApp Outreach & Broadcast
              </h1>
              <span
                className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                style={{
                  background: isConnected ? 'var(--success-soft)' : 'var(--danger-soft)',
                  color: isConnected ? 'var(--success)' : 'var(--danger)',
                  border: `1px solid ${isConnected ? 'var(--success-soft-border)' : 'var(--border)'}`,
                }}
              >
                ● {botStatus.status || 'CHECKING'}
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              Send pre-built or permanently customized WhatsApp templates with image/video attachments to single or bulk recipients with safe anti-ban pacing.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStatus}
            disabled={loadingStatus}
            className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-[var(--surface-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
          >
            <RefreshCw size={14} className={loadingStatus ? 'animate-spin' : ''} />
            Check Bot
          </button>

          {isSuperAdmin && (
            <Link
              to="/cms/whatsapp-account"
              className="flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-colors hover:bg-[var(--surface-raised)]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              <Smartphone size={14} />
              Bot Session
            </Link>
          )}
        </div>
      </div>

      {/* Disconnection Warning Banner */}
      {!isConnected && !loadingStatus && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-800 dark:text-amber-300">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={18} className="shrink-0 text-amber-600" />
            <span>
              <strong>WhatsApp Bot is currently offline or disconnected.</strong> {isSuperAdmin ? 'To send messages, please pair or scan the QR code in the WhatsApp Account settings.' : 'Please ask a Super Admin to pair or connect the WhatsApp bot session.'}
            </span>
          </div>
          {isSuperAdmin && (
            <Link
              to="/cms/whatsapp-account"
              className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 font-semibold text-white transition-opacity hover:opacity-90"
            >
              Connect Bot
            </Link>
          )}
        </div>
      )}

      {/* Main Grid: Form + Live Phone Preview */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
        {/* Left Column: Form & Settings (7 cols) */}
        <div className="space-y-6 xl:col-span-7">
          {/* Card 1: Recipients Input */}
          <div className="rounded-xl border p-5 surface-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users size={18} className="text-emerald-600" />
                <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  1. Recipients / Phone Numbers
                </h2>
              </div>
              <span className="rounded-md bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                {parsedRecipients.length} valid number{parsedRecipients.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* Quick Import Buttons */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Quick Import:
              </span>
              <button
                type="button"
                onClick={handleImportIncompleteLeads}
                disabled={importLoading}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--surface-raised)]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                <UserPlus size={12} className="text-amber-600" />
                Incomplete Driver Leads
              </button>
              <button
                type="button"
                onClick={handleImportDriverLeads}
                disabled={importLoading}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--surface-raised)]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                <Truck size={12} className="text-blue-600" />
                Driver Referral Leads
              </button>
              <button
                type="button"
                onClick={handleImportUserLeads}
                disabled={importLoading}
                className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors hover:bg-[var(--surface-raised)]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                <UserCheck size={12} className="text-emerald-600" />
                Customer Referral Leads
              </button>
            </div>

            {/* Phone Input Textarea */}
            <div>
              <textarea
                rows={4}
                value={rawRecipients}
                onChange={(e) => setRawRecipients(e.target.value)}
                placeholder="Enter single or multiple numbers (separated by comma, newline or space)&#10;e.g.&#10;9876543210&#10;919876543211&#10;+91 9988776655"
                className="w-full rounded-lg border p-3 font-mono text-xs outline-none transition-colors focus:border-emerald-500"
                style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
              />
              <div className="mt-1 flex items-center justify-between text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                <span>Accepts 10-digit mobile numbers or numbers with 91 country code.</span>
                {rawRecipients && (
                  <button
                    type="button"
                    onClick={() => setRawRecipients('')}
                    className="font-semibold text-red-500 hover:underline"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Card 2: Select Template */}
          <div className="rounded-xl border p-5 surface-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Tag size={18} className="text-emerald-600" />
                <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  2. Choose Message Template
                </h2>
              </div>
              <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                Click any template to load
              </span>
            </div>

            {/* Category Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all', label: 'All Templates' },
                { id: 'customer', label: 'Customer App' },
                { id: 'driver', label: 'Driver Onboarding' },
                { id: 'sales', label: 'Sales Follow-up' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    categoryFilter === cat.id
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'border hover:bg-[var(--surface-raised)]'
                  }`}
                  style={
                    categoryFilter === cat.id
                      ? {}
                      : { borderColor: 'var(--border)', color: 'var(--ink-muted)' }
                  }
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Templates Grid */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {filteredTemplates.map((tpl) => {
                const isSelected = selectedTemplateId === tpl.id
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleSelectTemplate(tpl)}
                    className={`flex flex-col text-left rounded-xl border p-3 transition-all ${
                      isSelected
                        ? 'border-emerald-500 bg-emerald-500/5 ring-1 ring-emerald-500'
                        : 'hover:border-slate-400/50'
                    }`}
                    style={
                      isSelected
                        ? {}
                        : { borderColor: 'var(--border)', background: 'var(--surface)' }
                    }
                  >
                    <div className="flex items-center justify-between w-full gap-1">
                      <span className="text-xs font-bold truncate" style={{ color: 'var(--ink)' }}>
                        {tpl.title}
                      </span>
                      {isSelected && <Check size={14} className="text-emerald-600 shrink-0" />}
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {tpl.is_customized && (
                        <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                          ✏️ Saved Custom
                        </span>
                      )}
                      {tpl.media_url && (
                        <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-400 flex items-center gap-1">
                          {tpl.media_type === 'video' ? <Film size={10} /> : <ImageIcon size={10} />}
                          {tpl.media_type === 'video' ? 'Video' : 'Image'}
                        </span>
                      )}
                    </div>

                    <p className="mt-1 line-clamp-2 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {tpl.description}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Card 3: Message Text Editor with Permanent Template Management */}
          <div className="rounded-xl border p-5 surface-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-emerald-600" />
                <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  3. Customize Message Text
                </h2>
              </div>
              <div className="flex items-center gap-2 text-[11.5px]">
                {hasUnsavedEdits && (
                  <span className="rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-400">
                    ● Temporary Edits
                  </span>
                )}
                <span style={{ color: 'var(--ink-muted)' }}>
                  {messageText.length} / 2000 chars
                </span>
              </div>
            </div>

            <div>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Campaign / Label name (e.g. Driver Signup Follow-up)"
                className="mb-2 w-full rounded-lg border px-3 py-2 text-xs font-medium outline-none"
                style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
              />

              <textarea
                rows={8}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type or edit message text... (Or leave empty if sending media-only)"
                className="w-full rounded-lg border p-3 text-xs outline-none transition-colors focus:border-emerald-500"
                style={{ background: 'var(--surface)', color: 'var(--ink)', borderColor: 'var(--border)' }}
              />
            </div>

            {/* Template Actions Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
              <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                Tip: Formatting: <code>*bold*</code>, <code>_italic_</code>, and line breaks.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {/* Reset to Saved Version */}
                {selectedTemplateId && (
                  <button
                    type="button"
                    onClick={handleResetToSavedTemplate}
                    disabled={!hasUnsavedEdits}
                    className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-raised)] disabled:opacity-40"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    title="Discard temporary edits and revert to the saved database template"
                  >
                    <RotateCcw size={13} />
                    Reset to Saved
                  </button>
                )}

                {/* Reset to Factory Default (if customized) */}
                {selectedTemplateId && currentTemplate?.is_customized && canEditPermanentTemplate && (
                  <button
                    type="button"
                    onClick={handleResetToFactoryDefault}
                    disabled={resettingTemplate}
                    className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-40"
                    title="Remove custom overrides and restore factory default template"
                  >
                    <RefreshCw size={13} className={resettingTemplate ? 'animate-spin' : ''} />
                    Factory Default
                  </button>
                )}

                {/* Save Template Permanently */}
                {canEditPermanentTemplate && selectedTemplateId && (
                  <button
                    type="button"
                    onClick={handleSaveTemplate}
                    disabled={savingTemplate || !selectedTemplateId}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40"
                    title="Permanently save current text and attached media to this template in database"
                  >
                    <Save size={14} className={savingTemplate ? 'animate-spin' : ''} />
                    {savingTemplate ? 'Saving...' : 'Save Template'}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Card 4: Media Attachments (Images & Videos) */}
          <div className="rounded-xl border p-5 surface-card space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon size={18} className="text-emerald-600" />
                <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                  4. Media Attachment (Image / Video)
                </h2>
              </div>
              <span className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                Optional • Supported: JPG, PNG, WEBP (10MB), MP4, 3GP, MOV (16MB)
              </span>
            </div>

            {/* If no attachment: show upload buttons */}
            {!attachment ? (
              <div className="rounded-xl border border-dashed p-6 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                  <Upload size={22} className={uploadingMedia ? 'animate-bounce' : ''} />
                </div>
                <h3 className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
                  {uploadingMedia ? 'Uploading media to Cloudinary...' : 'Attach an Image or Video to your WhatsApp message'}
                </h3>
                <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                  Media is delivered directly into recipient&apos;s WhatsApp with your message as a caption.
                </p>

                <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                  <button
                    type="button"
                    disabled={uploadingMedia}
                    onClick={() => imageInputRef.current?.click()}
                    className="flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold transition-colors hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  >
                    <ImageIcon size={15} className="text-emerald-600" />
                    Add Image (Max 10MB)
                  </button>
                  <button
                    type="button"
                    disabled={uploadingMedia}
                    onClick={() => videoInputRef.current?.click()}
                    className="flex items-center gap-2 rounded-lg border px-4 py-2 text-xs font-bold transition-colors hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                  >
                    <Video size={15} className="text-blue-600" />
                    Add Video (Max 16MB)
                  </button>
                </div>
              </div>
            ) : (
              /* If attachment exists: Preview & Management Box */
              <div className="rounded-xl border p-4 space-y-3" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                      {attachment.type === 'video' ? <Film size={20} /> : <ImageIcon size={20} />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold truncate max-w-[220px] sm:max-w-xs" style={{ color: 'var(--ink)' }}>
                          {attachment.name || 'Attached Media'}
                        </span>
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">
                          {attachment.type}
                        </span>
                      </div>
                      {attachment.size && (
                        <div className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                          {formatBytes(attachment.size)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (attachment.type === 'video') {
                          videoInputRef.current?.click()
                        } else {
                          imageInputRef.current?.click()
                        }
                      }}
                      className="rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-[var(--surface-raised)]"
                      style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => setAttachment(null)}
                      className="flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-500/10"
                      title="Remove media attachment"
                    >
                      <Trash2 size={13} />
                      Remove
                    </button>
                  </div>
                </div>

                {/* Media Preview Box */}
                <div className="overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                  {attachment.type === 'video' ? (
                    <video
                      src={attachment.url}
                      controls
                      className="max-h-60 w-full bg-black object-contain"
                    />
                  ) : (
                    <img
                      src={attachment.url}
                      alt="Attached preview"
                      className="max-h-60 w-full bg-slate-900/5 object-contain"
                    />
                  )}
                </div>

                <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  💡 <strong>Tip:</strong> You can broadcast this media once, or click <strong>&quot;Save Template&quot;</strong> in Section 3 to store this media with the template permanently!
                </p>
              </div>
            )}
          </div>

          {/* Action Card: Dispatch Broadcast */}
          <div className="flex items-center justify-between rounded-xl border p-4 surface-card">
            <div>
              <div className="text-xs font-bold" style={{ color: 'var(--ink)' }}>
                Ready to Dispatch?
              </div>
              <div className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                {parsedRecipients.length} recipient{parsedRecipients.length === 1 ? '' : 's'} •{' '}
                {attachment ? `Attached: ${attachment.type.toUpperCase()}` : 'Text only'} •{' '}
                {parsedRecipients.length > 1
                  ? `~${(parsedRecipients.length * 1.2).toFixed(1)}s safe anti-ban delay`
                  : 'Immediate'}
              </div>
            </div>

            <button
              type="button"
              disabled={
                sending ||
                parsedRecipients.length === 0 ||
                (!messageText.trim() && !attachment?.url) ||
                !isConnected ||
                !canSend
              }
              onClick={() => {
                if (parsedRecipients.length > 1) {
                  setShowConfirmModal(true)
                } else {
                  executeBroadcast()
                }
              }}
              className="flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-md transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Send size={15} className={sending ? 'animate-bounce' : ''} />
              {sending ? 'Sending WhatsApp...' : `Send Broadcast (${parsedRecipients.length || 0})`}
            </button>
          </div>
        </div>

        {/* Right Column: Live WhatsApp Mobile Preview (5 cols) */}
        <div className="space-y-4 xl:col-span-5">
          <div className="sticky top-6">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                📱 Live WhatsApp Preview
              </span>
              <span className="text-[11px] text-emerald-600 font-semibold">
                Customer / Driver View
              </span>
            </div>

            {/* Mobile Mockup Container */}
            <div
              className="mx-auto max-w-sm rounded-[32px] border-4 border-slate-800 shadow-2xl overflow-hidden"
              style={{ background: '#ECE5DD' }}
            >
              {/* WhatsApp App Header */}
              <div className="flex items-center gap-3 bg-[#075E54] px-4 py-3 text-white">
                <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 font-bold text-emerald-800">
                  <img
                    src="/logo.png"
                    alt="Shifter"
                    className="h-full w-full rounded-full object-cover"
                    onError={(e) => {
                      e.target.style.display = 'none'
                    }}
                  />
                  <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-[#075E54]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 font-bold text-sm truncate">
                    Shifter Online Bot
                    <CheckCircle2 size={13} className="text-emerald-300" />
                  </div>
                  <div className="text-[11px] text-emerald-200">Official Business Account</div>
                </div>
              </div>

              {/* Chat Canvas */}
              <div className="p-3.5 space-y-3 min-h-[460px] max-h-[580px] overflow-y-auto">
                <div className="flex justify-center">
                  <span className="rounded-md bg-white/70 px-2.5 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm backdrop-blur-xs">
                    TODAY
                  </span>
                </div>

                {/* WhatsApp Message Bubble with optional Media Preview */}
                <div className="flex flex-col items-start">
                  <div className="relative max-w-[94%] rounded-xl rounded-tl-none bg-white p-2.5 text-xs leading-relaxed text-slate-900 shadow-md">
                    {/* Media Preview inside WhatsApp Bubble */}
                    {attachment && attachment.type === 'image' && (
                      <div className="mb-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                        <img
                          src={attachment.url}
                          alt="Attachment preview"
                          className="max-h-52 w-full object-cover"
                          onError={(e) => {
                            e.target.style.display = 'none'
                          }}
                        />
                      </div>
                    )}

                    {attachment && attachment.type === 'video' && (
                      <div className="mb-2 overflow-hidden rounded-lg border border-slate-300 bg-slate-950 text-white">
                        <video
                          src={attachment.url}
                          controls
                          className="max-h-52 w-full"
                        />
                        <div className="flex items-center gap-1.5 p-1 text-[10px] text-slate-300">
                          <Play size={11} className="text-emerald-400" />
                          <span className="truncate">{attachment.name || 'Video attachment'}</span>
                        </div>
                      </div>
                    )}

                    {/* Message / Caption Text */}
                    <div className="whitespace-pre-line break-words px-1">
                      {messageText ? (
                        messageText
                      ) : attachment ? (
                        <span className="italic text-slate-400">(Media only message)</span>
                      ) : (
                        <span className="italic text-slate-400">
                          Select a template or type your message to see a live preview here...
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                      <span>Just now</span>
                      <span className="font-bold text-sky-500">✓✓</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom Chat Bar Mockup */}
              <div className="flex items-center gap-2 bg-[#F0F2F5] px-3 py-2.5 border-t border-slate-300">
                <div className="flex-1 rounded-full bg-white px-3.5 py-1.5 text-xs text-slate-400 shadow-inner">
                  Message...
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#00A884] text-white shadow-sm">
                  <Send size={13} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border p-6 surface-card shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <Send size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold" style={{ color: 'var(--ink)' }}>
                  Confirm WhatsApp Broadcast
                </h3>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  You are about to dispatch this campaign to multiple recipients.
                </p>
              </div>
            </div>

            <div className="rounded-xl border p-3.5 text-xs space-y-2" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-muted)' }}>Campaign:</span>
                <span className="font-semibold" style={{ color: 'var(--ink)' }}>{campaignName || 'General Outreach'}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-muted)' }}>Total Recipients:</span>
                <span className="font-bold text-emerald-600">{parsedRecipients.length} phone numbers</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-muted)' }}>Attachment:</span>
                <span className="font-semibold" style={{ color: 'var(--ink)' }}>
                  {attachment ? `${attachment.type.toUpperCase()}: ${attachment.name || 'Attached'}` : 'None (Text Only)'}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--ink-muted)' }}>Anti-Ban Pacing:</span>
                <span>~1.2 seconds delay per message</span>
              </div>
            </div>

            <p className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
              ⚠️ The bot will pace the delivery sequentially so that WhatsApp socket rules remain safe and healthy.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="rounded-lg border px-4 py-2 text-xs font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeBroadcast}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-xs font-bold text-white transition-opacity hover:opacity-90"
              >
                Start Broadcast Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dispatch Results Summary Card */}
      {dispatchResult && (
        <div className="rounded-xl border p-5 surface-card space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-600" />
              <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                Broadcast Summary Report
              </h2>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <span className="text-emerald-600">✅ {dispatchResult.sent} Sent</span>
              <span className="text-red-500">❌ {dispatchResult.failed} Failed</span>
              <span style={{ color: 'var(--ink-muted)' }}>Total: {dispatchResult.total}</span>
            </div>
          </div>

          <div className="max-h-48 overflow-y-auto divide-y rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            {dispatchResult.results?.map((res, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-3.5 py-2 text-xs"
                style={{ background: 'var(--surface)' }}
              >
                <div className="flex items-center gap-2 font-mono">
                  <Phone size={13} style={{ color: 'var(--ink-muted)' }} />
                  <span style={{ color: 'var(--ink)' }}>+{res.phone}</span>
                </div>
                {res.status === 'sent' ? (
                  <span className="flex items-center gap-1 font-semibold text-emerald-600">
                    <Check size={13} /> Delivered
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-semibold text-red-500">
                    <AlertCircle size={13} /> {res.reason || 'Failed'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

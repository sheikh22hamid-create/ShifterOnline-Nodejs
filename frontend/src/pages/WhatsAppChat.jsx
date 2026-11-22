import { useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  MessageSquare,
  Send,
  Paperclip,
  Search,
  User,
  Clock,
  CheckCheck,
  Check,
  Plus,
  RefreshCw,
  AlertCircle,
  Sparkles,
  Phone,
  Image as ImageIcon,
  Video as VideoIcon,
  X,
  ShieldCheck,
  ExternalLink,
  Radio,
} from 'lucide-react'
import api from '../services/api'
import { useSocket } from '../context/SocketContext'
import { useAuth } from '../context/AuthContext'

function formatTime(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatDate(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) return 'Today'
  const yest = new Date()
  yest.setDate(today.getDate() - 1)
  if (d.toDateString() === yest.toDateString()) return 'Yesterday'
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatCountdown(seconds) {
  if (!seconds || seconds <= 0) return '0h 0m'
  const hrs = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  return `${hrs}h ${mins}m left`
}

export default function WhatsAppChat() {
  const { user } = useAuth()
  const { socket } = useSocket()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const queryPhone = searchParams.get('phone')

  const [threads, setThreads] = useState([])
  const [selectedPhone, setSelectedPhone] = useState(null)
  const [activeThread, setActiveThread] = useState(null)
  const [messages, setMessages] = useState([])
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sending, setSending] = useState(false)

  // Filters & search
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState('all')

  // Composer
  const [inputText, setInputText] = useState('')
  const [mediaAttachment, setMediaAttachment] = useState(null) // { url, type, name }
  const [uploadingMedia, setUploadingMedia] = useState(false)

  // Templates
  const [templates, setTemplates] = useState([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [showTemplateModal, setShowTemplateModal] = useState(false)

  // New Chat Modal
  const [showNewChatModal, setShowNewChatModal] = useState(false)
  const [newChatPhone, setNewChatPhone] = useState('')
  const [newChatTemplate, setNewChatTemplate] = useState('')

  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  // Load Templates
  useEffect(() => {
    api
      .get('/whatsapp/templates')
      .then((res) => {
        if (res.data?.data) {
          setTemplates(res.data.data)
        }
      })
      .catch((err) => console.error('Failed to load templates:', err))
  }, [])

  // Load Threads
  const loadThreads = useCallback(async () => {
    try {
      setLoadingThreads(true)
      const res = await api.get('/whatsapp/chat/threads', {
        params: { search: searchQuery || undefined, type: filterType },
      })
      const data = res.data?.data || []
      setThreads(data)

      // If query phone supplied in URL and not yet selected, select it
      if (queryPhone && !selectedPhone) {
        const found = data.find((t) => t.phone === queryPhone || t.phone.endsWith(queryPhone.slice(-10)))
        if (found) {
          setSelectedPhone(found.phone)
        } else {
          // If not in thread list, set it anyway to allow starting conversation
          setSelectedPhone(queryPhone)
        }
      } else if (!selectedPhone && data.length > 0) {
        setSelectedPhone(data[0].phone)
      }
    } catch (err) {
      console.error('Failed to load chat threads:', err)
    } finally {
      setLoadingThreads(false)
    }
  }, [searchQuery, filterType, queryPhone, selectedPhone])

  useEffect(() => {
    loadThreads()
  }, [loadThreads])

  // Load Messages for Selected Phone
  const loadMessages = useCallback(async (phone) => {
    if (!phone) return
    try {
      setLoadingMessages(true)
      const res = await api.get(`/whatsapp/chat/threads/${phone}/messages`)
      const data = res.data?.data
      if (data) {
        setActiveThread(data.thread)
        setMessages(data.messages || [])
        // Clear unread on thread in state
        setThreads((prev) =>
          prev.map((t) => (t.phone === phone ? { ...t, unread_count: 0 } : t))
        )
      }
    } catch (err) {
      console.error('Failed to load messages for phone:', phone, err)
    } finally {
      setLoadingMessages(false)
      setTimeout(scrollToBottom, 150)
    }
  }, [])

  useEffect(() => {
    if (selectedPhone) {
      loadMessages(selectedPhone)
    }
  }, [selectedPhone, loadMessages])

  // Socket listeners for real-time messages
  useEffect(() => {
    if (!socket) return

    const handleNewMessage = ({ message, thread }) => {
      // Update thread list
      setThreads((prev) => {
        const index = prev.findIndex((t) => t.phone === thread.phone)
        if (index > -1) {
          const updated = [...prev]
          updated[index] = {
            ...updated[index],
            ...thread,
            unread_count:
              thread.phone === selectedPhone ? 0 : (updated[index].unread_count || 0) + 1,
          }
          // Move to top
          const [item] = updated.splice(index, 1)
          return [item, ...updated]
        } else {
          return [thread, ...prev]
        }
      })

      // If active thread is currently viewing this sender, append message
      if (selectedPhone && (thread.phone === selectedPhone || message.phone === selectedPhone)) {
        setMessages((prev) => [...prev, message])
        setActiveThread((prev) => (prev ? { ...prev, ...thread } : thread))
        setTimeout(scrollToBottom, 100)
      }
    }

    const handleMessageSent = ({ message, phone }) => {
      if (selectedPhone && (selectedPhone === phone || message.phone === selectedPhone)) {
        setMessages((prev) => [...prev, message])
        setTimeout(scrollToBottom, 100)
      }
      setThreads((prev) => {
        const index = prev.findIndex((t) => t.phone === phone)
        if (index > -1) {
          const updated = [...prev]
          updated[index] = {
            ...updated[index],
            last_message: message.body,
            last_message_at: message.created_at,
          }
          return updated
        }
        return prev
      })
    }

    const handleStatusUpdate = ({ message_id, status }) => {
      setMessages((prev) =>
        prev.map((m) => (m.message_id === message_id ? { ...m, status } : m))
      )
    }

    socket.on('whatsapp:new_message', handleNewMessage)
    socket.on('whatsapp:message_sent', handleMessageSent)
    socket.on('whatsapp:status_update', handleStatusUpdate)

    return () => {
      socket.off('whatsapp:new_message', handleNewMessage)
      socket.off('whatsapp:message_sent', handleMessageSent)
      socket.off('whatsapp:status_update', handleStatusUpdate)
    }
  }, [socket, selectedPhone])

  // Media upload handler
  const handleMediaUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    const isVideo = file.type.startsWith('video/')
    const maxMb = isVideo ? 16 : 10
    if (file.size > maxMb * 1024 * 1024) {
      alert(`File too large. Maximum size for ${isVideo ? 'video is 16MB' : 'image is 10MB'}.`)
      return
    }

    try {
      setUploadingMedia(true)
      const formData = new FormData()
      formData.append('media', file)
      const res = await api.post('/whatsapp/upload-media', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (res.data?.success && res.data.mediaUrl) {
        setMediaAttachment({
          url: res.data.mediaUrl,
          type: res.data.mediaType || (isVideo ? 'video/mp4' : 'image/jpeg'),
          name: file.name,
        })
      }
    } catch (err) {
      console.error('Media upload failed:', err)
      alert(err.response?.data?.message || 'Failed to upload media file')
    } finally {
      setUploadingMedia(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // Send Message
  const handleSend = async (e) => {
    e?.preventDefault()
    if (!selectedPhone) return
    if (!inputText.trim() && !mediaAttachment && !selectedTemplate) return

    try {
      setSending(true)
      const payload = {
        phone: selectedPhone,
        text: inputText.trim() || undefined,
        mediaUrl: mediaAttachment?.url,
        mediaType: mediaAttachment?.type,
      }

      // If window is closed or template selected
      if (selectedTemplate) {
        payload.isTemplate = true
        payload.templateName = selectedTemplate
        const tplObj = templates.find((t) => t.id === selectedTemplate)
        if (tplObj) {
          payload.text = tplObj.message
        }
      }

      await api.post('/whatsapp/chat/send', payload)

      // Reset input
      setInputText('')
      setMediaAttachment(null)
      setSelectedTemplate('')
      setShowTemplateModal(false)
      setTimeout(scrollToBottom, 100)
    } catch (err) {
      console.error('Failed to send message:', err)
      alert(err.response?.data?.message || 'Failed to deliver message via WhatsApp')
    } finally {
      setSending(false)
    }
  }

  // Start New Chat Handler
  const handleStartNewChat = async (e) => {
    e.preventDefault()
    if (!newChatPhone.trim()) return

    const clean = newChatPhone.replace(/\D/g, '')
    if (clean.length < 10) {
      alert('Please enter a valid 10-digit mobile number')
      return
    }

    const formatted = clean.length === 10 ? `91${clean}` : clean

    // If template selected, send first message
    if (newChatTemplate) {
      try {
        setSending(true)
        const tplObj = templates.find((t) => t.id === newChatTemplate)
        await api.post('/whatsapp/chat/send', {
          phone: formatted,
          isTemplate: true,
          templateName: newChatTemplate,
          text: tplObj?.message,
        })
      } catch (err) {
        alert(err.response?.data?.message || 'Failed to send template to new contact')
        setSending(false)
        return
      } finally {
        setSending(false)
      }
    }

    setShowNewChatModal(false)
    setNewChatPhone('')
    setNewChatTemplate('')
    setSelectedPhone(formatted)
    loadThreads()
  }

  const isWindowActive = Boolean(activeThread?.is_window_active ?? true)
  const windowRemaining = activeThread?.time_remaining_seconds || 0

  const displayMessages =
    messages.length > 0
      ? messages
      : activeThread?.last_message
      ? [
          {
            id: 'last_msg',
            phone: selectedPhone,
            sender_name: activeThread.contact_name,
            direction: 'inbound',
            message_type: 'text',
            body: activeThread.last_message,
            created_at: activeThread.last_message_at,
            status: 'delivered',
          },
        ]
      : []

  return (
    <div className="flex h-[calc(100vh-80px)] flex-col bg-[var(--bg)] text-[var(--ink)]">
      {/* Top Header */}
      <div className="flex items-center justify-between border-b px-5 py-3 surface-card">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600">
            <MessageSquare size={22} />
          </div>
          <div>
            <h1 className="text-base font-bold flex items-center gap-2">
              WhatsApp Live Chat & Inbox
              <span className="flex items-center gap-1 text-[11px] font-semibold bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-full">
                <Radio size={12} className="animate-pulse" /> Meta Cloud API
              </span>
            </h1>
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Real-time 2-way messaging with customers and drivers • Official WhatsApp Business Platform
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowNewChatModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow-xs transition-opacity hover:opacity-90"
          >
            <Plus size={15} /> New Chat
          </button>
          <button
            onClick={() => navigate('/marketing/whatsapp-broadcast')}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-[var(--surface-raised)]"
            style={{ borderColor: 'var(--border)' }}
          >
            <Sparkles size={14} className="text-amber-500" /> Outreach & Broadcast
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Column: Threads List */}
        <div className="flex w-80 sm:w-96 flex-col border-r surface-card" style={{ borderColor: 'var(--border)' }}>
          {/* Search & Tabs */}
          <div className="p-3 border-b space-y-2.5" style={{ borderColor: 'var(--border)' }}>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search name or phone..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border pl-9 pr-3 py-1.5 text-xs outline-none focus:border-emerald-500"
                style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
              />
            </div>

            <div className="flex items-center gap-1 text-xs">
              {['all', 'customer', 'driver', 'guest'].map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={`capitalize px-2.5 py-1 rounded-md text-[11.5px] font-medium transition-colors ${
                    filterType === type
                      ? 'bg-emerald-600 text-white'
                      : 'hover:bg-[var(--surface-raised)]'
                  }`}
                  style={filterType !== type ? { color: 'var(--ink-muted)' } : {}}
                >
                  {type === 'all' ? 'All' : `${type}s`}
                </button>
              ))}
            </div>
          </div>

          {/* Threads Scroll Area */}
          <div className="flex-1 overflow-y-auto divide-y" style={{ borderColor: 'var(--border)' }}>
            {loadingThreads ? (
              <div className="p-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
                <RefreshCw size={18} className="mx-auto mb-2 animate-spin text-emerald-600" />
                Loading conversations...
              </div>
            ) : threads.length === 0 ? (
              <div className="p-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
                <MessageSquare size={28} className="mx-auto mb-2 text-slate-400 opacity-60" />
                No conversation threads found.
                <div className="mt-2">
                  <button
                    onClick={() => setShowNewChatModal(true)}
                    className="text-emerald-600 hover:underline font-semibold"
                  >
                    Start a new conversation
                  </button>
                </div>
              </div>
            ) : (
              threads.map((thread) => {
                const isSelected = selectedPhone === thread.phone
                const active = Boolean(thread.is_window_active)
                return (
                  <div
                    key={thread.phone}
                    onClick={() => setSelectedPhone(thread.phone)}
                    className={`flex items-start gap-3 p-3.5 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-emerald-500/10 border-l-4 border-l-emerald-600'
                        : 'hover:bg-[var(--surface-raised)]'
                    }`}
                  >
                    {/* Avatar with Session indicator dot */}
                    <div className="relative shrink-0">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 font-bold text-xs uppercase">
                        {thread.contact_name ? thread.contact_name.slice(0, 2) : <User size={18} />}
                      </div>
                      <span
                        title={active ? '24h session active' : '24h session closed'}
                        className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-slate-800 ${
                          active ? 'bg-emerald-500' : 'bg-slate-400'
                        }`}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold truncate" style={{ color: 'var(--ink)' }}>
                          {thread.contact_name || thread.phone}
                        </h3>
                        <span className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                          {formatTime(thread.last_message_at)}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-[10.5px] text-slate-400 truncate">
                          +{thread.phone}
                        </span>
                        {thread.user_type === 'customer' && (
                          <span className="rounded bg-sky-500/15 px-1.5 py-0.2 text-[9.5px] font-semibold text-sky-700 dark:text-sky-400">
                            Customer
                          </span>
                        )}
                        {thread.user_type === 'driver' && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[9.5px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Driver
                          </span>
                        )}
                      </div>

                      <div className="flex items-center justify-between mt-1">
                        <p className="text-[11.5px] truncate max-w-[190px]" style={{ color: 'var(--ink-muted)' }}>
                          {thread.last_message || 'No messages yet'}
                        </p>
                        {thread.unread_count > 0 && (
                          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-600 px-1 text-[10px] font-bold text-white">
                            {thread.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Right Column: Chat Window */}
        <div className="flex flex-1 flex-col bg-[var(--bg)]">
          {selectedPhone ? (
            <>
              {/* Chat Top Header */}
              <div className="flex items-center justify-between border-b px-5 py-3 surface-card" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-sm uppercase shadow-xs">
                    {activeThread?.contact_name ? activeThread.contact_name.slice(0, 2) : <User size={18} />}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                        {activeThread?.contact_name || selectedPhone}
                      </h2>
                      <span className="font-mono text-xs text-slate-400">+{selectedPhone}</span>
                      {activeThread?.user_type === 'customer' && (
                        <span className="rounded bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-400">
                          Customer {activeThread.user_id ? `#${activeThread.user_id}` : ''}
                        </span>
                      )}
                      {activeThread?.user_type === 'driver' && (
                        <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                          Driver {activeThread.user_id ? `#${activeThread.user_id}` : ''}
                        </span>
                      )}
                    </div>

                    {/* 24-Hour Session Banner */}
                    <div className="flex items-center gap-1.5 mt-0.5 text-[11px]">
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                        24h Session Active • Manual messaging enabled
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => loadMessages(selectedPhone)}
                    title="Refresh Chat"
                    className="p-2 rounded-lg border hover:bg-[var(--surface-raised)] text-slate-400 transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <RefreshCw size={15} />
                  </button>
                  {activeThread?.user_type === 'customer' && activeThread.user_id && (
                    <button
                      onClick={() => navigate(`/customers?search=${selectedPhone}`)}
                      className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium"
                    >
                      <ExternalLink size={13} /> View Customer
                    </button>
                  )}
                  {activeThread?.user_type === 'driver' && activeThread.user_id && (
                    <button
                      onClick={() => navigate(`/drivers?search=${selectedPhone}`)}
                      className="flex items-center gap-1 text-xs text-emerald-600 hover:underline font-medium"
                    >
                      <ExternalLink size={13} /> View Driver
                    </button>
                  )}
                </div>
              </div>

              {/* Messages Area */}
              <div
                className="flex-1 overflow-y-auto p-5 space-y-3.5 bg-slate-50/60 dark:bg-slate-950/40"
                style={{
                  backgroundImage:
                    'radial-gradient(rgba(0, 0, 0, 0.04) 1px, transparent 1px)',
                  backgroundSize: '16px 16px',
                }}
              >
                {loadingMessages ? (
                  <div className="p-8 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
                    <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-emerald-600" />
                    Loading conversation...
                  </div>
                ) : displayMessages.length === 0 ? (
                  <div className="p-12 text-center text-xs" style={{ color: 'var(--ink-muted)' }}>
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
                      <Sparkles size={24} />
                    </div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--ink)' }}>
                      No messages yet with +{selectedPhone}
                    </p>
                    <p className="mt-1">
                      Type a message below to start chatting directly via Meta Cloud API.
                    </p>
                  </div>
                ) : (
                  displayMessages.map((msg, index) => {
                    const isOutbound = msg.direction === 'outbound'
                    return (
                      <div
                        key={msg.id || index}
                        className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[75%] sm:max-w-[65%] rounded-2xl p-3 shadow-xs text-xs space-y-1.5 ${
                            isOutbound
                              ? 'bg-emerald-600 text-white rounded-tr-xs'
                              : 'surface-card text-[var(--ink)] border rounded-tl-xs'
                          }`}
                          style={!isOutbound ? { borderColor: 'var(--border)' } : {}}
                        >
                          {/* Sender Label */}
                          <div
                            className={`flex items-center justify-between gap-3 text-[10px] font-semibold ${
                              isOutbound ? 'text-emerald-100' : 'text-slate-400'
                            }`}
                          >
                            <span>{isOutbound ? msg.admin_name || 'Admin' : msg.sender_name || 'User'}</span>
                            {msg.is_template && (
                              <span className="rounded bg-black/20 px-1 py-0.2 text-[9px] uppercase tracking-wider">
                                Template
                              </span>
                            )}
                          </div>

                          {/* Media if present */}
                          {msg.media_url && (
                            <div className="rounded-lg overflow-hidden border border-black/10 mt-1">
                              {msg.media_type?.startsWith('video') ? (
                                <video src={msg.media_url} controls className="max-h-56 w-full rounded" />
                              ) : (
                                <img
                                  src={msg.media_url}
                                  alt="attachment"
                                  className="max-h-64 w-full object-cover rounded cursor-pointer"
                                  onClick={() => window.open(msg.media_url, '_blank')}
                                />
                              )}
                            </div>
                          )}

                          {/* Body Text */}
                          {msg.body && (
                            <p className="whitespace-pre-wrap leading-relaxed text-[12.5px]">
                              {msg.body}
                            </p>
                          )}

                          {/* Timestamp & Status Checkmarks */}
                          <div
                            className={`flex items-center justify-end gap-1 text-[10px] pt-0.5 ${
                              isOutbound ? 'text-emerald-100' : 'text-slate-400'
                            }`}
                          >
                            <span>{formatTime(msg.created_at)}</span>
                            {isOutbound && (
                              <span>
                                {msg.status === 'read' ? (
                                  <CheckCheck size={14} className="text-sky-300" />
                                ) : msg.status === 'delivered' ? (
                                  <CheckCheck size={14} />
                                ) : msg.status === 'failed' ? (
                                  <AlertCircle size={13} className="text-red-300" />
                                ) : (
                                  <Check size={13} />
                                )}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer / Input Area */}
              <div className="border-t p-3.5 surface-card space-y-2" style={{ borderColor: 'var(--border)' }}>
                {/* Media Attachment Pill */}
                {mediaAttachment && (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-300 border border-emerald-500/20">
                    <div className="flex items-center gap-2 truncate">
                      {mediaAttachment.type.startsWith('video') ? <VideoIcon size={16} /> : <ImageIcon size={16} />}
                      <span className="truncate">{mediaAttachment.name}</span>
                    </div>
                    <button
                      onClick={() => setMediaAttachment(null)}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}

                {/* Template Selected Banner */}
                {selectedTemplate && (
                  <div className="flex items-center justify-between rounded-lg bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-800 dark:text-emerald-300 border border-emerald-500/20">
                    <div className="flex items-center gap-2 truncate">
                      <Sparkles size={16} />
                      <span className="font-semibold">Template selected: {templates.find(t => t.id === selectedTemplate)?.title || selectedTemplate}</span>
                    </div>
                    <button
                      onClick={() => {
                        setSelectedTemplate('')
                        setInputText('')
                      }}
                      className="text-slate-400 hover:text-red-500 transition-colors"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}

                <form onSubmit={handleSend} className="flex items-end gap-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*,video/*"
                    onChange={handleMediaUpload}
                    className="hidden"
                  />

                  {/* Attachment Button */}
                  <button
                    type="button"
                    disabled={uploadingMedia}
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach Image or Video"
                    className="p-2.5 rounded-xl border hover:bg-[var(--surface-raised)] text-slate-400 transition-colors disabled:opacity-30"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {uploadingMedia ? (
                      <RefreshCw size={18} className="animate-spin text-emerald-600" />
                    ) : (
                      <Paperclip size={18} />
                    )}
                  </button>

                  {/* Template Picker Trigger */}
                  <button
                    type="button"
                    onClick={() => setShowTemplateModal(true)}
                    title="Choose Approved Template"
                    className="flex items-center gap-1 px-3 py-2.5 rounded-xl border hover:bg-[var(--surface-raised)] text-xs font-semibold text-emerald-600 transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <Sparkles size={16} />
                    <span className="hidden sm:inline">Templates</span>
                  </button>

                  {/* Input Box */}
                  <div className="flex-1 relative">
                    <textarea
                      rows={1}
                      disabled={sending}
                      placeholder="Type a manual message here (Enter to send, Shift+Enter for new line)..."
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          handleSend()
                        }
                      }}
                      className="w-full resize-none rounded-xl border p-2.5 text-xs outline-none focus:border-emerald-500 disabled:opacity-50"
                      style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                    />
                  </div>

                  {/* Send Button */}
                  <button
                    type="submit"
                    disabled={sending || (!inputText.trim() && !mediaAttachment && !selectedTemplate)}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {sending ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-xs text-slate-400">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 mb-3">
                <MessageSquare size={32} />
              </div>
              <h2 className="text-sm font-bold" style={{ color: 'var(--ink)' }}>
                Select a conversation
              </h2>
              <p className="mt-1 max-w-sm" style={{ color: 'var(--ink-muted)' }}>
                Choose a customer or driver from the list on the left, or click &quot;New Chat&quot; to initiate a conversation with any phone number.
              </p>
              <button
                onClick={() => setShowNewChatModal(true)}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-xs transition-opacity hover:opacity-90"
              >
                <Plus size={15} /> Start New Chat
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Template Selection Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border p-5 surface-card space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-emerald-600" />
                <h3 className="text-sm font-bold">Select Approved WhatsApp Template</h3>
              </div>
              <button onClick={() => setShowTemplateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              Choose a Meta-approved template to deliver outside the 24-hr session window.
            </p>

            <div className="max-h-72 overflow-y-auto space-y-2">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  onClick={() => {
                    setSelectedTemplate(tpl.id)
                    setInputText(tpl.message)
                    setShowTemplateModal(false)
                  }}
                  className={`p-3 rounded-xl border cursor-pointer transition-colors ${
                    selectedTemplate === tpl.id
                      ? 'border-emerald-600 bg-emerald-500/10'
                      : 'hover:bg-[var(--surface-raised)]'
                  }`}
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs" style={{ color: 'var(--ink)' }}>
                      {tpl.title}
                    </span>
                    <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-500/15 px-2 py-0.5 rounded">
                      {tpl.categoryLabel || tpl.category}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] line-clamp-2" style={{ color: 'var(--ink-muted)' }}>
                    {tpl.message}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setShowTemplateModal(false)}
                className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: 'var(--border)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border p-5 surface-card space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <Plus size={18} className="text-emerald-600" />
                <h3 className="text-sm font-bold">Start New WhatsApp Conversation</h3>
              </div>
              <button onClick={() => setShowNewChatModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleStartNewChat} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--ink)' }}>
                  Recipient Mobile Number (10 Digits)
                </label>
                <div className="flex items-center rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                  <span className="text-xs font-bold text-slate-400 mr-2">+91</span>
                  <input
                    type="tel"
                    required
                    maxLength={10}
                    placeholder="9876543210"
                    value={newChatPhone}
                    onChange={(e) => setNewChatPhone(e.target.value.replace(/\D/g, ''))}
                    className="w-full text-xs font-mono outline-none bg-transparent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--ink)' }}>
                  First Message Template (Meta Requirement for New Contacts)
                </label>
                <select
                  value={newChatTemplate}
                  onChange={(e) => setNewChatTemplate(e.target.value)}
                  className="w-full rounded-lg border p-2 text-xs outline-none"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
                >
                  <option value="">Open conversation without sending template</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      {tpl.title} ({tpl.categoryLabel})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Since this is a new number, sending an approved template will invite the customer/driver to reply and open their 24h window.
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setShowNewChatModal(false)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium"
                  style={{ borderColor: 'var(--border)' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newChatPhone || newChatPhone.length < 10 || sending}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {sending ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                  Open Chat
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

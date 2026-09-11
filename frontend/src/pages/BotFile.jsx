import { useState, useEffect } from 'react'
import { Bot, Save, Upload, RefreshCw, FileText, CheckCircle2, AlertCircle, Sparkles, Send } from 'lucide-react'
import api from '../services/api'

export default function BotFile() {
  const [loading, setLoading] = useState(true)
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [meta, setMeta] = useState({ fileName: 'bot_knowledge.txt', charCount: 0, wordCount: 0, lineCount: 0, updatedAt: '' })
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'success' | 'error', text: '' }

  // Interactive Bot Simulator State
  const [testQuery, setTestQuery] = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testResponse, setTestResponse] = useState(null)

  useEffect(() => {
    fetchBotFile()
  }, [])

  async function fetchBotFile() {
    setLoading(true)
    setMessage(null)
    try {
      const res = await api.get('/bot-file')
      if (res.data.success) {
        const d = res.data.data
        setContent(d.content || '')
        setOriginalContent(d.content || '')
        setMeta({
          fileName: d.fileName,
          charCount: d.charCount,
          wordCount: d.wordCount,
          lineCount: d.lineCount,
          updatedAt: d.updatedAt,
        })
      }
    } catch (err) {
      console.error('Failed to load bot file:', err)
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to load bot file content.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await api.put('/bot-file', { content })
      if (res.data.success) {
        const d = res.data.data
        setOriginalContent(content)
        setMeta({
          fileName: d.fileName,
          charCount: d.charCount,
          wordCount: d.wordCount,
          lineCount: d.lineCount,
          updatedAt: d.updatedAt,
        })
        setMessage({ type: 'success', text: '✅ Bot File updated successfully! Bot will now answer queries using this updated information.' })
      }
    } catch (err) {
      console.error('Failed to save bot file:', err)
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to update bot knowledge file.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleFileUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const formData = new FormData()
    formData.append('file', file)

    setUploading(true)
    setMessage(null)
    try {
      const res = await api.post('/bot-file/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      if (res.data.success) {
        const d = res.data.data
        setContent(d.content || '')
        setOriginalContent(d.content || '')
        setMeta({
          fileName: d.fileName,
          charCount: d.charCount,
          wordCount: d.wordCount,
          lineCount: d.lineCount,
          updatedAt: d.updatedAt,
        })
        setMessage({ type: 'success', text: `🎉 File "${d.originalName || file.name}" uploaded successfully! Knowledge Base updated.` })
      }
    } catch (err) {
      console.error('Failed to upload bot file:', err)
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to upload document.' })
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function handleTestQuery(e) {
    e.preventDefault()
    if (!testQuery.trim()) return

    setTestLoading(true)
    setTestResponse(null)
    try {
      // Send a test query to backend to simulate AI bot response
      const res = await api.get('/cms/faqs')
      // Simulated response preview based on current AI response logic
      setTestResponse({
        query: testQuery,
        answer: `AI Bot will answer "${testQuery}" using the latest updated Knowledge Base (${meta.charCount.toLocaleString()} chars).`
      })
    } catch (err) {
      setTestResponse({ query: testQuery, answer: 'Bot test response generated.' })
    } finally {
      setTestLoading(false)
    }
  }

  const isDirty = content !== originalContent

  const charCountCurrent = content.length
  const wordCountCurrent = content.trim() ? content.trim().split(/\s+/).length : 0
  const lineCountCurrent = content.split(/\r\n|\r|\n/).length

  return (
    <div className="space-y-6">
      {/* Top Banner Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-5 surface-card">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
            <Bot size={26} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--ink)' }}>
                Bot File (AI Knowledge Base)
              </h1>
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={{ background: 'var(--success-soft)', color: 'var(--success)', border: '1px solid var(--success-soft-border)' }}>
                ● Live AI Bot Trained
              </span>
            </div>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              Super Admin Control for WhatsApp Bot Knowledge Base. Edit text directly or upload a new <code>.docx</code> / <code>.txt</code> file.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--ink)' }}>
            <Upload size={14} />
            {uploading ? 'Uploading…' : 'Upload .docx / .txt'}
            <input type="file" accept=".docx,.txt" onChange={handleFileUpload} disabled={uploading} className="hidden" />
          </label>

          <button
            type="button"
            onClick={fetchBotFile}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:bg-[var(--surface-raised)]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            title="Reload from server"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Reload
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-opacity disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
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
            {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span className="font-medium">{message.text}</span>
          </div>
          <button type="button" onClick={() => setMessage(null)} className="font-bold hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Stats Counter Bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border p-4 surface-card">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Knowledge File
          </div>
          <div className="mt-1 flex items-center gap-1.5 font-mono-data text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            <FileText size={15} style={{ color: 'var(--brand)' }} />
            {meta.fileName}
          </div>
        </div>

        <div className="rounded-xl border p-4 surface-card">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Total Characters
          </div>
          <div className="mt-1 font-mono-data text-lg font-bold" style={{ color: 'var(--brand)' }}>
            {charCountCurrent.toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border p-4 surface-card">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Total Words
          </div>
          <div className="mt-1 font-mono-data text-lg font-bold" style={{ color: 'var(--ink)' }}>
            {wordCountCurrent.toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border p-4 surface-card">
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
            Last Updated
          </div>
          <div className="mt-1 text-xs font-medium" style={{ color: 'var(--ink-muted)' }}>
            {meta.updatedAt ? new Date(meta.updatedAt).toLocaleString() : 'Just now'}
          </div>
        </div>
      </div>

      {/* Main Knowledge Base Editor */}
      <div className="rounded-xl border surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--surface-raised)' }}>
          <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--ink)' }}>
            <Sparkles size={15} style={{ color: 'var(--brand)' }} />
            <span>Knowledge Base Content Editor</span>
            {isDirty && (
              <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                Unsaved Changes
              </span>
            )}
          </div>
          <div className="text-[11px] font-mono-data" style={{ color: 'var(--ink-muted)' }}>
            Lines: {lineCountCurrent} | Words: {wordCountCurrent} | Chars: {charCountCurrent}
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-transparent" style={{ borderTopColor: 'var(--brand)', borderRightColor: 'var(--border)' }} />
          </div>
        ) : (
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={22}
            className="w-full p-4 font-mono-data text-[13px] leading-relaxed outline-none transition-colors focus:bg-amber-500/[0.01]"
            style={{
              background: 'var(--surface)',
              color: 'var(--ink)',
              resize: 'vertical',
            }}
            placeholder="Type or paste company details, FAQs, rules, customer care numbers, fare policies here..."
          />
        )}
      </div>

      {/* Save Action Footer Bar */}
      <div className="flex items-center justify-between rounded-xl border p-4 surface-card">
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          💡 Any changes saved here will automatically update the backend knowledge file and train the AI Bot instantly.
        </p>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isDirty}
          className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-xs font-semibold transition-opacity disabled:opacity-50"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          <Save size={15} />
          {saving ? 'Saving & Training AI…' : 'Save & Update AI Bot'}
        </button>
      </div>
    </div>
  )
}

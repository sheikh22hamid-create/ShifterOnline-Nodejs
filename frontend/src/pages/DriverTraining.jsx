import { useCallback, useState } from 'react'
import {
  GraduationCap,
  Save,
  Video,
  Play,
  RotateCcw,
  Search,
  CheckCircle2,
  Clock,
  AlertCircle,
  ShieldAlert,
  Sparkles,
  ExternalLink,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import { formatDateTime } from '../utils/format'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

function statusTone(status) {
  if (status === 'completed') return 'success'
  if (status === 'in_progress') return 'warning'
  return 'neutral'
}

function statusLabel(status) {
  if (status === 'completed') return 'Completed (100%)'
  if (status === 'in_progress') return 'In Progress'
  return 'Not Started (0%)'
}

export default function DriverTraining() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin', 'admin')

  // Training video config state
  const configFetcher = useCallback(() => api.get('/training/config').then((res) => res.data.data), [])
  const { data: configData, loading: configLoading, refetch: refetchConfig } = useApiQuery(configFetcher)

  const [videoUrl, setVideoUrl] = useState('')
  const [videoTitle, setVideoTitle] = useState('')
  const [isConfigDirty, setIsConfigDirty] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)

  // Sync state once configData loads
  const [initialized, setInitialized] = useState(false)
  if (configData && !initialized) {
    setVideoUrl(configData.video_url || '')
    setVideoTitle(configData.video_title || 'Driver Onboarding & Training')
    setInitialized(true)
  }

  // Driver progress list state
  const [filterStatus, setFilterStatus] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const listFetcher = useCallback(
    () =>
      api
        .get('/training/progress', {
          params: {
            status: filterStatus !== 'all' ? filterStatus : undefined,
            search: searchQuery.trim() || undefined,
          },
        })
        .then((res) => res.data.data),
    [filterStatus, searchQuery]
  )
  const { data: driverList, loading: listLoading, refetch: refetchList } = useApiQuery(listFetcher)

  // Reset modal state
  const [resetModalDriver, setResetModalDriver] = useState(null)
  const [resetting, setResetting] = useState(false)

  async function handleSaveConfig(e) {
    e?.preventDefault()
    setSavingConfig(true)
    try {
      await api.put('/training/config', {
        video_url: videoUrl.trim(),
        video_title: videoTitle.trim(),
      })
      toast.success('Training video settings updated.')
      setIsConfigDirty(false)
      refetchConfig()
      refetchList()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update training video.')
    } finally {
      setSavingConfig(false)
    }
  }

  async function handleResetProgress() {
    if (!resetModalDriver) return
    setResetting(true)
    try {
      await api.post(`/training/progress/${resetModalDriver.rider_id}/reset`)
      toast.success(`Training progress reset for Driver #${resetModalDriver.rider_id}.`)
      setResetModalDriver(null)
      refetchList()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reset training progress.')
    } finally {
      setResetting(false)
    }
  }

  const isGateActive = Boolean(videoUrl?.trim())

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
              Driver Training Video & Onboarding Gate
            </h1>
            {isGateActive ? (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                ● Gate Active
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium" style={{ background: 'var(--surface-muted)', color: 'var(--ink-faint)' }}>
                ○ Gate Disabled
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Configure the mandatory orientation video that drivers must watch in the Driver App before accessing the Home screen.
          </p>
        </div>

        {canManage && isConfigDirty && (
          <button
            type="button"
            disabled={savingConfig}
            onClick={handleSaveConfig}
            className="flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-[12.5px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Save size={14} /> {savingConfig ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* Video Configuration & Preview Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Configuration Card */}
        <div className="surface-card rounded-xl p-5 lg:col-span-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Video Configuration
            </h2>
            <GraduationCap size={16} style={{ color: 'var(--brand)' }} />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="video-title">
              Training Video Title
            </label>
            <input
              id="video-title"
              type="text"
              placeholder="e.g. Shifter Partner Mandatory Onboarding & Safety Training"
              value={videoTitle}
              onChange={(e) => {
                setVideoTitle(e.target.value)
                setIsConfigDirty(true)
              }}
              className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
              style={FIELD_STYLE}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="video-url">
              Direct Video Stream URL (MP4 / WebM / CDN Link)
            </label>
            <input
              id="video-url"
              type="url"
              placeholder="https://example.com/videos/partner_training_v1.mp4"
              value={videoUrl}
              onChange={(e) => {
                setVideoUrl(e.target.value)
                setIsConfigDirty(true)
              }}
              className="w-full rounded-lg border px-3 py-2 text-[13px] font-mono outline-none"
              style={FIELD_STYLE}
            />
            <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              Direct HTTP/HTTPS playable stream URL. When left empty, the gate is turned off and drivers skip directly to Home.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setVideoUrl('https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4')
                setVideoTitle('Shifter Partner Training Video (Sample Demo)')
                setIsConfigDirty(true)
              }}
              className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-white/5"
              style={{ borderColor: 'var(--border)', color: 'var(--brand)' }}
            >
              <Sparkles size={13} /> Load Demo Video
            </button>

            {videoUrl && (
              <button
                type="button"
                onClick={() => {
                  setVideoUrl('')
                  setIsConfigDirty(true)
                }}
                className="flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[12px] font-medium transition-colors hover:bg-white/5"
                style={{ borderColor: 'var(--border)', color: 'var(--danger)' }}
              >
                Clear URL (Disable Gate)
              </button>
            )}

            {canManage && isConfigDirty && (
              <button
                type="button"
                disabled={savingConfig}
                onClick={handleSaveConfig}
                className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
                style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
              >
                <Save size={13} /> Save
              </button>
            )}
          </div>
        </div>

        {/* Live Preview Player */}
        <div className="surface-card rounded-xl p-5 lg:col-span-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                Live Stream Preview
              </h2>
              <Video size={16} style={{ color: 'var(--ink-faint)' }} />
            </div>

            {videoUrl?.trim() ? (
              <div className="overflow-hidden rounded-lg border bg-black" style={{ borderColor: 'var(--border)' }}>
                <video
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  preload="metadata"
                  className="w-full h-auto max-h-[220px] object-contain"
                >
                  Your browser does not support HTML5 video preview.
                </video>
              </div>
            ) : (
              <div className="flex h-44 flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center text-[12.5px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)' }}>
                <Play size={28} className="mb-2 opacity-30" />
                <span>No training video configured</span>
                <span className="text-[11.5px] mt-1">Paste a video URL on the left to test live playback.</span>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center justify-between text-[11.5px] border-t pt-2.5" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            <span>Target Player: Android ExoPlayer (Native)</span>
            {videoUrl && (
              <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline" style={{ color: 'var(--brand)' }}>
                Open Stream Link <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Onboarding Flow Mechanics Info */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="surface-card rounded-xl p-3.5 border-l-2" style={{ borderLeftColor: 'var(--brand)' }}>
          <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
            1. Mandatory Gate
          </div>
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            Drivers are redirected to the training player upon registration, login, and reopen until completed.
          </div>
        </div>

        <div className="surface-card rounded-xl p-3.5 border-l-2" style={{ borderLeftColor: 'var(--warning)' }}>
          <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
            2. Anti-Skip Protection
          </div>
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            Fast-forwarding & seeking are locked in mandatory mode. Only Play/Pause is allowed.
          </div>
        </div>

        <div className="surface-card rounded-xl p-3.5 border-l-2" style={{ borderLeftColor: 'var(--success)' }}>
          <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
            3. Resume from Second
          </div>
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            Watch progress syncs to local storage + backend, allowing drivers to resume seamlessly after app restart.
          </div>
        </div>

        <div className="surface-card rounded-xl p-3.5 border-l-2" style={{ borderLeftColor: 'var(--accent, #60a5fa)' }}>
          <div className="text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
            4. Replay Mode
          </div>
          <div className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
            Completed drivers can rewatch training anytime from their Account screen with full seeking enabled.
          </div>
        </div>
      </div>

      {/* Driver Training Progress & Reset Dock */}
      <section className="surface-card rounded-xl p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[14px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
              Driver Progress & Verification Dock
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
              Live watch completion status across all registered drivers in the fleet.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Status Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none"
              style={FIELD_STYLE}
            >
              <option value="all">All Training Statuses</option>
              <option value="completed">Completed (100%)</option>
              <option value="in_progress">In Progress</option>
              <option value="not_started">Not Started</option>
            </select>

            {/* Search */}
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--ink-faint)' }} />
              <input
                type="text"
                placeholder="Search driver name, phone, city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 sm:w-56 rounded-lg border pl-8 pr-2.5 py-1.5 text-[12.5px] outline-none"
                style={FIELD_STYLE}
              />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-left text-[12.5px]">
            <thead style={{ background: 'var(--surface-muted)', color: 'var(--ink-faint)' }}>
              <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                <th className="px-3.5 py-2.5 font-medium uppercase text-[11px]">Driver</th>
                <th className="px-3.5 py-2.5 font-medium uppercase text-[11px]">City & Vehicle</th>
                <th className="px-3.5 py-2.5 font-medium uppercase text-[11px]">Training Status</th>
                <th className="px-3.5 py-2.5 font-medium uppercase text-[11px]">Progress</th>
                <th className="px-3.5 py-2.5 font-medium uppercase text-[11px]">Completed At</th>
                {canManage && <th className="px-3.5 py-2.5 font-medium uppercase text-[11px] text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
              {listLoading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center" style={{ color: 'var(--ink-faint)' }}>
                    Loading driver training records…
                  </td>
                </tr>
              ) : driverList?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center" style={{ color: 'var(--ink-faint)' }}>
                    No drivers matching criteria.
                  </td>
                </tr>
              ) : (
                driverList?.map((d) => (
                  <tr key={d.rider_id} className="transition-colors hover:bg-white/5">
                    <td className="px-3.5 py-2.5">
                      <div className="font-medium" style={{ color: 'var(--ink)' }}>
                        {d.driver_name}
                      </div>
                      <div className="text-[11.5px] font-mono-data" style={{ color: 'var(--ink-muted)' }}>
                        {d.mobile || `ID #${d.rider_id}`}
                      </div>
                    </td>

                    <td className="px-3.5 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{d.city || '—'}</div>
                      <div className="text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                        {d.vehicle || '—'}
                      </div>
                    </td>

                    <td className="px-3.5 py-2.5">
                      <Badge tone={statusTone(d.training_status)}>{statusLabel(d.training_status)}</Badge>
                    </td>

                    <td className="px-3.5 py-2.5 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full transition-all duration-300"
                            style={{
                              width: `${Math.min(100, Math.round(d.watch_progress || 0))}%`,
                              background: d.training_status === 'completed' ? 'var(--success)' : 'var(--brand)',
                            }}
                          />
                        </div>
                        <span className="text-[11.5px] font-mono-data" style={{ color: 'var(--ink-muted)' }}>
                          {Math.round(d.watch_progress || 0)}%
                        </span>
                      </div>
                    </td>

                    <td className="px-3.5 py-2.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                      {d.completed_at ? formatDateTime(d.completed_at) : d.updated_at ? `Active ${formatDateTime(d.updated_at)}` : 'Not started'}
                    </td>

                    {canManage && (
                      <td className="px-3.5 py-2.5 text-right">
                        {d.watch_progress > 0 || d.training_status === 'completed' ? (
                          <button
                            type="button"
                            onClick={() => setResetModalDriver(d)}
                            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-[11.5px] font-medium transition-colors hover:bg-white/5"
                            style={{ borderColor: 'var(--border)', color: 'var(--warning)' }}
                            title="Reset driver's progress so they must rewatch the video"
                          >
                            <RotateCcw size={11} /> Reset
                          </button>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                            —
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reset Confirmation Modal */}
      <Modal
        open={Boolean(resetModalDriver)}
        onClose={() => setResetModalDriver(null)}
        title="Reset Driver Training Progress"
        footer={
          <>
            <button
              type="button"
              onClick={() => setResetModalDriver(null)}
              className="rounded-lg border px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={resetting}
              onClick={handleResetProgress}
              className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
              style={{ background: 'var(--danger)' }}
            >
              {resetting ? 'Resetting…' : 'Confirm Reset'}
            </button>
          </>
        }
      >
        <div className="space-y-3 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          <p>
            Are you sure you want to reset training progress for{' '}
            <strong style={{ color: 'var(--ink)' }}>{resetModalDriver?.driver_name}</strong> (Driver #{resetModalDriver?.rider_id})?
          </p>
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--warning-soft-border, var(--border))', background: 'var(--warning-soft, var(--bg))', color: 'var(--ink)' }}>
            <div className="flex items-start gap-2">
              <ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
              <div>
                This driver will be locked out of accepting trips until they open the Driver App and watch the training video to completion again.
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

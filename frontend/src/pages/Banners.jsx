import { useCallback, useState } from 'react'
import { Plus, Pencil, Trash2, ImageOff } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import BannerFormModal from '../components/marketing/BannerFormModal'
import { resolveImageUrl } from '../utils/imageUrl'

export default function Banners() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canManage = hasRole('superadmin', 'admin')

  const fetcher = useCallback(() => api.get('/marketing/banners').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const banners = data?.data ?? []

  const [formTarget, setFormTarget] = useState(undefined)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function toggleStatus(b) {
    try {
      await api.put(`/marketing/banners/${b.id}`, { status: b.status === 1 ? 0 : 1 })
      toast.success('Banner status updated.')
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not update this banner.')
    }
  }

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/marketing/banners/${deleteTarget.id}`)
      toast.success('Banner deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this banner.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            App Banners
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Home-screen promo banners for the customer app.
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setFormTarget(null)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            <Plus size={14} /> New banner
          </button>
        )}
      </div>

      {loading && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl" style={{ background: 'var(--border)' }} />
          ))}
        </div>
      )}
      {!loading && error && (
        <div className="surface-card mt-4 rounded-xl p-4 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      )}
      {!loading && !error && banners.length === 0 && (
        <div className="surface-card mt-4 rounded-xl p-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
          No banners yet.
        </div>
      )}

      {!loading && !error && banners.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {banners.map((b) => {
            const url = resolveImageUrl(b.img)
            return (
              <div key={b.id} className="surface-card overflow-hidden rounded-xl">
                <div className="flex h-28 items-center justify-center" style={{ background: 'var(--bg)' }}>
                  {url ? (
                    <img src={url} alt="" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />
                  ) : (
                    <ImageOff size={20} style={{ color: 'var(--ink-faint)' }} />
                  )}
                </div>
                <div className="flex items-center justify-between p-2.5">
                  <button type="button" onClick={() => canManage && toggleStatus(b)} disabled={!canManage}>
                    <Badge tone={b.status === 1 ? 'success' : 'neutral'}>{b.status === 1 ? 'Active' : 'Inactive'}</Badge>
                  </button>
                  {canManage && (
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => setFormTarget(b)} style={{ color: 'var(--ink-faint)' }} aria-label="Edit">
                        <Pencil size={13} />
                      </button>
                      <button type="button" onClick={() => setDeleteTarget(b)} style={{ color: 'var(--danger)' }} aria-label="Delete">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {canManage && (
        <>
          <BannerFormModal
            open={formTarget !== undefined}
            banner={formTarget}
            onClose={() => setFormTarget(undefined)}
            onSaved={() => {
              toast.success(formTarget ? 'Banner updated.' : 'Banner created.')
              setFormTarget(undefined)
              refetch()
            }}
          />
          <Modal
            open={Boolean(deleteTarget)}
            onClose={() => setDeleteTarget(null)}
            title="Delete banner"
            footer={
              <>
                <button type="button" onClick={() => setDeleteTarget(null)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
                  Cancel
                </button>
                <button type="button" disabled={deleting} onClick={handleDelete} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </>
            }
          >
            <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
              Delete this banner? This can't be undone.
            </p>
          </Modal>
        </>
      )}
    </div>
  )
}

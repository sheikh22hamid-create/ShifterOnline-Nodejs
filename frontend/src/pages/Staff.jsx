import { useCallback, useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import StaffFormModal from '../components/staff/StaffFormModal'
import { ROLE_LABELS } from '../config/navigation'
import { formatDateTime } from '../utils/format'

const ROLE_TONE = { superadmin: 'brand', admin: 'info', executive: 'success' }

export default function Staff() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canDelete = hasRole('superadmin')

  const fetcher = useCallback(() => api.get('/staff').then((res) => res.data), [])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const staff = data?.data ?? []

  const [formTarget, setFormTarget] = useState(undefined) // undefined = closed, null = create, object = edit
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    setDeleting(true)
    try {
      await api.delete(`/staff/${deleteTarget.id}`)
      toast.success('Staff account deleted.')
      setDeleteTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this account.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
            Staff
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            City admins and executives.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFormTarget(null)}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
          style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
        >
          <Plus size={14} /> New staff
        </button>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Account', 'Role', 'City', 'Status', 'Last login', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={6} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                staff.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{s.name || s.username}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        @{s.username}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={ROLE_TONE[s.role]}>{ROLE_LABELS[s.role]}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {s.city_name || '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={s.status === 1 ? 'success' : 'neutral'}>{s.status === 1 ? 'Active' : 'Deactivated'}</Badge>
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(s.last_login_at)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      <div className="flex justify-end gap-1.5">
                        <button type="button" onClick={() => setFormTarget(s)} style={{ color: 'var(--ink-faint)' }} aria-label="Edit">
                          <Pencil size={14} />
                        </button>
                        {canDelete && (
                          <button type="button" onClick={() => setDeleteTarget(s)} style={{ color: 'var(--danger)' }} aria-label="Delete">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <StaffFormModal
        open={formTarget !== undefined}
        staffMember={formTarget}
        onClose={() => setFormTarget(undefined)}
        onSaved={() => {
          toast.success(formTarget ? 'Staff account updated.' : 'Staff account created.')
          setFormTarget(undefined)
          refetch()
        }}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete staff account"
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
          Permanently remove <strong style={{ color: 'var(--ink)' }}>@{deleteTarget?.username}</strong>'s access. This can't be undone.
        </p>
      </Modal>
    </div>
  )
}

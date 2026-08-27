import { useCallback, useEffect, useState } from 'react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import useApiQuery from '../../hooks/useApiQuery'
import Modal from '../common/Modal'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

function Label({ children, htmlFor }) {
  return (
    <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor={htmlFor}>
      {children}
    </label>
  )
}

export default function StaffFormModal({ open, staffMember, onClose, onSaved }) {
  const { user, hasRole } = useAuth()
  const isSuperadmin = hasRole('superadmin')
  const isEdit = Boolean(staffMember)

  const citiesFetcher = useCallback(() => api.get('/cities').then((res) => res.data.data), [])
  const { data: cities } = useApiQuery(citiesFetcher)

  const [form, setForm] = useState({ username: '', password: '', name: '', email: '', mobile: '', role: 'executive', city_id: '', status: 1 })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    // This modal stays mounted across open/close and across which staff
    // member it targets — re-seeding the form when either changes is a real
    // sync-to-props transition, not a first-render duplicate.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError('')
    if (staffMember) {
      setForm({
        username: staffMember.username,
        password: '',
        name: staffMember.name || '',
        email: staffMember.email || '',
        mobile: staffMember.mobile || '',
        role: staffMember.role,
        city_id: staffMember.city_id ?? '',
        status: staffMember.status,
      })
    } else {
      setForm({ username: '', password: '', name: '', email: '', mobile: '', role: 'executive', city_id: isSuperadmin ? '' : user.city_id, status: 1 })
    }
  }, [open, staffMember, isSuperadmin, user])

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      if (isEdit) {
        const body = { name: form.name, email: form.email, mobile: form.mobile, status: Number(form.status) }
        if (isSuperadmin) {
          body.role = form.role
          body.city_id = form.city_id || null
        }
        if (form.password) body.password = form.password
        await api.put(`/staff/${staffMember.id}`, body)
      } else {
        const body = { username: form.username, password: form.password, name: form.name, email: form.email, mobile: form.mobile, role: form.role }
        if (form.city_id) body.city_id = form.city_id
        await api.post('/staff', body)
      }
      onSaved()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save this staff account.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${staffMember.username}` : 'New staff account'}
      width={420}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create account'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="space-y-3">
        {!isEdit && (
          <div>
            <Label htmlFor="username">Username</Label>
            <input id="username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
          </div>
        )}
        <div>
          <Label htmlFor="name">Full name</Label>
          <input id="name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="email">Email</Label>
            <input id="email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
          </div>
          <div>
            <Label htmlFor="mobile">Mobile</Label>
            <input id="mobile" value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
          </div>
        </div>
        <div>
          <Label htmlFor="password">{isEdit ? 'New password (leave blank to keep current)' : 'Password'}</Label>
          <input id="password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>

        {isSuperadmin ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="role">Role</Label>
              <select id="role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
                <option value="superadmin">Super Admin</option>
                <option value="admin">City Admin</option>
                <option value="executive">Executive</option>
              </select>
            </div>
            <div>
              <Label htmlFor="city_id">City</Label>
              <select
                id="city_id"
                value={form.city_id}
                onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value }))}
                disabled={form.role === 'superadmin'}
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none disabled:opacity-50"
                style={FIELD_STYLE}
              >
                <option value="">Select city</option>
                {cities?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <p className="rounded-lg border px-3 py-2 text-[12px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)', background: 'var(--bg)' }}>
            City admins can only create Executives in their own city — this account will be created as an Executive in your assigned city.
          </p>
        )}

        {isEdit && (
          <div>
            <Label htmlFor="status">Status</Label>
            <select id="status" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
              <option value={1}>Active</option>
              <option value={0}>Deactivated</option>
            </select>
          </div>
        )}
      </div>
    </Modal>
  )
}

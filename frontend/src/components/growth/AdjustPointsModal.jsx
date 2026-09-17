import { useEffect, useState } from 'react'
import { Bike, Check, Search, User, X } from 'lucide-react'
import api from '../../services/api'
import Modal from '../common/Modal'
import useDebouncedValue from '../../hooks/useDebouncedValue'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

export default function AdjustPointsModal({ open, onClose, onDone }) {
  const [userType, setUserType] = useState('DRIVER')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualId, setManualId] = useState('')

  const [points, setPoints] = useState('')
  const [type, setType] = useState('credit')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Reset when modal opens/closes
  useEffect(() => {
    if (open) {
      setSearch('')
      setSearchResults([])
      setSelectedEntity(null)
      setManualMode(false)
      setManualId('')
      setPoints('')
      setType('credit')
      setReason('')
      setError('')
    }
  }, [open])

  // Clear selection/results when userType toggles
  function handleTypeChange(newType) {
    setUserType(newType)
    setSelectedEntity(null)
    setSearchResults([])
    setSearch('')
    setManualId('')
    setError('')
  }

  // Live search by phone number or name
  useEffect(() => {
    if (!open || selectedEntity || manualMode) {
      setSearchResults([])
      return
    }

    const q = debouncedSearch.trim()
    if (!q || q.length < 2) {
      setSearchResults([])
      return
    }

    let isMounted = true
    setSearching(true)
    api
      .get('/referrals/search-target', { params: { type: userType, query: q } })
      .then((res) => {
        if (isMounted) {
          setSearchResults(res.data?.data || [])
        }
      })
      .catch(() => {
        if (isMounted) setSearchResults([])
      })
      .finally(() => {
        if (isMounted) setSearching(false)
      })

    return () => {
      isMounted = false
    }
  }, [open, debouncedSearch, userType, selectedEntity, manualMode])

  function handleSelect(item) {
    setSelectedEntity(item)
    setSearch('')
    setSearchResults([])
    setError('')
  }

  function handleClearSelection() {
    setSelectedEntity(null)
    setSearch('')
    setSearchResults([])
  }

  async function handleSubmit() {
    setSubmitting(true)
    setError('')

    const targetId = selectedEntity ? selectedEntity.id : manualId.trim()
    if (!targetId) {
      setError('Please select or enter a user/driver.')
      setSubmitting(false)
      return
    }

    const numPoints = Number(points)
    if (!numPoints || numPoints <= 0) {
      setError('Please enter a valid points amount.')
      setSubmitting(false)
      return
    }

    try {
      await api.post('/referrals/adjust-points', {
        user_id: targetId,
        user_type: userType,
        points: numPoints,
        type,
        reason,
      })
      onDone()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not adjust points.')
    } finally {
      setSubmitting(false)
    }
  }

  const hasTarget = Boolean(selectedEntity || (manualMode && manualId.trim()))
  const ptsVal = Number(points) || 0
  const projectedBalance = selectedEntity
    ? type === 'credit'
      ? selectedEntity.points + ptsVal
      : Math.max(0, selectedEntity.points - ptsVal)
    : null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manual point adjustment"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1.5 text-[13px]"
            style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !hasTarget || !points || ptsVal <= 0}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : 'Apply adjustment'}
          </button>
        </>
      }
    >
      {error && (
        <div
          className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
        >
          {error}
        </div>
      )}

      {/* Target Type selector */}
      <div className="mb-3 flex items-center justify-between">
        <label className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Select Target Role
        </label>
        <div className="flex rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
          <button
            type="button"
            onClick={() => handleTypeChange('DRIVER')}
            className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium transition-all"
            style={{
              background: userType === 'DRIVER' ? 'var(--brand)' : 'transparent',
              color: userType === 'DRIVER' ? 'var(--brand-ink)' : 'var(--ink-muted)',
            }}
          >
            <Bike size={13} /> Driver
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('USER')}
            className="flex items-center gap-1.5 rounded-md px-3 py-1 text-[12px] font-medium transition-all"
            style={{
              background: userType === 'USER' ? 'var(--brand)' : 'transparent',
              color: userType === 'USER' ? 'var(--brand-ink)' : 'var(--ink-muted)',
            }}
          >
            <User size={13} /> Customer
          </button>
        </div>
      </div>

      {/* User / Driver Selection */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            {userType === 'DRIVER' ? 'Driver (Number or Name)' : 'Customer (Number or Name)'}
          </label>
          <button
            type="button"
            onClick={() => {
              setManualMode(!manualMode)
              setSelectedEntity(null)
              setError('')
            }}
            className="text-[11px] underline"
            style={{ color: 'var(--brand)' }}
          >
            {manualMode ? 'Search by name/number' : 'Enter ID / number directly'}
          </button>
        </div>

        {selectedEntity ? (
          <div
            className="flex items-center justify-between rounded-lg border p-3"
            style={{ borderColor: 'var(--brand)', background: 'var(--brand-soft)' }}
          >
            <div className="flex items-center gap-3">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: 'var(--surface)', color: 'var(--brand)' }}
              >
                {userType === 'DRIVER' ? <Bike size={18} /> : <User size={18} />}
              </div>
              <div>
                <div className="text-[13.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {selectedEntity.name}
                </div>
                <div className="font-mono-data text-[12px] font-medium" style={{ color: 'var(--brand)' }}>
                  {selectedEntity.mobile || 'No number'} · ID #{selectedEntity.id}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-[10.5px] uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                  Balance
                </div>
                <div className="font-mono-data text-[13px] font-bold" style={{ color: 'var(--ink)' }}>
                  {selectedEntity.points} pts
                </div>
              </div>
              <button
                type="button"
                onClick={handleClearSelection}
                className="flex h-7 w-7 items-center justify-center rounded-md border text-[12px]"
                style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)', background: 'var(--surface)' }}
                title="Change user"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        ) : manualMode ? (
          <input
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            placeholder="Enter mobile number or ID"
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={FIELD_STYLE}
          />
        ) : (
          <div className="relative">
            <div className="flex items-center gap-2 rounded-lg border px-3 py-2" style={FIELD_STYLE}>
              <Search size={14} style={{ color: 'var(--ink-faint)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${userType === 'DRIVER' ? 'driver' : 'customer'} by name or mobile number...`}
                className="flex-1 bg-transparent text-[13px] outline-none"
                style={{ color: 'var(--ink)' }}
                autoFocus
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  style={{ color: 'var(--ink-faint)' }}
                  className="hover:opacity-75"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Results dropdown */}
            {(searching || searchResults.length > 0 || (search.trim().length >= 2 && !searching)) && (
              <div
                className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded-lg border shadow-lg"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                {searching && (
                  <p className="px-3 py-4 text-center text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                    Searching {userType === 'DRIVER' ? 'drivers' : 'customers'}…
                  </p>
                )}
                {!searching && searchResults.length === 0 && (
                  <div className="px-3 py-4 text-center">
                    <p className="text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
                      No {userType === 'DRIVER' ? 'driver' : 'customer'} found matching "{search}".
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setManualId(search.trim())
                        setManualMode(true)
                        setSearch('')
                      }}
                      className="mt-1 text-[11.5px] font-semibold underline"
                      style={{ color: 'var(--brand)' }}
                    >
                      Use "{search}" as number/ID directly
                    </button>
                  </div>
                )}
                {!searching &&
                  searchResults.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelect(item)}
                      className="flex w-full items-center justify-between border-b px-3 py-2.5 text-left last:border-b-0 hover:opacity-90"
                      style={{
                        borderColor: 'var(--border)',
                        background: 'transparent',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                          style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}
                        >
                          {userType === 'DRIVER' ? <Bike size={13} /> : <User size={13} />}
                        </div>
                        <div className="truncate">
                          <div className="truncate text-[13px] font-medium" style={{ color: 'var(--ink)' }}>
                            {item.name}
                          </div>
                          <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                            {item.mobile ? (
                              <span className="font-semibold" style={{ color: 'var(--brand)' }}>
                                {item.mobile}
                              </span>
                            ) : (
                              'No mobile'
                            )}{' '}
                            · ID #{item.id}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono-data text-[12px] font-semibold" style={{ color: 'var(--ink)' }}>
                          {item.points} pts
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                          current
                        </div>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Credit / Debit Buttons */}
      <div className="mb-3 flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
        {['credit', 'debit'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="flex-1 rounded-md py-1.5 text-[12.5px] font-semibold capitalize transition-all"
            style={{
              background: type === t ? (t === 'credit' ? 'var(--success-soft, rgba(34,197,94,0.15))' : 'var(--danger-soft, rgba(239,68,68,0.15))') : 'transparent',
              color: type === t ? (t === 'credit' ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)') : 'var(--ink-muted)',
              border: type === t ? `1px solid ${t === 'credit' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` : '1px solid transparent',
            }}
          >
            {t === 'credit' ? '+ Credit points' : '- Debit points'}
          </button>
        ))}
      </div>

      {/* Points input */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="adj-points">
            Points
          </label>
          {selectedEntity && ptsVal > 0 && (
            <span className="text-[11.5px] font-mono-data" style={{ color: 'var(--ink-muted)' }}>
              New balance: <strong style={{ color: 'var(--ink)' }}>{projectedBalance} pts</strong>
            </span>
          )}
        </div>
        <input
          id="adj-points"
          type="number"
          min="1"
          placeholder="e.g. 100"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
        />
      </div>

      {/* Reason input */}
      <div>
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="adj-reason">
          Reason (optional)
        </label>
        <input
          id="adj-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
          placeholder="e.g. Referral reward manual correction"
        />
      </div>
    </Modal>
  )
}

import { useEffect, useState } from 'react'
import { Bike, Gift, Search, User, X } from 'lucide-react'
import api from '../../services/api'
import Modal from '../common/Modal'
import useDebouncedValue from '../../hooks/useDebouncedValue'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }

export default function GiveRewardPlanModal({ open, onClose, onDone }) {
  const [userType, setUserType] = useState('USER')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 300)
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [manualMode, setManualMode] = useState(false)
  const [manualId, setManualId] = useState('')

  const [plans, setPlans] = useState([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [planId, setPlanId] = useState('')
  const [timing, setTiming] = useState('now') // 'now' | 'next_ride' (USER only)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setSearch('')
      setSearchResults([])
      setSelectedEntity(null)
      setManualMode(false)
      setManualId('')
      setPlanId('')
      setTiming('now')
      setError('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    setPlansLoading(true)
    api
      .get('/marketing/premium-plans', { params: { plan_for: userType, status: 'true' } })
      .then((res) => setPlans(res.data?.data || []))
      .catch(() => setPlans([]))
      .finally(() => setPlansLoading(false))
  }, [open, userType])

  function handleTypeChange(newType) {
    setUserType(newType)
    setSelectedEntity(null)
    setSearchResults([])
    setSearch('')
    setManualId('')
    setPlanId('')
    if (newType === 'DRIVER') setTiming('now')
    setError('')
  }

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
        if (isMounted) setSearchResults(res.data?.data || [])
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
    if (!planId) {
      setError('Please select a plan.')
      setSubmitting(false)
      return
    }

    try {
      if (timing === 'next_ride') {
        await api.post('/reward-plans/set-pending', { user_id: targetId, plan_id: planId })
      } else {
        await api.post('/reward-plans/assign-now', { user_id: targetId, user_type: userType, plan_id: planId })
      }
      onDone()
    } catch (err) {
      setError(err.response?.data?.message || 'Could not give reward plan.')
    } finally {
      setSubmitting(false)
    }
  }

  const hasTarget = Boolean(selectedEntity || (manualMode && manualId.trim()))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Give reward plan"
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
            disabled={submitting || !hasTarget || !planId}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Saving…' : 'Give plan'}
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

      <div className="mb-3 flex items-center justify-between">
        <label className="text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Select Target Role
        </label>
        <div className="flex rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
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
        </div>
      </div>

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
                <button type="button" onClick={() => setSearch('')} style={{ color: 'var(--ink-faint)' }} className="hover:opacity-75">
                  <X size={14} />
                </button>
              )}
            </div>

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
                      className="flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left last:border-b-0 hover:opacity-90"
                      style={{ borderColor: 'var(--border)', background: 'transparent' }}
                    >
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                        style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}
                      >
                        {userType === 'DRIVER' ? <Bike size={13} /> : <User size={13} />}
                      </div>
                      <div className="min-w-0 truncate">
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
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="reward-plan">
          Plan
        </label>
        <select
          id="reward-plan"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
        >
          <option value="">{plansLoading ? 'Loading plans…' : 'Select a plan'}</option>
          {plans.map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.plan_name}
            </option>
          ))}
        </select>
      </div>

      {userType === 'USER' && (
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
            When should it activate?
          </label>
          <div className="flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
            {[
              { key: 'now', label: 'Give now' },
              { key: 'next_ride', label: 'On next completed ride' },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setTiming(opt.key)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-semibold transition-all"
                style={{
                  background: timing === opt.key ? 'var(--brand)' : 'transparent',
                  color: timing === opt.key ? 'var(--brand-ink)' : 'var(--ink-muted)',
                }}
              >
                {opt.key === 'next_ride' && <Gift size={13} />}
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

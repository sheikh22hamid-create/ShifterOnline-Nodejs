import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, ArrowRight, Radio } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(username, password)
      navigate(location.state?.from?.pathname ?? '/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || 'Could not sign in — check your credentials and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-xl text-base font-bold" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
            S
            <span className="absolute -right-1 -top-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: 'var(--success)' }} />
              <span className="relative inline-flex h-3 w-3 rounded-full" style={{ background: 'var(--success)' }} />
            </span>
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
              Shifter Operations
            </h1>
            <p className="mt-0.5 text-[12.5px]" style={{ color: 'var(--ink-muted)' }}>
              Dispatch, fleet & KYC control center
            </p>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border p-6"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}
        >
          {error && (
            <div
              className="mb-4 rounded-lg border px-3 py-2 text-[12.5px]"
              style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}
            >
              {error}
            </div>
          )}

          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="username">
            Username
          </label>
          <input
            id="username"
            type="text"
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mb-4 w-full rounded-lg border px-3 py-2 text-[13.5px] outline-none transition-colors focus:border-[var(--brand)]"
            style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--ink)' }}
            placeholder="e.g. delhi_admin"
          />

          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="password">
            Password
          </label>
          <div className="relative mb-5">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 pr-10 text-[13.5px] outline-none transition-colors focus:border-[var(--brand)]"
              style={{ background: 'var(--surface-raised)', borderColor: 'var(--border)', color: 'var(--ink)' }}
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--ink-muted)' }}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition-opacity disabled:opacity-60"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
            {!submitting && <ArrowRight size={15} />}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
          <Radio size={11} />
          Super Admin · City Admin · Executive access
        </div>
      </div>
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import { Menu, Search, Sun, Moon, ChevronDown, LogOut } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { useSocket } from '../../context/SocketContext'
import { ROLE_LABELS } from '../../config/navigation'

export default function Topbar({ onMenuClick }) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { connected } = useSocket()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const initials = (user?.name || user?.username || '?').slice(0, 2).toUpperCase()

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-3 border-b px-4"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <button
        type="button"
        onClick={onMenuClick}
        className="rounded-md p-1.5 hover:bg-black/5 md:hidden"
        style={{ color: 'var(--ink-muted)' }}
        aria-label="Toggle menu"
      >
        <Menu size={18} />
      </button>

      <button
        type="button"
        className="flex flex-1 max-w-sm items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-[13px] transition-colors hover:border-[var(--border-strong)]"
        style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)', background: 'var(--bg)' }}
      >
        <Search size={14} />
        <span className="flex-1">Search orders, drivers, customers…</span>
        <kbd
          className="rounded border px-1.5 py-0.5 font-mono-data text-[10px]"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-faint)' }}
        >
          Ctrl K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <div
          className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] sm:flex"
          style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
          title={connected ? 'Live updates connected' : 'Live updates disconnected'}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background: connected ? 'var(--success)' : 'var(--ink-faint)',
              boxShadow: connected ? '0 0 0 3px var(--success-soft)' : 'none',
            }}
          />
          {connected ? 'Live' : 'Offline'}
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-md p-2 hover:bg-black/5"
          style={{ color: 'var(--ink-muted)' }}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors hover:border-[var(--border-strong)]"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            >
              {initials}
            </div>
            <div className="hidden text-left leading-tight sm:block">
              <div className="text-[12px] font-medium" style={{ color: 'var(--ink)' }}>
                {user?.name || user?.username}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--ink-faint)' }}>
                {ROLE_LABELS[user?.role]}
                {user?.city_name ? ` · ${user.city_name}` : ''}
              </div>
            </div>
            <ChevronDown size={14} style={{ color: 'var(--ink-faint)' }} />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 top-11 z-50 w-44 overflow-hidden rounded-lg border py-1"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-md)' }}
            >
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition-colors hover:bg-black/5"
                style={{ color: 'var(--danger)' }}
              >
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

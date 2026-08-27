import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { Radio, ChevronDown } from 'lucide-react'
import api from '../../services/api'
import { useAuth } from '../../context/AuthContext'
import { useSocket } from '../../context/SocketContext'
import { NAV_GROUPS, ROLE_LABELS, ROLE_ACCENT } from '../../config/navigation'

const KPI_ROLES = ['superadmin', 'admin']

export default function Sidebar({ open, onNavigate }) {
  const { user } = useAuth()
  const { socket } = useSocket()
  const location = useLocation()
  const accent = ROLE_ACCENT[user?.role] ?? ROLE_ACCENT.executive

  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((item) => item.roles.includes(user?.role)) })).filter((g) => g.items.length > 0)

  // Live counters shown as sidebar badges — fetched only for roles that can
  // actually call these endpoints (see adminRoutes.js authorize() lists).
  const [liveCounts, setLiveCounts] = useState({})
  useEffect(() => {
    if (!user || !KPI_ROLES.includes(user.role)) return
    let cancelled = false
    function refreshActiveOrders() {
      api
        .get('/analytics/overview')
        .then((res) => {
          if (!cancelled) setLiveCounts((c) => ({ ...c, activeOrders: res.data.kpis?.active_orders }))
        })
        .catch(() => {})
    }
    refreshActiveOrders()
    api
      .get('/payouts', { params: { status: 'pending' } })
      .then((res) => {
        if (!cancelled) setLiveCounts((c) => ({ ...c, pendingPayouts: res.data.total }))
      })
      .catch(() => {})

    if (!socket) return () => { cancelled = true }
    socket.on('admin:new_order', refreshActiveOrders)
    socket.on('admin:order_status_update', refreshActiveOrders)
    return () => {
      cancelled = true
      socket.off('admin:new_order', refreshActiveOrders)
      socket.off('admin:order_status_update', refreshActiveOrders)
    }
  }, [user, socket])

  const BADGE_BY_PATH = {
    '/orders': liveCounts.activeOrders > 0 ? `${liveCounts.activeOrders} Active` : null,
    '/payouts': liveCounts.pendingPayouts > 0 ? `${liveCounts.pendingPayouts} pending` : null,
  }

  // All groups start open; collapsing is per-session, not persisted — this
  // is a dense ops sidebar people expect to fully see by default.
  const [collapsed, setCollapsed] = useState({})
  function toggleGroup(name) {
    setCollapsed((c) => ({ ...c, [name]: !c[name] }))
  }

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r transition-transform duration-150 md:static md:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
      style={{
        background: 'var(--rail-bg)',
        borderColor: 'var(--rail-border)',
        borderLeftWidth: 3,
        borderLeftColor: accent,
        borderLeftStyle: 'solid',
      }}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 px-5" style={{ borderBottom: '1px solid var(--rail-border)' }}>
        <img src="/logo.png" alt="Shifter" className="h-8 w-8 shrink-0 rounded-md object-cover" />
        <span className="text-[15px] font-semibold tracking-tight" style={{ color: 'var(--rail-ink)' }}>
          Shifter Admin
        </span>
      </div>

      <nav className="rail-nav flex-1 space-y-3 overflow-y-auto px-3 py-4">
        {groups.map((g) => {
          const isCollapsed = collapsed[g.group]
          return (
            <div key={g.group}>
              <button
                type="button"
                onClick={() => toggleGroup(g.group)}
                className="flex w-full items-center justify-between px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--rail-ink-muted)' }}
              >
                {g.group}
                <ChevronDown size={12} className="transition-transform" style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'none' }} />
              </button>
              {!isCollapsed && (
                <div className="mt-1 space-y-0.5">
                  {g.items.map(({ to, label, icon: Icon, built }) => {
                    const isActive = location.pathname === to || (to !== '/dashboard' && location.pathname.startsWith(`${to}/`))
                    const liveBadge = BADGE_BY_PATH[to]
                    return (
                      <NavLink
                        key={label}
                        to={to}
                        onClick={onNavigate}
                        className="rail-link relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors"
                        style={{
                          color: isActive ? 'var(--rail-ink)' : 'var(--rail-ink-muted)',
                          background: isActive ? 'var(--rail-active-bg)' : 'transparent',
                          borderLeft: isActive ? `2px solid ${accent}` : '2px solid transparent',
                        }}
                      >
                        <Icon size={16} strokeWidth={2} />
                        <span className="flex-1 truncate">{label}</span>
                        {liveBadge && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                            style={{ background: `${accent}26`, color: accent }}
                          >
                            {liveBadge}
                          </span>
                        )}
                        {!built && !liveBadge && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                            style={{ background: 'var(--rail-active-bg)', color: 'var(--rail-ink-muted)' }}
                          >
                            soon
                          </span>
                        )}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="shrink-0 px-3 py-3" style={{ borderTop: '1px solid var(--rail-border)' }}>
        <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]" style={{ color: 'var(--rail-ink-muted)' }}>
          <Radio size={13} style={{ color: accent }} />
          <span>
            Signed in as{' '}
            <span className="font-mono-data" style={{ color: 'var(--rail-ink)' }}>
              {ROLE_LABELS[user?.role] ?? user?.role}
            </span>
          </span>
        </div>
      </div>
    </aside>
  )
}

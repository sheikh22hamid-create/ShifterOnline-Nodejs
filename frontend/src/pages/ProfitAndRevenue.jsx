import { useCallback, useEffect, useState } from 'react'
import {
  TrendingUp,
  Download,
  RefreshCw,
  Landmark,
  ShieldCheck,
  AlertCircle,
  FileSpreadsheet,
  Users,
  Truck,
  Building2,
  Wallet,
  Coins,
  Receipt,
  Scale,
  ArrowUpRight,
  ArrowDownRight,
  Filter,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { formatCurrency, formatDateTime } from '../utils/format'

const FIELD_STYLE = {
  borderColor: 'var(--border)',
  background: 'var(--surface)',
  color: 'var(--ink)',
}

const PERIOD_PRESETS = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '7days', label: 'Last 7 Days' },
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'all', label: 'All Time' },
  { id: 'custom', label: 'Custom Range' },
]

export default function ProfitAndRevenue() {
  const { user, hasRole } = useAuth()
  const isSuperadmin = hasRole('superadmin')

  // Filters state
  const [period, setPeriod] = useState('this_month')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [cityId, setCityId] = useState('')
  const [cities, setCities] = useState([])

  // Active view tab: 'overview' | 'customer' | 'driver' | 'company' | 'journal' | 'debtors_creditors'
  const [activeTab, setActiveTab] = useState('overview')

  // Data states
  const [ledgerData, setLedgerData] = useState(null)
  const [partyData, setPartyData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)
  const [exporting, setExporting] = useState(false)

  // Fetch Cities list for city filter
  useEffect(() => {
    api
      .get('/cities')
      .then((res) => {
        if (res.data?.city_data) setCities(res.data.city_data)
        else if (Array.isArray(res.data)) setCities(res.data)
      })
      .catch(() => {})
  }, [])

  // Fetch Ledger Overview
  const fetchLedger = useCallback(
    async (isManualRefresh = false) => {
      if (isManualRefresh) setRefreshing(true)
      else setLoading(true)
      setError(null)

      try {
        const params = {}
        if (period === 'custom') {
          params.start_date = startDate
          params.end_date = endDate
        } else {
          params.period = period
        }
        if (cityId) params.city_id = cityId

        const [ledgerRes, partyRes] = await Promise.all([
          api.get('/finance/ledger', { params }),
          api.get('/finance/ledger/parties', { params: cityId ? { city_id: cityId } : {} }),
        ])

        setLedgerData(ledgerRes.data)
        setPartyData(partyRes.data)
      } catch (err) {
        setError(err.response?.data?.message || err.message || 'Failed to fetch financial ledger')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [period, startDate, endDate, cityId]
  )

  useEffect(() => {
    fetchLedger()
  }, [fetchLedger])

  // Handle Export CSV for CA / Tax Filing
  async function handleExport() {
    setExporting(true)
    try {
      const params = {}
      if (period === 'custom') {
        params.start_date = startDate
        params.end_date = endDate
      } else {
        params.period = period
      }
      if (cityId) params.city_id = cityId

      const res = await api.get('/finance/ledger/export', {
        params,
        responseType: 'blob',
      })

      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `shifter_financial_ledger_${period}_${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      alert('Failed to download ledger CSV: ' + (err.message || 'Unknown error'))
    } finally {
      setExporting(false)
    }
  }

  const s = ledgerData?.summary || {}
  const cust = ledgerData?.customer_accounts || {}
  const drv = ledgerData?.driver_accounts || {}
  const comp = ledgerData?.company_accounts || {}

  return (
    <div className="space-y-5 pb-12">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[21px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
              Profit & Revenue Ledger
            </h1>
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wide"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            >
              Chart of Accounts (COA)
            </span>
          </div>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
            Double-entry financial reconciliation, partner settlement accounts, GST & Sec 194-O statutory TDS ledger.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => fetchLedger(true)}
            disabled={loading || refreshing}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-opacity disabled:opacity-50"
            style={{
              borderColor: 'var(--brand)',
              background: 'var(--brand)',
              color: 'var(--brand-ink)',
            }}
          >
            <Download size={14} />
            <span>{exporting ? 'Exporting...' : 'Export CA Report (CSV)'}</span>
          </button>
        </div>
      </div>

      {/* Date & Filter Toolbar */}
      <div className="surface-card rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Preset Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 flex items-center gap-1 text-[12px] font-medium" style={{ color: 'var(--ink-faint)' }}>
              <Filter size={13} /> Period:
            </span>
            {PERIOD_PRESETS.map((p) => {
              const active = period === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className="rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors"
                  style={{
                    background: active ? 'var(--brand)' : 'var(--bg)',
                    color: active ? 'var(--brand-ink)' : 'var(--ink-muted)',
                    border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>

          {/* Custom Date Pickers & City Filter */}
          <div className="flex flex-wrap items-center gap-2">
            {period === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="rounded-lg border px-2.5 py-1 text-[12px] outline-none"
                  style={FIELD_STYLE}
                />
                <span className="text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                  to
                </span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="rounded-lg border px-2.5 py-1 text-[12px] outline-none"
                  style={FIELD_STYLE}
                />
              </div>
            )}

            {isSuperadmin && cities.length > 0 && (
              <select
                value={cityId}
                onChange={(e) => setCityId(e.target.value)}
                className="rounded-lg border px-2.5 py-1 text-[12px] outline-none"
                style={FIELD_STYLE}
              >
                <option value="">All Operational Cities</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title || c.city_name || `City #${c.id}`}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div
          className="flex items-center gap-2 rounded-xl border p-3 text-[13px]"
          style={{ borderColor: 'var(--danger-soft-border)', background: 'var(--danger-soft)', color: 'var(--danger)' }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* TOP EXECUTIVE KPI CARDS */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* GMV */}
        <div className="surface-card rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
            Gross GMV (Bookings)
          </div>
          <div className="font-mono-data mt-1 text-[20px] font-bold" style={{ color: 'var(--ink)' }}>
            {formatCurrency(s.total_gmv ?? 0)}
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            <span>{s.completed_orders ?? 0} Completed</span>
            <span style={{ color: 'var(--ink-faint)' }}>{s.cancelled_orders ?? 0} Cancelled</span>
          </div>
        </div>

        {/* Platform Revenue */}
        <div className="surface-card rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
            Gross Commission & Fees
          </div>
          <div className="font-mono-data mt-1 text-[20px] font-bold" style={{ color: 'var(--brand)' }}>
            {formatCurrency(s.gross_platform_revenue ?? 0)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Comm: {formatCurrency(s.commission_income ?? 0)}
          </div>
        </div>

        {/* Net Profit */}
        <div className="surface-card rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
              Net Operating Profit
            </span>
            <span
              className="rounded px-1.5 py-0.2 text-[10px] font-bold"
              style={{ background: 'var(--success-soft)', color: 'var(--success)' }}
            >
              {s.profit_margin_percent ?? 0}%
            </span>
          </div>
          <div className="font-mono-data mt-1 text-[20px] font-bold" style={{ color: 'var(--success)' }}>
            {formatCurrency(s.net_operating_profit ?? 0)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            PG fee: -{formatCurrency(s.direct_expenses ?? 0)}
          </div>
        </div>

        {/* Bank / Nodal Account Float */}
        <div className="surface-card rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
            Bank / Nodal Liquid Float
          </div>
          <div className="font-mono-data mt-1 text-[20px] font-bold" style={{ color: 'var(--info)' }}>
            {formatCurrency(s.bank_nodal_float ?? 0)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Escrow / Inflows float
          </div>
        </div>

        {/* GST Output Liability */}
        <div className="surface-card rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
            GST Output (18%)
          </div>
          <div className="font-mono-data mt-1 text-[20px] font-bold" style={{ color: 'var(--warning)' }}>
            {formatCurrency(comp.gst_output_commission?.balance ?? 0)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Net: {formatCurrency(comp.net_gst_payable?.balance ?? 0)} (post ITC)
          </div>
        </div>

        {/* Sec 194-O TDS */}
        <div className="surface-card rounded-xl border p-3.5" style={{ borderColor: 'var(--border)' }}>
          <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
            TDS Sec 194-O (1%)
          </div>
          <div className="font-mono-data mt-1 text-[20px] font-bold" style={{ color: 'var(--ink)' }}>
            {formatCurrency(drv.tds_194o_deducted?.balance ?? 0)}
          </div>
          <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Form 26Q e-Commerce Pool
          </div>
        </div>
      </div>

      {/* NAVIGATION TABS */}
      <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
        {[
          { id: 'overview', label: 'Financial Summary & Ledgers', icon: Receipt },
          { id: 'customer', label: 'Customer Accounts (3)', icon: Users },
          { id: 'driver', label: 'Driver Accounts (4)', icon: Truck },
          { id: 'company', label: 'Company P&L & Tax (7)', icon: Building2 },
          { id: 'debtors_creditors', label: 'Debtors & Creditors', icon: Scale },
          { id: 'journal', label: 'Journal Audit Trail', icon: FileSpreadsheet },
        ].map((tab) => {
          const Icon = tab.icon
          const active = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className="relative flex items-center gap-2 px-4 py-2.5 text-[13px] font-medium transition-colors"
              style={{
                color: active ? 'var(--ink)' : 'var(--ink-muted)',
                borderBottom: active ? '2px solid var(--brand)' : '2px solid transparent',
              }}
            >
              <Icon size={15} />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>

      {/* TAB 1: OVERVIEW (ALL 3 SIDES AT A GLANCE) */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {/* Customer-Side Ledger Box */}
            <div className="surface-card flex flex-col justify-between rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
                      <Users size={16} />
                    </span>
                    <div>
                      <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Customer-Side</h3>
                      <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>Current Liabilities & Customer Float</p>
                    </div>
                  </div>
                  <span className="rounded px-2 py-0.5 text-[10.5px] font-semibold uppercase" style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                    Liabilities
                  </span>
                </div>

                <div className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
                  {/* Advance Received */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {cust.advance_deposit_received?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(cust.advance_deposit_received?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{cust.advance_deposit_received?.code}</span>
                      <span>Active Booking Deposits</span>
                    </div>
                  </div>

                  {/* Customer Wallet */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {cust.customer_wallet_balance?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(cust.customer_wallet_balance?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{cust.customer_wallet_balance?.code}</span>
                      <span>{cust.customer_wallet_balance?.positive_users_count ?? 0} Users with Balance</span>
                    </div>
                  </div>

                  {/* Refunds Payable */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {cust.refunds_payable?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--danger)' }}>
                        {formatCurrency(cust.refunds_payable?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{cust.refunds_payable?.code}</span>
                      <span>Cancelled / Distance Dues</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg p-2.5 text-right" style={{ background: 'var(--bg)' }}>
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
                  Total Customer Liabilities:{' '}
                </span>
                <span className="font-mono-data text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
                  {formatCurrency(cust.total_customer_liabilities ?? 0)}
                </span>
              </div>
            </div>

            {/* Driver-Side Ledger Box */}
            <div className="surface-card flex flex-col justify-between rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                      <Truck size={16} />
                    </span>
                    <div>
                      <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Driver-Side</h3>
                      <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>Partner Earnings & Settlements</p>
                    </div>
                  </div>
                  <span className="rounded px-2 py-0.5 text-[10.5px] font-semibold uppercase" style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                    Fleet Ledger
                  </span>
                </div>

                <div className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
                  {/* Driver Earnings Payable */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {drv.driver_earnings_payable?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(drv.driver_earnings_payable?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{drv.driver_earnings_payable?.code}</span>
                      <span>Gross Fleet Share</span>
                    </div>
                  </div>

                  {/* Commission Receivable (Cash) */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {drv.platform_commission_receivable?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--brand)' }}>
                        {formatCurrency(drv.platform_commission_receivable?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{drv.platform_commission_receivable?.code}</span>
                      <span>Receivable from Cash Trips</span>
                    </div>
                  </div>

                  {/* Driver Wallet / Settlement A/c */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {drv.driver_wallet_settlement?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(drv.driver_wallet_settlement?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>Pending: {formatCurrency(drv.driver_wallet_settlement?.pending_payouts ?? 0)}</span>
                      <span>Settled: {formatCurrency(drv.driver_wallet_settlement?.settled_in_period ?? 0)}</span>
                    </div>
                  </div>

                  {/* Sec 194-O TDS */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {drv.tds_194o_deducted?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--warning)' }}>
                        {formatCurrency(drv.tds_194o_deducted?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{drv.tds_194o_deducted?.code}</span>
                      <span>1% Statutory e-Commerce TDS</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-lg p-2.5" style={{ background: 'var(--bg)' }}>
                <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Debtors: <span className="font-mono-data font-semibold text-red-600">{formatCurrency(drv.sundry_debtors?.balance ?? 0)}</span>
                </span>
                <span className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Creditors: <span className="font-mono-data font-semibold text-emerald-600">{formatCurrency(drv.sundry_creditors?.balance ?? 0)}</span>
                </span>
              </div>
            </div>

            {/* Company-Side Ledger Box */}
            <div className="surface-card flex flex-col justify-between rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div>
                <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                      <Building2 size={16} />
                    </span>
                    <div>
                      <h3 className="text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>Company-Side</h3>
                      <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>P&L, Taxes & Direct Expenses</p>
                    </div>
                  </div>
                  <span className="rounded px-2 py-0.5 text-[10.5px] font-semibold uppercase" style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                    P&L / Balance Sheet
                  </span>
                </div>

                <div className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
                  {/* Platform Commission Income */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {comp.platform_commission_income?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--brand)' }}>
                        {formatCurrency(comp.platform_commission_income?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{comp.platform_commission_income?.code}</span>
                      <span>Online: {formatCurrency(comp.platform_commission_income?.online_portion ?? 0)} | Cash: {formatCurrency(comp.platform_commission_income?.cash_portion ?? 0)}</span>
                    </div>
                  </div>

                  {/* Cancellation Income */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {comp.cancellation_charges_income?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                        {formatCurrency(comp.cancellation_charges_income?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{comp.cancellation_charges_income?.code}</span>
                      <span>Cancellation Penalty Fees</span>
                    </div>
                  </div>

                  {/* GST Output vs ITC */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        GST Output (18%) less ITC
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--warning)' }}>
                        {formatCurrency(comp.net_gst_payable?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>Output: {formatCurrency(comp.gst_output_commission?.balance ?? 0)}</span>
                      <span>ITC Credit: -{formatCurrency(comp.input_tax_credit?.balance ?? 0)}</span>
                    </div>
                  </div>

                  {/* Razorpay Gateway Charges */}
                  <div className="py-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12.5px] font-medium" style={{ color: 'var(--ink)' }}>
                        {comp.razorpay_gateway_charges?.name}
                      </span>
                      <span className="font-mono-data text-[14px] font-semibold" style={{ color: 'var(--danger)' }}>
                        -{formatCurrency(comp.razorpay_gateway_charges?.balance ?? 0)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                      <span>{comp.razorpay_gateway_charges?.code}</span>
                      <span>~2% Gateway Merchant Fee</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-lg p-2.5 text-right" style={{ background: 'var(--bg)' }}>
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
                  Net Platform Profit:{' '}
                </span>
                <span className="font-mono-data text-[15px] font-bold" style={{ color: 'var(--success)' }}>
                  {formatCurrency(s.net_operating_profit ?? 0)}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: CUSTOMER ACCOUNTS IN DETAIL */}
      {activeTab === 'customer' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Card 1 */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {cust.advance_deposit_received?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  Liability
                </span>
              </div>
              <h3 className="mt-2 text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                {cust.advance_deposit_received?.name}
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {cust.advance_deposit_received?.description}
              </p>
              <div className="font-mono-data mt-4 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(cust.advance_deposit_received?.balance ?? 0)}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Period deposits completed: {formatCurrency(cust.advance_deposit_received?.period_flow ?? 0)}
              </div>
            </div>

            {/* Card 2 */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {cust.customer_wallet_balance?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  Liability
                </span>
              </div>
              <h3 className="mt-2 text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                {cust.customer_wallet_balance?.name}
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {cust.customer_wallet_balance?.description}
              </p>
              <div className="font-mono-data mt-4 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(cust.customer_wallet_balance?.balance ?? 0)}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Active users holding wallet balance: {cust.customer_wallet_balance?.positive_users_count ?? 0}
              </div>
            </div>

            {/* Card 3 */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {cust.refunds_payable?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                  Payable
                </span>
              </div>
              <h3 className="mt-2 text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                {cust.refunds_payable?.name}
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                {cust.refunds_payable?.description}
              </p>
              <div className="font-mono-data mt-4 text-[22px] font-bold" style={{ color: 'var(--danger)' }}>
                {formatCurrency(cust.refunds_payable?.balance ?? 0)}
              </div>
              <div className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Distance adjustments & cancellations
              </div>
            </div>
          </div>

          {/* Top Customer Wallet Holders */}
          <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
            <h4 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
              Top Customer Wallet Balance Liabilities
            </h4>
            <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr style={{ background: 'var(--bg)' }}>
                    <th className="px-3 py-2 text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Customer</th>
                    <th className="px-3 py-2 text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Mobile</th>
                    <th className="px-3 py-2 text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Email</th>
                    <th className="px-3 py-2 text-right text-[10.5px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Wallet Stored Liability</th>
                  </tr>
                </thead>
                <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                  {(!partyData?.customer_wallets || partyData.customer_wallets.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-3 py-6 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                        No positive customer wallet balances recorded.
                      </td>
                    </tr>
                  )}
                  {partyData?.customer_wallets?.map((c) => (
                    <tr key={c.id}>
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--ink)' }}>{c.name}</td>
                      <td className="font-mono-data px-3 py-2" style={{ color: 'var(--ink-muted)' }}>{c.mobile || '—'}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--ink-muted)' }}>{c.email || '—'}</td>
                      <td className="font-mono-data px-3 py-2 text-right font-bold" style={{ color: 'var(--brand)' }}>
                        {formatCurrency(c.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: DRIVER ACCOUNTS IN DETAIL */}
      {activeTab === 'driver' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Driver Earnings Payable */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {drv.driver_earnings_payable?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  Payable
                </span>
              </div>
              <h3 className="mt-2 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                {drv.driver_earnings_payable?.name}
              </h3>
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                {drv.driver_earnings_payable?.description}
              </p>
              <div className="font-mono-data mt-4 text-[20px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(drv.driver_earnings_payable?.balance ?? 0)}
              </div>
            </div>

            {/* Platform Commission Receivable */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {drv.platform_commission_receivable?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--info-soft)', color: 'var(--info)' }}>
                  Asset
                </span>
              </div>
              <h3 className="mt-2 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                {drv.platform_commission_receivable?.name}
              </h3>
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                {drv.platform_commission_receivable?.description}
              </p>
              <div className="font-mono-data mt-4 text-[20px] font-bold" style={{ color: 'var(--brand)' }}>
                {formatCurrency(drv.platform_commission_receivable?.balance ?? 0)}
              </div>
            </div>

            {/* Driver Wallet / Settlement A/c */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {drv.driver_wallet_settlement?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                  Clearing
                </span>
              </div>
              <h3 className="mt-2 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                {drv.driver_wallet_settlement?.name}
              </h3>
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                Pending Payouts: {formatCurrency(drv.driver_wallet_settlement?.pending_payouts ?? 0)}
              </p>
              <div className="font-mono-data mt-4 text-[20px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(drv.driver_wallet_settlement?.balance ?? 0)}
              </div>
            </div>

            {/* TDS Section 194-O */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {drv.tds_194o_deducted?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--warning-soft)', color: 'var(--warning)' }}>
                  Statutory
                </span>
              </div>
              <h3 className="mt-2 text-[14px] font-semibold" style={{ color: 'var(--ink)' }}>
                {drv.tds_194o_deducted?.name}
              </h3>
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                1% E-Commerce Operator TDS for IT Dept
              </p>
              <div className="font-mono-data mt-4 text-[20px] font-bold" style={{ color: 'var(--warning)' }}>
                {formatCurrency(drv.tds_194o_deducted?.balance ?? 0)}
              </div>
            </div>
          </div>

          {/* Debtors vs Creditors Glance */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--danger)' }}>
                    Sundry Debtors — Driver (Negative Balances)
                  </h4>
                  <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                    Drivers who collected cash fares and have not yet paid platform commission
                  </p>
                </div>
                <div className="font-mono-data text-[18px] font-bold text-red-600">
                  {formatCurrency(drv.sundry_debtors?.balance ?? 0)}
                </div>
              </div>
              <div className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                Total Debtors: {drv.sundry_debtors?.count ?? 0} drivers
              </div>
            </div>

            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--success)' }}>
                    Sundry Creditors — Driver (Net Payable Pending)
                  </h4>
                  <p className="mt-0.5 text-[11.5px]" style={{ color: 'var(--ink-muted)' }}>
                    Drivers with positive wallet balance awaiting withdrawal or payout batch
                  </p>
                </div>
                <div className="font-mono-data text-[18px] font-bold text-emerald-600">
                  {formatCurrency(drv.sundry_creditors?.balance ?? 0)}
                </div>
              </div>
              <div className="mt-2 text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                Total Creditors: {drv.sundry_creditors?.count ?? 0} drivers
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: COMPANY P&L, TAX & NODAL ACCOUNT */}
      {activeTab === 'company' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Commission Income */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {comp.platform_commission_income?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                  Revenue
                </span>
              </div>
              <h3 className="mt-2 text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                {comp.platform_commission_income?.name}
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Core take-rate from shipments
              </p>
              <div className="font-mono-data mt-4 text-[22px] font-bold" style={{ color: 'var(--brand)' }}>
                {formatCurrency(comp.platform_commission_income?.balance ?? 0)}
              </div>
              <div className="mt-1 flex justify-between text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                <span>Online: {formatCurrency(comp.platform_commission_income?.online_portion ?? 0)}</span>
                <span>Cash: {formatCurrency(comp.platform_commission_income?.cash_portion ?? 0)}</span>
              </div>
            </div>

            {/* Cancellation Charges */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {comp.cancellation_charges_income?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
                  Other Income
                </span>
              </div>
              <h3 className="mt-2 text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                {comp.cancellation_charges_income?.name}
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Penalty fee on cancelled trips
              </p>
              <div className="font-mono-data mt-4 text-[22px] font-bold" style={{ color: 'var(--ink)' }}>
                {formatCurrency(comp.cancellation_charges_income?.balance ?? 0)}
              </div>
            </div>

            {/* Razorpay Gateway Charges (Expense) */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {comp.razorpay_gateway_charges?.code}
                </span>
                <span className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
                  Expense
                </span>
              </div>
              <h3 className="mt-2 text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                {comp.razorpay_gateway_charges?.name}
              </h3>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Direct PG interchange (~2%)
              </p>
              <div className="font-mono-data mt-4 text-[22px] font-bold" style={{ color: 'var(--danger)' }}>
                -{formatCurrency(comp.razorpay_gateway_charges?.balance ?? 0)}
              </div>
            </div>
          </div>

          {/* Taxes Breakdown: GST Output vs Input Tax Credit (ITC) */}
          <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
            <h4 className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
              Tax Ledger & Compliance (GST SAC 9965 / 9967)
            </h4>
            <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                <div className="text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                  {comp.gst_output_commission?.name}
                </div>
                <div className="font-mono-data mt-1 text-[18px] font-bold" style={{ color: 'var(--warning)' }}>
                  {formatCurrency(comp.gst_output_commission?.balance ?? 0)}
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  18% on platform commission
                </div>
              </div>

              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                <div className="text-[11px] font-medium" style={{ color: 'var(--ink-faint)' }}>
                  {comp.input_tax_credit?.name}
                </div>
                <div className="font-mono-data mt-1 text-[18px] font-bold" style={{ color: 'var(--info)' }}>
                  -{formatCurrency(comp.input_tax_credit?.balance ?? 0)}
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                  Claimable ITC on Razorpay invoices
                </div>
              </div>

              <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
                <div className="text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>
                  Net GST Output Tax Payable
                </div>
                <div className="font-mono-data mt-1 text-[18px] font-bold" style={{ color: 'var(--danger)' }}>
                  {formatCurrency(comp.net_gst_payable?.balance ?? 0)}
                </div>
                <div className="mt-0.5 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                  Payable to CBIC after ITC offset
                </div>
              </div>
            </div>
          </div>

          {/* Bank / Nodal Account Box */}
          <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <span className="font-mono text-[11px] font-semibold" style={{ color: 'var(--brand)' }}>
                  {comp.bank_nodal_account?.code}
                </span>
                <h3 className="text-[15px] font-semibold" style={{ color: 'var(--ink)' }}>
                  {comp.bank_nodal_account?.name}
                </h3>
                <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                  Razorpay Route / Nodal Escrow Float (Customer online collections minus payouts & direct costs)
                </p>
              </div>
              <div className="text-right">
                <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
                  Estimated Liquid Balance
                </span>
                <div className="font-mono-data text-[24px] font-bold" style={{ color: 'var(--info)' }}>
                  {formatCurrency(comp.bank_nodal_account?.balance ?? 0)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: SUNDRY DEBTORS VS SUNDRY CREDITORS */}
      {activeTab === 'debtors_creditors' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Sundry Debtors Table */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <h3 className="text-[14px] font-semibold text-red-600">Sundry Debtors — Driver</h3>
                  <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>Negative wallet balance (Platform commission to recover)</p>
                </div>
                <span className="font-mono-data text-[15px] font-bold text-red-600">
                  {formatCurrency(drv.sundry_debtors?.balance ?? 0)}
                </span>
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Driver</th>
                      <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Mobile</th>
                      <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Vehicle</th>
                      <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Receivable Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {(!partyData?.debtor_drivers || partyData.debtor_drivers.length === 0) && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                          No drivers with negative balances found.
                        </td>
                      </tr>
                    )}
                    {partyData?.debtor_drivers?.map((d) => (
                      <tr key={d.id}>
                        <td className="px-2.5 py-2 font-medium" style={{ color: 'var(--ink)' }}>{d.name}</td>
                        <td className="font-mono-data px-2.5 py-2" style={{ color: 'var(--ink-muted)' }}>{d.mobile || '—'}</td>
                        <td className="font-mono-data px-2.5 py-2" style={{ color: 'var(--ink-faint)' }}>{d.vehicle_no}</td>
                        <td className="font-mono-data px-2.5 py-2 text-right font-bold text-red-600">
                          {formatCurrency(Math.abs(d.balance))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Sundry Creditors Table */}
            <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between border-b pb-2.5" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <h3 className="text-[14px] font-semibold text-emerald-600">Sundry Creditors — Driver</h3>
                  <p className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>Positive wallet balance (Pending payout settlements)</p>
                </div>
                <span className="font-mono-data text-[15px] font-bold text-emerald-600">
                  {formatCurrency(drv.sundry_creditors?.balance ?? 0)}
                </span>
              </div>

              <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr style={{ background: 'var(--bg)' }}>
                      <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Driver</th>
                      <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Mobile</th>
                      <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Vehicle</th>
                      <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Payable Due</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                    {(!partyData?.creditor_drivers || partyData.creditor_drivers.length === 0) && (
                      <tr>
                        <td colSpan={4} className="px-3 py-6 text-center text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                          No drivers with positive payable balances found.
                        </td>
                      </tr>
                    )}
                    {partyData?.creditor_drivers?.map((d) => (
                      <tr key={d.id}>
                        <td className="px-2.5 py-2 font-medium" style={{ color: 'var(--ink)' }}>{d.name}</td>
                        <td className="font-mono-data px-2.5 py-2" style={{ color: 'var(--ink-muted)' }}>{d.mobile || '—'}</td>
                        <td className="font-mono-data px-2.5 py-2" style={{ color: 'var(--ink-faint)' }}>{d.vehicle_no}</td>
                        <td className="font-mono-data px-2.5 py-2 text-right font-bold text-emerald-600">
                          {formatCurrency(d.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: JOURNAL AUDIT TRAIL (FULL SPLIT PER ORDER) */}
      {activeTab === 'journal' && (
        <div className="surface-card rounded-xl border p-4" style={{ borderColor: 'var(--border)' }}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-[14.5px] font-semibold" style={{ color: 'var(--ink)' }}>
                Double-Entry Financial Journal Audit Trail
              </h3>
              <p className="text-[12px]" style={{ color: 'var(--ink-muted)' }}>
                Individual booking financial split: GMV = Driver Gross + Platform Take-Rate + 18% GST + 1% Sec 194-O TDS.
              </p>
            </div>
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
            >
              <Download size={13} />
              <span>Export All to CSV</span>
            </button>
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full whitespace-nowrap text-left text-[12px]">
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Order</th>
                  <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Date</th>
                  <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Customer</th>
                  <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Driver</th>
                  <th className="px-2.5 py-2 text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Mode</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Gross GMV</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Driver Share</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Platform Cut</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>GST 18%</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>TDS 1%</th>
                  <th className="px-2.5 py-2 text-right text-[10px] font-semibold uppercase" style={{ color: 'var(--ink-faint)' }}>Net Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {(!ledgerData?.journal_entries || ledgerData.journal_entries.length === 0) && (
                  <tr>
                    <td colSpan={11} className="px-3 py-8 text-center text-[12.5px]" style={{ color: 'var(--ink-faint)' }}>
                      No orders found in this period.
                    </td>
                  </tr>
                )}
                {ledgerData?.journal_entries?.map((o) => (
                  <tr key={o.id}>
                    <td className="font-mono-data px-2.5 py-2 font-semibold" style={{ color: 'var(--brand)' }}>
                      {o.booking_id}
                    </td>
                    <td className="font-mono-data px-2.5 py-2 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
                      {formatDateTime(o.date)}
                    </td>
                    <td className="px-2.5 py-2 font-medium" style={{ color: 'var(--ink)' }}>
                      {o.customer_name}
                    </td>
                    <td className="px-2.5 py-2" style={{ color: 'var(--ink-muted)' }}>
                      {o.driver_name}
                    </td>
                    <td className="px-2.5 py-2">
                      <span
                        className="rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase"
                        style={{
                          background: o.is_cash ? 'var(--warning-soft)' : 'var(--info-soft)',
                          color: o.is_cash ? 'var(--warning)' : 'var(--info)',
                        }}
                      >
                        {o.payment_mode}
                      </span>
                    </td>
                    <td className="font-mono-data px-2.5 py-2 text-right font-semibold" style={{ color: 'var(--ink)' }}>
                      {formatCurrency(o.fare_gmv)}
                    </td>
                    <td className="font-mono-data px-2.5 py-2 text-right" style={{ color: 'var(--ink-muted)' }}>
                      {formatCurrency(o.driver_gross)}
                    </td>
                    <td className="font-mono-data px-2.5 py-2 text-right font-medium" style={{ color: 'var(--brand)' }}>
                      {formatCurrency(o.platform_commission)}
                    </td>
                    <td className="font-mono-data px-2.5 py-2 text-right" style={{ color: 'var(--warning)' }}>
                      {formatCurrency(o.gst_output)}
                    </td>
                    <td className="font-mono-data px-2.5 py-2 text-right" style={{ color: 'var(--ink-faint)' }}>
                      {formatCurrency(o.tds_194o)}
                    </td>
                    <td className="font-mono-data px-2.5 py-2 text-right font-bold" style={{ color: 'var(--success)' }}>
                      {formatCurrency(o.net_profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

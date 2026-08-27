import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import ProtectedRoute from './components/common/ProtectedRoute'
import RequireRole from './components/common/RequireRole'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'

// Route-level code splitting — with ~20 pages now, bundling them all
// together pushed the main chunk past 500KB even before Leaflet/Recharts.
// Login and the shell stay eager (needed immediately); every routed page
// loads on demand instead.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const LiveTracking = lazy(() => import('./pages/LiveTracking'))
const Orders = lazy(() => import('./pages/Orders'))
const ScheduledOrders = lazy(() => import('./pages/ScheduledOrders'))
const Drivers = lazy(() => import('./pages/Drivers'))
const KycApproval = lazy(() => import('./pages/KycApproval'))
const Customers = lazy(() => import('./pages/Customers'))
const Payouts = lazy(() => import('./pages/Payouts'))
const RateCards = lazy(() => import('./pages/RateCards'))
const Categories = lazy(() => import('./pages/Categories'))
const Vehicles = lazy(() => import('./pages/Vehicles'))
const Cities = lazy(() => import('./pages/Cities'))
const PremiumPlans = lazy(() => import('./pages/PremiumPlans'))
const Coupons = lazy(() => import('./pages/Coupons'))
const Banners = lazy(() => import('./pages/Banners'))
const Referrals = lazy(() => import('./pages/Referrals'))
const Reports = lazy(() => import('./pages/Reports'))
const Faqs = lazy(() => import('./pages/Faqs'))
const LegalPages = lazy(() => import('./pages/LegalPages'))
const CancelReasons = lazy(() => import('./pages/CancelReasons'))
const DynamicQuestions = lazy(() => import('./pages/DynamicQuestions'))
const Staff = lazy(() => import('./pages/Staff'))
const Settings = lazy(() => import('./pages/Settings'))
const NotFound = lazy(() => import('./pages/NotFound'))

function Gated({ roles, children }) {
  return <RequireRole roles={roles}>{children}</RequireRole>
}

function PageFallback() {
  return (
    <div className="flex h-40 items-center justify-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-transparent"
        style={{ borderTopColor: 'var(--brand)', borderRightColor: 'var(--border)' }}
      />
    </div>
  )
}

function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            {/* Operations */}
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/fleet/live-tracking" element={<LiveTracking />} />
            <Route path="/orders" element={<Orders />} />
            <Route path="/orders/scheduled" element={<ScheduledOrders />} />
            <Route path="/drivers" element={<Drivers />} />
            <Route path="/kyc" element={<KycApproval />} />
            <Route path="/customers" element={<Customers />} />

            {/* Fleet & Pricing */}
            <Route path="/rate-cards" element={<RateCards />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/vehicles" element={<Vehicles />} />
            <Route path="/cities" element={<Cities />} />

            {/* Financials & Growth */}
            <Route path="/payouts" element={<Gated roles={['superadmin', 'admin']}><Payouts /></Gated>} />
            <Route path="/marketing/premium-plans" element={<PremiumPlans />} />
            <Route path="/marketing/coupons" element={<Coupons />} />
            <Route path="/marketing/banners" element={<Banners />} />
            <Route path="/referrals" element={<Referrals />} />

            {/* CMS & System Settings */}
            <Route path="/reports" element={<Gated roles={['superadmin', 'admin']}><Reports /></Gated>} />
            <Route path="/cms/faqs" element={<Faqs />} />
            <Route path="/cms/pages" element={<LegalPages />} />
            <Route path="/cms/cancel-reasons" element={<CancelReasons />} />
            <Route path="/settings/dynamic-questions" element={<Gated roles={['superadmin']}><DynamicQuestions /></Gated>} />
            <Route path="/staff" element={<Gated roles={['superadmin', 'admin']}><Staff /></Gated>} />
            <Route path="/settings" element={<Gated roles={['superadmin']}><Settings /></Gated>} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  )
}

export default App

import {
  LayoutDashboard,
  Radar,
  Package,
  CalendarClock,
  Users,
  UserCheck,
  MapPin,
  CalendarCheck,
  ShieldCheck,
  UserCircle,
  Tag,
  LayoutGrid,
  Truck,
  Building2,
  Wallet,
  Crown,
  Ticket,
  Image,
  Share2,
  BarChart3,
  HelpCircle,
  FileText,
  Ban,
  ListChecks,
  CreditCard,
  UserCog,
  Settings,
  GraduationCap,
  ShoppingBag,
  Activity,
  Sunrise,
} from 'lucide-react'

const ALL_STAFF = ['superadmin', 'admin', 'executive']
const MANAGERS = ['superadmin', 'admin']

export const NAV_GROUPS = [
  {
    group: 'Operations',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL_STAFF, built: true },
      { to: '/fleet/live-tracking', label: 'Live Mission Control', icon: Radar, roles: ALL_STAFF, built: true },
      { to: '/orders', label: 'Live Orders', icon: Package, roles: ALL_STAFF, built: true },
      { to: '/orders/scheduled', label: 'Scheduled Orders', icon: CalendarClock, roles: ALL_STAFF, built: true },
      { to: '/orders/next-day', label: 'Next Day Orders', icon: Sunrise, roles: ALL_STAFF, built: true },
      { to: '/custom-orders', label: 'Custom Orders (Bidding)', icon: ShoppingBag, roles: ALL_STAFF, built: true },
      { to: '/drivers', label: 'Drivers Fleet', icon: Users, roles: ALL_STAFF, built: true },
      { to: '/monthly-drivers', label: 'Monthly Drivers', icon: UserCheck, roles: ALL_STAFF, built: true },
      { to: '/fleet/driver-activity', label: 'Driver Duty Logs', icon: Activity, roles: ALL_STAFF, built: true },
      { to: '/driver-training', label: 'Driver Training', icon: GraduationCap, roles: ALL_STAFF, built: true },
      { to: '/kyc', label: 'KYC Approval Dock', icon: ShieldCheck, roles: ALL_STAFF, built: true },
      { to: '/customers', label: 'Customers', icon: UserCircle, roles: ALL_STAFF, built: true },
    ],
  },
  {
    group: 'Fleet & Pricing',
    items: [
      { to: '/service-zones', label: 'Service Zones (Geofence)', icon: MapPin, roles: ALL_STAFF, built: true },
      { to: '/rate-cards', label: 'Rate Cards', icon: Tag, roles: ALL_STAFF, built: true },
      { to: '/categories', label: 'Package Categories', icon: LayoutGrid, roles: ALL_STAFF, built: true },
      { to: '/vehicles', label: 'Vehicle Types', icon: Truck, roles: ALL_STAFF, built: true },
      { to: '/cities', label: 'Operational Cities', icon: Building2, roles: ALL_STAFF, built: true },
    ],
  },
  {
    group: 'Financials & Growth',
    items: [
      { to: '/monthly-attendance', label: 'Monthly Duty & Salary', icon: CalendarCheck, roles: MANAGERS, built: true },
      { to: '/payouts', label: 'Withdrawal Requests', icon: Wallet, roles: MANAGERS, built: true },
      { to: '/marketing/premium-plans', label: 'Premium Plans', icon: Crown, roles: ALL_STAFF, built: true },
      { to: '/marketing/coupons', label: 'Promo Coupons', icon: Ticket, roles: ALL_STAFF, built: true },
      { to: '/marketing/banners', label: 'App Banners', icon: Image, roles: ALL_STAFF, built: true },
      { to: '/referrals', label: 'Referral Network', icon: Share2, roles: ALL_STAFF, built: true },
    ],
  },
  {
    group: 'CMS & System Settings',
    items: [
      { to: '/reports', label: 'Reports & Analytics', icon: BarChart3, roles: MANAGERS, built: true },
      { to: '/cms/faqs', label: 'FAQs & Support', icon: HelpCircle, roles: ALL_STAFF, built: true },
      { to: '/cms/pages', label: 'Legal Pages (CMS)', icon: FileText, roles: ALL_STAFF, built: true },
      { to: '/cms/cancel-reasons', label: 'Cancellation Reasons', icon: Ban, roles: ALL_STAFF, built: true },
      { to: '/settings/dynamic-questions', label: 'Dynamic Questions', icon: ListChecks, roles: ['superadmin'], built: true },
      { to: '/settings', label: 'Payment Gateways', icon: CreditCard, roles: ['superadmin'], built: true },
      { to: '/staff', label: 'Staff Management', icon: UserCog, roles: MANAGERS, built: true },
      { to: '/settings', label: 'Platform Settings', icon: Settings, roles: ['superadmin'], built: true },
    ],
  },
]


export const ROLE_LABELS = {
  superadmin: 'Super Admin',
  admin: 'City Admin',
  executive: 'Executive',
}

// Drives the sidebar's role-colored rail — a quiet, always-visible signal of
// which access level you're operating at.
export const ROLE_ACCENT = {
  superadmin: '#e8871e',
  admin: '#60a5fa',
  executive: '#34d399',
}

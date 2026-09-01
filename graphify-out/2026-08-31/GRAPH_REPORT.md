# Graph Report - Shifter Online  (2026-08-31)

## Corpus Check
- 167 files · ~116,427 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1137 nodes · 2307 edges · 83 communities (64 shown, 15 thin omitted)
- Extraction: 92% EXTRACTED · 8% INFERRED · 0% AMBIGUOUS · INFERRED: 178 edges (avg confidence: 0.86)
- Token cost: 196,363 input · 0 output

## Community Hubs (Navigation)
- Admin CRM Detail Drawers
- App Shell & Live Context Providers
- Analytics & Marketing Controllers
- Backend Package Manifest
- Admin CMS Form Modals
- Marketing & Master Data Form Modals
- Admin App Route Table
- Staff Auth & Access Control
- Order & Tracking Socket Wiring
- Banner & Category Form Modals
- Admin Panel Sections Spec
- Admin Order Controller
- Driver KYC Approval Flow
- 20-Driver Order Flow Test Script
- Order Rejection Flow Test Script
- Single-Model No-Driver Test Script
- Customer Order Controller
- Frontend Runtime Dependencies
- 100x500 Dispatch Load Simulation
- Order Acceptance Flow Test Script
- Dispatch Manager Service
- Frontend Lint Tooling
- Dispatch Simulator UI Page
- CMS Content Controller
- Trip Lifecycle Service
- Order Flow API Spec Endpoints
- Master Data Controller
- Pricing Engine Service
- Admin Rider/KYC Controller
- Admin Password Reset Script
- Rate Card Controller
- Rider Controller
- Live Fleet Dashboard
- Dispatch Engine Implementation Plan
- Backend README
- Express App Bootstrap
- Dynamic Question Controller
- Admin Socket Notifications
- Frontend README
- Rate Card Admin UI
- Payment Gateway Settings UI
- Admin Customer Controller
- Auth Controller
- Staff Controller
- Driver Lock Manager Service
- Referral Controller
- Frontend Package Manifest
- Fleet Controller & DB Client
- Firebase Push Notifications
- Custom Order Controller
- Settings Controller
- FAQ Admin UI
- Real-Time Dispatch Cascade Concepts
- Dummy Driver Seeding Script
- Payout Controller
- Prisma Client & User Routes
- Server Entrypoint
- Revenue/Trips Chart Component
- Trip Lifecycle Unit Tests
- 5s Batch Gap Test Script
- Live Order Flow Render Test Script
- Tier Priority Flow Test Script
- Location Routes
- Atomic Order Acceptance Concepts
- React Hooks Lint Plugin
- React Runtime Dependency
- React DOM Dependency
- ESLint Globals Config
- Vercel Config (Backend)
- Vercel Config (Frontend)
- App Favicon Asset
- Frontend App Identity
- Bluesky Icon Asset
- Discord Icon Asset
- Documentation Icon Asset
- GitHub Icon Asset
- Shared Icon Sprite Sheet
- Social/Community Icon Asset
- X (Twitter) Icon Asset

## God Nodes (most connected - your core abstractions)
1. `useApiQuery()` - 74 edges
2. `useAuth()` - 53 edges
3. `api` - 53 edges
4. `useToast()` - 41 edges
5. `Modal()` - 35 edges
6. `formatCurrency()` - 29 edges
7. `Order Flow Node.js Specification` - 28 edges
8. `Badge()` - 26 edges
9. `Dispatch Simulator page` - 26 edges
10. `useSocket()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `Package Orders (Real-Time Dispatch Engine)` --semantically_similar_to--> `5s/15s Overlapping Batch Dispatch Cascade`  [INFERRED] [semantically similar]
  ADMIN_PANEL_SECTIONS_AND_MODULES_SPECIFICATION.md → backend/ORDER_FLOW_NODEJS_SPECIFICATION.md
- `Admin Panel Sections & Modules Specification` --conceptually_related_to--> `Shifter Admin Vite Entry Shell`  [INFERRED]
  ADMIN_PANEL_SECTIONS_AND_MODULES_SPECIFICATION.md → frontend/index.html
- `Package Order Reports (Analytics)` --shares_data_with--> `pkg_order table`  [INFERRED]
  ADMIN_PANEL_SECTIONS_AND_MODULES_SPECIFICATION.md → backend/ORDER_FLOW_NODEJS_SPECIFICATION.md
- `Package Orders (Real-Time Dispatch Engine)` --shares_data_with--> `pkg_order table`  [INFERRED]
  ADMIN_PANEL_SECTIONS_AND_MODULES_SPECIFICATION.md → backend/ORDER_FLOW_NODEJS_SPECIFICATION.md
- `Package Orders (Real-Time Dispatch Engine)` --shares_data_with--> `pkg_order_wait_timer table`  [INFERRED]
  ADMIN_PANEL_SECTIONS_AND_MODULES_SPECIFICATION.md → backend/ORDER_FLOW_NODEJS_SPECIFICATION.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Node.js + Express + Prisma + MySQL Backend Stack** — backend_readme_nodejs, backend_readme_express, backend_readme_prisma, backend_readme_mysql [EXTRACTED 1.00]
- **Alternative Vite React Plugin Options (Oxc vs SWC)** — frontend_readme_vitejs_plugin_react, frontend_readme_oxc, frontend_readme_vitejs_plugin_react_swc, frontend_readme_swc [EXTRACTED 1.00]
- **Real-Time Dispatch Cascade System** — admin_panel_sections_and_modules_specification_package_orders_dispatch_engine, backend_order_flow_nodejs_specification_dispatch_cascade_engine, docs_superpowers_plans_2026_08_26_order_dispatch_engine_dispatchmanager, backend_public_index_doc, backend_scripts_last_test_output_doc [INFERRED 0.85]
- **Order Lifecycle Socket Event Contract** — backend_order_flow_nodejs_specification_order_request_event, backend_order_flow_nodejs_specification_order_accept_event, backend_order_flow_nodejs_specification_order_dismiss_event, backend_order_flow_nodejs_specification_order_assigned_event, backend_public_index_doc [EXTRACTED 1.00]
- **Shared Order/Rider DB Schema** — backend_order_flow_nodejs_specification_pkg_order, backend_order_flow_nodejs_specification_tbl_rider, backend_order_flow_nodejs_specification_tbl_order_requests, admin_panel_sections_and_modules_specification_package_orders_dispatch_engine, admin_panel_sections_and_modules_specification_rider_driver_section [INFERRED 0.85]

## Communities (83 total, 15 thin omitted)

### Community 0 - "Admin CRM Detail Drawers"
Cohesion: 0.06
Nodes (48): Customers, Payouts, Referrals, Drawer(), KpiCard(), TREND_VARS, Pagination(), CustomerDetailDrawer() (+40 more)

### Community 1 - "App Shell & Live Context Providers"
Cohesion: 0.06
Nodes (45): App(), AppShell(), KPI_ROLES, Sidebar(), Topbar(), createDriverIcon(), createDropoffIcon(), createPickupIcon() (+37 more)

### Community 2 - "Analytics & Marketing Controllers"
Cohesion: 0.05
Nodes (48): cityComparison(), internalError(), logger, monthComparison(), overview(), { Prisma }, round2(), salesReport() (+40 more)

### Community 3 - "Backend Package Manifest"
Cohesion: 0.04
Nodes (45): author, dependencies, bcryptjs, cors, dotenv, express, firebase-admin, jsonwebtoken (+37 more)

### Community 4 - "Admin CMS Form Modals"
Cohesion: 0.10
Nodes (22): CancelReasons, CancelReasonFormModal(), EMPTY_FORM, FIELD_STYLE, EMPTY_FORM, FIELD_STYLE, Modal(), WalletAdjustModal() (+14 more)

### Community 5 - "Marketing & Master Data Form Modals"
Cohesion: 0.09
Nodes (17): PageFormModal(), Badge(), TONE_VARS, CouponFormModal(), PremiumPlanFormModal(), CityFormModal(), VehicleFormModal(), QuestionFormModal() (+9 more)

### Community 6 - "Admin App Route Table"
Cohesion: 0.10
Nodes (18): Banners, Categories, Cities, Coupons, Drivers, DynamicQuestions, LegalPages, LiveTracking (+10 more)

### Community 7 - "Staff Auth & Access Control"
Cohesion: 0.13
Nodes (12): Staff, ProtectedRoute(), RequireRole(), FIELD_STYLE, StaffFormModal(), AuthContext, useAuth(), CancelReasons() (+4 more)

### Community 8 - "Order & Tracking Socket Wiring"
Cohesion: 0.12
Nodes (19): logger, registerOrderHandlers(), tripLifecycle, adminSocket, dispatchManager, initSocket(), logger, prisma (+11 more)

### Community 9 - "Banner & Category Form Modals"
Cohesion: 0.18
Nodes (11): BannerFormModal(), EMPTY_FORM, FIELD_STYLE, CategoryFormModal(), EMPTY_FORM, FIELD_STYLE, useApiQuery(), Banners() (+3 more)

### Community 10 - "Admin Panel Sections Spec"
Cohesion: 0.10
Nodes (21): Banner Section, City Section, Coupon Section (Promotions), Customer Section, Dashboard Section, Admin Panel Sections & Modules Specification, Dynamic Section (Driver Onboarding Questions), FAQ Section (+13 more)

### Community 11 - "Admin Order Controller"
Cohesion: 0.19
Nodes (20): adminSocket, assignRider(), assignScheduledDriver(), cancel(), dispatchManager, EDITABLE_FIELDS, { getIO }, getOne() (+12 more)

### Community 12 - "Driver KYC Approval Flow"
Cohesion: 0.13
Nodes (10): KycApproval, DocumentDecisionCard(), DocumentImageViewer(), KycApproval(), handleDecide(), onKey(), DOC_STATUS_LABELS, DOC_STATUS_TONES (+2 more)

### Community 13 - "20-Driver Order Flow Test Script"
Cohesion: 0.16
Nodes (19): app, BIKE_PACKAGE_IDS, cleanup(), connect20DriverSockets(), http, { initSocket }, ioClient, main() (+11 more)

### Community 14 - "Order Rejection Flow Test Script"
Cohesion: 0.16
Nodes (19): app, cleanup(), connectSockets(), driverSockets, http, { initSocket }, ioClient, main() (+11 more)

### Community 15 - "Single-Model No-Driver Test Script"
Cohesion: 0.16
Nodes (19): app, cleanup(), connectSockets(), driverSockets, http, { initSocket }, ioClient, main() (+11 more)

### Community 16 - "Customer Order Controller"
Cohesion: 0.11
Nodes (14): adminSocket, createOrder(), dispatchManager, fareEstimate(), { getRoadDistanceKm }, isFiniteNumber(), logger, pricingEngine (+6 more)

### Community 17 - "Frontend Runtime Dependencies"
Cohesion: 0.11
Nodes (19): axios, dompurify, @fontsource/inter, @fontsource/jetbrains-mono, dependencies, axios, dompurify, @fontsource/inter (+11 more)

### Community 18 - "100x500 Dispatch Load Simulation"
Cohesion: 0.16
Nodes (16): findEligibleCandidates(), generate100Orders(), generate500Drivers(), { haversineKm }, lockManager, { MAX_DRIVERS_PER_BATCH, POPUP_TIMEOUT_MS }, PACKAGE_NAMES, run100x500Simulation() (+8 more)

### Community 19 - "Order Acceptance Flow Test Script"
Cohesion: 0.17
Nodes (18): app, cleanup(), connectSockets(), driverSockets, http, { initSocket }, ioClient, main() (+10 more)

### Community 20 - "Dispatch Manager Service"
Cohesion: 0.16
Nodes (15): activeDispatches, adminSocket, buildOrderRequestPayload(), checkCascadeTermination(), getPreviouslyAttemptedRiderIds(), lockManager, logger, {
  POPUP_TIMEOUT_MS,
  BATCH_GAP_MS,
  MAX_DRIVERS_PER_BATCH,
  MAX_TOPUP_ROUNDS,
  SEARCH_RADIUS_KM,
  STARTUP_RECOVERY_BUFFER_SECONDS,
} (+7 more)

### Community 21 - "Frontend Lint Tooling"
Cohesion: 0.11
Nodes (19): eslint, @eslint/js, eslint-plugin-react-refresh, devDependencies, eslint, @eslint/js, eslint-plugin-react-refresh, tailwindcss (+11 more)

### Community 22 - "Dispatch Simulator UI Page"
Cohesion: 0.19
Nodes (16): api() fetch helper, Dispatch Simulator page, emitCustomer(), emitDriver(), hideRequestPopup(), joinDriverSocket(), loadCategories(), loadRiderModelAccess() (+8 more)

### Community 23 - "CMS Content Controller"
Cohesion: 0.21
Nodes (16): CANCEL_REASON_TYPES, createCancelReason(), createFaq(), createPage(), deleteCancelReason(), deleteFaq(), deletePage(), internalError() (+8 more)

### Community 24 - "Trip Lifecycle Service"
Cohesion: 0.15
Nodes (13): acceptOrder(), adminSocket, dispatchManager, lockManager, logger, notifyAdminStatus(), OfferNotFreshError, OrderAlreadyTakenError (+5 more)

### Community 25 - "Order Flow API Spec Endpoints"
Cohesion: 0.13
Nodes (16): Package Section (Rate Cards & Categories), POST /api/order/customer-cancel, Order Flow Node.js Specification, POST /api/order/fare-estimate, driver:location_ping / location_stream events, order:assigned socket event, POST /api/order/details, order_status_history table (+8 more)

### Community 26 - "Master Data Controller"
Cohesion: 0.23
Nodes (15): createCategory(), createCity(), createVehicle(), deleteCategory(), deleteCity(), deleteVehicle(), internalError(), listCategories() (+7 more)

### Community 27 - "Pricing Engine Service"
Cohesion: 0.25
Nodes (14): calculateCommissionPercent(), calculateDriverEarning(), calculateFare(), commissionAmount(), getFareEstimate(), getPackageById(), getPackagesForCategory(), { getRoadDistanceKm } (+6 more)

### Community 28 - "Admin Rider/KYC Controller"
Cohesion: 0.26
Nodes (13): attachCityNames(), DOC_STATUS, DOC_TYPE_HANDLERS, getOne(), internalError(), isScopedOut(), kycDecision(), list() (+5 more)

### Community 29 - "Admin Password Reset Script"
Cohesion: 0.15
Nodes (7): bcrypt, { BCRYPT_SALT_ROUNDS }, prisma, dispatchManager, lockManager, { POPUP_TIMEOUT_MS, BATCH_GAP_MS }, prisma

### Community 30 - "Rate Card Controller"
Cohesion: 0.31
Nodes (12): create(), formatTime(), getOne(), internalError(), list(), logger, PACKAGE_TYPES, prisma (+4 more)

### Community 31 - "Rider Controller"
Cohesion: 0.15
Nodes (5): logger, prisma, express, riderController, router

### Community 32 - "Live Fleet Dashboard"
Cohesion: 0.22
Nodes (10): Dashboard, FILTERS, LiveFleetMap(), markerIcon(), riderTooltipContent(), computeTrend(), currency, Dashboard() (+2 more)

### Community 33 - "Dispatch Engine Implementation Plan"
Cohesion: 0.17
Nodes (12): POST /api/order/create, One Driver = One Popup Global Lock, order:dismiss socket event, Socket.io Room Architecture, dispatchManager.js (planned), Order & Dispatch Microservice Implementation Plan, geoDistance.js (planned), Layered Architecture Rationale (+4 more)

### Community 34 - "Backend README"
Cohesion: 0.24
Nodes (12): Backend README, DATABASE_URL Environment Variable, npm run dev (nodemon auto-restart), Express, MySQL, Node.js, PORT Environment Variable, Prisma (+4 more)

### Community 35 - "Express App Bootstrap"
Cohesion: 0.17
Nodes (11): adminRoutes, app, cors, express, fs, locationRoutes, logger, orderRoutes (+3 more)

### Community 36 - "Dynamic Question Controller"
Cohesion: 0.27
Nodes (11): createOption(), createQuestion(), deleteOption(), deleteQuestion(), internalError(), listOptions(), listQuestions(), logger (+3 more)

### Community 37 - "Admin Socket Notifications"
Cohesion: 0.26
Nodes (9): broadcastToScope(), jwt, logger, notifyDispatchAlert(), notifyDriverKycSubmitted(), notifyLiveDriverPing(), notifyNewOrder(), notifyOrderStatusUpdate() (+1 more)

### Community 38 - "Frontend README"
Cohesion: 0.20
Nodes (12): Frontend README, ESLint, HMR (Hot Module Replacement), Oxc, React, React Compiler, SWC, TypeScript (+4 more)

### Community 39 - "Rate Card Admin UI"
Cohesion: 0.18
Nodes (5): RateCards, EMPTY_FORM, FIELD_STYLE, RateCardFormModal(), RateCards()

### Community 40 - "Payment Gateway Settings UI"
Cohesion: 0.17
Nodes (6): Settings, FIELD_STYLE, PaymentGateways(), SETTING_FIELDS, Settings(), SettingsForm()

### Community 41 - "Admin Customer Controller"
Cohesion: 0.35
Nodes (10): attachCityNames(), getOne(), internalError(), isScopedOut(), list(), logger, prisma, remove() (+2 more)

### Community 42 - "Auth Controller"
Cohesion: 0.29
Nodes (10): bcrypt, { BCRYPT_SALT_ROUNDS }, getCityName(), jwt, logger, login(), me(), prisma (+2 more)

### Community 43 - "Staff Controller"
Cohesion: 0.29
Nodes (9): attachCityNames(), bcrypt, { BCRYPT_SALT_ROUNDS, ADMIN_ROLES }, create(), list(), logger, prisma, toPublicStaff() (+1 more)

### Community 44 - "Driver Lock Manager Service"
Cohesion: 0.22
Nodes (5): acquireLock(), activePopups, getLock(), isLocked(), lockManager

### Community 45 - "Referral Controller"
Cohesion: 0.29
Nodes (7): adjustPoints(), getSettings(), internalError(), listUserReferrals(), logger, prisma, updateSettings()

### Community 46 - "Frontend Package Manifest"
Cohesion: 0.20
Nodes (9): name, private, scripts, build, dev, lint, preview, type (+1 more)

### Community 47 - "Fleet Controller & DB Client"
Cohesion: 0.28
Nodes (7): logger, prisma, driverActivity(), internalError(), liveTracking(), logger, prisma

### Community 48 - "Firebase Push Notifications"
Cohesion: 0.33
Nodes (7): initFirebase(), logger, sendPushNotification(), error(), info(), timestamp(), warn()

### Community 49 - "Custom Order Controller"
Cohesion: 0.36
Nodes (8): convert(), CUSTOM_ORDER_STATUSES, getBids(), internalError(), isScopedOut(), list(), logger, prisma

### Community 50 - "Settings Controller"
Cohesion: 0.33
Nodes (8): getSettings(), internalError(), listPaymentGateways(), logger, prisma, SETTING_PUBLIC_FIELDS, updatePaymentGateway(), updateSettings()

### Community 51 - "FAQ Admin UI"
Cohesion: 0.25
Nodes (5): Faqs, EMPTY_FORM, FaqFormModal(), FIELD_STYLE, Faqs()

### Community 52 - "Real-Time Dispatch Cascade Concepts"
Cohesion: 0.32
Nodes (8): Package Orders (Real-Time Dispatch Engine), 5s/15s Overlapping Batch Dispatch Cascade, order:request socket event, pkg_order_wait_timer table, Re-eligibility & Anti-Spam Priority Rules, tbl_order_requests table, 20-Bike-Driver Dispatch Cascade Test Log, Tier Exhaustion Fix Analysis

### Community 53 - "Dummy Driver Seeding Script"
Cohesion: 0.36
Nodes (7): CATEGORY_SHORT_CODES, jitter(), main(), MOBILE_BLOCK_BASE, pad2(), prisma, seedCategory()

### Community 54 - "Payout Controller"
Cohesion: 0.39
Nodes (7): approve(), internalError(), list(), logger, prisma, reject(), riderName()

### Community 55 - "Prisma Client & User Routes"
Cohesion: 0.29
Nodes (5): prisma, { PrismaClient }, express, prisma, router

### Community 56 - "Server Entrypoint"
Cohesion: 0.29
Nodes (6): app, dispatchManager, http, { initSocket }, logger, server

### Community 57 - "Revenue/Trips Chart Component"
Cohesion: 0.38
Nodes (6): ChartTooltip(), dayLabel, fillLast7Days(), last7DayRange(), RevenueTripsChart(), RevenueTripsChart

### Community 58 - "Trip Lifecycle Unit Tests"
Cohesion: 0.33
Nodes (5): dispatchManager, lockManager, pricingEngine, prisma, tripLifecycle

### Community 59 - "5s Batch Gap Test Script"
Cohesion: 0.60
Nodes (4): ioClient, prisma, sleep(), test5SecBatchGap()

### Community 60 - "Live Order Flow Render Test Script"
Cohesion: 0.60
Nodes (4): ioClient, prisma, runRenderTest(), sleep()

### Community 61 - "Tier Priority Flow Test Script"
Cohesion: 0.60
Nodes (4): ioClient, prisma, sleep(), testTierPriority()

### Community 62 - "Location Routes"
Cohesion: 0.50
Nodes (3): express, logger, router

### Community 63 - "Atomic Order Acceptance Concepts"
Cohesion: 0.67
Nodes (3): Atomic First-Come-First-Served Acceptance, order:accept socket event, tripLifecycle.js (planned)

## Knowledge Gaps
- **367 isolated node(s):** `name`, `version`, `description`, `main`, `node` (+362 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 487 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useApiQuery()` connect `Banner & Category Form Modals` to `Admin CRM Detail Drawers`, `Live Fleet Dashboard`, `App Shell & Live Context Providers`, `Admin CMS Form Modals`, `Marketing & Master Data Form Modals`, `Admin App Route Table`, `Rate Card Admin UI`, `Staff Auth & Access Control`, `Payment Gateway Settings UI`, `Driver KYC Approval Flow`, `FAQ Admin UI`, `Revenue/Trips Chart Component`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `api` connect `Admin CMS Form Modals` to `Live Fleet Dashboard`, `Admin CRM Detail Drawers`, `App Shell & Live Context Providers`, `Marketing & Master Data Form Modals`, `Admin App Route Table`, `Rate Card Admin UI`, `Staff Auth & Access Control`, `Banner & Category Form Modals`, `Payment Gateway Settings UI`, `Driver KYC Approval Flow`, `FAQ Admin UI`, `Revenue/Trips Chart Component`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **Why does `DocumentImageViewer()` connect `Driver KYC Approval Flow` to `Banner & Category Form Modals`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _367 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Admin CRM Detail Drawers` be split into smaller, more focused modules?**
  _Cohesion score 0.05708548479632817 - nodes in this community are weakly interconnected._
- **Should `App Shell & Live Context Providers` be split into smaller, more focused modules?**
  _Cohesion score 0.0553116769095698 - nodes in this community are weakly interconnected._
- **Should `Analytics & Marketing Controllers` be split into smaller, more focused modules?**
  _Cohesion score 0.05101327742837177 - nodes in this community are weakly interconnected._
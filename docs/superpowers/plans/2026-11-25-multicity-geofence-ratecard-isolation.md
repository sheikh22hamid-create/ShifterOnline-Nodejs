# Comprehensive Multi-City Geofence, Settings & Rate Card Isolation Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement true multi-tenant city isolation across Shifter Online. Every city (e.g. Ujjain, Indore) maintains its own isolated Geofence boundaries, Rate Cards, Vehicle Categories, and Operational Settings. Changes made by a City Admin apply **strictly inside that city's geofenced boundary** and are invisible to other cities. Any geographic area without a defined geofence (highways, unmapped towns, rural areas) automatically falls back to **Global India Admin settings and configurations**.

---

## 1. Core Architectural Pillars

### A. The 3-Tier Geographic Hierarchy
```
                   [ Customer / Driver Interaction ]
                    (Lat, Lng Pickup / GPS Location)
                                   │
                                   ▼
                   ┌───────────────────────────────┐
                   │   cityGeofenceService.js      │
                   │  (Cached Point-In-Polygon)    │
                   └───────────────┬───────────────┘
                                   │
           ┌───────────────────────┴───────────────────────┐
           ▼                                               ▼
[Inside Defined City Geofence]                 [Outside Any Geofence / Highway]
  (e.g., Ujjain Polygon)                                   │
           │                                               ▼
           ▼                                   ┌───────────────────────┐
┌──────────────────────────────────────┐       │  Global India Admin   │
│ Priority 1: City Specific Overrides   │       │  Baseline (city_id=0) │
│ - City Rate Cards (tbl_package)      │       │ - Universal Rates     │
│ - City Vehicle Categories            │       │ - Standard Radius     │
│ - City Order/Search Settings         │       │ - Standard Commission │
│ - City No-Entry / Service Zones      │       └───────────────────────┘
└──────────────────┬───────────────────┘                   ▲
                   │ (If any specific config is null)      │
                   └───────────────────────────────────────┘
                            (Automatic Fallback)
```

### B. Settings Inheritance Pattern (Override -> Fallback)
When resolving any configuration parameter `key` for location `(lat, lng)`:
1. Determine `matchedCityId = resolveCityFromCoordinates(lat, lng)`.
2. If `matchedCityId > 0`:
   - Query setting/rate-card specifically for `city_id = matchedCityId`.
   - If found and active, return it (**City Override**).
3. If not found or if `matchedCityId === 0` (un-geofenced area):
   - Query setting/rate-card for `city_id = 0` (**Global India Default**).
   - If found, return it.

---

## 2. Scope Matrix: What Gets Isolated vs What Remains Global

| Module / Entity | City Geofence Level (`city_id > 0`) | Global India Fallback (`city_id = 0`) |
| :--- | :--- | :--- |
| **Rate Cards (`tbl_package`)** | Specific fares, min charge, per-km, night charges, waiting charges per city. | Universal default fare chart for unzoned India bookings. |
| **Vehicle Categories (`pkg_category`)** | Enable/disable specific vehicle types (e.g. 3-Wheeler only in Ujjain; 14ft only in Indore). | All standard vehicle categories enabled by Super Admin. |
| **Order & Dispatch (`city_order_settings`)** | Search radius (e.g. 5 km Ujjain vs 12 km Indore), search timeout seconds, booking guarantee on/off. | Global default search radius (default 5 km, 60s timeout). |
| **General Settings (`app_settings` / `setting`)** | City-level commission %, weather surge, cancellation penalty overrides. | Base company commission, standard cancellation fees. |
| **Geofences & No-Entry Zones** | Precise polygon boundary defining the city limits and vehicle entry restrictions. | N/A (unrestricted unless inside a designated zone). |
| **Admin Panel UI Visibility** | City Admin sees ONLY their city workspace. Cannot see or alter other cities. | Super Admin controls Global baseline + all cities. |

---

## 3. Implementation Tasks Breakdown

### Task 1: Database Normalization & Safe Migration
**Files:**
- Create: `backend/prisma/migrations/20261125020000_multicity_isolation_all_settings/migration.sql`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/scripts/migrate-legacy-city-data.js`

**Details:**
1. `tbl_package`:
   - Change `city_id` from legacy comma string to `Int @default(0)`.
   - Seed `city_id = 0` as "Global India Default".
   - Add index: `@@index([city_id, cat_id, status])`.
2. `pkg_category`:
   - Ensure `city_id Int @default(0)`.
   - `0` means visible across all cities unless overridden.
   - Add index: `@@index([city_id, cat_status])`.
3. `city_order_settings`:
   - Ensure a default row with `city_id = 0` exists as the Global Default search/dispatch baseline.
4. Run migration script on DEV to cleanly split any legacy comma-separated values into single-city rows.

- [ ] Step 1: Write migration SQL and patch script.
- [ ] Step 2: Update `schema.prisma`.
- [ ] Step 3: Run `npx prisma generate` and verify client compilation.
- [ ] Step 4: Commit.

---

### Task 2: High-Performance Geofence Point-in-Polygon Engine
**Files:**
- Create: `backend/src/services/cityGeofenceService.js`
- Create: `backend/src/services/__tests__/cityGeofenceService.test.js`

**Details:**
- Reads active boundary polygons from `tbl_geofence_zones` where `status = true` AND `shape_type = 'polygon'`.
- Uses in-memory caching with TTL (30 minutes) + event-driven cache invalidation whenever an admin edits a geofence.
- Implements high-speed Ray-Casting algorithm (sub-millisecond execution, zero DB hit on every ride request).
- Function Signature:
  ```javascript
  async function resolveCityFromCoordinates(lat, lng): Promise<{ cityId: number, cityName: string, isGeofenced: boolean }>
  ```
  - Inside Ujjain Geofence ➔ `{ cityId: 2, cityName: "Ujjain", isGeofenced: true }`
  - Inside Indore Geofence ➔ `{ cityId: 1, cityName: "Indore", isGeofenced: true }`
  - Outside Geofences / Highway ➔ `{ cityId: 0, cityName: "Global India", isGeofenced: false }`

- [ ] Step 1: Write unit tests covering boundary points, interior points, and exterior highway points.
- [ ] Step 2: Implement `cityGeofenceService.js` with polygon cache and ray-casting.
- [ ] Step 3: Run tests and verify pass.
- [ ] Step 4: Commit.

---

### Task 3: Pricing Engine & Fare Resolution with 2-Tier Fallback
**Files:**
- Modify: `backend/src/services/pricingEngine.js`
- Modify: `backend/src/controllers/orderController.js` (`fareEstimate`, `packageListEstimate`, `getCategories`)
- Modify: `backend/src/controllers/customerContentController.js` (`homeData`)
- Create: `backend/src/services/__tests__/pricingEngineMulticity.test.js`

**Details:**
1. In `orderController.fareEstimate` and `packageListEstimate`:
   - Automatically determine `effectiveCityId = city_id || (await resolveCityFromCoordinates(plat, plong)).cityId`.
2. In `pricingEngine.getPackagesForCategory`:
   - **Step A:** Try finding packages matching `city_id = effectiveCityId AND cat_id = catId AND status = 1`.
   - **Step B (Fallback):** If no packages exist for `effectiveCityId`, query `city_id = 0 AND cat_id = catId AND status = 1` (Global India baseline).
3. In `customerContentController.homeData`:
   - Accept optional `lat`, `lng`.
   - Filter `pkg_category` where `city_id = effectiveCityId OR city_id = 0`.
   - If a city has disabled a category, it does not appear in that city.

- [ ] Step 1: Write tests for 2-tier pricing fallback.
- [ ] Step 2: Wire `cityGeofenceService` into `pricingEngine.js` and `orderController.js`.
- [ ] Step 3: Wire category filtering in `customerContentController.js`.
- [ ] Step 4: Run tests and verify pass.
- [ ] Step 5: Commit.

---

### Task 4: City Order & Dispatch Settings Fallback
**Files:**
- Modify: `backend/src/services/orderSearchSettings.js`
- Modify: `backend/src/controllers/adminOrderSearchController.js`
- Modify: `backend/src/services/dispatchManager.js`

**Details:**
1. In `orderSearchSettings.getCitySettings(cityId)`:
   - If `cityId > 0`, fetch `city_order_settings` for that city.
   - If not found or if `cityId === 0`, fetch `city_order_settings` where `city_id = 0` (Global India Default).
   - If neither exists, return hardcoded system fallback rules.
2. In `dispatchManager.js`:
   - Order dispatch radius and timeout use the resolved city's settings or Global fallback.

- [ ] Step 1: Update `orderSearchSettings.js` to implement fallback to `city_id = 0`.
- [ ] Step 2: Verify dispatch manager consumes resolved settings.
- [ ] Step 3: Commit.

---

### Task 5: Admin Panel Backend RBAC Scoping
**Files:**
- Modify: `backend/src/controllers/rateCardController.js`
- Modify: `backend/src/controllers/masterDataController.js`
- Modify: `backend/src/controllers/settingsController.js`
- Create: `backend/src/routes/__tests__/adminCityRbac.test.js`

**Details:**
1. For City Admin (`req.user.role !== 'superadmin'`):
   - Read operations (`GET /rate-cards`, `GET /categories`): automatically forced to `where.city_id = req.user.city_id`.
   - Write operations (`POST`, `PUT`, `DELETE`): verified against `req.user.city_id`. If payload has a different `city_id`, immediately return `403 Forbidden`.
   - City Admin cannot modify `city_id = 0` (Global Baseline).
2. For Super Admin (`req.user.role === 'superadmin'`):
   - Can select and switch between `city_id = 0` (Global Baseline) or any individual city.
3. Add utility endpoint:
   - `POST /api/v1/admin/rate-cards/clone-from-global` allowing City Admins to copy the Global baseline into their city with 1-click as a starting point.

- [ ] Step 1: Write RBAC protection tests.
- [ ] Step 2: Implement scoping in `rateCardController.js` and `masterDataController.js`.
- [ ] Step 3: Implement clone helper endpoint.
- [ ] Step 4: Run tests and verify pass.
- [ ] Step 5: Commit.

---

### Task 6: Admin Frontend Multi-City UI (`RateCards.jsx`, `Categories.jsx`, `Settings.jsx`)
**Files:**
- Modify: `frontend/src/pages/RateCards.jsx`
- Modify: `frontend/src/pages/Categories.jsx`
- Modify: `frontend/src/pages/OrderSearchSettings.jsx`

**Details:**
1. **Super Admin View:**
   - Top Header City Selector:
     `[🌐 Global India Baseline] [🏙️ Indore] [🏙️ Ujjain] [🏙️ Bhopal] ...`
   - Cards display status pills:
     - `🟢 City Override (Customized for Ujjain)`
     - `⚪ Inherited from Global Default`
2. **City Admin View:**
   - Dropdown is locked and shows their city: e.g. `📍 Ujjain Operations`.
   - Any rate card changes apply directly to Ujjain (`city_id = 2`).
   - "Copy from Global Baseline" button available when setting up a new vehicle.

- [ ] Step 1: Implement Super Admin City Selector component.
- [ ] Step 2: Implement City Admin locked workspace view.
- [ ] Step 3: Test editing in browser under both roles.
- [ ] Step 4: Commit.

---

## 4. Verification & Testing Matrix

| Test Case | Actor / Action | Location / Parameters | Expected Result |
| :--- | :--- | :--- | :--- |
| **TC-1: Ujjain Booking** | Customer Fare Request | `23.1827, 75.7682` (Ujjain Center) | Falls inside Ujjain Geofence ➔ returns Ujjain Rate Card & Vehicles. |
| **TC-2: Indore Booking** | Customer Fare Request | `22.7196, 75.8577` (Indore Center) | Falls inside Indore Geofence ➔ returns Indore Rate Card & Vehicles. |
| **TC-3: Highway / Unzoned** | Customer Fare Request | `22.9676, 76.0534` (Dewas Bypass) | Outside any city geofence ➔ returns Global India Default rates (`city_id = 0`). No error. |
| **TC-4: City Admin Isolation** | Ujjain Admin Edits Fare | Updates Tata Ace to ₹180 | Only `city_id = 2` row is updated; Indore (`city_id = 1`) and Global (`city_id = 0`) remain unchanged. |
| **TC-5: Cross-City Tampering** | Ujjain Admin API Request | Tries to PUT `city_id = 1` | Server rejects with `403 Forbidden`. |
| **TC-6: Global Update by Super Admin** | Super Admin Edits Global | Updates Global Base fare | Un-geofenced highway bookings reflect new Global rate; Ujjain and Indore remain on their customized city rates. |

# System 2 (Vehicle Category First) and city-wise Booking Guarantee — Design

Date: 2026-10-12. Status: draft for owner review. Source: manager's message of 2026-10-11 plus the owner's answers of 2026-10-12.

## Purpose

Today a customer can only book a vehicle category when a driver is currently online near the pickup (System 1). The manager wants each city to be able to choose **System 2**: show every vehicle category registered in the city, let the customer book, and search for a driver *after* the order is confirmed, for an admin-set time. If nobody is found in that time, the existing Booking Guarantee admin window opens (if the city enabled it); if the admin cannot arrange a vehicle either, the customer is compensated and then locked until referrals are completed.

This spec covers System 2 and the city-wise Booking Guarantee. The Free Ride fixes (completion-time amount/km check, select-vehicle eligibility) are a separate, smaller spec.

## Who edits what

City Admin is the existing `admin` role with `admin.city_id` set. Scoping already exists (`middleware/scopeFilter.js`, same pattern as `adminFreeBookingController`).

| Role | Order Search settings |
|---|---|
| `superadmin` | read/write any city |
| `admin` (City Admin) | read/write own city only; a missing `city_id` is refused (fail closed) |
| `executive` | read own city only |

Admin alerts are already city-scoped: `adminSocket.notifyDispatchAlert(orderId, cityId, ...)` calls `broadcastToScope(cityId, ...)`. No change needed.

## Current state (verified in code)

- `orderAvailabilityController.availableVehicles` already returns every category with an `available` flag, and resolves `matchedCityId` from the pickup. The select-vehicle screen blocks categories flagged unavailable.
- `dispatchManager` runs a tier cascade (one lap). `checkCascadeTermination` ends it when tiers are exhausted: free-booking fallback, then `bookingGuaranteeService.openForExhaustedOrder`, else cancel "No driver found". There is no fixed search time.
- Booking Guarantee: table `booking_guarantee_case`, global admin window in `app_settings` (`booking_guarantee_assign_minutes`, default 10), compensation per `tbl_package.no_driver_compensation`, sweeper `expireDue`. Its migration `20261007020000` is not applied to any database, so no live behaviour changes.
- Referral unlock hook: `referralRewardService` calls `freeBookingService.unlockForReferral` when a USER referral completes.

## Data model (one migration, hand-applied)

### `city_order_settings`
| column | notes |
|---|---|
| city_id | PK, matches `tbl_city.id` |
| search_system | TINYINT, 1 or 2, default 1 |
| search_radius_km | DECIMAL(5,2) NULL; NULL = `SEARCH_RADIUS_KM` constant; valid 1–30 |
| driver_search_seconds | INT NULL; NULL = 60; valid 15–600 |
| guarantee_enabled | BOOL, default 0 |
| admin_window_minutes | INT NULL; NULL = the existing global value; valid 1–1440 |
| guarantee_referrals_required | INT, default 1, >= 1 |
| updated_by, updated_at | audit |

A city without a row behaves exactly as today: System 1, guarantee off. This is safe because the guarantee migration is not live anywhere yet.

### `pkg_order`
- `search_system` TINYINT NULL: snapshot of the city setting at order creation (NULL = System 1).
- `search_deadline_at` DATETIME NULL: set only for System 2 orders, `created + driver_search_seconds`.

### `tbl_user`
- `guarantee_locked` BOOL default 0, `guarantee_locked_at` DATETIME NULL. Separate from the Free Booking lock: they are different benefits and unlock independently.

## System 2 flow

1. **Vehicle list.** For a pickup in a System 2 city, `availableVehicles` returns every category registered in the city with `available: true`, no "No drivers nearby", and no widen-radius suggestion. The response also carries `search_system` and `driver_search_seconds`. System 1 cities are unchanged. Scheduled and next-day bookings are always System 1 behaviour.
2. **Order create** (`orderController.createOrderCore`). If the order is an instant booking in a System 2 city, store `search_system = 2` and `search_deadline_at`. The server uses the city's `search_radius_km` for dispatch and ignores the client's radius. Fare logic is untouched: the radius charge still bills each driver's real distance.
3. **Search window.** Dispatch starts as today (tiered stages included). While `now < search_deadline_at`, an exhausted cascade does not end the order: after a short pause (`SEARCH_RETRY_MS`, 10 s) a new lap starts, using the existing exclusion rules, so drivers who come online mid-window are caught. No new batch starts after the deadline; popups already live are allowed to finish. A driver accepting at any point is the normal assignment flow.
4. **Deadline reached with no driver** (single function `finishSearchWindow(orderId)`, reached from `checkCascadeTermination` once the deadline has passed and no popup is live):
   - Free-booking fallback first (unchanged).
   - If the city's `guarantee_enabled` and the user is not guarantee-locked: `openForExhaustedOrder` with the deadline `now + admin_window_minutes`. This is the existing case, alert, customer event, assign, cancel and sweeper path.
   - Otherwise: cancel with `cancel_reason = "Driver is not available"`, `o_status = Cancelled` (no new enum value, so existing reports keep working), refund prepaid wallet fare and referral points as today, emit `order:no_driver_found` with `reason: "driver_not_available"`. No compensation.
5. **Restart safety.** `search_deadline_at` lives in the DB. Startup recovery (`reconcileStaleOffersOnStartup` and the stale-order sweep) must not cancel a System 2 order before its deadline: it resumes dispatch if the deadline is in the future, or runs `finishSearchWindow` if it has passed.
6. **Customer cancels during the search window**: normal cancel, no compensation, no case.

## Booking Guarantee changes

- Opens only when the city has `guarantee_enabled` (both System 1 and System 2 cities) and the user is not locked. A System 1 city with the guarantee on keeps today's trigger (cascade exhausted).
- Admin window length is `city_order_settings.admin_window_minutes`, falling back to the global setting. The case still snapshots its own `deadline_at`.
- Compensation is unchanged: highest `sort_order` among the customer's selected models, from `tbl_package.no_driver_compensation`, frozen at open.
- **Lock.** When the sweeper credits compensation (`expired_compensated`, amount > 0), set `guarantee_locked = 1`, `guarantee_locked_at = now` in the same transaction as the wallet credit. A zero-amount expiry does not lock.
- **Unlock.** New `bookingGuaranteeService.unlockForReferral(userId)`, called next to the Free Booking call in `referralRewardService`. It counts completed USER referrals with `verified_at >= guarantee_locked_at` and unlocks at `guarantee_referrals_required` (same rule as Free Booking). Admins can also lock and unlock a user manually from the Booking Guarantee page.
- A locked user's booking proceeds normally and gets the search window, but at the deadline it is cancelled with "Driver is not available" and no admin window. The order screen tells a locked user the guarantee is locked and how many referrals are needed.

## Surfaces

- **Backend admin API:** `GET/PUT /api/admin/order-search/settings?city_id=` with the role rules above, validation as in the data model, and an audit log line per change. Booking Guarantee admin page gets the lock/unlock actions.
- **Admin panel:** an "Order Search System" section in Order Management: System 1/2, radius, driver search time (preset 30/60/120/180 plus custom), guarantee on/off, admin window, referrals needed. Superadmin sees a city picker.
- **Customer app:** `select_vehicle.dart` stops blocking unavailable categories when the response says `search_system == 2`. `waiting_screen.dart` shows the search countdown, then "Finding you a driver…" on `order:guarantee_pending`, or "Driver is not available" on `order:no_driver_found`. Exact classes are pinned in the plan.
- **Driver app:** no change.

## Error handling and edge cases

- Settings read fails: fail to System 1 and guarantee off, and log it. A settings outage must never strand an order.
- Deadline timer and customer cancel, or driver accept, race: every transition uses a conditional update (`rid = 0 AND order_status = 0`), as `checkCascadeTermination` already does.
- Search time changed mid-window affects only new orders (deadline is snapshotted).
- A System 2 city with no online drivers at all: the customer waits the full window, then sees the result. This is the intended trade-off of System 2.
- Tiered dispatch on: the stages (Free, Daily, Normal) all run inside one search window; the window does not restart per stage.

## Testing

- `availableVehicles`: System 2 city returns all categories available; System 1 unchanged; scheduled booking unchanged.
- Order create snapshots `search_system` and a correct `search_deadline_at`; ignores client radius in System 2.
- Dispatch: exhausted before the deadline re-laps; a driver appearing mid-window gets the order; no batch after the deadline; deadline ends the order exactly once.
- `finishSearchWindow`: guarantee on and user unlocked opens a case; guarantee off or user locked cancels with "Driver is not available" and refunds.
- Lock set on a compensated expiry only; unlock at N referrals made after the lock; earlier referrals never count.
- Restart recovery before and after the deadline.
- Role matrix on the settings API: city admin cannot touch another city; missing `city_id` refused; executive read-only.

## Rollout

Hand-written migration, applied by hand on every database before the code is deployed (the dev DB has no shadow DB), then `prisma migrate resolve --applied`. Everything defaults to System 1 and guarantee off, so deploying changes nothing until a city admin turns it on. The customer and driver app folders are gitignored: commit with `git add -f` on exact files.

## Out of scope

Free Ride completion-time limits and select-vehicle eligibility (separate spec), System 2 for scheduled and next-day bookings, per-vehicle-category radius or search time.

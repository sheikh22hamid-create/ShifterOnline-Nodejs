# Daily Driver System — Backend Engine Design

Status: approved (condensed — architectural, backend sub-project only). Admin panel and
driver-app (native Android `com.shifter.driver`) UI are separate sub-projects that will
consume this backend and are not covered here.

## Context

Replaces the existing "Monthly Driver" system (`monthly_driver_contract` +
`driver_duty_log` + `monthly_driver_ledger`, admin manually promotes one driver into one
fixed 1:1 contract, proportional salary payout, zone-based online tracking, always
commission-exempt while `tbl_rider.monthly_plan=1`) with a self-service, multi-plan,
capacity-limited "Daily Driver" system per the product spec pasted 2026-09-26.

Migration decision: **manual re-enroll**. Existing `monthly_driver_contract` rows are left
alone (historical read only); admin creates new Daily Driver plans and re-enrolls drivers
by hand. No auto-migration.

The existing `tbl_premium_plan` (`plan_for=DRIVER`, `DRIVER_PREMIUM`/`DRIVER_SECOND`,
`driverPlanService.js`) is a different, unrelated system (commission-discount plans) and is
untouched by this work.

## Data model

New tables (Prisma models), old monthly-driver tables kept as-is for history:

- **`daily_driver_plan`** — admin-created catalog row.
  `plan_name`, `price` (Decimal), `duty_start_time`/`duty_end_time` (String "HH:MM:SS"),
  `required_duty_hours` (Float), `free_km` (Int), `extra_km_rate` (Decimal),
  `shortfall_hourly_rate` (Decimal), `overtime_hourly_rate` (Decimal), `max_drivers` (Int),
  `assigned_zone_id` (Int?, FK-ish to `service_zone`, optional per plan), `city` (String,
  "all" or CSV of city ids — same convention as `tbl_premium_plan.city`),
  `package_categories` (String, same convention as `tbl_premium_plan.package_categories`),
  `status` (Boolean), timestamps.

- **`daily_driver_enrollment`** — one row per driver per calendar day.
  `rider_id`, `plan_id`, `enrollment_date` (Date), `status` enum:
  `pending_approval | enrolled | active | completed | settlement_pending |
  settlement_completed | rejected | cancelled`, `auto_enroll_id` (Int?, FK), `approved_by_admin`
  (Int?), `approved_at`, timestamps.
  Constraint: at most one non-`rejected`/non-`cancelled` enrollment per
  `(rider_id, enrollment_date)` — one Daily Driver plan per driver per day.

- **`daily_driver_auto_enroll`** — `rider_id`, `plan_id`, `enabled` (Boolean),
  `until_date` (Date), `status` (`active|cancelled`), timestamps. A daily job reads this and
  creates tomorrow's `daily_driver_enrollment` (status `enrolled` if capacity available,
  else `pending_approval`) for every enabled, non-expired row, respecting `max_drivers`
  same as a manual enroll would.

- **`daily_driver_duty_log`** — one row per `enrollment_id`, evolution of
  `driver_duty_log`. `enrollment_id` (unique), `punch_in_at`, `punch_out_at`,
  `total_online_minutes`, `total_in_zone_minutes`, `total_out_zone_minutes`,
  `rides_completed`, `actual_km`, `extra_km`, `extra_km_charge`, `shortfall_hours`,
  `shortfall_deduction`, `overtime_minutes`, `overtime_pay`, `ride_earnings`,
  `eligible_plan_amount`, `final_settlement_amount`, `settlement_direction`
  (`company_pays|company_retains|none`), `status` (`in_progress|completed|settled`).

- **`daily_driver_ledger`** — evolution of `monthly_driver_ledger`, same shape
  (`rider_id`, `enrollment_id`, `order_id?`, `entry_type`, `amount`, `balance_effect`,
  `notes`, `created_at`). `entry_type` values: `PLAN_AMOUNT`, `SHORTFALL_DEDUCTION`,
  `EXTRA_KM_CHARGE`, `OVERTIME_PAY`, `RIDE_EARNINGS`, `COMPANY_SETTLEMENT_PAYOUT`,
  `COMPANY_RETAINED`, `ZERO_RIDE_FORFEIT`.

## Enrollment & capacity

- `POST /enroll` — if `count(enrollment where plan_id, enrollment_date, status in
  [enrolled,active,completed,settlement_pending,settlement_completed]) < max_drivers` →
  create with `status=enrolled`. Else → create with `status=pending_approval`.
- Admin approve/reject endpoint flips `pending_approval` → `enrolled`/`rejected`,
  re-checking capacity at approval time (race-safe via the same count check inside a
  transaction).
- `enrolled` → `active` transition happens automatically at `duty_start_time` (checked
  lazily on punch-in / status-read, not a separate cron).
- Driver may cancel their own `pending_approval` or `enrolled` (not yet started) row any
  time before `duty_start_time`.

## Duty tracking

Reuses the existing `dutyTrackingService.js` pattern (punch-in/out, periodic location
ping, zone in/out via `geofenceService`), keyed off `daily_driver_enrollment` (today's
`active` row for the rider) instead of the old 1:1 `monthly_driver_contract`. Zone
restriction stays **optional per plan** (`assigned_zone_id` nullable) — when set, only
in-zone minutes count toward `required_duty_hours`; when null, all online minutes count.

## Settlement (computed once, when duty window closes — triggered by first ping/read
after `duty_end_time`, or explicit punch-out)

```
rides_completed = count(pkg_order where rid=driver, o_status=Completed,
                         completed within [duty_start, duty_end] on enrollment_date)

if rides_completed == 0:
    eligible_plan_amount = 0          # zero-ride rule overrides everything else
else:
    shortfall_hours     = max(0, required_duty_hours - duty_hours_counted)
    shortfall_deduction = shortfall_hours * plan.shortfall_hourly_rate
    eligible_plan_amount = max(0, plan.price - shortfall_deduction)

overtime_hours = max(0, duty_hours_counted - required_duty_hours)
overtime_pay   = overtime_hours * plan.overtime_hourly_rate

actual_km   = sum(pkg_order.distance for the same completed rides)
extra_km    = max(0, actual_km - plan.free_km)
extra_km_charge = extra_km * plan.extra_km_rate

ride_earnings = sum(driver's net fare for the same completed rides)  # commission is 0
                                                                       # during the plan,
                                                                       # so this is the
                                                                       # full fare

diff = eligible_plan_amount - ride_earnings
if diff > 0:  COMPANY_SETTLEMENT_PAYOUT of `diff`, credited to driver wallet
if diff < 0:  COMPANY_RETAINED of `-diff`, debited from driver wallet (mirrors the old
              system's CASH_COLLECTED clawback — driver already has the ride fare in hand
              or wallet from the normal per-ride payout, this reclaims the excess)
```

`overtime_pay` and `extra_km_charge` are independent ledger credits to the driver (not
folded into the `eligible_plan_amount` vs `ride_earnings` comparison — sections 13/14 of
the spec are separate ledger lines from section 16's settlement comparison).

Every component becomes a `daily_driver_ledger` row; `daily_driver_duty_log` carries the
computed snapshot for fast reads (admin dashboard, driver app "view full details").

## Commission exemption & rights integration

- `tripLifecycle.js:505` (`isMonthlyDriver` check) is extended to also check "does this
  rider have a `daily_driver_enrollment` with `status=active` for today" → same
  commission-exemption branch. Advance payment flow is untouched (already independent of
  commission).
- Existing scheduled-order priority dispatch (`pkg_order_interest` /
  `tbl_order_requests`, `dispatchManager.offerToInterestedRiders`) and Model1 fallback are
  **not modified** — a Daily Driver enrollee participates in them exactly like any other
  driver; no special-casing needed there.
- **Force Assign** (net new — no prior implementation existed): admin endpoint assigns a
  specific scheduled order (`booking_type=2`, not yet accepted) to a specific driver
  inside a transaction: expire/cancel every pending `tbl_order_requests` and
  `pkg_order_interest` row for that order, assign the order to the chosen driver via the
  same claim path the normal accept flow uses, emit a cancel/withdraw socket event to
  every other previously-offered rider so their popup closes, notify the assigned driver,
  and write an audit trail row.

## Out of scope here (separate sub-projects)

- Admin panel screens (plan CRUD UI, approval queue, force-assign UI, ledger views).
- Driver app native Android screens (`ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/`).

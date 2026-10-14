# Booking Guarantee — Executive Queue Layer — Design

Date: 2026-10-14
Status: **Implemented (backend + admin UI) on 2026-10-14; feature OFF by default; not yet enabled anywhere; see Implementation status** (Section 16). Approved by user 2026-10-14 with the Section 12 post-assignment-cancellation clarification.
Extends: [2026-10-07 Booking Guarantee](2026-10-07-booking-guarantee-design.md) and [2026-10-12 System 2 / city-wise guarantee](2026-10-12-system2-vehicle-first-booking-guarantee-design.md). Both remain authoritative for everything not changed here.

## 1. Purpose and non-goals

When a guarantee case opens (cascade exhausted, city guarantee on, inside the guarantee window, customer not locked), today every admin sees a banner and any of them may assign a driver before `deadline_at`. This spec adds an **optional per-city executive queue**: the case is automatically given to exactly one eligible executive (the *primary owner*) who is accountable for resolving it before the existing deadline, with workload caps, reminders, escalation, reassignment, meaningful-action tracking, and supervisor dashboards.

**Non-goals / must not change** (all verified against current code):

- `booking_guarantee_case.status` values and every existing transition (`open`, `resolved_assigned`, `expired_compensated`, `cancelled`).
- `deadline_at`, `compensation_amount`, `compensation_package_id`, `selected_package_ids` — never written after the case opens.
- `expireCase` / `finishExpiry` / `expireDue`: the compensation formula, wallet credit and its idempotency key (`booking_guarantee_credit:<order_id>`), `guarantee_locked` setting, prepaid-fare and referral-point refunds, repair pass.
- Referral-completion unlock (`unlockForReferral`), customer-facing `guarantee` view, quote endpoint, System 2 search, customer app flow.
- Existing admin APIs and response shapes.
- No new queue/infra dependency (no Redis/BullMQ exists). The existing 15 s sweeper is extended.

**Default: OFF.** Per-city flag `exec_queue_enabled` defaults to 0. With it off, behaviour is identical to today. Enabling is a manual per-city action only after the Section 14 gates pass.

## 2. Existing lifecycle findings (summary)

| Concern | Today |
|---|---|
| Case open | `bookingGuaranteeService.openForExhaustedOrder` from `dispatchManager` (order held, not cancelled) |
| Deadline | `deadline_at = now + city.adminWindowMinutes ?? global setting` |
| Resolve | `closeOnAssign` (called by `assignRider`, queue/next-day assign, `tripLifecycle` accept/force-assign) |
| Cancel | `closeOnCancel` (customer, admin) |
| Expire | `expireDue` every 15 s: conditional `UPDATE ... WHERE status='open'`, cancel order `WHERE rid=0 AND order_status=0`, credit wallet once, then refunds phase |
| Admin assign | `adminOrderController.assignRider`: direct assignment (`rid` set, `order_status=1`); **no driver accept/reject step** |
| Roles | `admin_role` = `superadmin`, `admin`, `executive`; city bound by `scopeFilter` (fails closed, 403 without city) |
| DB | MySQL (Prisma), `DateTime(0)` columns, hand-applied SQL on prod |

Role mapping used throughout: **executive** = Executive, **admin** = City Admin, **superadmin** = Head Admin (cross-city).

## 3. State machine

`booking_guarantee_case.status` is **unchanged** and remains the only source of truth for whether a case is open or closed. A new orthogonal column `queue_state` is meaningful **only while `status='open'`** (and only when the city's queue was on at open time).

```
queue_state:  unassigned ──claim──▶ assigned ──first meaningful action──▶ in_progress
                  ▲                    │  ▲                                   │
                  │                    │  └──────────── reassign ◀────────────┤
                  └── owner removed ───┘         (any of the three)           │
                                         ──escalation threshold──▶ escalated (flag-like; still owned)

status:  open ──closeOnAssign──▶ resolved_assigned   (executive or anyone assigns a driver)
         open ──closeOnCancel──▶ cancelled
         open ──expireCase────▶ expired_compensated  (deadline reached, nothing resolved)
```

Rules:

1. `queue_state` NULL = case predates the feature or the city had the queue off at open time; such cases behave exactly as today (any admin may assign).
2. `unassigned → assigned` happens only through the claim transaction (Section 6).
3. `assigned → in_progress` only on the first **meaningful** action (Section 8).
4. `escalated` is set once (sweeper at the escalation threshold, or an escalation action), and only while the case has an owner; an unowned case stays `unassigned` (`escalated_at` is still stamped so the alert fires once). It does not remove ownership. It is cleared by reassignment.
5. Reassignment (`assigned|in_progress|escalated → assigned`) keeps `status`, `deadline_at` and all timestamps; it ends one ownership period and starts another.
6. When `status` leaves `open`, `queue_state` is frozen as-is for reporting and the active ownership period is ended (`end_reason` = `resolved | cancelled | expired`). Closing never depends on the ownership update succeeding (Section 11).
7. No transition may write `status`, `deadline_at` or compensation columns except the existing functions.

## 4. Database design (MySQL, additive only)

### 4.1 `booking_guarantee_case` — new nullable columns

| column | type | notes |
|---|---|---|
| `city_id` | INT NULL | set at open from `order.city_id`; the case's own city is authoritative for every queue decision (claim, reassignment and the compare-and-swap all filter on it) |
| `owner_admin_id` | INT NULL | current primary owner (denormalised cache of the active assignment; the assignment table is authoritative, see 4.2) |
| `owner_assigned_at` | DATETIME(0) NULL | start of current ownership period |
| `queue_state` | VARCHAR(20) NULL | `unassigned\|assigned\|in_progress\|escalated` |
| `unassigned_reason` | VARCHAR(30) NULL | `none_in_city\|all_unavailable\|all_at_capacity` |
| `first_action_at` / `last_action_at` | DATETIME(0) NULL | meaningful actions only |
| `reminded_at` / `escalated_at` | DATETIME(0) NULL | set once by conditional update |
| `last_alerted_at` | DATETIME(0) NULL | throttles repeated "no executive" alerts |

Indexes: `(queue_state, deadline_at)`, `(owner_admin_id, status)` and `(city_id, status)`. Cases opened before the migration have `city_id` NULL and are never queued.

### 4.2 `guarantee_assignment` — ownership history (never updated except to close a period)

| column | notes |
|---|---|
| `id` PK, `case_id`, `admin_id` | owner for this period. No SQL foreign keys, matching the existing guarantee tables (integrity is enforced by the service and the repair pass) |
| `assigned_by` INT NULL | admin id, NULL = system |
| `source` | `auto\|manual\|escalation` |
| `started_at`, `ended_at` NULL, `end_reason` NULL | `reassigned\|unavailable\|resolved\|cancelled\|expired\|idle_auto_reassign` |
| `reassign_reason` VARCHAR(200) NULL | free-text from the supervisor |
| `active` TINYINT NULL | **1 while the period is open, NULL once ended** |

**Active-uniqueness constraint:** `UNIQUE KEY uq_ga_one_active (case_id, active)`.

Validity on MySQL/InnoDB: a UNIQUE index permits any number of rows that contain a NULL in an indexed column (NULLs are not considered equal). Therefore any number of historical rows with `active = NULL` coexist for one `case_id`, while a second row with `active = 1` for the same case is rejected with a duplicate-key error (Prisma `P2002`). Ending a period is a single `UPDATE ... SET active = NULL, ended_at = ..., end_reason = ... WHERE id = ? AND active = 1`. This must be verified by a database-level test (acceptance AC-3) rather than assumed; `active` must never be written as 0.

Indexes: `(admin_id, active)` for the workload count; `(case_id)`.

### 4.3 `guarantee_action` — action log

`id`, `case_id`, `admin_id` (server-derived from the token), `type`, `meaningful` TINYINT, `result` VARCHAR(30) NULL, `driver_id` INT NULL, `meta` TEXT NULL (safe fields only: no phone numbers, no tokens), `created_at` (server clock). Index `(case_id, created_at)`.

Types: `viewed` (not meaningful), `search_started`, `driver_contacted`, `contact_outcome`, `driver_assigned` (written by hook), `escalated`, `note`, `resolution_attempt`. Allowed `result` codes (validated by the controller, 400 otherwise): `agreed`, `declined`, `no_answer`, `unreachable`, `assigned`, `none_available`. A second index `(admin_id, created_at)` exists for reporting.

### 4.4 `executive_guarantee_profile`

`admin_id` PK, `capacity` INT NULL (NULL = city default), `available` TINYINT NOT NULL DEFAULT 1, `last_assigned_at` DATETIME NULL, `updated_by`, `updated_at`. A row is created lazily (`INSERT ... ON DUPLICATE KEY UPDATE admin_id = admin_id`) the first time the engine considers the executive, so the lock target in Section 6 always exists. Separate table: the `admin` table is not altered.

### 4.5 `city_order_settings` — new columns (existing city-scoped pattern)

`exec_queue_enabled` TINYINT NOT NULL DEFAULT 0, `exec_default_capacity` INT NOT NULL DEFAULT 5, `reminder_pct` INT NOT NULL DEFAULT 50, `escalate_pct` INT NOT NULL DEFAULT 75, `auto_reassign_idle_minutes` INT NULL (NULL = off). Validation: capacity ≥ 1; `0 < reminder_pct < escalate_pct < 100`; idle minutes ≥ 1 when set. Queue settings do **not** go through the order-search settings code. They have their own endpoints, `GET/PUT /booking-guarantee/exec/settings` (roles `superadmin`, `admin`), backed by the service `guaranteeQueueSettings` (5 s per-city cache, fail-closed: a missing row or read error means queue OFF). A city admin is pinned to their own city (never read from the request); a superadmin names `city_id`. Bounds enforced in `guaranteeQueueRules.validateQueueInput`: capacity whole number 1-200; `reminder_pct` and `escalate_pct` whole numbers 1-99 with `reminder_pct < escalate_pct`; idle minutes whole number 1-1440 or null (off).

### 4.6 Audit

`booking_guarantee_audit` is reused (append-only; `event` is VARCHAR(40)). New events (exactly the set the code writes): `exec_queue_unassigned` (case enters the queue), `exec_auto_assigned` (system claim), `exec_manually_assigned` (a supervisor named the executive for a case that had no owner), `exec_reassigned` (ownership moved executive to executive: manual, unavailable-owner handover or idle), `exec_owner_released` (owner removed and no executive had capacity, so the case returned to `unassigned`), `exec_reminder_sent`, `exec_escalated` (system at the threshold, or a recorded `escalated` action), `exec_no_executive_alert` (throttled supervisor alert, with the reason), `exec_auto_reassigned_idle` (idle auto-reassign, written in addition to `exec_reassigned`), `exec_assignment_repaired` (repair pass, `meta.kind` = `closed_case_active_period | owner_without_period | owner_mismatch`). Existing events untouched.

### 4.7 Migration safety

All changes are `ADD COLUMN ... NULL/DEFAULT` and `CREATE TABLE`. No data rewrites, no drops. Prod needs a hand-written SQL file (project drift rule); Prisma migration is applied to the **dev DB only**. The existing guarantee migrations `20261007020000` and `20261013020000` are prerequisites and are not yet applied anywhere. Rollback: drop the new tables/columns; the flag being off means nothing reads them.

## 5. Permissions matrix

Enforced in the controller/service on every call (never only in the UI). "Own city" = the actor's `city_id` (pinned server-side; `scopeFilter` for list endpoints). Executive access always requires `owner_admin_id = req.user.id` **and** the case's city matching.

| Action | Executive | City Admin (`admin`) | Superadmin |
|---|---|---|---|
| View own assigned cases / detail | own only | - | - |
| View queue, unassigned, any case in scope | no | own city | all (optionally filtered) |
| Record actions, escalate, notes | owned cases only (all action types) | own city, `note` / `escalated` / `viewed` only | all, same limited set |
| Assign a driver (`assignRider`, queue flag on) | **owned cases only** | own city | all |
| Assign a driver (flag off or `queue_state` NULL) | unchanged from today | unchanged | unchanged |
| Reassign case to an executive | no | own city, target must be in same city | all |
| Set executive capacity / availability | no | executives in own city | all |
| Edit exec queue settings | no | own city | all |
| View workload & reports | no | own city | all |
| Approve compensation | n/a: compensation stays automatic (existing); no approval step is added | | |

Additional rules:

- **The ownership rule on assignment covers both entry points:** `POST /orders/:id/assign-rider` (`assignRider`) **and** `POST /orders/next-day/assign-batch` (`assignNextDayBatch`). Both call `assertExecutiveMayAssign`. An executive is rejected (403, "owned by another executive") when the order has an open, queued case in a city whose flag is ON and the executive is not its owner. The batch checks every order before assigning anything, so if any order in the batch is blocked the whole request is rejected with nothing assigned. Admin and superadmin are unaffected. Orders without an open queued case, and cities with the flag OFF, are unaffected.
- **Case detail and actions return 404 (not 403)** for an executive who is not the current owner and for any actor outside the case's city, so existence is not leaked. A non-superadmin without a valid city reaches nothing (fail-closed: 404 on case routes, 403 "not assigned to a city" on list/settings routes).
- An executive cannot change their own profile or permissions (the profile, settings and reassign routes exclude the `executive` role); actor ids and timestamps are always server-side; a reassignment target must be an active executive in the case's city.

Routes (admin router, `/booking-guarantee/exec/...`; `RIDER_ROLES` = superadmin, admin, executive):

| Route | Roles | Notes |
|---|---|---|
| `GET /booking-guarantee/exec/my-cases` | executive | own active, recently closed (24 h) and reassigned-away cases |
| `GET /booking-guarantee/exec/cases/:orderId` | RIDER_ROLES | case detail with periods, actions, audit; ownership/city enforced in the service; an executive's read logs a `viewed` action |
| `POST /booking-guarantee/exec/cases/:orderId/actions` | RIDER_ROLES | **the one new executive-writable route**; added to the allow-list in `adminRoutesRbac.test.js` |
| `POST /booking-guarantee/exec/cases/:orderId/reassign` | superadmin, admin | `target_admin_id` optional (null = automatic), `reason` required (max 200) |
| `GET /booking-guarantee/exec/queue` | superadmin, admin (`scopeFilter`) | optional `state` filter |
| `GET /booking-guarantee/exec/workload` | superadmin, admin (`scopeFilter`) | per-executive load, capacity, availability |
| `GET /booking-guarantee/exec/report` | superadmin, admin (`scopeFilter`) | `from`/`to`, default last 24 h |
| `PUT /booking-guarantee/exec/profiles/:adminId` | superadmin, admin | `capacity` (1-200 or null) and/or `available` (strict boolean); marking unavailable hands over owned cases |
| `GET` / `PUT /booking-guarantee/exec/settings` | superadmin, admin | see 4.5 |

## 6. Assignment algorithm and concurrency

### 6.1 Triggers

1. After a case row is created in `openForExhaustedOrder` (only when the city flag is on): set `queue_state='unassigned'`, then attempt assignment inline, best-effort (failure is logged; the case remains `unassigned` and the sweeper retries).
2. Every sweeper tick (existing 15 s interval, after `expireDue`): attempt assignment for unassigned open cases, **nearest `deadline_at` first**, bounded batch.

### 6.2 Eligibility

Executive `admin.role='executive'`, `admin.status=1`, `admin.city_id = order.city_id`, `profile.available=1`, active load < effective capacity (`profile.capacity ?? city.exec_default_capacity`). City admins and superadmins are never auto-assigned (manual reassignment to a city admin is not allowed in this version).

### 6.3 Ranking

`active_load / capacity` ascending, then `last_assigned_at` ascending (NULL first), then `admin_id`. `active_load` = `COUNT(*)` of `guarantee_assignment` rows with `active=1` for that executive joined to cases with `status='open'`; **no stored counter**, so it cannot drift. Every case weighs 1; a per-package weight is a documented extension point and out of scope.

### 6.4 Claim transaction (short, per executive, never queue-wide)

For each candidate in rank order (max N attempts, default 5):

1. City settings are read **before** the transaction (they use the global client, another pool connection, and must not run while a lock is held).
2. `INSERT ... ON DUPLICATE KEY` ensure the candidate's profile row exists (outside the transaction).
3. `BEGIN` at **READ COMMITTED** isolation.
4. `SELECT ... FROM executive_guarantee_profile WHERE admin_id = ? FOR UPDATE`: the row lock serializes all concurrent claims **for that executive across every app instance**, because the lock lives in MySQL, not in process memory.
5. Re-check inside the lock: `available=1`, admin still an active executive of the case's city, and the load, which is a **plain** `SELECT COUNT(*)` (no locking read) read **after** the profile row is locked. Because the transaction runs at READ COMMITTED, every statement after the lock sees all commits of earlier lock holders regardless of statement order (under REPEATABLE READ the snapshot could have been established earlier). Capacity full -> `ROLLBACK`, try next candidate.
6. Compare-and-swap: `UPDATE booking_guarantee_case SET owner_admin_id=?, owner_assigned_at=NOW(), queue_state='assigned', unassigned_reason=NULL WHERE id=? AND status='open' AND city_id=? AND owner_admin_id <expected owner: IS NULL for a first claim>`; 0 rows = someone else claimed, the case closed, or the city does not match -> `ROLLBACK`, stop (`case_gone`).
7. `INSERT guarantee_assignment (..., active=1)`: the `uq_ga_one_active` constraint is a second, independent guard against two owners (a duplicate-key error is treated as `case_gone`).
8. Update `profile.last_assigned_at`; write the audit row (`exec_auto_assigned` / `exec_manually_assigned` / `exec_reassigned`); `COMMIT`.
9. After commit: notify the executive (`admin:dispatch_alert`, kind `guarantee_assigned`, carrying ids and codes only). Notification failure never rolls back.

Why this protects capacity: two instances claiming for the same executive both need the same profile row lock; the second waits, then (at READ COMMITTED) counts and sees the first's committed assignment. **Global lock order is profile row -> case row -> assignment (period) rows**, in every transaction (claim, reassignment and the repair pass), so deadlock risk is low. A lock-wait timeout, deadlock or serialization failure is treated as "candidate busy" and the next candidate is tried.

### 6.5 No eligible executive

`queue_state` stays `unassigned`; `unassigned_reason` set to the most specific of `none_in_city | all_unavailable | all_at_capacity`. City admins of that city and superadmins receive an `admin:dispatch_alert` (kind `guarantee_unassigned`), throttled by `last_alerted_at` (at most once per few minutes per case, plus once more at escalation). The case stays in the unassigned queue view, the sweeper retries every tick, and **the deadline is never changed**. The existing "any admin may assign" path is not blocked for admins/superadmins while a case is unassigned, so a supervisor can still resolve it.

### 6.6 Reassignment

Allowed for city admin (own city) and superadmin, by the sweeper (idle auto-reassign), and automatically when an owner becomes unavailable. One transaction: lock the **target** executive's profile row (same capacity check as 6.4; supervisors may not override capacity in v1), end the current period (`UPDATE ... WHERE case_id=? AND active=1`, set `active=NULL`, `end_reason`), `UPDATE case ... WHERE id=? AND status='open' AND city_id=? AND owner_admin_id = <expected current owner>` (compare-and-swap on the expected owner and city so two supervisors reassigning concurrently cannot both succeed; the loser gets 409). This is the same transaction as 6.4 (`tryAssign` with an expected owner), so the lock order and READ COMMITTED reasoning are identical, insert the new period (`active=1`), audit. Nothing about `deadline_at`, `opened_at` or `first_action_at` is touched. Old periods are never deleted or edited beyond `ended_at/active/end_reason`.

**Capacity is preserved on every path** (automatic claim, supervisor reassignment, unavailable-owner handover, idle auto-reassign). Supervisors cannot override it.
- Supervisor reassigns to a *named* executive who is at capacity (or unavailable, or in another city): rejected with 409 and a clear message; the current owner and their period are unchanged.
- Supervisor (or the system) reassigns with target "auto": the engine ranks eligible executives under 6.2–6.4; if none has capacity, the current period is ended (`end_reason` = `reassigned` or `unavailable`), `queue_state` returns to `unassigned` with the specific `unassigned_reason`, supervisors are alerted, and the sweeper retries. `deadline_at` is never extended.

Marking an executive unavailable: owned open cases are reassigned by the same engine immediately (inside the save-profile request), and again by the sweeper if an owner is found ineligible (unavailable, inactive, no longer an executive, or moved city), bypassing that executive; if no target exists they become `unassigned` with the owner period ended (`end_reason='unavailable'`) and an `exec_owner_released` audit row.

## 7. Deadline, SLA and escalation

- `deadline_at` is the one and only deadline. It is set by the existing code at open and is never written again by this feature (enforced by test AC-9 and a code-review rule: no new code path references `deadline_at` in an UPDATE).
- Time spent unassigned, in reassignment, or with an idle owner **counts against the window**. Staff unavailability never extends the customer's guarantee.
- Reminder: at `reminder_pct` of `(deadline_at - opened_at)` elapsed, `UPDATE ... SET reminded_at=NOW() WHERE id=? AND reminded_at IS NULL` (conditional: exactly one instance wins), then notify the owner (or city admins if unassigned).
- Escalation: at `escalate_pct`, same conditional pattern on `escalated_at` (set exactly once); `queue_state` becomes `'escalated'` **only if the case currently has an owner** (an unowned case stays `unassigned`), then city admins/superadmins are alerted. A recorded `escalated` action follows the same once-only rule.
- Idle auto-reassign (independent of the escalation threshold): if `auto_reassign_idle_minutes` is set and the owner's last meaningful action (or `owner_assigned_at` if none) is older than that, and **at least 2 sweep intervals** remain before `deadline_at`, the sweeper hands the case over via 6.6 with `source='escalation'` and `end_reason='idle_auto_reassign'`. It only does so when **another** executive has capacity; if nobody else can take it the owner is **kept** (no release and re-claim ping-pong).
- Per tick the sweeper skips cities whose flag is OFF and cases already at or past `deadline_at` (expiry owns those).
- All times stored in UTC-equivalent as the existing columns do (note: the repo writes `new Date()` and `istNow()` in different places; this feature uses `new Date()` for all new columns and the UI converts to IST for display). Percent thresholds are computed from DB values, never from browser clocks.

## 8. Meaningful-action tracking

Only `search_started`, `driver_contacted`, `contact_outcome`, `driver_assigned`, `escalated`, `resolution_attempt` and `note` (trimmed length >= 10 characters) can count as meaningful. `viewed` is logged (informational) and never counts.

- **Only the owning executive's** meaningful actions are stored `meaningful=1` and update `first_action_at` / `last_action_at` and move `assigned -> in_progress`. Supervisor (city admin / superadmin) notes and escalations are stored `meaningful=0`: they stay audit-visible but never make the case look as if the owner worked on it. Supervisors may record only `note`, `escalated` and `viewed`; any other type is 403.
- Progress writes (`first_action_at`, `last_action_at`, `queue_state`) are each conditional on `owner_admin_id = actor` **and** `status='open'`, so a reassignment or close between read and write is harmless. A meaningful action on a closed case is rejected with 409.
- `driver_assigned` is written by a best-effort hook in `assignRider` (`recordAssignmentAction`, never blocks the assignment). It counts as meaningful and updates progress **only when the assigning admin is the case owner**; otherwise it is logged with `meaningful=0`.
- The actor id comes from `req.user`; `created_at` is the server clock; any client-supplied actor/timestamp is ignored.
- HTTP validation (`POST .../actions`): `type` must be a string and one of the known types (400); `result`, when present, must be one of `agreed`, `declined`, `no_answer`, `unreachable`, `assigned`, `none_available` (400); `driver_id`, when present, a positive integer id (400); `meta` an object of string/number values, whitelisted to `note`, `outcome`, `reason` (each truncated to 500 characters); no phone numbers or tokens are stored.

## 9. Compensation interaction (the core safety argument)

1. **The expiry sweeper stays the sole authority.** `expireCase` is not modified. It decides compensation using the same conditional `UPDATE ... WHERE status='open'` and the order-side guard `WHERE rid=0 AND order_status=0 AND o_status NOT IN (Cancelled, Completed)`.
2. **Resolution vs expiry race.** An executive's assignment goes through the unchanged atomic order update (`UPDATE pkg_order ... WHERE rid=0 AND order_status=0`). Exactly one of {assignment, expiry cancel} can win that row. If the assignment wins, `expireCase` finds 0 cancelled orders and marks the case `cancelled` with audit `order_already_closed` (existing behaviour) — no compensation. If expiry wins, `assignRider` returns 409 "taken or cancelled". The queue layer adds no new write path to `status`.
3. **Ownership bookkeeping can never block or pay.** Ending the ownership period is a separate, best-effort step after `closeWith`/`expireCase` commit. A failure leaves an orphan active period; the repair pass (Section 11) closes it. It has no effect on money.
4. **No duplicate compensation:** unchanged — `order_id` UNIQUE, conditional status flip, wallet idempotency key.
5. **Nothing new decides entitlement.** The executive queue does not create, approve, deny or modify compensation. A case that expires owned, unowned, escalated or reassigned is compensated by exactly the existing rules.
6. Locked customers, cities without the guarantee, and orders outside the guarantee window never open a case, so they never enter the queue (existing gates, untouched).

## 10. Failure handling matrix

| Event | Behaviour |
|---|---|
| No executive in city / all unavailable / all at capacity | `unassigned`, reason recorded, supervisors alerted (throttled), retried each tick, deadline unchanged |
| Two instances claim the same case | `owner_admin_id IS NULL` CAS + unique active key; loser rolls back and moves on |
| Two instances claim for the same executive | profile row lock; second re-counts and may be refused |
| Two supervisors reassign the same case | CAS on expected owner; second gets 409 |
| Owner marked unavailable | cases reassigned (`exec_reassigned`) or returned to `unassigned` (`exec_owner_released`), history kept |
| Owner idle past `auto_reassign_idle_minutes` | auto-reassign with `source='escalation'`, only if >= 2 sweep intervals remain and another executive has capacity (otherwise the owner is kept) |
| Contact outcome `declined`/`no_answer` | logged as meaningful; executive continues with another driver (no offer/accept step exists; see 12) |
| Case closes (assign/cancel/expire) | active period ended best-effort; repair pass closes any orphan |
| Server restarts | all state is in DB; sweeper resumes; reminders/escalations are conditional so none repeat or are lost |
| Notification (socket/push) fails | logged; never rolls back assignment or closure |
| Queue flag turned OFF mid-flight | new cases skip the queue; existing owned cases keep their owner but the ownership restriction on `assignRider` stops applying (any admin may assign again) |
| Flag ON, `queue_state` NULL (older case) | behaves as today |

## 11. Recovery and repair (sweeper additions, all idempotent)

Each tick, after `expireDue` (so expiry always runs first), `guaranteeQueueService.tick()` runs two contained phases:

1. **Open-case processing** (cities with the flag ON only; a flag-OFF city is skipped entirely, and cases at or past `deadline_at` are left to expiry), nearest deadline first, bounded batch: assign unowned cases (6.1); hand over cases whose owner is no longer eligible (`exec_reassigned` or `exec_owner_released`); send due reminders and escalations (Section 7); idle auto-reassign (Section 7, `exec_auto_reassigned_idle`).
2. **Repair pass** (`repairOrphans`, runs **even for cities whose flag is OFF**, because it only reconciles bookkeeping and never decides money). Each repair writes an `exec_assignment_repaired` audit row with `meta.kind`:
   - `closed_case_active_period`: an active period on a case whose `status != 'open'` is ended, `end_reason` mapped from the case status (`resolved`, `cancelled`, `expired`).
   - `owner_without_period`: an open case with an owner but no active period gets an active period inserted, under a row lock on the case and only if that exact owner still owns the open case (so a case released a moment ago is never resurrected).
   - `owner_mismatch`: an open case whose active period names a different owner (or the case has none): the assignment table is authoritative, so the case's owner is set from the period (locking the case row, then the period row). `queue_state` becomes `assigned` only from NULL or `unassigned`; `in_progress` and `escalated` are preserved.

Each phase, and each row within it, is wrapped in its own try/catch so one failure cannot stop expiry or the other steps; failures are logged with the case id.

## 12. Decisions and known limits

- Admin assignment is immediate (no accept/reject). "Driver rejection" is therefore modelled as a logged contact outcome by the executive, not a system event.
- **Post-assignment driver cancellation (verified 2026-10-14, documented gap, out of scope).**
  - *Code path:* `tripLifecycle.driverCancel` (`backend/src/services/tripLifecycle.js` ~L1445). Under a row lock it sets `rid=0, order_status=4, o_status='Cancelled'`, refunds referral points, the wallet advance and any wallet-paid fare, applies the driver cancellation fee and the existing `driver_cancel_user_earning` customer credit (package-configured, idempotent keys), then calls `dispatchManager.stopDispatch(orderId, "driver_cancelled")` and emits `order:driver_cancelled` with `searching_for_new_driver: false`. The in-code comment is explicit: *"Driver cancellation is terminal for this booking. Do not silently put a paid order back into dispatch/reassignment."* The test at `services/__tests__/tripLifecycle.test.js` ~L1067 asserts `searching_for_new_driver: false`. Other automated cancels (`cancelOverduePickup`, pickup sweeps) are likewise terminal. Free/Daily-driver cancel requests are not: `cancelRequestService.approve` un-assigns the order and re-dispatches it to the next tier (`startDispatch` with the next stage), so the order keeps searching, but before the follow-up below the guarantee case stayed closed (`resolved_assigned`).
  - *Conclusion:* the existing dispatch system does **not** search for another driver after a post-assignment cancel, and it does **not** preserve the customer's booking protection. The guarantee case is already `resolved_assigned` (closed, no guarantee compensation), the order is cancelled, and `expireCase` never sees it. The customer receives the existing refunds and, where configured, `driver_cancel_user_earning`; they do **not** receive the Booking Guarantee compensation. This is existing behaviour for every assigned order, with or without the executive queue, and the executive queue neither creates nor worsens it.
  - *Decision:* this feature makes **no change** here. Reopening a case, re-dispatching, or paying guarantee compensation after a driver cancel would silently change the compensation policy and the "terminal cancel" rule, so it is a separate product decision.
  - *Update 2026-10-14:* implemented by the follow-up spec `2026-10-14-guarantee-driver-cancel-recovery-design.md` (per-city switch, default OFF).
  - *Smallest safe follow-up (recommended, not part of this plan):* a separate spec decides policy first. If the business wants protection after assignment, the minimal mechanism is a best-effort audit event on `booking_guarantee_audit` (`assigned_driver_cancelled`) plus a supervisor-visible flag for cases whose resolving driver later cancelled, so the gap becomes measurable before any policy change; only afterwards decide between (a) no change, (b) a separate "late-cancel" notice to supervisors, or (c) a policy-approved re-dispatch for guarantee orders. Any option that pays money must reuse the existing wallet credit with its own idempotency key and be configurable per city.
- Executives can only assign drivers for owned cases when the city flag is on (server-side check added to `assignRider`/queue assign for role `executive`). Admin/superadmin unaffected.
- Active-load weighting is count-based (weight 1); a complexity weight is a future extension.
- City admins never receive automatic cases; they supervise.
- Accountability reporting shows ownership periods, share of window each owner held, time to first meaningful action, and whether a candidate driver pool existed; it does **not** label negligence from an SLA miss alone.

## 13. UI surfaces (admin panel, `frontend/`)

- **Executive Workspace** (role `executive`): my active cases, new assignments, approaching/overdue, completed, reassigned. Per case: summary, selected models, city, `GuaranteeCountdown`, action buttons (search started, contacted, outcome, assign driver via existing flow, escalate, note), contact history. Polling every ~15 s plus the existing admin socket alert; no fake live data.
- **Queue & Workload** (role `admin`, `superadmin`): KPI cards (active, unassigned, approaching deadline, overdue, resolved, expired/compensated), unassigned queue, per-executive load/capacity/availability/on-time rate/reassignments, reassign and capacity/availability controls, report. All server-side aggregates, paginated, filterable.
- Sidebar entries role-gated; existing `BookingGuarantee.jsx` page and `GuaranteeBanner` unchanged (with the queue on, the broadcast guarantee banner is suppressed for executives: the owner receives a targeted `guarantee_assigned` alert instead).

## 14. Rollout gates (feature stays OFF until all pass)

1. Prisma/SQL migrations for this feature **and** the two pending guarantee migrations applied to the **dev** DB and verified (never prod).
2. Full existing Jest suite passes with no regressions in `bookingGuarantee*` tests.
3. All new tests pass (acceptance below), **including the real-MySQL concurrency tests** (AC-3 to AC-6, AC-8, AC-15), run against a disposable dev/test MySQL schema, never prod. Mocked-Prisma unit tests alone do not satisfy this gate. **AC-12 (assignment racing expiry) is verified in the dev smoke test (gate 4)**, not in the real-MySQL suite: that suite does not seed `pkg_order`, and both `assignRider` and `expireCase` use the same atomic conditional `pkg_order` UPDATE (`WHERE rid=0 AND order_status=0`), so exactly one can win.
4. Dev smoke test actually run end to end (open case -> auto-assign -> action -> assign driver -> resolved; open -> no action -> expiry -> compensation exactly once; and an assignment racing expiry for AC-12) with results recorded.
5. Only then may a superadmin set `exec_queue_enabled=1` for one pilot city. Prod migration SQL is delivered as a file for the user to run; nothing is applied to prod by this work.

## 15. Acceptance criteria

- **AC-1** With `exec_queue_enabled=0` every existing guarantee test passes unchanged and no new table is read or written.
- **AC-2** A new case in an enabled city becomes `unassigned` then `assigned` to exactly one eligible executive of that city; no executive of another city and no city admin/superadmin is ever auto-assigned.
- **AC-3** DB-level: inserting a second `active=1` row for the same `case_id` fails; inserting many `active=NULL` rows for one `case_id` succeeds (verified on a real MySQL).
- **AC-4** Capacity: with capacity 1 and N concurrent claim attempts (including simulated separate connections/instances) for the same executive, at most 1 succeeds; the rest pick other executives or leave the case unassigned.
- **AC-5** Concurrent claim of the same case by two workers yields one owner and one active assignment row.
- **AC-6** Two concurrent reassignments of one case: exactly one succeeds, the other gets 409; history shows every period; no period is deleted.
- **AC-7** No available executive: case visible in the unassigned queue with a reason, supervisors alerted, retried next tick, `deadline_at` unchanged.
- **AC-8** Reminder and escalation each fire exactly once per case even when the sweeper runs twice or on two instances.
- **AC-9** `deadline_at`, `compensation_amount`, `compensation_package_id`, `opened_at` are identical before and after assignment, reassignment, escalation and unavailability handling.
- **AC-10** Executive resolves before deadline via assign: case `resolved_assigned`, no compensation, order proceeds normally, active period ended with `end_reason='resolved'`.
- **AC-11** Deadline passes with no resolution: existing `expireCase` runs unchanged, compensation credited exactly once (existing idempotency), repeated sweeps create no duplicate; owned/unowned/escalated cases are treated identically.
- **AC-12** Assignment racing with expiry: exactly one outcome; never both a driver and a compensation. Verified in the dev smoke test (see gate 3), because both paths hinge on the same conditional `pkg_order` UPDATE.
- **AC-13** Customer cancel and admin cancel close the case (no compensation) and end the active period.
- **AC-14** An executive cannot read, act on, or assign for a case they do not own, or one in another city (assignment is guarded on both `assign-rider` and `POST /orders/next-day/assign-batch`, the batch rejecting with nothing assigned if any order is blocked; case detail and actions return 404); city admin cannot act outside their city or edit another city's settings; only superadmin has cross-city reach; direct API calls bypassing the UI are rejected (tested per role).
- **AC-15** Orphan/stuck repair: simulated crashes between steps leave state that the next tick reconciles with an audit row.
- **AC-16** `viewed` events never move `queue_state` or `first_action_at`.
- **AC-17** Actor id and timestamps come from the server; client-supplied values are ignored.
- **AC-18** Existing booking, dispatch, referral-unlock and customer-facing guarantee behaviour is unchanged (full existing suite green).

## 16. Implementation status and verification

Implemented 2026-10-14 (backend and admin UI). The feature is OFF by default (`exec_queue_enabled=0` per city) and has not been enabled in any city or environment.

**What was built**

- Schema and migration `20261014010000_add_guarantee_executive_queue`: ten nullable columns (including `city_id`) and three indexes on `booking_guarantee_case`, five queue columns on `city_order_settings`, and the tables `guarantee_assignment`, `guarantee_action`, `executive_guarantee_profile`.
- `guaranteeQueueRules.js` (pure rules: validation, ranking, thresholds, idle test, meaningful-action test) and `guaranteeQueueSettings.js` (per-city settings with a 5 s cache, fail-closed).
- `guaranteeQueueService.js`: claim/reassign transaction (profile row lock, READ COMMITTED, compare-and-swap, unique active key), unavailable-owner handover, capacity and availability, open and close hooks called from `bookingGuaranteeService`, action recording, the ownership guard, and the sweeper `tick()` (assign, hand over, remind, escalate, idle reassign, repair), run from `server.js` right after `expireDue`.
- `guaranteeQueueReports.js`: server-side queue list, per-executive workload and report aggregates.
- `guaranteeQueueController.js` and the new route block in `adminRoutes.js` (Section 5), plus the ownership guard in `assignRider` and `assignNextDayBatch` and the `driver_assigned` hook; `expireCase` and every compensation path are untouched.
- Admin UI: `ExecutiveWorkspace.jsx` (route `/guarantee/my-cases`, executive) and `GuaranteeWorkload.jsx` (route `/guarantee/workload`, admin and superadmin), role-gated sidebar entries, queue alerts in `AppShell` via the existing admin socket, 15 s polling fallback.
- Test suites: rules, settings, hooks and controller unit tests (mocked Prisma), plus real-MySQL suites for the engine, reassignment, actions, tick/repair and reports.

**Migrations.** None of the migrations (this one, or the two pending guarantee migrations it depends on) is applied anywhere by this work, except the throwaway test database used by the real-MySQL suites. The dev DB and prod still need them applied by hand before the backend is deployed (project drift rule; prod SQL is run by the user).

**Real-MySQL suites.** The files `backend/src/services/__tests__/guaranteeQueue*.mysql.test.js` skip themselves unless `GUARANTEE_TEST_DATABASE_URL` is set. It must point at a disposable MySQL database whose name ends in `_test`; the helper (`__tests__/helpers/mysqlTestDb.js`) refuses to run otherwise, so they can never touch the dev or prod schema. Run from `backend/`, for example `GUARANTEE_TEST_DATABASE_URL="mysql://user:pass@localhost:3306/shifter_guarantee_test" npx jest guaranteeQueue`. The suites simulate several instances with concurrent connections from one process pool, which exercises the same MySQL locks; the dev smoke test adds a genuine second process.

**Known limitations**

- Post-assignment driver cancellation is unchanged (Section 12): the case is already closed, the order is cancelled terminally and no guarantee compensation is paid; the optional audit-event follow-up was intentionally not built.
- The frontend has no unit-test runner, and `npm run lint` is broken at baseline in this repo (an ESLint configuration error unrelated to this work), so the UI was verified by `npm run build` and scratch checks only.
- `adminSocket` broadcasts to all admin sockets, so client-side alert filtering is a UX filter, not a security boundary; alert payloads hold ids and codes only and every data fetch is server-authorized.
- AC-12 is verified in the dev smoke test, not by an automated test (Section 14 gate 3), and that smoke test has not yet been run.

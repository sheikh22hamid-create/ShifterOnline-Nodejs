# Automated Trial Driver Search & Executive Assignment (design)

Date: 2026-10-20. Status: draft for approval. Extends [[2026-10-14-guarantee-executive-queue-design]] and the outside-driver lookup (spec 2026-10-15). Nothing here changes compensation, the case deadline or normal order flow.

## Intent

A Booking Guarantee case is held for the admin window. Today an admin/executive must press Assign Order -> Find outside driver, phone the driver, register them as a trial driver and assign. This feature makes the first three steps automatic and turns executive distribution into a one-case-at-a-time queue, so an executive only ever sees a case that already has a ready Trial Driver and just decides: assign or reject.

## Goals

- When a guarantee case opens, a bot finds an outside driver from the order's pickup, drop and vehicle (the existing `outsideDriverService.lookup`), registers them as a Trial Driver (existing `registerTrial`) and links them to the case.
- A free executive gets the case (driver + order on one screen) with two actions: **Assign Order to Driver** and **Not Convinced / Do Not Assign**.
- Reject: executive is released at once, the driver is never offered again for that order, the bot searches the next driver automatically, the new driver goes to the next free executive.
- If no executive is free the case waits in the queue and is handed out automatically (oldest first) when one frees up.
- Every step is audited. Search exhaustion is shown to the admin, never silent.

## Non-goals / anti-goals

- No new external platform, no change to how the partner search or trial registration work.
- No change to compensation, deadline, expiry, refunds, or the normal booking flow after assignment.
- Must not create duplicate searches, duplicate trial riders, or assign one case/driver twice. Must not strand an order silently.
- Cities with the new switch OFF behave exactly as today.

## Decisions (agreed with the user)

- The Assign button is enabled only once the Trial Driver is **online** in the Shifter app (the executive phones the driver, who installs the app and logs in with that mobile). Until then the card shows Call + "Waiting for driver to go online" (live-updating). Reject is always available.
- Executive panel field "My Guarantee Cases" is renamed **New Ride Trial Driver** (menu label and page title).

## My calls (builder: flag any you disagree with)

1. Per-city switch `city_order_settings.exec_auto_outside_search` (default 0), only effective when `exec_queue_enabled` is also 1. Editable on the existing admin queue-settings page.
2. In auto mode an executive's capacity is **1** active case (overrides the per-city/per-executive capacity).
3. Search limit stays the existing constants (`MAX_LOOKUPS_PER_ORDER` = 8 lookups per order in total across rejections, 10 s gap). It is not admin-configurable today; making it configurable is out of scope.
4. A driver already returned for this order (same mobile or vehicle number, rejected or not) counts as a repeat and is skipped, using the existing repeat logic plus a check against the order's rejected candidates.
5. On exhaustion the case stays open (existing manual Find-outside-driver, Assign, expiry and compensation keep working) and admins get a dispatch alert + audit row.
6. Executive status labels are derived, not a new executive column.

## Behaviour

### Data
- `city_order_settings.exec_auto_outside_search` TINYINT(1) default 0. Migration is hand-applied (see DB drift memory); prod needs it before deploy.
- `booking_guarantee_case`: `search_state` (null | searching | exhausted) and `search_lease_until` DATETIME NULL (a lease so exactly one worker searches per case, even across app instances; a lease expires after ~3 min so a crashed worker is recovered by the sweeper).
- New table `guarantee_outside_candidate`: id, case_id, order_id, rider_id (the trial rider), name, mobile, vehicle_number, vehicle_name, fare, status (`ready` | `rejected` | `assigned` | `superseded`), rejected_by, rejected_at, reject_reason, created_at, `active` (1 while the candidate is the live one, NULL after; UNIQUE(case_id, active) so a case has at most one live candidate), UNIQUE(case_id, mobile) so the same driver is never offered twice for an order.

### Search bot (backend, no admin click)
- Trigger A: `onCaseOpened` for a city with the switch on. Trigger B: the sweeper tick picks up open cases with the switch on, no live candidate, `search_state` not `exhausted` and no live lease (restart / failure recovery).
- The worker takes the lease with a compare-and-swap, then loops: stop immediately if the case is no longer open or the order is assigned/cancelled; call `lookup` (adminId null, audited as today); wait the 10 s gap between attempts; a 429 "limit reached" ends the loop as exhausted.
- Driver found and not a repeat/rejected one: call `registerTrial` (1 trial order). If it fails: log + audit `outside_trial_failed`, create no candidate row, continue searching. On success insert the candidate (`ready`, `active` 1) and trigger assignment.
- The worker never blocks the sweeper (runs detached, errors contained).

### Assignment to executives
- `claimCase` in auto mode only hands out a case that has a live `ready` candidate; a case still searching is not "unassigned/no executive" (no alert spam). Free executive = existing `listCandidates`/`rankCandidates` with capacity 1. No free executive: case stays `unassigned` (shown as Pending in Queue) and is picked up by the existing sweeper / by the release hooks below.
- Whenever an executive is freed (assign succeeded, case closed, reject, executive set unavailable) the oldest waiting case in that city is claimed immediately (`dispatchWaiting(cityId)`), without waiting for the next sweep. Claims keep the existing profile-row lock + CAS guards, so two simultaneous cases never double-assign.

### Executive actions
- Case detail now returns `candidate` (driver name, mobile, vehicle type/number, trial status, online flag) and order details (id, pickup, drop, selected vehicle, fare, other order info already shown to admins).
- **Assign**: dedicated endpoint; owner only; requires the candidate to be online; assigns through the existing assign-rider logic (so the normal flow, `closeOnAssign`, payout/refund and notifications are unchanged); candidate -> `assigned`; the case closes, the executive's period ends (Free) and `dispatchWaiting` runs. In auto mode an executive can only assign that live candidate.
- **Reject**: owner only. One transaction: candidate `rejected` (record who/when/why), executive's period ended with reason `driver_rejected`, case back to unowned. Then the bot starts the next search for the same order and `dispatchWaiting` gives the executive the next waiting case.

### Status labels (derived)
Free = no active period. Engaged = owns an open case. Driver Rejected = last candidate rejected, next search running. Order Assigned = case closed as assigned. Pending in Queue = open, no owner, candidate ready. Searching = open, no live candidate yet. Shown in the executive card and the admin queue view (adds a candidate/driver column).

### Frontend
- Rename menu entry and page title to **New Ride Trial Driver** ([navigation.js](../../../frontend/src/config/navigation.js), [ExecutiveWorkspace.jsx](../../../frontend/src/pages/ExecutiveWorkspace.jsx)).
- Case card: Trial Driver block (name, mobile with Call link, vehicle type, vehicle number if known, trial status) and Order block, on one screen, with the two buttons; Assign disabled + "waiting for driver" until online (poll like the existing outside-driver panel). Existing manual tools stay for non-auto cases.
- Admin queue settings page: the new switch. Admin queue view: candidate/driver and status.

### Audit
Audit rows for: search started, driver found, trial created / failed, executive assigned, driver rejected, search exhausted, driver assigned. Existing `booking_guarantee_audit` + `guarantee_action`.

## Edge cases (must be covered by tests)
- Two cases at once, one free executive: one is assigned, the other waits; no double assignment.
- All executives engaged: new cases wait; first one to free up gets the oldest.
- Reject loop until the limit: each rejection releases the executive and searches again; after the limit the admin sees exhaustion.
- Two workers racing on one case: only one searches (lease).
- Order cancelled/assigned while searching or while a candidate is offered: search stops, candidate superseded, executive freed.
- Trial creation fails: no duplicate/incomplete rider, search continues.
- Rejected or repeat driver returned again: skipped.
- Case expires (deadline): existing expiry pays compensation once; search stops.
- Switch OFF: behaviour identical to today.

## Verification
Jest unit tests (mocked) for rules/service, plus a real-MySQL suite for the lease, queue claim/release and reject loop (project gate for queue work). Frontend build. Dev smoke with the switch on for one city; prod untouched until approved.

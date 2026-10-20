# Automated Trial Driver Search & Executive Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bot finds and registers an outside Trial Driver for every held Booking Guarantee case, and a one-case-per-executive queue hands the case (driver + order) to a free executive who assigns or rejects.

**Architecture:** New per-city switch layered on the existing executive queue (`guaranteeQueueService`) and outside-driver service (`outsideDriverService`). A lease-guarded worker (`guaranteeOutsideSearch`) runs lookup -> registerTrial -> candidate row -> claim. A new `guarantee_outside_candidate` table holds at most one live candidate per case. Release hooks call `dispatchWaiting(cityId)` so a freed executive gets the oldest waiting case at once.

**Tech Stack:** Node/Express, Prisma + MySQL (hand-applied migration), Jest (+ real-MySQL suites via `helpers/mysqlTestDb`), React admin (`frontend/`).

**Spec:** `docs/superpowers/specs/2026-10-20-auto-trial-driver-search-design.md` (read it first).

## Global Constraints

- Switch `city_order_settings.exec_auto_outside_search` default 0; effective only if `exec_queue_enabled` is 1. OFF = behaviour identical to today.
- Auto mode: executive capacity is 1 (ignores per-city/per-executive capacity).
- Search limit = existing `MAX_LOOKUPS_PER_ORDER` (8, total per order) and `MIN_GAP_MS` (10 s) in `outsideDriverService`; not configurable.
- `deadline_at`, compensation, expiry and normal order flow are never changed.
- Menu/page name: **New Ride Trial Driver**. Buttons: **Assign Order to Driver**, **Not Convinced / Do Not Assign**.
- Assign enabled only when the trial driver is online (server already enforces `a_status === 1` in `assignRider`).
- Migration is hand-applied (dev `shifteronlinedev` only; never `migrate deploy`); name `20261020010000_add_auto_outside_search`. Prod untouched.
- Work on branch `feature/auto-trial-driver-search`; commit exact files per task; never push/deploy.

## Review Focus

- Two cases open at once with one free executive: exactly one is claimed, the other waits (no double claim).
- Worker crash mid-search (lease left behind): sweeper recovers after the lease expires, no duplicate trial rider.
- Reject, then the partner returns the SAME driver (same mobile or plate): skipped, never re-offered.
- Order cancelled/assigned/expired while searching or while a candidate is offered: search stops, candidate superseded, executive freed, nothing left active.
- Switch turned OFF mid-flight: no new searches start; existing cases fall back to today's flow.

---

### Task 1: Switch, schema, settings

**Files:**
- Create: `backend/prisma/migrations/20261020010000_add_auto_outside_search/migration.sql`
- Modify: `backend/prisma/schema.prisma` (model `city_order_settings`, `booking_guarantee_case`; new model `guarantee_outside_candidate`)
- Modify: `backend/src/services/guaranteeQueueRules.js`, `guaranteeQueueSettings.js`, `backend/src/controllers/guaranteeQueueController.js` (`settingsToApi`)
- Test: `backend/src/services/__tests__/guaranteeQueueRules.test.js`, `guaranteeQueueSettings.test.js`

**Interfaces:**
- Produces: setting key `autoOutsideSearch` (bool, default false) in `normalizeQueueRow`/`validateQueueInput`/`COLUMN`; API field `exec_auto_outside_search`; `queueSettings.autoSearchActive(cityId): Promise<boolean>` = `execQueueEnabled && autoOutsideSearch`. Prisma: `booking_guarantee_case.search_state String? VarChar(15)`, `search_lease_until DateTime?`; model `guarantee_outside_candidate` per spec (unique `[case_id, active]` named `uq_goc_one_live`, unique `[case_id, mobile]` named `uq_goc_case_mobile`, `active Int? TinyInt`).

- [ ] **Step 1:** Write failing tests: `normalizeQueueRow({exec_auto_outside_search:1}).autoOutsideSearch === true`, default false; `validateQueueInput({autoOutsideSearch:"true"})` -> `{autoOutsideSearch:true}`; `autoSearchActive` false when queue off even if flag on, true when both on, false on read error.
- [ ] **Step 2:** Run `npx jest src/services/__tests__/guaranteeQueueRules.test.js src/services/__tests__/guaranteeQueueSettings.test.js` — expect FAIL.
- [ ] **Step 3:** Implement migration SQL (ALTER `city_order_settings` ADD `exec_auto_outside_search TINYINT(1) NOT NULL DEFAULT 0`; ALTER `booking_guarantee_case` ADD `search_state`, `search_lease_until`; CREATE TABLE `guarantee_outside_candidate` with the columns/uniques above, same header-comment style as `20261014020000`), the Prisma models, and the rules/settings/controller changes. Run `npx prisma generate`.
- [ ] **Step 4:** Re-run the tests — expect PASS.
- [ ] **Step 5:** Commit `feat(guarantee): auto outside search switch and schema`.

### Task 2: Candidate store

**Files:**
- Create: `backend/src/services/guaranteeOutsideCandidateService.js`
- Test: `backend/src/services/__tests__/guaranteeOutsideCandidateService.test.js` (mocked prisma)

**Interfaces:**
- Consumes: `guarantee_outside_candidate` model (Task 1).
- Produces (all async):
  - `createLive({ caseId, orderId, riderId, driver: {name, mobile, vehicle_number, vehicle_name, fare} }) -> { created: boolean, row }` — `created:false` on P2002 (live candidate exists or same mobile already offered).
  - `getLive(caseId) -> row|null` (active = 1).
  - `hasOffered(caseId, { mobile, vehicleNumber }) -> boolean` (any status).
  - `reject({ caseId, adminId, reason }) -> boolean` — CAS `status:"ready", active:1` -> `rejected`, `active:null`, sets `rejected_by/at/reject_reason`.
  - `markAssigned(caseId, riderId) -> boolean`; `supersedeLive(caseId, reason) -> number`.

- [ ] **Step 1:** Failing tests: createLive returns `created:false` on a mocked P2002; reject returns false when `updateMany` count is 0 and true for 1 and sets `active: null`; hasOffered matches by mobile OR plate (plate compared trimmed, case-insensitive, empty plate never matches); supersedeLive only touches `active:1`.
- [ ] **Step 2:** Run the file — expect FAIL.
- [ ] **Step 3:** Implement the module (thin Prisma wrappers; never write `active = 0`, only 1 or null).
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit `feat(guarantee): outside candidate store`.

### Task 3: Search bot

**Files:**
- Create: `backend/src/services/guaranteeOutsideSearch.js`
- Test: `backend/src/services/__tests__/guaranteeOutsideSearch.test.js` (mocked)

**Interfaces:**
- Consumes: `outsideDriverService.lookup({orderId, vehicleId, adminId, fetchImpl})` (throws `httpError` 429 at limit / 409 when not held), `outsideDriverService.registerTrial({orderId,name,mobile,vehicleNumber,trialOrders,adminId})`, Task 2 module, `queueSettings.autoSearchActive`.
- Produces:
  - `acquireLease(caseId, now?) -> boolean` — CAS on `search_lease_until IS NULL OR < now`, sets lease now+3 min and `search_state:"searching"`.
  - `runSearch(caseId, deps?) -> Promise<{ outcome: "candidate"|"exhausted"|"stopped"|"busy" }>`; `deps = { sleep, lookupFn, registerFn }` for tests.
  - `startForCase(caseId) -> void` (detached, errors logged, never throws); `sweep(now) -> Promise<number>` starts workers for open cases in auto-mode cities with no live candidate, `search_state != "exhausted"`, lease free.
- vehicle id for `lookup`: map from the order's category with the same guess rules as `OutsideDriverPanel.guessVehicle` (extract to a shared helper in `outsideDriverService` as `guessVehicleId(category)`; the panel keeps its own copy).

- [ ] **Step 1:** Failing tests (all with fake `deps`): (a) lookup returns a driver -> registerFn called once -> candidate created -> outcome `candidate`; (b) driver is a `repeat` or `hasOffered` -> skipped, loop continues; (c) 429 -> `search_state:"exhausted"`, audit `outside_search_exhausted`, alert kind `outside_search_exhausted`, outcome `exhausted`; (d) registerFn throws -> audit `outside_trial_failed`, no candidate, loop continues; (e) case no longer open or switch off at loop top -> `stopped`, no lookup call; (f) second `acquireLease` while held -> false -> `busy`; (g) `sleep` called with the 10 s gap between lookups.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement. Loop re-reads case status + `autoSearchActive` before every lookup; renews lease each iteration; on `candidate` calls the queue's `dispatchWaiting(cityId)` (Task 4; inject via lazy `require` to avoid a cycle); audit rows: `outside_search_started`, `outside_driver_found`, `outside_trial_created`, `outside_trial_failed`, `outside_search_exhausted` through `guaranteeQueueService.writeAudit`.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit `feat(guarantee): automatic outside driver search worker`.

### Task 4: Queue integration

**Files:**
- Modify: `backend/src/services/guaranteeQueueService.js` (`claimCase`, `tryAssign`, `onCaseOpened`, `onCaseClosed`, `setAvailability`, `tick`, `assertExecutiveMayAssign`, `recordAssignmentAction`, `getCaseDetail`; new `dispatchWaiting`, `rejectCandidate`)
- Test: `backend/src/services/__tests__/guaranteeQueueHooks.test.js` (extend); real-MySQL in Task 7

**Interfaces:**
- Produces:
  - `dispatchWaiting(cityId) -> Promise<number>` — claims unowned open cases that have a live candidate, oldest `opened_at` first, until no free executive; returns count claimed.
  - `rejectCandidate({ orderId, actor, reason }) -> Promise<{ released: true }>` — owner only (404 otherwise); one transaction: `reject(...)`, `endActiveAssignment(caseId, "driver_rejected", tx)`, case `owner_admin_id:null, queue_state:"unassigned"`; afterwards audit `outside_driver_rejected`, `guaranteeOutsideSearch.startForCase`, `dispatchWaiting(cityId)`. 409 if no live candidate.
  - `claimCase` in auto mode: no live candidate -> `{claimed:false, reason:"awaiting_driver"}` and **no** `markUnassigned` alert; ranks with capacity 1 (candidates' own capacity ignored); `tryAssign` capacity check uses 1 in auto mode.
  - `assertExecutiveMayAssign(user, orderId, riderId?)`: in auto mode with a live candidate an executive may assign only `candidate.rider_id` (403 otherwise).
  - `getCaseDetail` adds `candidate` (name, mobile, vehicle_number, vehicle_name, status, rider_id, `online` from `tbl_rider.a_status===1 && status===1`) and `order` (id, pick/drop names + coords, category, fare, plus fields the admin order detail already exposes).

- [ ] **Step 1:** Failing tests: `claimCase` auto + no candidate -> awaiting_driver, `markUnassigned` not called; auto + candidate -> claimed with capacity 1 (second case to the same exec returns `at_capacity`); `rejectCandidate` by non-owner -> 404, by owner -> candidate rejected, period ended `driver_rejected`, `startForCase` and `dispatchWaiting` called; `assertExecutiveMayAssign` rejects another rider id in auto mode and allows the candidate's; `onCaseClosed` calls `dispatchWaiting`; `onCaseOpened` in auto mode calls `startForCase` and does not claim immediately; `recordAssignmentAction` marks the candidate `assigned`.
- [ ] **Step 2:** Run `npx jest src/services/__tests__/guaranteeQueueHooks.test.js` — expect FAIL.
- [ ] **Step 3:** Implement. `setAvailability(false)`/handover and `tick` also call `dispatchWaiting`; `tick` additionally calls `guaranteeOutsideSearch.sweep(now)`; update `adminOrderController.assignRider` to pass `riderId` to `assertExecutiveMayAssign`. Switch OFF paths must stay byte-for-byte as before (guard every new branch on `autoSearchActive`).
- [ ] **Step 4:** Run the hooks test plus the existing `guaranteeQueue*.test.js` — expect PASS.
- [ ] **Step 5:** Commit `feat(guarantee): queue integration for auto trial driver`.

### Task 5: Reject endpoint, queue view

**Files:**
- Modify: `backend/src/controllers/guaranteeQueueController.js`, `backend/src/routes/adminRoutes.js`, `backend/src/services/guaranteeQueueReports.js` (`queueList`)
- Test: `backend/src/controllers/__tests__/guaranteeQueueController.test.js` (create if absent, follow `freeBookingController.test.js` style)

**Interfaces:**
- Consumes: `rejectCandidate` (Task 4).
- Produces: `POST /booking-guarantee/exec/cases/:orderId/candidate/reject` (`authorize("executive")`, body `{reason?: string<=200}`) -> `{success:true,data:{released:true}}`; `queueList` rows gain `candidate_name`, `candidate_mobile`, `candidate_status`, `search_state`.

- [ ] **Step 1:** Failing controller tests: non-executive 403 via route auth is not unit-testable, so test the handler: bad `orderId` -> 400, service 404/409 bubble as the same status, success -> `data.released true`; reason longer than 200 -> 400.
- [ ] **Step 2:** Run — expect FAIL.
- [ ] **Step 3:** Implement handler + route + `queueList` columns.
- [ ] **Step 4:** Run — expect PASS.
- [ ] **Step 5:** Commit `feat(guarantee): reject-driver endpoint and queue view columns`.

### Task 6: Frontend

**Files:**
- Modify: `frontend/src/config/navigation.js:70`, `frontend/src/pages/ExecutiveWorkspace.jsx`, `frontend/src/pages/GuaranteeWorkload.jsx`, `frontend/src/utils/guaranteeQueueForms.js`
- Test: `frontend` build (`npm run build`); add a unit test for any pure helper in `guaranteeQueueForms.js` following its existing tests

**Interfaces:**
- Consumes: case detail `candidate` + `order` (Task 4), reject route (Task 5), `POST /orders/:id/assign-rider {rider_id}` (existing), `GET /orders/:id/outside-driver/status` is NOT used (candidate `online` comes from case detail, re-fetched every 5 s while the card is open).

- [ ] **Step 1:** Rename menu label and `<h1>` to "New Ride Trial Driver".
- [ ] **Step 2:** Case card: Trial Driver block (name, `tel:` link, vehicle type, vehicle number if present, trial status) and Order block (id, pickup, drop, vehicle, fare) on one screen; buttons "Assign Order to Driver" (disabled + "Waiting for driver to go online" until `candidate.online`) and "Not Convinced / Do Not Assign" (always enabled, confirm step); show status label (Engaged / Pending in Queue / Searching / Driver Rejected / Order Assigned) derived from case/candidate state; cases without a candidate keep today's card.
- [ ] **Step 3:** Settings: add the "Auto trial driver search" switch to the queue settings form (`exec_auto_outside_search`); admin queue table shows candidate name/mobile/status.
- [ ] **Step 4:** Run `cd frontend && npm run build` — expect success.
- [ ] **Step 5:** Commit `feat(admin): New Ride Trial Driver executive screen and settings`.

### Task 7: Real-MySQL suite and gate

**Files:**
- Create: `backend/src/services/__tests__/guaranteeAutoSearch.mysql.test.js` (use `helpers/mysqlTestDb` like `guaranteeQueueTick.mysql.test.js`)

- [ ] **Step 1:** Write suites with a stubbed `lookupFn`/`registerFn`: (a) two cases + one free executive -> one claimed, other awaits; (b) executive assigns/rejects -> next waiting case claimed immediately; (c) reject loop: rejected mobile never re-offered, limit -> exhausted + alert; (d) two concurrent `runSearch` for one case -> one runs, one `busy`; (e) lease expiry lets the sweeper resume; (f) order cancelled mid-offer -> candidate superseded, period ended; (g) switch OFF -> `onCaseOpened` behaves as before (claims at once).
- [ ] **Step 2:** Run against the throwaway MySQL (`127.0.0.1:3399`, db `shifter_guarantee_test`, same env as earlier queue work) — expect PASS.
- [ ] **Step 3:** Run full `npx jest` — only the known `aadharPdfVerify` failures allowed.
- [ ] **Step 4:** Commit `test(guarantee): real-MySQL auto trial driver suite`.
- [ ] **Step 5:** Dev rollout (only when the user says so): backup `shifteronlinedev`, hand-apply the migration, `migrate resolve --applied`, deploy to dev with the switch OFF, smoke with one city ON.

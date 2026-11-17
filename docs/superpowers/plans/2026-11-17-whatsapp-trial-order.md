# WhatsApp Trial Order Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an executive run a Trial Driver's order entirely over the existing WhatsApp bot, with the exact same lifecycle, timers, fares and wallet settlement as the driver app.

**Architecture:** A per-order `pkg_order.driver_channel` ('app' | 'whatsapp') chosen at assign time. A new `backend/src/whatsapp/driverOrder/` module is a thin, stateless adapter: on every driver message it reads the order's state from the DB, maps the reply to exactly one existing backend call (`tripLifecycle.updateStatus`, `driverTripService.progressTrip`, `tripLifecycle.driverCancel`, `settlementService.markCashReceived`) and replies with the next step. No second state machine.

**Tech Stack:** Node/Express, Prisma (MySQL), Baileys (`@whiskeysockets/baileys` 7 rc), Jest (mocked prisma, `jest --runInBand` for real-MySQL suites), React + Vite admin frontend.

**Spec:** `docs/superpowers/specs/2026-11-17-whatsapp-trial-order-design.md`

## Global Constraints

- Lifecycle must go through the existing functions only: `tripLifecycle.updateStatus(orderId, riderId, status, {lat,lng,dropOtp,earlyDrop})`, `driverTripService.progressTrip({...})`, `tripLifecycle.driverCancel(orderId, riderId, reason)`, `settlementService.markCashReceived({orderId, riderId})`. Never write `order_status` / `o_status` / timers directly.
- A WhatsApp-channel driver's `tbl_rider.a_status` is never set to 1 by this feature.
- WhatsApp mode only for riders with `trial_status = 'active'`.
- Switch: `app_settings.setting_key = 'whatsapp_trial_orders_enabled'`, **default OFF** (only `1`/`true`/`on` enable it; read errors = OFF). In-flight WhatsApp orders keep working when OFF.
- WhatsApp-channel orders do NOT count toward `trial_orders_completed` (owner decision 1a).
- Driver-facing copy is Hinglish, one next step per message, always ends with the helpline line `📞 Help: 9109114515`.
- Reply keywords (case/space-insensitive): `1` arrived pickup, OTP digits, `2` pickup complete, `3` arrived stop, `4` stop complete, `5` arrived drop, `6` delivered, `HAAN` confirm, `CANCEL`, `PAISA MILA`, `0`/`HELP`.
- No-reply alert threshold: 10 minutes on the same step.
- Location used for OTP-verify / early-drop only if `rloc_updated_at` is within 2 minutes (same freshness rule as dispatch).
- Migration folder: `backend/prisma/migrations/20261117010000_add_whatsapp_trial_orders/`; it is applied nowhere by this plan — note it in the final report.
- Commit each task with exact file paths; never push.

## Review Focus

1. Driver sends a reply for a step that isn't current (e.g. `5` while at pickup) → backend refuses, bot replies the backend message + current step; order unchanged. (Task 4 test)
2. Driver's WhatsApp sender arrives as `@lid` → still matched to the rider via `senderPn`/`remoteJidAlt`; unmatched → normal bot menu. (Task 5 test)
3. Driver types "stop" / "start" / "hi" mid-order → routed to the order flow (re-sends current step), never pauses the chat or opens the customer menu. (Task 5 test)
4. Driver installs the app mid-order and progresses there → next WhatsApp reply acts on the real current step; bot sends the new step after the app's change. (Task 4 + Task 7 tests)
5. Order cancelled by customer/admin while the driver is mid-flow → driver's next reply gets "order cancel ho gaya", no backend action. (Task 4 test)

---

## File Structure

- `backend/prisma/schema.prisma`, migration `20261117010000_add_whatsapp_trial_orders/migration.sql` — `pkg_order.driver_channel`, table `whatsapp_driver_session`.
- `backend/src/services/whatsappTrialSettings.js` — switch read + eligibility.
- `backend/src/whatsapp/driverOrder/messages.js` — all driver-facing copy (pure functions).
- `backend/src/whatsapp/driverOrder/stepResolver.js` — order state → current step (pure).
- `backend/src/whatsapp/driverOrder/flow.js` — reply handling, location ingest, proactive step push, executive advance.
- `backend/src/whatsapp/driverOrder/senderIdentity.js` — JID/LID → 10-digit phone → active WhatsApp order.
- `backend/src/whatsapp/driverOrder/watchdog.js` — no-reply / bot-down alerts.
- Modified: `orderAssignmentService.js`, `adminOrderController.js`, `adminRoutes.js`, `trialOrderTracker.js`, `tripLifecycle.js`, `pickupOtpShareService.js`, `whatsapp/client.js`, change/cancel call sites, `ExecutiveWorkspace.jsx`, `OutsideDriverPanel.jsx`, new `frontend/src/components/orders/WhatsAppOrderPanel.jsx`.

---

### Task 1: Schema, migration, switch & eligibility

**Files:**
- Modify: `backend/prisma/schema.prisma` (model `pkg_order` ~line 251; new model)
- Create: `backend/prisma/migrations/20261117010000_add_whatsapp_trial_orders/migration.sql`
- Create: `backend/src/services/whatsappTrialSettings.js`
- Test: `backend/src/services/__tests__/whatsappTrialSettings.test.js`

**Interfaces:**
- Produces: `pkg_order.driver_channel String @default("app") @db.VarChar(10)`.
- Produces: model `whatsapp_driver_session { order_id Int @id; rider_id Int; phone String @db.VarChar(15); pending_confirm String? @db.VarChar(20) /* 'cancel' | 'early_drop' */; pending_otp String? @db.VarChar(10) /* drop OTP carried into the early-drop HAAN */; last_step String? @db.VarChar(40); last_prompt_at DateTime?; last_reply_at DateTime?; last_location_at DateTime?; alerted_step String? @db.VarChar(40); created_at DateTime @default(now()); updated_at DateTime @updatedAt }` plus `@@index([rider_id])`.
- Produces: `whatsappTrialSettings.isEnabled(): Promise<boolean>`; `whatsappTrialSettings.eligibility(riderId: number): Promise<{ eligible: boolean, reason: string|null, whatsapp_orders_done: number, bot_connected: boolean, enabled: boolean }>` — reasons: `'disabled'`, `'bot_offline'`, `'not_trial'`, `'not_found'`. `whatsapp_orders_done` = count of `pkg_order` with `rid`, `driver_channel='whatsapp'`, `o_status='Completed'`. Bot status from `require('../whatsapp/client').getBotStatus()` (connected when its status is `"CONNECTED"` — check the actual value in `client.js` and use it).

- [ ] **Step 1: Write failing tests** — `isEnabled` false when row missing, `'0'`, read throws; true for `'1'`, `'true'`, `' ON '`. `eligibility` returns `{eligible:false, reason:'disabled'}` when off; `'bot_offline'` when bot not connected; `'not_trial'` when `trial_status !== 'active'`; eligible with `whatsapp_orders_done: 2` when count mock returns 2.
- [ ] **Step 2:** Run `cd backend && npx jest src/services/__tests__/whatsappTrialSettings.test.js` → FAIL (module missing).
- [ ] **Step 3:** Add schema fields/model, write migration SQL (`ALTER TABLE pkg_order ADD COLUMN driver_channel VARCHAR(10) NOT NULL DEFAULT 'app';` + `CREATE TABLE whatsapp_driver_session ...`), run `npx prisma generate`, implement the service (same read pattern as `driverCancelRelive.isEnabled`, but default OFF).
- [ ] **Step 4:** Re-run the test → PASS.
- [ ] **Step 5:** Commit schema, migration, service, test: `feat(whatsapp-trial): driver_channel column, session table, switch`.

---

### Task 2: Assign over WhatsApp without being online

**Files:**
- Modify: `backend/src/services/orderAssignmentService.js:24-79` (`assignRiderToOrder`)
- Modify: `backend/src/controllers/adminOrderController.js:250-284` (`assignRider`)
- Test: `backend/src/services/__tests__/orderAssignmentWhatsapp.test.js`

**Interfaces:**
- Consumes: `whatsappTrialSettings.eligibility(riderId)` (Task 1).
- Produces: `assignRiderToOrder({ ..., channel = 'app' })`. For `channel === 'whatsapp'`: call `eligibility`; not eligible → `fail(400, <message>)` with messages `"WhatsApp orders are switched off"`, `"WhatsApp bot is not connected"`, `"WhatsApp mode is only for active Trial Drivers"`; skip ONLY the `a_status !== 1` check; persist `driver_channel: 'whatsapp'` in the same update that claims the order; after success fire-and-forget `require('../whatsapp/driverOrder/flow').startOrder(order.id)` (Task 4 export; guard with try/catch + logger so a WhatsApp failure never fails the assign). Any other `channel` value → `fail(400, "Invalid channel")`.
- Controller passes `channel: req.body.channel` through; response unchanged.

- [ ] **Step 1: Write failing tests** (mock prisma like `trialDriverAutoAssign.test.js`): offline trial rider + `channel:'whatsapp'` + eligible → `ok:true`, claim update data contains `driver_channel:'whatsapp'`, `tbl_rider.update` never called with `a_status: 1`, `startOrder` called with order id; offline rider + default channel → `fail 400 "Driver is currently offline"` (unchanged); not eligible `not_trial` → 400 with the message above; `channel:'sms'` → 400 `"Invalid channel"`; `startOrder` throwing → still `ok:true`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run this test and the existing `trialDriverAutoAssign.test.js`, `dailyDriverOrderAssign.test.js` → PASS.
- [ ] **Step 5:** Commit: `feat(whatsapp-trial): assign trial driver over WhatsApp without going online`.

---

### Task 3: WhatsApp orders don't consume the trial allowance

**Files:**
- Modify: `backend/src/utils/trialOrderTracker.js`
- Modify: `backend/src/services/tripLifecycle.js:1174` (call site)
- Test: `backend/src/utils/__tests__/trialOrderTracker.test.js` (create or extend)

**Interfaces:**
- Produces: `recordTrialOrderCompletion(riderId: number, orderId?: number)`. When `orderId` given and that order's `driver_channel === 'whatsapp'` → no-op. Without `orderId` → old behaviour.

- [ ] **Step 1: Failing tests** — whatsapp order: `tbl_rider.update` not called; app order with allowed 1: rider becomes `exhausted`; no orderId: old behaviour.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; pass `orderId` at the `tripLifecycle` call site.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(whatsapp-trial): WhatsApp orders don't count toward trial allowance`.

---

### Task 4: Driver order flow (messages, step resolver, reply handling)

**Files:**
- Create: `backend/src/whatsapp/driverOrder/messages.js`, `stepResolver.js`, `flow.js`
- Test: `backend/src/whatsapp/__tests__/driverOrderStepResolver.test.js`, `driverOrderFlow.test.js`

**Interfaces:**
- `stepResolver.resolveStep({ order, progress, stops, timer, dropOtpRequired, settlement }) → { key, stopNumber? }` (pure). Keys and rules:
  - order cancelled (`o_status === 'Cancelled'`) → `'cancelled'`
  - `o_status === 'Completed'` and `settlement?.status === 'pending'` and settlement is cash → `'await_cash'`; else completed → `'done'`
  - `order_status 1` → `'go_pickup'`
  - `order_status 2` and `!progress?.otp_verified_at` → `'pickup_otp'`; verified → `'loading'`
  - `order_status 3`, `step = progress.stop_step || 0`: even and `step/2 < stops.length` → `'go_stop'` (stopNumber `step/2+1`); odd and `(step+1)/2 <= stops.length` → `'at_stop'` (stopNumber `(step+1)/2`); `step === stops.length*2` → `'go_drop'`; `step === stops.length*2+1` → `dropOtpRequired ? 'drop_otp' : 'at_drop'`.
- `messages.js`: `orderCard(order, stops, rider)`, `stepPrompt(stepKey, ctx)`, `invalidReply(stepKey, ctx)`, `backendRefused(msg, stepKey, ctx)`, `cancelConfirm()`, `cancelled()`, `earlyDropConfirm({distance_m, old_fare, new_fare})`, `completed({ final_fare, isCash, amountDue })`, `cashThanks()`, `appNudge()` — all return strings; app nudge uses `process.env.DRIVER_APP_DOWNLOAD_URL || 'https://play.google.com/store/apps/details?id=com.shifter.driver'` and says "isi number se login karein, saare orders aur wallet app mein dikhenge". Online-paid completion says `₹X aapke Shifter wallet mein`.
- `flow.js` exports:
  - `loadContext(orderId) → { order, rider, stops, progress, timer, dropOtpRequired, settlement, session, step }`
  - `startOrder(orderId)` — upsert `whatsapp_driver_session`, send `orderCard` + current step prompt via `notifications.sendWhatsAppNotification(rider.fmobile, text)`; returns send boolean.
  - `handleDriverReply({ orderId, riderId, text }) → string` (the reply text; caller sends it). Updates `session.last_reply_at`. Mapping (reply valid only on its step; else `invalidReply`):
    - `go_pickup` + `1` → `tripLifecycle.updateStatus(o, r, 'arrived')`
    - `pickup_otp` + digits → `progressTrip({ orderId, riderId, action:'verify_otp', otp, lat, lng })` (fresh location or omitted)
    - `loading` + `2` → `updateStatus(..., 'pickup')`
    - `go_stop` + `3` → `updateStatus(..., 'arrived_stop_N')`; `at_stop` + `4` → `'complete_stop_N'`
    - `go_drop` + `5` → `'arrived_drop'`
    - `at_drop` + `6` / `drop_otp` + digits → `updateStatus(..., 'complete', { lat, lng, dropOtp })`; result `early_drop_required` → set `pending_confirm='early_drop'` and `pending_otp` = the drop OTP just sent (if any), reply `earlyDropConfirm`; `HAAN` with pending `early_drop` → `updateStatus(..., 'complete', { lat, lng, dropOtp: pending_otp, earlyDrop:true })`, then clear both
    - `CANCEL` (while `order_status` 1 or 2) → set `pending_confirm='cancel'`, reply `cancelConfirm`; `HAAN` with pending `cancel` → `tripLifecycle.driverCancel(o, r, 'Cancelled by driver on WhatsApp')`
    - `await_cash` + `PAISA MILA` → `settlementService.markCashReceived({ orderId, riderId })` → `cashThanks() + appNudge()`
    - `0`/`HELP`/anything else → current step prompt
    - `cancelled` → `cancelled()`; `done` → `appNudge()`
    - Backend `{success:false, msg}` or thrown error with `statusCode` → `backendRefused(msg, step)`; after success the reply is the prompt for the **re-loaded** step (plus `completed(...)` + `appNudge()` when the order just completed). Any other reply clears `pending_confirm`.
  - `sendCurrentStep(orderId, { reason })` — re-load, send prompt for the current step unless `session.last_step` equals it and reason is not `'changed'`; updates `last_step`, `last_prompt_at`. No-op for `driver_channel !== 'whatsapp'`.

- [ ] **Step 1: Failing resolver tests** — one per key above, including 2 stops (`stop_step` 0→`go_stop` 1, 1→`at_stop` 1, 4→`go_drop`, 5 + drop OTP→`drop_otp`).
- [ ] **Step 2: Failing flow tests** (mock prisma, `tripLifecycle`, `driverTripService`, `settlementService`, `notifications`, `dropOtp`):
  - `go_pickup` + `"1"` → `updateStatus(877, 55, 'arrived')`; reply contains the pickup-OTP prompt.
  - `go_pickup` + `"5"` → no backend call; reply equals `invalidReply('go_pickup', …)`.
  - `pickup_otp` + `"4821"` with `rloc_updated_at` 30 s ago → `progressTrip` called with `otp:'4821'` and lat/lng; with 5 min ago → lat/lng undefined.
  - `progressTrip` throws `{statusCode:409, message:'Invalid pickup OTP'}` → reply contains `Invalid pickup OTP` and the OTP prompt.
  - `at_drop` + `"6"` → `early_drop_required` result → session `pending_confirm='early_drop'`; then `"haan"` → `updateStatus(..., 'complete', expect.objectContaining({ earlyDrop:true }))`.
  - `go_pickup` + `"cancel"` then `"HAAN"` → `driverCancel(877, 55, 'Cancelled by driver on WhatsApp')`; `"cancel"` then `"1"` → no cancel, arrived called, `pending_confirm` cleared.
  - completed cash order + `"paisa mila"` → `markCashReceived({orderId:877, riderId:55})`.
  - cancelled order + `"1"` → reply `cancelled()`, no backend call.
  - App progressed the order to `order_status 3` meanwhile; driver sends `"1"` → no `arrived` call; reply is `invalidReply('go_drop', …)` (Review Focus 4).
- [ ] **Step 3:** Run both → FAIL.
- [ ] **Step 4:** Implement `messages.js`, `stepResolver.js`, `flow.js`.
- [ ] **Step 5:** Run → PASS.
- [ ] **Step 6:** Commit: `feat(whatsapp-trial): driver order flow over WhatsApp`.

---

### Task 5: Route bot messages & locations to the flow

**Files:**
- Create: `backend/src/whatsapp/driverOrder/senderIdentity.js`
- Modify: `backend/src/whatsapp/client.js:185-300` (`messages.upsert`)
- Modify: `backend/src/whatsapp/driverOrder/flow.js` (add `handleDriverLocation`)
- Test: `backend/src/whatsapp/__tests__/driverOrderRouting.test.js`, extend `driverOrderFlow.test.js`

**Interfaces:**
- `senderIdentity.phoneFromMessage(msg) → string|null` — 10-digit phone from `msg.key.remoteJid` when it ends `@s.whatsapp.net`; for `@lid` use `msg.key.senderPn` or `msg.key.remoteJidAlt` (whichever holds a `@s.whatsapp.net` JID); strip `91` prefix to 10 digits; null if unresolvable.
- `senderIdentity.findActiveWhatsAppOrder(phone10) → { orderId, riderId } | null` — rider by `fmobile` (match 10-digit and `91`-prefixed forms), then `pkg_order` with `rid`, `driver_channel:'whatsapp'`, `order_status in [1,2,3]`, `o_status notIn ['Completed','Cancelled']`; **also** a `Completed` order whose settlement is still pending cash (so `PAISA MILA` routes), latest first.
- `flow.handleDriverLocation({ orderId, riderId, lat, lng, timestampMs })` — update `tbl_rider` `rlats/rlongs/rloc_updated_at`, `liveDriverPositions.record(riderId, lat, lng, 0)`, emit `driver:location_stream` to room `order_${orderId}` (via `getIO()` from `sockets/socketServer`, same payload shape as `trackingSocket.js`), set `session.last_location_at`, call `progressTrip({ orderId, riderId, action:'sync', samples:[{ lat, lng, timestamp: timestampMs }] })`; if the resolved step changed → `sendCurrentStep(orderId, { reason:'changed' })`. Errors are logged, never thrown.
- `client.js`: a new routing block placed **after** the `fromMe` branch and **before** the chat-pause / stop-command checks: resolve phone → active order → if `LOCATION_PIN:` text, call `handleDriverLocation` (no reply); else `reply = await handleDriverReply(...)` and `sock.sendMessage(remoteJid, { text: reply })`; `continue`. For location messages from such drivers, the 120-second stale skip must not drop them (move the stale check below the driver routing, or exempt `liveLocationMessage`/`locationMessage`). Verify on dev with a real phone whether Live Location updates reach `messages.upsert` with `type === 'notify'`; if they arrive under another type or as `messages.update`, subscribe there for location-only payloads of routed drivers and note it in the commit message.

- [ ] **Step 1: Failing tests** — `phoneFromMessage` for `919876543210@s.whatsapp.net`, `@lid` with `senderPn: '919876543210@s.whatsapp.net'`, `@lid` with nothing → null. Routing (extract the routing block into an exported `routeDriverMessage({ msg, text, sock })` returning `true` when handled, so it is testable): driver with active WhatsApp order sending `"stop"` → `handleDriverReply` called, `chatControl.pauseChat` not called; unknown sender → returns false; `LOCATION_PIN:22.7,75.8` → `handleDriverLocation` with numbers, no `sendMessage`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS, plus existing `whatsapp/__tests__` suites → PASS.
- [ ] **Step 5:** Commit: `feat(whatsapp-trial): route trial driver messages and live location to the order flow`.

---

### Task 6: Customer "Send OTP to Driver" on WhatsApp orders

**Files:**
- Modify: `backend/src/services/pickupOtpShareService.js:77-113` (`share`)
- Modify: `backend/src/whatsapp/driverOrder/messages.js` (add `pickupOtpShared(otp)`)
- Test: `backend/src/services/__tests__/pickupOtpShareWhatsapp.test.js`

**Interfaces:**
- In `share`, when `order.driver_channel === 'whatsapp'`: instead of `emitDriverEvent` + `waitForDelivery`, send `messages.pickupOtpShared(order.otp)` ("Customer ne Pickup OTP bheja: 4821. Isi ko reply mein bhejein.") to the rider's `fmobile`; send true → update row `status:'delivered', delivered_at: now` and return `{ok:true, msg:MSG.SENT}`; false → `status:'failed'`, return `{ok:false, msg:MSG.FAILED}`.

- [ ] **Step 1: Failing tests** — whatsapp order + send true → row delivered, `emitDriverEvent` not called; send false → row failed, `ok:false`; app order → old path (emitDriverEvent called).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run + existing pickupOtpShare tests → PASS.
- [ ] **Step 5:** Commit: `feat(whatsapp-trial): customer OTP share goes to the driver's WhatsApp`.

---

### Task 7: Push the next step when the order changes elsewhere

**Files:**
- Modify: `backend/src/whatsapp/driverOrder/flow.js` (add `notifyOrderChanged`)
- Modify call sites: `backend/src/sockets/orderSocket.js` (`order:status_update` success), `backend/src/controllers/driverTripController.js` (after `progressTrip`), `backend/src/services/orderPickupService.js:305` (pickup change), the drop-change and add-stop confirm paths in `orderController` (where `notifyDriverDestinationUpdated` / `notifyDriverStopAdded` are called), and every `pushNotifier.notifyDriverCustomerCancelled` / `notifyDriverPickupTimeoutCancel` / `notifyDriverAdvancePaymentTimeoutCancel` call site in `tripLifecycle.js` and `bookingGuaranteeService.js` / `cancelRequestService.js` / `customiseCancelService.js`.
- Test: extend `driverOrderFlow.test.js`

**Interfaces:**
- `flow.notifyOrderChanged(orderId, { kind })` — fire-and-forget, never throws. `kind`: `'progress'` → `sendCurrentStep(orderId, {reason:'changed'})`; `'route_changed'` → resend `orderCard` + step; `'cancelled'` → send `messages.cancelled()` once. No-op unless `driver_channel === 'whatsapp'`.

- [ ] **Step 1: Failing tests** — app order → no send; whatsapp `'cancelled'` → one `cancelled()` send; `'route_changed'` → card containing the new drop address; `'progress'` with unchanged `last_step` and reason `changed` → still sends.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement + wire every call site listed (grep `notifyDriverCustomerCancelled|notifyDriverPickupTimeoutCancel|notifyDriverAdvancePaymentTimeoutCancel|notifyDriverDestinationUpdated|notifyDriverPickupUpdated|notifyDriverStopAdded` to confirm none is missed).
- [ ] **Step 4:** Run full `npx jest src/whatsapp src/services/__tests__/tripLifecycle*` → PASS.
- [ ] **Step 5:** Commit: `feat(whatsapp-trial): tell the WhatsApp driver about changes made elsewhere`.

---

### Task 8: Executive status, manual "next step", eligibility API, watchdog

**Files:**
- Modify: `backend/src/whatsapp/driverOrder/flow.js` (add `statusForExecutive`, `advanceAsExecutive`)
- Create: `backend/src/whatsapp/driverOrder/watchdog.js`
- Modify: `backend/src/controllers/adminOrderController.js`, `backend/src/routes/adminRoutes.js` (next to line 271), server bootstrap where other sweepers start (grep `setInterval` / `startSweeper` in `backend/src/server.js` or `app.js`)
- Test: `backend/src/whatsapp/__tests__/driverOrderExecutive.test.js`, `driverOrderWatchdog.test.js`

**Interfaces:**
- `GET /admin/riders/:id/whatsapp-eligibility` (RIDER_ROLES) → `{ success, data: eligibility(riderId) }`.
- `GET /admin/orders/:id/whatsapp-status` (RIDER_ROLES, scopeFilter, city-scoped like `assignRider`) → `{ success, data: statusForExecutive(orderId) }` = `{ channel, step, step_label, last_reply_at, last_location_at, last_prompt_at, needs_otp: boolean }`.
- `POST /admin/orders/:id/whatsapp-step` body `{ otp? }` (RIDER_ROLES, scopeFilter) → `advanceAsExecutive({ orderId, admin, otp })`: performs the backend call the driver's next valid reply would (same mapping as Task 4; OTP steps require `otp`; `await_cash` → `markCashReceived`), writes an `order_status_history` remark `"WhatsApp step '<step>' done by executive #<id>"` (same table/shape `assignRiderToOrder` uses for its remark), then `sendCurrentStep(orderId, {reason:'changed'})`. Returns `{ ok, message, step }`; refusals → 409 with the backend message. Not allowed for `go_pickup` cancel — executives cancel via the existing cancel flow.
- `watchdog.start()` every 60 s: for active WhatsApp orders, if `now - max(last_reply_at, last_prompt_at) > 10 min` and `alerted_step !== current step` → `adminSocket.notifyDispatchAlert(orderId, cityId, "WhatsApp driver hasn't replied for 10 min on order #<id> (<step label>). Call the driver.", { kind:'whatsapp_driver_silent' })`, set `alerted_step`; if bot not connected and any active WhatsApp order → one alert per order per disconnect (`kind:'whatsapp_bot_offline'`).

- [ ] **Step 1: Failing tests** — advance at `go_pickup` → `updateStatus(...,'arrived')` + history remark + `sendCurrentStep`; `pickup_otp` without otp → 400 `"Enter the pickup OTP"`; backend refusal → 409 message passthrough; watchdog alerts once per step and not before 10 min; bot offline alert.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement, register routes, start watchdog at boot (only when the WhatsApp bot is initialised in this process).
- [ ] **Step 4:** Run → PASS. **Step 5:** Commit: `feat(whatsapp-trial): executive status, manual next step, silence alerts`.

---

### Task 9: Admin UI — channel choice + WhatsApp order panel

**Files:**
- Create: `frontend/src/components/orders/WhatsAppOrderPanel.jsx`
- Modify: `frontend/src/pages/ExecutiveWorkspace.jsx:175-278` (`TrialDriverOffer`)
- Modify: `frontend/src/components/orders/OutsideDriverPanel.jsx:94-205`
- Modify: the order detail view for assigned orders (`OrderDetailDrawer.jsx`) to show `WhatsAppOrderPanel` when `order.driver_channel === 'whatsapp'`

**Interfaces:**
- Consumes the three endpoints from Task 8 and `POST /orders/:id/assign-rider` with `{ rider_id, channel }`.
- Choice UI (both screens): radio `App` / `WhatsApp`, default `App`. On mount call eligibility; WhatsApp radio disabled with the reason text (`disabled` → "WhatsApp orders are switched off", `bot_offline` → "WhatsApp bot is not connected", `not_trial` → "Only for active Trial Drivers"); show "WhatsApp orders done: N". With WhatsApp selected, the Assign button is enabled while offline and the "install the app / go online" helper text is replaced by "The order and every step will be sent to the driver on WhatsApp. Ask them to share Live Location."
- `WhatsAppOrderPanel({ orderId })`: polls status every 5 s; shows badge "WhatsApp", current step label, "Last reply N min ago", "Location: not shared / N min ago"; "Do next step for driver" button (OTP input when `needs_otp`) with a confirm step like the existing assign confirm; toast on result.

- [ ] **Step 1:** Implement the panel and both screen changes using existing `api`, `useToast`, `inputClass`, CSS variables.
- [ ] **Step 2:** Run `cd frontend && npm run build` → build succeeds with no new warnings for these files.
- [ ] **Step 3:** Commit: `feat(whatsapp-trial): executive chooses App or WhatsApp; WhatsApp order panel`.

---

### Task 10: End-to-end verification

- [ ] **Step 1:** `cd backend && npx jest --runInBand` → all suites pass except the pre-existing `aadharPdfVerify` failure; report the exact counts.
- [ ] **Step 2:** `cd frontend && npm run build` → success.
- [ ] **Step 3:** Write a manual test checklist `docs/testing/manual-test-cases-2026-11-17-whatsapp-trial.md`: apply migration on dev, set `whatsapp_trial_orders_enabled=1`, register a Trial Driver with a real test phone, assign with WhatsApp, walk every step (incl. wrong reply, wrong OTP, stop, drop OTP, early drop, cancel+HAAN, PAISA MILA), share Live Location and watch customer tracking, customer "Send OTP to Driver", customer cancel mid-flow, executive next-step, 10-min silence alert, driver logs into app mid-order.
- [ ] **Step 4:** Commit the checklist. Final report must state: migration `20261117010000_add_whatsapp_trial_orders` applied nowhere; switch default OFF; Live Location delivery behaviour observed (or not yet verified).

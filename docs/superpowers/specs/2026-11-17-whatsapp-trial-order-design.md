# WhatsApp Trial Order — Design

Date: 2026-11-17
Status: draft, awaiting owner approval

## Why

When no Shifter driver is available, the "Porter Driver Scraping Bot" / auto outside-search finds a Porter
driver's number, the driver is registered as a Trial Driver, and an executive calls them. Many of these drivers
refuse to install the Shifter Driver app: they don't trust an unknown app ("phone hack ho jayega") but are happy
to do the job "normally". Today the order can only be assigned once the driver installs the app and goes online
(`trialDriverAutoAssign.js`, `assignRiderToOrder` rejects offline drivers), so these orders are lost.

The feature lets the executive run that driver's order entirely over WhatsApp, using our existing WhatsApp bot,
so the driver completes their first 1-2 orders without the app, builds trust, and then moves to the app.

## Goals

- An executive can choose, **per order at assign time**, whether a Trial Driver completes the order via the
  **App** (today's flow) or via **WhatsApp**.
- On WhatsApp the order follows **exactly the same lifecycle as the driver app**: arrived → pickup OTP →
  pickup complete → (stop arrived → stop complete)* → drop arrived → (drop OTP) → complete. Same timers,
  wait charges, early-drop repricing, drop OTP, commission/wallet settlement, customer + receiver notifications.
  "Koi mistake nahi hona chahiye": the bot never advances a step the backend would not allow.
- **The app stays the source of truth.** WhatsApp orders are ordinary `pkg_order` rows assigned to the
  driver's `tbl_rider`; they appear in the driver app's order history, earnings and wallet exactly like app
  orders. If the driver installs the app mid-order, the active order shows there and either channel can move it.
- Customer and receiver live tracking keep working, fed by the driver's WhatsApp Live Location.
- The executive can see each WhatsApp order's current step and push a step on the driver's behalf if stuck.
- After each WhatsApp order the bot nudges the driver to the app (link + "your earnings are in your Shifter wallet").

## Non-goals

- No new pricing, commission, wallet or settlement logic. Commission is deducted from the Trial Driver's wallet
  exactly as today (cash orders push it negative; online-paid earnings sit in the wallet until withdrawn via app).
- No official WhatsApp Cloud API / Meta templates / tap-buttons (chosen approach A; may migrate later).
- No browser page for the driver.
- Not for regular (non-trial) drivers.
- Not making the WhatsApp driver "online" for normal dispatch.

## Anti-goals (failure even if it "works")

- A WhatsApp reply moving an order out of sequence, or any second state machine that can drift from
  `driverTripService.progressTrip` / `tripLifecycle.updateStatus`.
- A WhatsApp driver receiving normal dispatch broadcasts / being marked online.
- The bot's customer menu, AI replies or "stop" chat-pause swallowing a driver's order reply.
- WhatsApp orders missing from the app history / wallet.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Existing Baileys bot (`backend/src/whatsapp/client.js`), driver replies with numbers/OTP text | Already running, no cost, same number. No real buttons; unofficial API carries ban risk at high volume — acceptable for 1-2 trial orders. |
| B | Official WhatsApp Cloud API with reply buttons | Fewest mistakes, no ban risk; needs Meta verification, approved templates (driver never messaged us first), per-conversation cost, days of setup. Possible later migration — keep the driver-step logic channel-agnostic so B only swaps the transport. |
| C | WhatsApp link to a no-install web page with big buttons | Fewest mistakes + browser GPS; but a driver who fears an app also fears links, and location only flows while the page is open. |

Owner picked **A**.

## How it works

### 1. Executive chooses the mode (assign time)

Where (only the places a Porter driver is registered as a Trial Driver and assigned): the Trial Driver offer card on
"New Ride Trial Driver" (`frontend/src/pages/ExecutiveWorkspace.jsx`, `TrialDriverOffer`) and the manual
outside-driver register panel on an order (`OutsideDriverPanel.jsx`). The general `AssignDriverModal` (online
drivers only) is **not** changed.

```
Order kaise complete hoga?   ( ) App   (•) WhatsApp
[Assign Order to Driver]   [Not Convinced]
```

- **App**: today's behaviour unchanged (assign once online / auto-assign on online).
- **WhatsApp**: Assign is enabled even while the driver is offline. The order is assigned immediately and
  the first WhatsApp order message is sent to the driver's mobile (`tbl_rider.fmobile`).
- The mode is stored **on the order** (e.g. `pkg_order.driver_channel = 'app' | 'whatsapp'`, default `'app'`;
  exact column/table is the builder's call).
- Auto-assign-on-online (`trialDriverAutoAssign.autoAssignIfOffered`) must not fire for a case where the
  executive already assigned via WhatsApp (it won't — the case is closed by the assign — but verify).
- WhatsApp mode is only offered for Trial Drivers (`trial_status = 'active'`).

### 2. Assignment without being online

`orderAssignmentService.assignRiderToOrder` rejects `a_status !== 1` ("Driver is currently offline"). Add an
explicit option (e.g. `channel: 'whatsapp'`) that skips **only** the online check; every other check
(approved/trial, city scope, one active trip, order still open, rate card) stays. The driver's `a_status`
is **not** changed, so they never receive normal dispatch broadcasts. Everything else the assign does
(fare finalisation, customer `order:assigned` push, customer/receiver WhatsApp notifications) is unchanged.

### 3. Driver-side WhatsApp conversation

A new module (suggested `backend/src/whatsapp/driverOrderFlow.js`) owns the driver conversation. It is a thin
adapter: it **reads the order's current state from the DB on every message** (no in-memory step state) and
maps a reply to exactly one existing backend call.

Routing in `client.js` `messages.upsert`: **before** chat-pause, stop-command and `botMenuEngine` handling,
if the sender matches a rider who has an active (`order_status` 1/2/3) order with `driver_channel='whatsapp'`,
hand the message to `driverOrderFlow` and stop. (So "stop", menus and AI replies never intercept a driver.)

Step messages (Hinglish, one next step per message; exact wording is the builder's call):

| Order state | Bot tells driver | Valid reply | Backend call |
|---|---|---|---|
| Assigned (`order_status`=1) | Order card: id, vehicle, fare, pickup address + Google Maps link, drop + stops, customer name/phone, "Live Location share karein", "Pickup pe pahunch kar **1** bhejein" | `1` | `tripLifecycle.updateStatus(id, rid, 'arrived')` |
| Arrived (2), OTP not verified | "Customer se Pickup OTP lekar bhejein" | 4-6 digit number | `progressTrip({action:'verify_otp', otp, lat, lng})` with last known location |
| OTP verified, loading | "Maal load hone ke baad **2** bhejein" | `2` | `updateStatus(..., 'pickup')` |
| On route, stop N next | "Stop N pe pahunch kar **3** bhejein" | `3` | `updateStatus(..., 'arrived_stop_N')` |
| At stop N | "Stop N ka kaam hone par **4** bhejein" | `4` | `updateStatus(..., 'complete_stop_N')` |
| On route, drop next | "Drop pe pahunch kar **5** bhejein" | `5` | `updateStatus(..., 'arrived_drop')` |
| At drop | Drop OTP required → "Receiver se Drop OTP lekar bhejein"; else "Maal utarne ke baad **6** bhejein" | OTP / `6` | `updateStatus(..., 'complete', {dropOtp, lat, lng})` |
| Early-drop response | "Aap drop se X m door hain. Yahin khatam karna hai? **HAAN** bhejein" (shows old/new fare) | `HAAN` | `updateStatus(..., 'complete', {earlyDrop:true, ...})` |
| Completed | Final fare / amount to collect (cash) or "₹X aapke Shifter wallet mein", app link + trust message | — | — |

Rules:
- Any other reply → bot re-sends the current step's instruction (never guesses). `0`/`help` re-sends the
  current step plus the executive helpline.
- Backend refusal (`success:false` / 409) → bot sends the backend's own message, then the current step again.
- Auto-arrival from Live Location (see 4) also advances the order; the bot then sends the next step proactively.
- Duplicate replies are harmless: the backend is idempotent per step (`stop_step`, milestone upserts).
- Driver cancel: same rules as the app (`tripLifecycle.driverCancel`, incl. driver-cancel re-live). Reply
  `CANCEL` → bot asks for confirmation `HAAN` → cancel. (Builder's/owner's call — see open items.)
- Customer-side changes (pickup change, add stop, drop change, cancel by customer/admin) → bot sends the
  driver an updated order card / "order cancel ho gaya" message. Hook where these already notify the driver app.

### 4. Live Location → driver location

- The first order message asks the driver to share **WhatsApp Live Location** (8 h) with the bot number.
- Each `liveLocationMessage`/`locationMessage` from a WhatsApp-channel driver updates
  `tbl_rider.rlats/rlongs/rloc_updated_at` (same as `trackingSocket.js`) and calls
  `progressTrip({action:'sync', samples:[{lat,lng,timestamp}]})` so auto-arrival, pickup-timer auto-pause and
  the GPS trail work like the app.
- Location messages from these drivers must not be filtered by the existing 120-second stale filter or the
  `m.type !== 'notify'` filter if Live Location updates arrive that way (builder must verify Baileys behaviour).
- No location → manual numeric replies still work (same as the app's manual "arrived" fallback for weak GPS).
  The executive card shows "Location: not shared / last update N min ago".

### 5. Executive visibility + manual override

- On the case card / order details for a WhatsApp order: channel badge "WhatsApp", current step, last driver
  reply time, last location time.
- **"Next step" override** (admin, executive role, city-scoped): runs the same backend call the driver's next
  reply would (incl. OTP entry box for pickup/drop OTP). Recorded with the admin's id in the order remark/log.
  The bot then sends the driver the next step.
- Dispatch alert to the executive when: WhatsApp send fails, the driver hasn't replied for X minutes on a step
  (builder picks X, e.g. 10), or the bot is disconnected while a WhatsApp order is active.

### 6. Moving the driver to the app

- After every completed WhatsApp order: thank-you + earnings + Driver app link + "isi number se login karein,
  saare orders aur wallet app mein dikhenge".
- Count of completed WhatsApp orders per rider is visible to the executive at assign time ("WhatsApp orders
  done: 1"). No hard block — the executive decides per order (owner: decision at assign time).
- If the driver logs into the app while a WhatsApp order is active, the app shows that order normally; both
  the app and WhatsApp can advance it; the bot keeps telling the driver the current step after any change.

### 7. Trial order allowance (owner decision 1a)

WhatsApp-channel orders **do not count** toward the trial allowance. `utils/trialOrderTracker.recordTrialOrderCompletion`
(called from `tripLifecycle` on completion) must skip orders with `driver_channel = 'whatsapp'`, so the driver stays
`trial_status = 'active'` with their trial orders still available when they move to the app. The WhatsApp count shown
to the executive is a separate count of completed WhatsApp-channel orders for that rider.

### 8. Customer "Send OTP to Driver" on a WhatsApp order (owner decision 2a)

`pickupOtpShareService` today delivers the pickup OTP through the driver app and waits for an on-screen ack; the
delivered/failed result feeds the pickup-timeout fault split. For a `driver_channel = 'whatsapp'` order, send the OTP
to the driver's WhatsApp instead ("Customer ne OTP bheja: 4821 — isi ko reply mein bhejein") and record the share as
**delivered** when the WhatsApp send succeeds (failed if the send fails / bot disconnected). The driver still has to
reply with the OTP, which goes through the normal `verify_otp` path, so the fault split works exactly as with the app.

### 9. Cash received (owner decision 3a)

When completion creates a pending cash `order_settlement`, the completion message asks
"Customer se ₹X cash mila? **PAISA MILA** bhejein". Reply `PAISA MILA` (case/space-insensitive) → 
`settlementService.markCashReceived`, same as the app's "Received" tap. No reply → existing
`settlement_auto_receive_minutes` auto-receive applies unchanged. Online-paid orders skip this step.

### 10. On/off switch

A default-OFF switch (app_settings key, e.g. `whatsapp_trial_orders_enabled`, optionally per city). OFF → the
WhatsApp option is hidden on assign screens, the assign API rejects `channel: 'whatsapp'`, and new messages are not
routed to `driverOrderFlow` unless the sender already has an active WhatsApp order (so in-flight orders can finish).

## Constraints / risks the builder must handle

- **Phone matching:** newer WhatsApp sends senders as `@lid` JIDs, where `remoteJid.split('@')[0]` is not
  the phone. Map lid → phone (Baileys `senderPn` / `remoteJidAlt` / contact store) before matching
  `tbl_rider.fmobile`. Normalise 91-prefix / 10-digit.
- Outbound messages to a driver who never messaged us must work on the Baileys account (they do today for
  customer notifications via `notifications.sendWhatsAppNotification`).
- Bot disconnected → WhatsApp option disabled in the UI (use `getBotStatus()`), and alerts for active orders.
- Multiple backend instances: the bot runs in one process; DB-driven state keeps that safe.
- Schema changes need a migration applied by hand on dev + prod (see project memory on schema drift).

## Decided by the owner

- Approach A (existing Baileys bot, numeric/text replies).
- Mode chosen by the executive per order at assign time, on the trial-driver assign screen.
- App is the source of truth; orders, earnings, wallet all show in the app.
- Commission/wallet exactly as today for Trial Drivers.
- Lifecycle identical to the driver app.
- WhatsApp orders don't count toward the trial allowance (1a).
- Customer "Send OTP to Driver" goes to the driver's WhatsApp and counts as delivered (2a).
- Cash orders: bot asks "PAISA MILA"; auto-receive still applies (3a).

## Builder's calls (proposed, owner may override)

- WhatsApp option only on the Trial Driver offer card + `OutsideDriverPanel`, not the general assign modal.
- Default-OFF on/off switch.

- Column/table for the channel; message wording; reply keywords; no-reply alert threshold.
- Driver may cancel via WhatsApp with `CANCEL` + `HAAN` confirmation (mirrors app).
- No hard cap on WhatsApp orders per driver; count shown to executive.

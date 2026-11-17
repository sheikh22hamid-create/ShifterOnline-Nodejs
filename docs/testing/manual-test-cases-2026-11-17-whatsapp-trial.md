# Manual test checklist — WhatsApp Trial Order (2026-11-17)

Branch `feature/whatsapp-trial-order`. Run on **DEV** only. Use a test phone you control as the "Porter driver" and a second phone/WhatsApp as the customer.

## 0. Setup
- [ ] Apply `backend/prisma/migrations/20261117010000_add_whatsapp_trial_orders/migration.sql` on the dev DB (not applied anywhere yet; without it every `pkg_order` read fails with P2022).
- [ ] Turn the switch on: `INSERT INTO app_settings (setting_key, setting_value) VALUES ('whatsapp_trial_orders_enabled','1') ON DUPLICATE KEY UPDATE setting_value='1';`
- [ ] Backend running with the WhatsApp bot connected (not `DISABLE_WHATSAPP_BOT`); admin panel shows bot CONNECTED.
- [ ] Register the test phone as a Trial Driver (trial_status active). Driver app NOT installed / driver offline.

## 1. Assign choice
- [ ] Trial Driver offer card shows `( ) App ( ) WhatsApp`, default App, "WhatsApp orders done: 0".
- [ ] With App selected: offline driver → Assign disabled, old install/go-online text (unchanged behaviour).
- [ ] Switch OFF → WhatsApp disabled "WhatsApp orders are switched off". Bot disconnected → "WhatsApp bot is not connected". Non-trial driver → "Only for active Trial Drivers".
- [ ] Select WhatsApp → Assign enabled while offline → order assigned; driver still offline (`a_status` unchanged).
- [ ] Same check on an order's Outside Driver panel.
- [ ] Driver phone receives order card (🆕 Order #, fare, pickup, drop, Live Location request, helpline 9109114515) + first step.

## 2. Step walk (reply only numbers)
- [ ] Wrong reply (e.g. "abc") → "invalid" message repeating the current step.
- [ ] Arrived at pickup → step advances; customer app shows driver arrived.
- [ ] Wrong pickup OTP → refused with message; correct OTP → loading step.
- [ ] Customer taps "Send OTP to Driver" → driver gets "Customer ne Pickup OTP bheja: NNNN"; customer sees sent.
- [ ] Loading done → trip started; customer app shows in-transit.
- [ ] Order with a stop: arrive stop → complete stop → next leg.
- [ ] Drop OTP flow (if drop OTP on): wrong OTP refused, correct OTP completes.
- [ ] Early drop: share Live Location far from drop, try complete → "early drop" confirm → HAAN → completes.
- [ ] CANCEL before pickup → confirm → HAAN → order cancel/re-live behaves exactly as an app driver cancel.
- [ ] Cash order → after complete bot asks "PAISA MILA" → reply → settlement marked received; wallet commission debited as for app trial drivers.
- [ ] Completion message shows fare/earnings + driver app link + "isi number se login karein".
- [ ] Order counts: WhatsApp order does NOT consume trial allowance; "WhatsApp orders done" becomes 1.

## 3. Live Location (real-phone checks still outstanding)
- [ ] Share WhatsApp Live Location (8 h) → customer tracking map moves.
- [ ] Note: do live updates reach the linked bot device? Does `sequenceNumber` increase? Record result.
- [ ] Driver on a `@lid` WhatsApp account: replies still route to the order (remoteJidAlt).
- [ ] Static location pin / forwarded location → ignored (no step change).

## 4. Changes made elsewhere
- [ ] Customer changes drop / adds stop → driver gets "✏️ Order #N update hua" + current step (not a new-order card).
- [ ] Customer cancels mid-flow → driver gets one "order cancel ho gaya" message; later replies get the same.
- [ ] Executive completes / progresses from admin → driver gets next step / completion summary once.
- [ ] Driver logs into the Driver app mid-order → order visible in app; no WhatsApp spam from app syncs.

## 5. Executive panel & alerts
- [ ] Order details show WhatsApp panel: step, last reply N min ago, location N min ago, refreshes every 5 s.
- [ ] "Do next step for driver" → confirm shows step; OTP box on OTP steps; result toast; order history remark "done by executive #id"; driver gets the next step.
- [ ] Executive from another city → 403 on status/next step/eligibility.
- [ ] No reply for 10 min on a non-driving step → dispatch alert "WhatsApp driver hasn't replied…" once per step.
- [ ] Driving step with Live Location fresh → no silence alert.
- [ ] Stop the bot during an active WhatsApp order → one "bot offline" alert per order; no silence alerts while offline.

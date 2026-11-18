# Customer App — "Finding your driver" screen redesign — Design (short)

Date: 2026-11-18 · Branch: `feature/porter-style-ui` · Screen: `ShifterOnline/lib/screens/home/waiting_screen.dart`
Mockup (approved): https://claude.ai/artifact/V1pwTeQvwcRrAdd3V1kVq9 (boards: Current · New (A) searching, live · New (A) long wait)
Image prompts: `docs/design/porter-style-asset-prompts.md` (V1–V4)

## Intent
The owner wants the screen to feel like Porter's. When finding a driver takes long, the customer should not feel it is late, and should not cancel the order.

Two things on today's screen push people to cancel:
- a big **countdown** (mm:ss running down to 00:00)
- a big red **Cancel Order** button

## Goals / non-goals / anti-goals
- **Goals:**
  - Make the wait feel like progress, not time running out.
  - Reassure the customer: the order is real, it stays active, they are covered by the guarantee, and they can leave the screen.
  - Make cancelling possible but quiet.
  - Show a premium 3D vehicle.
- **Non-goals:** any change to search, dispatch, timeouts, socket events, cancel/compensation rules, or the guarantee logic. No new API.
- **Anti-goals:**
  - Fake facts: "5 drivers notified", invented ETAs, or "most orders get a driver in 2 min" are failures even if they reduce cancels.
  - Hiding Cancel.

## Approaches (owner picked A)
- **A (picked):** replace the visible countdown with an eased progress bar, 3 steps and rotating truthful messages. The deadline still drives everything under the hood.
- **B:** keep a small countdown under the progress bar. Rejected by the owner: the number still pulls attention to "time left".
- **C:** keep the timer and only restyle. Doesn't address the cancel problem.

## Design (A)
Top to bottom (v2 tokens, canvas background, white cards with `AppShadow.card`):

1. **Animated orange hero** (top 318 px, solid brand `#FF6B35`, bottom radius 28; approved 2026-11-18 over the radar version):
   - **Top row on the band:** a white back circle and a white **"Go to Home"** pill. Both call the existing `_navigateBackToHome`, which keeps the order watched in the background.
   - **Scene, back to front:**
     - 3 white clouds drift right → left (14–20 s loops).
     - A dark `#3A1A0B` city skyline at 28% opacity scrolls slowly (18 s, seamless 2-copy loop).
     - A darker-orange road strip (92 px) with a white dashed lane line scrolls fast (0.6 s), so the vehicle looks like it is driving.
   - **The vehicle** sits on the road:
     - It is the **3D image for the booked kind** (`BookedVehicleKind` → V1 `vehicle_bike.png`, V2 `vehicle_e_loader.png`, V3 `vehicle_three_wheeler.png`, V4 `vehicle_four_wheeler.png` in `assets/v2/`).
     - It does a small "driving" bob/tilt (0.9 s), with 3 white speed lines behind it and a breathing ground shadow under it.
     - **Missing image → today's `VehicleBookingAnimation`** on the road, never a placeholder box.
   - **Reduce motion:** with the OS setting on, every animation stops; the scene stays static.
2. **Entrance:** the title block and the three cards below rise in one after another (0.5 s each, 150 ms apart) when the screen opens.
3. **Title + message:**
   - A small orange "live" dot pulses beside the title. The title is "Finding your driver", or "Still finding your driver" in the last stage.
   - The message under it rotates by stage, and each line is true. A new message fades in and slides up 8 px (0.5 s):
     1. "Sending your order to nearby drivers."
     2. "Nearby drivers can see your order now."
     3. "Drivers usually accept once they finish their current trip."
     4. (late) "Still looking. Your order stays active, no need to book again."

4. **Progress card:**
   - An orange bar plus 3 steps: ✓ Order placed · Drivers notified · Driver accepts. "Drivers notified" gets its tick after the first stage; a tick pops in with a small scale bounce.
   - A white shimmer sweeps across the filled part of the bar every 1.8 s, so it never looks stuck.
   - The bar moves fast at first, then slows, and **never reaches 100%** until the assignment event. The screen then leaves as it does today.

5. **Trip card:**
   - The vehicle name, "Order #id · ₹grand_total", pickup (green ↑) and drop (red ↓) addresses.
   - Data comes from the order-details response the screen already fetches (`category`, `grand_total`, `customer_paddress`, `customer_daddress`).
   - Fields that are missing are hidden.

6. **Guarantee card:**
   - The existing `_buildGuaranteeCard` states and conditions are unchanged.
   - When the guarantee is on: in the late stage its headline becomes **"You are covered"** with the same amount text.

7. **Reassurance row:** "You can leave this screen. We'll let you know when a driver accepts."

8. **Cancel:** a small grey underlined **"Cancel booking"** text button at the bottom. It opens the existing `_showCancelDialog` (compensation text unchanged).

## Timing (stage = fraction of the search window)
- **Window:** from the order time (`order_date`) to the `_timerDeadline` the screen already computes.
- **Stage thresholds:** 0–20% stage 1, 20–50% stage 2, 50–80% stage 3, ≥80% late stage.
- **Bar:** `4% + 92% × (1 − e^(−3·fraction))`, capped at 96%.
- **No deadline known** (System 1 / not yet loaded): use time on screen, with a nominal 5-minute window.

## Constraints
- UI-only. All existing behaviour stays: socket listeners, timeouts, auto-close, recovery on reconnect, guarantee pending/locked states, the cancel API and dialog.
- New strings go through `.tr` with English keys.
- Dark mode via `AppPalette.current`.
- The Plan 5 colour guard applies: the file is in `_swept`.

## Left to the builder
- How to split the widgets: progress card, trip card and the vehicle hero as small presentational widgets.
- The exact message rotation inside a stage, and the animation curves.
- How the order time is read: `order_date` parse, falling back to time on screen.

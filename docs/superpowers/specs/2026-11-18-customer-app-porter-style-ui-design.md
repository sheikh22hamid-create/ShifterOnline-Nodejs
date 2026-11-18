# Customer App — Porter-Style UI (v2 redesign) — Design

Date: 2026-11-18
Branch: `feature/porter-style-ui` (from `main`, which already contains the 2026-11-16 redesign)
Builds on: `docs/superpowers/specs/2026-11-16-customer-app-ui-redesign-design.md` (called "v1" below)
Reference screenshots (Porter, captured from the owner's phone, Indore pickup, 2026-11-18):
`docs/design/porter-reference-2026-11-18/` — home, service sheet, drop search, drop details, select
vehicle, review booking, orders, payments, account.

## 1. Intent

The owner does not enjoy the v1 customer app theme. Porter feels **premium, easy to use, simple and
fast**, and the owner wants the Shifter customer app (`ShifterOnline/`, Flutter) to look and flow like
Porter, with two hard rules:

1. **Shifter's own colour stays** (brand orange `#FF6B35`, dark text on orange buttons — v1 decision).
2. **No Shifter feature may go missing.** Every feature stays reachable; it is made as simple as
   Porter where possible, usually by moving it to the screen where Porter puts the equivalent.

Why v1 still feels heavy: its Home carries a peach header, animated truck, a full route card with
Now/Schedule/Low Fare, vehicle cards, an 8-tile "More on Shifter" grid, a Free Ride banner and a centre
"Book now" nav button. Porter's Home has a pickup card, 2–3 big service tiles and one rewards strip.

## 2. Goals, non-goals, anti-goals

**Goals**
- Porter's look: light grey-blue canvas, white rounded cards, one accent colour (orange) used only for
  the primary button and selected states, bold clear hierarchy, consistent pickup (green ↑) / drop
  (red ↓) markers.
- Porter's flow: one job per screen, one full-width primary button pinned at the bottom.
- Porter-sparse Home (option A, owner's choice).
- Premium illustrations, supplied by the owner from prompts written by Claude (§8).
- No jank (v1 performance rules still apply).

**Non-goals**
- No backend / API / socket / GetX controller / business-rule changes. No new features.
- Not a pixel copy of Porter: no Porter logos, illustrations, icons, copy text or blue.

**Anti-goals (failure even if it "works")**
- Any existing feature missing or harder to find than a clearly named card/row.
- Any existing `onTap` handler, validation or conditional state (v1 §7 list) changed in behaviour.
- App looking AI-generated (emoji, gradients, mismatched illustration styles).

## 3. Constraints

- UI only. Every new button calls the same existing function the old one did.
- Reuse v1 building blocks: `lib/theme/app_tokens.dart`, `app_theme.dart`, `lib/theme/widgets/*`.
- Keep the 222+ existing widget tests green; update only tests asserting old layout.
- Gilroy font stays (closest to Porter's bold geometric sans already bundled).
- `ShifterOnline/` is gitignored → `git add -f` exact files only.
- Vehicle images on Select Vehicle come from the backend (admin-uploaded); the app does not ship them.

## 4. Approaches

- **A — Evolve v1 (chosen by owner).** Retune v1 tokens toward Porter, then re-layout screen by screen
  on the existing widgets, device-checking after each. Lowest risk of losing features: all wiring is
  already in v1 widgets.
- **B — Rewrite each screen.** Closer pixel match, but every feature and state has to be re-wired;
  highest risk of a missing feature. Rejected because "no feature missing" is the owner's first rule.

Home layout options (owner chose **A**): A = Porter-sparse Home (pickup, 4 tiles, Free Ride strip);
B = same plus a 4-item "More on Shifter" row. A chosen; all grid items move per §6.

Before any app code: mockups of **Home, Select Vehicle, Review** next to the Porter screenshots, for the
owner's approval.

## 5. Visual system changes (on top of v1 §5)

| Token | v1 | v2 (Porter feel) |
|---|---|---|
| canvas | `#F7F7F7` | cool light grey-blue `#F3F5F9` |
| surface | white | white (unchanged) |
| card radius | per v1 | 16 for cards, 12 for inner rows/inputs, 999 for chips |
| card elevation | v1 shadow | very soft: `0 2 8 rgba(16,24,40,0.06)`, no borders on main cards |
| primary button | orange, dark text | full-width, 52 h, radius 12, pinned bottom in a white safe-area bar |
| secondary button | v1 | white with 1.5 px orange outline + orange text (Porter "Add GSTIN" style) |
| pickup / drop markers | mixed | green circle ↑ pickup, red circle ↓ drop, grey dots between, everywhere |
| text | v1 ink | title 18–20 bold, row title 16 semibold, sub 13–14 `inkMuted` |
| brand tint | `#FFF0E8` | used only for selected-card fill and the Home header |

Dark mode keeps working via the existing palette switch; new tokens get dark values (builder's call,
v1 rule).

## 6. Screens and where every feature goes

### 6.1 Home (`screens/home/home.dart`, `lib/bottombar.dart`)
- **Header** (orange-tint band, Porter header shape): Shifter logo, notification bell, wallet balance
  chip (existing data only), and the static header illustration (asset H1). No animated truck.
- **Pickup card** overlapping the header: "Pick up from" + address + chevron →
  `_changePickupLocation` (existing). Pickup-first prompt / not-serviceable state stay as today, restyled
  like Porter's "We are not there yet" card (asset E1).
- **Live-order strip** when an order is active (existing `_buildActiveOrderStrip`).
- **2×2 service tiles** (big white cards, illustration + label + chevron):
  - **Book Now** → `_selectedBookingType = 1`, then the same path the v1 route card used
    (`_startDropSelection` if no drop, else `_openVehicleSelection`).
  - **Schedule** → `_handleScheduleBookingTap` (existing; already opens drop search).
  - **Low Fare** → `_handleNextDayDeliveryTap` (existing eligibility check + Premium sheet unchanged).
  - **Customise Order** → `CustomiseOrderTile.open` (existing; keeps its switch/"Coming Soon" rule).
- **Free Ride Chance strip** (Porter "Explore Rewards" style; chance wording, never "first booking
  free") → existing Free Ride screen.
- Removed from Home (moved, not deleted): route card, vehicle cards, "More on Shifter" grid, saved
  places row, how-to-use card. Booking Guarantee strip stays off Home (v1 owner answer).
- **Bottom nav:** plain white bar, 4 tabs **Home · Orders · Wallet · Account**, active tab orange with
  a short top indicator (Porter style). Centre "Book now" button removed (tiles replace it).

### 6.2 Drop search (`location_search_screen.dart`, `add_stops_screen.dart`)
Porter layout: route card at top (pickup row with name·number, focused drop field, **+** add stop),
"Select on map" bar, recents list with **❤ SAVE**. Keeps: voice search, Paste map link, saved places,
results with distance.

### 6.3 Drop / pickup details (`location_confirm_map_screen.dart`)
Porter layout: map top with pin + tooltip, address card with **Change**, receiver name (phone-book icon
inside field), receiver number, "Use my mobile number" checkbox, **WhatsApp live-tracking opt-in**
checkbox, house/flat/floor, Save as Home/Shop/Other chips, pinned **Confirm and Proceed**.

### 6.4 Select Vehicle (`select_vehicle.dart`)
- Top: route card (pickup/drop with name·number, swap, **Add Stop**, **Edit Locations** — already
  exist), booking-type chip (Now / Schedule time / Low Fare), **driver search radius** row. The chip's
  "Change" only appears for Schedule and re-picks the time (`_pickScheduleDateTime`, today's
  behaviour); switching booking type means going back to Home (Claude's call — no new behaviour).
- Vehicle list: selected vehicle = large card (backend image, name + info icon, capacity · ETA, price,
  orange outline + tint); others = compact rows (image, name, tags like NEW, capacity · ETA, price with
  strike-through when discounted). Models / body type picker stays as today, restyled as a sheet.
- Pinned button: **Proceed with <vehicle>**.
- **Offers & Details card** below the vehicle list (owner decision 2026-11-18, option 2): goods type,
  Apply Coupon, Reward Points, GST — as Porter-style rows inside one white card. They stay on this
  screen because their state (`_appliedCoupon`, `_useReferralPoints`, `_gstDetails`, `_goodsTypeId`)
  and the payable/wallet-debit maths live in `select_vehicle.dart`; the booking path is not touched.

### 6.5 Review Booking (`confirm_order_map.dart`)
Sections as white cards, top to bottom: vehicle + time card ("View Address Details" → all stops and
receivers) with loading-time info line; read-only summary of the applied coupon / points / GST / goods
chosen on Select Vehicle (only if Review already receives them; else omitted); booking guidelines; **Booking Guarantee** line (v1 rule:
only when amount > 0, exact amount, locked variant). Pinned bottom bar: payment method selector
(Cash / Shifter Wallet with balance / **Receiver pays** with commission), total, **View Breakup**, and
**Book <vehicle>**. Terms line above it.

### 6.6 Finding driver, Live tracking, Trip complete
Feature lists exactly as v1 §6.6–6.8 (radar, guarantee line, cancel compensation dialog; OTP, driver
card, call/chat/share, waiting timer, WhatsApp share, pay online, change pickup/drop/add stop,
replace/favourite/block driver, report, customer care, cancel; ratings, invoice, settlement). Restyled
to v2 tokens only; v1 map-hero layout kept.

### 6.7 Orders (`myorder/myorder.dart`)
Porter cards: vehicle image + name + date, amount + chevron, inner grey box with pickup/drop rows,
status chip (e.g. CANCELLED / COMPLETED) + **Book Again** (only if an existing re-book action exists;
otherwise status chip + existing actions). Keeps Recent/Completed/Favourite tabs, payment-due banner +
Settle now, track / details / invoice, favourite toggle.

### 6.8 Wallet tab (`wallet_page.dart`, `referral_points_screen.dart`)
Porter "Payments" layout: balance card + full-width **Add Money**, then Reward Points card, then
transactions (All/Credit/Debit + filter). Keeps quick amounts, 2.5% fee + ₹50,000 max text.

### 6.9 Account (`profile/myprofile.dart`)
Porter grouped cards: profile header (name, email/mobile, View/Edit, **Add GST Details**); card 1 Saved
Addresses, Business/GST; card 2 Premium Plans, Free Ride status, Reward Points; card 3 Refer & Earn
(Invite button), Refer business leads, Share app; card 4 Favourite Drivers, Blocked Drivers; card 5
Language, Dark mode; card 6 Help & Support, **How to use** (admin `how_to_use_url`, moved from Home —
Claude's call), FAQs, Privacy, Terms; then Log out, Delete account.

### 6.10 Login / OTP
v1 single-entry login unchanged in flow; restyled to v2 tokens (Porter OTP layout per reference doc).

### 6.11 Feature checklist (must all be reachable after v2)
Book now · Schedule · Low Fare/Next Day Saver · Customise Order · Free Ride Chance · Premium Plans ·
Refer & Earn · Favourite Drivers · Blocked Drivers · Reward Points · Help & Support · FAQs · Wallet +
Add Money · Saved addresses · Notifications · Live-order strip · Add stop / edit locations · Paste map
link · Voice search · Pick on map · WhatsApp tracking opt-in (pickup/drop/stops) · Driver search radius ·
Vehicle models/body type · Goods type · Coupon · GST · Receiver pays · Booking Guarantee · Payment
methods · Fare breakup · all v1 tracking/after-trip actions · Orders tabs + payment-due settle ·
Language · Dark mode · Refer business leads · Share app · Delete account · Log out.
(Buy Anything and Offers tile were already removed by owner decision in v1 — not reintroduced.)

## 7. Behaviour that must stay exactly as today
All of v1 §7 and §8 (Low Fare rules, Booking Guarantee rules, Free Ride wording, conditional states,
onTap handlers, validations, motion/performance rules).

## 8. Assets (owner generates from Claude's prompts)
Claude writes one prompt per asset into `docs/design/porter-style-asset-prompts.md`: one consistent
style for all (soft 3D/clay, clean white background or transparent PNG, Shifter orange `#FF6B35` +
navy accents, no text inside images, no other brand names/logos), exact pixel size and file name.
Planned set: H1 Home header art; T1–T4 tile art (Book Now, Schedule, Low Fare, Customise Order); F1 Free
Ride strip icon; E1 not-serviceable empty state; E2 no orders; E3 no driver found; W1 wallet card icon;
S1 Within-flow sheet art if needed. Until supplied, flat placeholders (`BrandIllustration`) are used and
file names are already wired so dropping the PNG in `assets/` is the only step.

## 9. Order of work
0. Mockups (Home, Select Vehicle, Review) as an HTML page beside the Porter screenshots → owner
   approval. No app code (not even tokens) before approval. Every "Claude's call" in §10 (canvas
   colour, sizes, nav, placements) may still change from the owner's mockup feedback; the spec is then
   updated before step 1.
1. Tokens + shared widgets (canvas, card, pinned bottom bar, markers, outline button, nav).
2. Home + bottom nav. 3. Drop search + details. 4. Select Vehicle. 5. Review.
6. Orders, Wallet, Account. 7. Tracking / finding driver / trip complete / login restyle.
Device check on the owner's phone after each step; commit each finished step.

## 10. Decisions log
| Decision | By | Date |
|---|---|---|
| Porter look + flow, Shifter orange kept | Owner | 2026-11-18 |
| No feature may go missing | Owner | 2026-11-18 |
| Home option A (sparse) | Owner | 2026-11-18 |
| Approach A (evolve v1) | Owner | 2026-11-18 |
| Owner makes images from Claude's prompts | Owner | 2026-11-18 |
| Home tiles = Book Now / Schedule / Low Fare / Customise Order | Owner (agreed) | 2026-11-18 |
| 4-tab nav, centre Book now removed | Claude's call | 2026-11-18 |
| Goods/coupon/points/GST stay on Select Vehicle in an "Offers & Details" card | Owner | 2026-11-18 |
| Booking-type "Change" = re-pick schedule time only | Claude's call | 2026-11-18 |
| "How to use" moves to Account → Help card | Claude's call | 2026-11-18 |
| Canvas `#F3F5F9`, card/button sizes in §5 | Claude's call | 2026-11-18 |

## 11. Left to the builder
- Exact widget split, keeping state where it is.
- Dark values of new tokens.
- Skeletons per screen.
- Whether each moved control's validation still fires correctly in its new place (else keep it put).

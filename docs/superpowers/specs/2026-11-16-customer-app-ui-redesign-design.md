# Customer App UI Redesign — Design

Date: 2026-11-16
App: `ShifterOnline/` (Flutter customer app, GetX + Provider)
Branch: `feature/customer-ui-redesign`
Mockups (approved direction): https://claude.ai/artifact/N6W3fokfpJBwhrXFGhpwhb
Reference: `C:\Users\alkvi\OneDrive\Desktop\Porter Reverse Engg\PORTER_UI_UX_REVERSE_ENGINEERING.md`

## 1. Intent

The owner wants the customer app to feel as easy, light and premium as Porter's customer app.
Today the app:

- looks "AI-generated" (gradients everywhere, random styles per screen, AI stock images that carry
  wrong brand names: `assets/delivery_van_footer.jpg` says "SPEEDY SHIPS", `assets/delivery_mascot.jpg`
  says "SWIFTDELIVER");
- hangs (suspected: very large single-widget screens that rebuild as a whole — `trackingway.dart`
  9,288 lines, `home.dart` 4,201, `select_vehicle.dart` 2,512 — not yet profiled);
- hides many of its own features, so customers never find them.

Porter is the reference for **flow and feel**, not a template to copy. Shifter has more features than
Porter; every one of them must stay and be shown properly.

## 2. Goals, non-goals, anti-goals

**Goals**
- One consistent visual system across all customer screens (tokens in one theme file).
- Porter-like booking flow: search → confirm drop details → choose vehicle → review & pay → finding
  driver → live tracking → trip complete.
- Every existing customer feature visible and reachable (see §7 feature checklist).
- Smooth, light motion (skeletons, small transitions) and no hangs.

**Non-goals**
- No backend/API/socket changes. No new business features.
- No change to fare logic, eligibility rules, OTP flows, payment flows or order state handling.
- Driver app (`ShifterDriver/`) is out of scope.

**Anti-goals (failure even if it "works")**
- Any existing feature removed or made unreachable.
- Any behaviour change: a button that used to call X now calls Y, a validation dropped, a state missed.
- Looks AI-generated: emojis, gradient washes, glow, random colours, stock 3D mascots.
- Heavier/slower than today (many Lottie files, full-screen rebuilds on every tick).

## 3. Constraints

- **UI-only.** Controllers, `ApiWrapper` calls, `NodeSocketManager` events, GetX/Provider state,
  `GetStorage` keys, navigation arguments and every `onTap` handler keep their current behaviour.
  A redesigned button calls the same existing function with the same arguments.
- Work screen by screen; the app must build and the full booking flow must work after every step.
- All user-facing text stays `.tr` / `.trParams` (23-language work, `lib/Language/`); new strings get
  added to the translation source. Layouts must survive long translations and RTL
  (`Language/rtl_wrapper.dart`) — no fixed-width text boxes.
- Dark mode (`ColorNotifier`) must keep working; every new token gets a dark value.
- Commits: exact files with `git add -f` (`ShifterOnline/` is gitignored). No push/deploy unasked.

## 4. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Theme/tokens + hang profiling first, then screens one by one (Home → booking flow → post-booking/account) | Slower to see the full new look; safest — each step is testable and reversible |
| B | Home + booking flow only, rest later | Faster first impression; app is a mix of old and new for a long time |
| C | All screens at once | One big change; high risk of broken flows, hard to test |

Owner picked **A**.

## 5. Visual system (decided)

**Theme:** light, matching today's app. Brand orange stays.

| Token | Light | Use |
|---|---|---|
| `brand` | `#FF6B35` (existing `linercolor`) | primary buttons, active states, pins, accents |
| `brandTint` | `#FFF0E8` | selected backgrounds, header band, active nav pill |
| `onBrand` | `#1A0B04` | **text/icons on orange — dark, not white (owner decision 2026-11-16)** |
| `brandText` | `#B83C0C` | orange-coloured text links on white (passes contrast) |
| `canvas` | `#F7F7F7` (existing `lightbgcolor`) | page background |
| `surface` | `#FFFFFF` | cards, sheets |
| `ink` | `#15171C` | primary text |
| `inkMuted` | `#4B515E` / `#636977` | secondary text (both pass 4.5:1 on white) |
| `line` | `#E8E8E8` / `#F0F0F0` | card borders / dividers |
| `success` | `#16A34A` text `#15803D`, tint `#ECFDF3` | pickup pin, Booking Guarantee, delivered, Next Day Saver |
| `danger` | `#B42318`, tint `#FFF4F2` | cancel, payment due |
| `warning` | `#9A6700`, tint `#FFFBEB` | guidelines, points, premium |
| feature tints | blue `#EAF1FB/#2457A6`, purple `#F1ECFB/#6B3FC2`, pink `#FDECEF/#B4234A`, gold `#FFF6DB/#9A6700` | "More on Shifter" icons only |

- **Type:** keep the bundled Gilroy (`Gilroy_Regular/Medium/Bold`); mockups used Plus Jakarta Sans only
  because Gilroy can't load in a browser. Scale: 27 hero / 22 page title / 17–16 section / 15–14 body /
  13–12 secondary / 11 nav labels.
- **Shape:** radius 8 chips, 12 inputs/buttons, 14–16 cards, 20 hero cards, 24 bottom-sheet top, pills full.
- **Elevation:** cards = 1px border, no shadow; floating items (route card, map buttons, nav) = soft shadow;
  primary CTA = orange-tinted shadow.
- **Touch targets:** ≥ 44px.
- **Icons:** line icons, 2px stroke, one family. No emojis anywhere (also remove `⭐` from strings such as
  "Premium Exclusive Feature").
- **Illustrations:** flat vehicle drawings (as in mockups) or the owner's real brand assets. Delete/replace
  the two AI images above.

## 6. Screens (as mocked)

Each item lists what the screen shows. Functionality comes from the existing screen named in brackets.

1. **Home** (`screens/home/home.dart`, `bottombar.dart`) — peach header with pickup location, wallet
   balance chip, notifications, "What are we moving today?", animated truck; floating route card
   (pickup, drop, add stop) with **Now / Schedule / Low Fare**; live-order strip when an order is active;
   vehicle cards (horizontal); orange **Free Ride Chance** banner (chance wording, never "first booking
   free"); **More on Shifter** grid (Customise Order, Buy Anything, Premium Plans, Refer & Earn, Offers &
   Coupons, Favourite Drivers, Reward Points, Help & Support); **Booking Guarantee** strip; saved places;
   floating white bottom nav (Home, Orders, Wallet, Account).
2. **Location search** (`location_search_screen.dart`, `add_stops_screen.dart`) — pickup + drop fields,
   voice search, add stop, Pick on map, Paste map link, saved places, results with distance, recents.
3. **Confirm drop details** (`location_confirm_map_screen.dart`) — pin-drop map, address, house/flat/floor,
   receiver name + number, phone book picker, WhatsApp live-tracking opt-in, save as Home/Shop/Other.
4. **Choose vehicle** (`select_vehicle.dart`) — map with route, route summary, driver search area,
   vehicle list (capacity, ETA, price, tag), Next Day Saver, goods type, coupon, referral points, GST
   details, estimated fare + fare details, continue.
5. **Review & pay** (`confirm_order_map.dart`) — vehicle + time, route with all stops and receivers,
   payment method (Cash / Shifter Wallet with balance / Receiver pays with commission), fare details,
   booking guidelines, Booking Guarantee line, confirm.
6. **Finding driver** (`waiting_screen.dart`) — radar map, progress, order summary, guarantee/locked line,
   Go to Home, cancel (keeps the existing "wait, you could get compensation" dialog).
7. **Live tracking** (`myorder/trackingway.dart`) — status pill + 4-step progress, pickup OTP, driver card
   (rating, plate, Call / Chat / Share), waiting-time info, share tracking with receiver on WhatsApp,
   payment (pay online, breakdown), order details (order ID copy, receivers, change number, goods,
   package photos), more options (change pickup, change drop, add stop, replace driver, favourite, block,
   report problem, customer care, cancel).
8. **Trip complete** (`customer_feedback_sheet.dart`, `customer_settlement_sheet.dart`) — success
   animation, total + payment status, invoice, breakdown, three ratings, comment, favourite driver,
   skip/submit; settlement options stay as today.
9. **Orders** (`myorder/myorder.dart`) — Recent / Completed / Favourite, payment-due banner + Settle now,
   order cards with status chip, track / details / invoice, favourite toggle.
10. **Wallet** (`wallet_page.dart`, `referral_points_screen.dart`) — ledger balance, quick amounts, add
    money (2.5% fee, ₹50,000 max shown), reward points, transactions with All/Credit/Debit + filter.
11. **Account** (`profile/myprofile.dart` + linked screens) — profile + edit, Premium plans, saved
    addresses, favourite / blocked drivers, refer & earn, Free Ride status, refer business leads, share
    app, language, dark mode, customer care, FAQs, privacy, terms, log out, delete account.
12. **Login** (`authscreen/signin.dart`, `signup.dart`, `verification.dart`) — mobile number, city,
    referral code, Get OTP, trust line, terms; OTP screen in the same style.

Screens not mocked (coupon list, custom order, buy anything, chat, premium plans, FAQ, etc.) get the same
tokens and components without layout changes beyond what consistency needs.

## 7. Behaviour that must stay exactly as today (checklist)

- **Low Fare / Next Day Saver:** shown to everyone; tap runs `_checkNextDayEligibility`; not eligible →
  `_showNextDayPremiumModal`; `select_vehicle.dart` re-checks and falls back to Instant (type 1).
- **Booking Guarantee:** line shown only when the quote amount > 0 (`guaranteeLine`), with the exact
  amount ("If no driver is found, you get ₹X"); locked customers see `guaranteeLockedLine`. Home strip
  follows the same rule (hidden when the city's guarantee is off). Mockup copy "compensation in your
  wallet" is replaced by the real amount text.
- Free Ride Chance wording: chance-based, repeatable — never "first booking free".
- Conditional states keep their triggers: pending settlement, insufficient wallet, receiver-pays
  conflicts, Free Ride locked, advance payment due, waiting-charge timer, drop OTP, scheduled-order
  cancel, no-driver dialogs, refund credited, session expired.
- Every `onTap` keeps its handler; every validation message keeps its condition.

### Mockup elements that need an existing data source

Some mocked elements show data on a screen that may not load it today: the wallet balance chip and the
live-order strip on Home, the wallet quick-amount chips. Rule: show them only from data/APIs the app
already has (e.g. the wallet balance the app already fetches, the active-order info `bottombar.dart`
already tracks). If no existing source exists, leave the element out and list it for the owner — adding
a new API call is out of scope. Quick-amount chips only pre-fill the existing amount field.

Sample values in the mockups (names, addresses, prices, km, OTP, order IDs) are placeholders; real
screens show live data.

## 8. Motion and performance

- Allowed motion: press scale (0.97), section fade-up on first load, skeleton shimmer while loading,
  radar on finding-driver, marker interpolation on tracking, pin drop on confirm, success tick + small
  confetti on trip complete, truck on Home header/login. All built with Flutter implicit/explicit
  animations, not new Lottie files. Respect "reduce motion" (`MediaQuery.disableAnimations`).
- Before redesigning a screen, profile it (Flutter DevTools, profile mode) and fix the cause of jank:
  split giant `build()` methods into small widgets, scope `setState`/`Obx` to the part that changes
  (timers, socket updates, map markers), `const` constructors, cache images.
- Home header animation must not rebuild the rest of the page.

## 9. Decisions log

| Decision | By | Date |
|---|---|---|
| Approach A (tokens + hang fix, then screen by screen) | Owner | 2026-11-16 |
| Home V3 layout, light theme, brand orange kept | Owner | 2026-11-16 |
| Porter = reference, not copy; all extra features shown | Owner | 2026-11-16 |
| Dark text on orange buttons | Owner | 2026-11-16 |
| Low Fare visible to all, Premium sheet on tap (today's rule) | Owner (keep current) | 2026-11-16 |
| Guarantee strip hidden when amount is 0 (today's rule) | Owner (keep current) | 2026-11-16 |
| Keep Gilroy font | Claude's call | 2026-11-16 |
| No new Lottie; flat SVG vehicle drawings | Claude's call | 2026-11-16 |

## 10. Left to the builder

- Exact widget split per screen and where state lives after the split (must not change behaviour).
- Skeleton shapes per screen.
- Dark-mode values for each token.
- Which existing Lottie files can be removed safely (only those no longer referenced).
- Real brand logo/illustration assets — ask the owner; until then use the flat drawings.

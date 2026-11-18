# Porter-Style UI — Plan 1: Mockups + Asset Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a side-by-side mockup page (Shifter v2 Home, Select Vehicle, Review next to the Porter screenshots) to approve, plus the image-prompt file they will use to generate assets — spec §9 step 0.

**Architecture:** One self-contained HTML page (inline CSS, no JS framework) that draws three 360×780 phone frames in Shifter's v2 style, each beside the matching Porter screenshot, published as a private claude.ai artifact. A markdown prompts file lists every image asset. No Flutter code changes in this plan; plans 2+ (tokens/widgets/Home, booking flow, other tabs) are written after the owner approves the mockups, because spec §9 lets the §10 "Claude's call" values change from that feedback.

**Tech Stack:** HTML/CSS, Artifact publish; Markdown.

**Spec:** `docs/superpowers/specs/2026-11-18-customer-app-porter-style-ui-design.md`

## Global Constraints

- Brand orange `#FF6B35`; text/icons on orange buttons dark `#1A0B04` (never white).
- Canvas `#F3F5F9`, cards white radius 16, inner rows/inputs radius 12, chips radius 999, card shadow `0 2px 8px rgba(16,24,40,0.06)`, no borders on main cards.
- Primary button full-width, 52px high, radius 12, pinned in a white bottom bar.
- Secondary button: white, 1.5px orange outline, orange text.
- Pickup marker green circle ↑ (`#16A34A`), drop marker red circle ↓ (`#B42318`).
- Type: title 18–20 bold, row title 16 semibold, sub 13–14 `#4B515E`; font Gilroy (fallback: system sans).
- No Porter logos, illustrations, icons, copy or blue; no emoji; no gradients.
- Free Ride wording is chance-based and repeatable — never "first booking free".
- Booking Guarantee line text: "If no driver is found, you get ₹X" (sample X).
- Sample data only (names, addresses, prices) — placeholders.

## Review Focus

- Every feature in spec §6.11 that belongs on Home / Select Vehicle / Review is visibly present on the mockup (owner's first rule) — Task 1 Step 3 checklist.
- Mockup readable at phone width (owner may open it on the phone): page must not scroll horizontally at 390px — Task 1 Step 4.
- Dark text on orange buttons, not white — Task 1 Step 4.
- Prompts produce one consistent style across all assets (same style line repeated in each prompt) — Task 2 Step 2.
- Prompt file names match the asset paths later plans will wire — Task 2 Step 1 table.

---

### Task 1: Side-by-side mockup page

**Files:**
- Create: `docs/design/porter-style-mockups/index.html`
- Uses (published as supporting files): `docs/design/porter-reference-2026-11-18/home_indore.jpg`, `vehicle.jpg`, `review.jpg`

**Interfaces:**
- Produces: published artifact URL (recorded in the spec's header line "Mockups:" and in memory `porter_style_ui_v2.md`).

- [ ] **Step 1: Build the page skeleton**

Three rows, each titled ("Home", "Select Vehicle", "Review Booking"), each with two phone frames: left "Porter (reference)" = `<img>` of the screenshot, right "Shifter v2" = HTML drawing. Below 820px wide, frames stack vertically. Tokens as CSS variables on `:root` with the Global Constraints values; dark-mode block per the artifact-design skill.

- [ ] **Step 2: Draw the three Shifter v2 screens (spec §6.1, §6.4, §6.5)**

Home: orange-tint header band (logo text "Shifter", bell, wallet chip "₹250"), header-art placeholder box labelled H1; pickup card overlapping header ("Pick up from" + address + chevron); live-order strip (sample, labelled "only when an order is active"); 2×2 tiles Book Now / Schedule / Low Fare / Customise Order with placeholder boxes T1–T4; Free Ride Chance strip ("Every booking is a chance to ride free" + chevron, placeholder F1); 4-tab nav Home·Orders·Wallet·Account with orange top indicator on Home.
Select Vehicle: top bar "Select Vehicle"; route card (pickup + drop with name·number, swap icon, Add Stop, Edit Locations); booking-type chip "Now"; driver-search-radius row; selected vehicle large card (orange outline + `#FFF0E8` fill, image box, name + info icon, "500 kg · 4 mins", price); 4 compact rows with price and one strike-through; "Offers & Details" card with rows Goods type, Apply Coupon, Reward Points, GST details; pinned "Proceed with 3 Wheeler".
Review: top bar "Review Booking"; vehicle + time card with "View Address Details"; loading-time info line; booking guidelines card; Booking Guarantee line; terms line; pinned bar with payment selector showing "Cash ▾" and options note (Cash / Shifter Wallet ₹250 / Receiver pays), total "₹403", "View Breakup", button "Book 3 Wheeler".

- [ ] **Step 3: Check feature coverage against spec §6.11**

For each item in §6.11 that the spec places on Home, Select Vehicle or Review, confirm it is drawn. Expected: all present; any missing → add before publishing.

- [ ] **Step 4: Verify rendering**

Open the file in a browser at 1280px and 390px widths (Playwright `browser_resize`). Expected: no horizontal scroll at 390px; orange buttons have dark text; no emoji/gradient.

- [ ] **Step 5: Publish and commit**

Publish with the Artifact tool (`icon: "phone"`, files: the three Porter jpgs at `ref/home.jpg`, `ref/vehicle.jpg`, `ref/review.jpg`). Add the URL to the spec header as `Mockups: <url>`.

```bash
git add docs/design/porter-style-mockups/index.html docs/superpowers/specs/2026-11-18-customer-app-porter-style-ui-design.md
git commit -m "docs(design): Porter-style v2 mockups (Home, Select Vehicle, Review)"
```

### Task 2: Asset prompt file

**Files:**
- Create: `docs/design/porter-style-asset-prompts.md`

**Interfaces:**
- Produces: asset file names that plans 2+ wire into `ShifterOnline/assets/v2/` (table below is the contract).

- [ ] **Step 1: Write the asset table**

| ID | File | Size (px) | Background | Used on |
|---|---|---|---|---|
| H1 | `assets/v2/home_header.png` | 1080×480 | transparent | Home header |
| T1 | `assets/v2/tile_book_now.png` | 600×400 | transparent | Home tile |
| T2 | `assets/v2/tile_schedule.png` | 600×400 | transparent | Home tile |
| T3 | `assets/v2/tile_low_fare.png` | 600×400 | transparent | Home tile |
| T4 | `assets/v2/tile_customise.png` | 600×400 | transparent | Home tile |
| F1 | `assets/v2/free_ride_icon.png` | 256×256 | transparent | Free Ride strip |
| E1 | `assets/v2/empty_not_serviceable.png` | 900×600 | transparent | Home not-serviceable card |
| E2 | `assets/v2/empty_no_orders.png` | 900×600 | transparent | Orders empty |
| E3 | `assets/v2/empty_no_driver.png` | 900×600 | transparent | No driver found |
| W1 | `assets/v2/wallet_icon.png` | 256×256 | transparent | Wallet balance card |

- [ ] **Step 2: Write one prompt per asset**

Each prompt = shared style line + subject line. Shared style line (verbatim in every prompt): "Soft 3D clay illustration, clean and premium, gentle studio lighting, soft shadow, main colour orange #FF6B35 with deep navy #1A2B4C and white accents, no text, no letters, no logos, no brand names, transparent background, centred subject with margin." Subjects (Indian context): T1 an Indian mini goods truck moving fast with motion lines; T2 a mini truck beside a calendar with a clock; T3 a mini truck with a price tag showing a down arrow (no numbers); T4 two hands shaking over a small parcel (fair deal); H1 a wide scene of a small city street with a mini truck and parcels, left 45% kept empty for text; F1 a shiny coin with a small truck emboss; E1 a delivery person looking at a map pin with a cross, hills behind; E2 an empty open cardboard box; E3 a mini truck with a magnifying glass, searching; W1 a wallet with a coin. Add "Generate at <size> px" per row.

- [ ] **Step 3: Commit**

```bash
git add docs/design/porter-style-asset-prompts.md
git commit -m "docs(design): image prompts for Porter-style v2 assets"
```

### After Plan 1

Owner reviews the mockups. Feedback updates the spec (§5/§6/§10). Then write Plan 2 (tokens + shared widgets + Home + nav), Plan 3 (drop search, details, Select Vehicle, Review), Plan 4 (Orders, Wallet, Account, tracking/finding/complete/login restyle).

# Loading / Unloading ("Saaman Uthana") — Design Doc

**Date:** 2026-11-24
**Owner:** ghosttrozan (Shifter Online, Indore)
**Status:** Approved path (Model A, Phase 1) — pending owner sign-off on this doc before build.

---

## Owner summary (Hinglish, 30 sec)
Driver khud saaman uthayega (chhote-medium kaam tak). Customer booking pe 2-3 cheez chunega (kitna saaman, kaunsi manzil / dukaan me access), app turant **pakka price** dega. Paisa **wallet me hold** hoga, **OTP dene pe driver ko milega**. Mauke pe saaman zyada nikle → driver **photo** daale, customer **approve kare tabhi** extra. Jhagda ho → **executive beech me aake** decide karega (paisa driver ko / customer ko wapas / aadha-aadha). Bhaari/bulk/upar-manzil = "coming soon" (Phase 2 me team bhejenge). Phase 1 me driver ko **poora paisa**, commission nahi.

---

## 1. Intent & Why
Shifter Online abhi sirf goods move karti hai; loading/unloading customer ka apna kaam hai. Field research (10 drivers + 10 customers, Indore) ne dikhaya:
- Customers (ghar + dukaan) ko uthane wala chahiye, par unka #1 dar = **delivery pe price badhna** aur **bhaari cheez ke liye kam aadmi**.
- Drivers extra kamana chahte hain, par darte hain: **customer under-declare karta hai**, **uthane ke baad paisa nahi milta**, **commission galat lagta hai**, **bhaari/bulk akela impossible**.
- Business repeat users (kirana/pharmacy) ke liye asli product = **"saaman andar pahunchana, gate pe nahi"** + **ek-tap repeat**.

Ye feature ek naya revenue stream + Porter se differentiation hai, aur retention lever (repeat B2B).

## 2. Goals
- G1. Customer booking pe ek **locked, upfront labour price** le sake (ghar + dukaan dono mode).
- G2. Driver ko accept karne se **pehle** declared inputs + labour amount dikhe.
- G3. Labour paisa **escrow (hold)** ho booking pe, **unload/drop-OTP** pe driver ko release ho.
- G4. On-site **declared-vs-actual mismatch** ek **photo + customer-approve** gate se handle ho (dono side cheat-proof).
- G5. Driver **opt-in** kare (profile toggle: drive-only / light-only / full-loader); labour decline karne pe **normal ride dispatch me penalty na ho**.
- G6. Bhaari/bulk/upar-manzil jobs **auto-detect** ho aur Phase 1 me "coming soon" dikhe (dumping on one driver nahi).
- G7. Driver-customer **dispute** ho toh **executive** beech me aake resolve kar sake (release/refund/split + note), escrow tab tak freeze rahe.
- G8. Price slabs **owner-controlled** ho (`app_settings`), Indore ke hisaab se tune ho sake.
- G9. Phase 1 me driver ko **100% labour paisa**, koi commission nahi.

## 3. Non-Goals (Phase 1)
- Separate helper/labour pool (Model B) — Phase 2.
- Multi-man crew / "number of labourers" input — Phase 2.
- Per-unit metering, monthly/contract pricing, rated/preferred helper — Phase 2/3.
- Insurance / damage cover product — Phase 3. (Phase 1 = evidence + manual adjudication only.)
- Platform commission/fee on labour — Phase 2 (flat ₹10–15, pre-announced).

## 4. Anti-Goals (feature fails even if it "works")
- A silent doorstep price bump (any un-gated extra) — breaks the locked-price promise for a whole locality.
- Forcing a lone driver to carry a fridge up 3 floors / bulk alone — injury + driver exodus.
- "varies / approx / starting from" wording anywhere on price — kills trust instantly.
- Declining labour hurting a driver's normal-ride dispatch — supply cascade.
- The word "coolie/labour" in driver-facing UI — dignity loss, senior/women drivers quit.

## 5. Constraints
- Solo bootstrapped owner, small dev capacity → MVP must be solo-buildable, reuse existing plumbing.
- Reuse: additive pricing engine (`pricingEngine.js`, new `labourCharge` line), wallet/advance-hold + cancel-refund, drop-OTP event, `app_settings`-driven rate cards, `admin_role = executive`, `order_settlement` dispute fields (`dispute_reason/raised_by/raised_at/resolved_by/resolved_at/resolve_note`), the admin approve/decide pattern (`order_cancel_request`).
- Customer app = Flutter (`ShifterOnline/`, gitignored, `git add -f`). Backend = Node/Express/Prisma/MySQL.
- Non-techy UI: big Hindi picture-buttons, one bold final total; GetX `.tr` translations.
- Migrations: additive only; feature behind an `app_settings` switch, default OFF; dev-only until owner applies on prod.
- Never fabricate competitor prices. "Other platform" label only.

## 6. Approaches considered
- **Model A — driver khud uthaye** (chosen for Phase 1). Driver already dispatched + paid through the system; labour is a new locked line he keeps 100% of. Marginal cost ~0, solo-buildable. Limit: one person, so capped to light/medium, ≤2 floor, ≤40 boxes.
- **Model B — separate helper/crew dispatched.** Needed for heavy/bulk, but a whole second marketplace (sourcing, availability, settlement, idle-pay). **Deferred to Phase 2**, triggered by the SAME declared-input router built in Phase 1 (no rework).
- **Flat single add-on** (rejected) — unfair (2 bags = full house same price); drivers refuse big jobs, customers feel cheated.
- **Per-item catalog** (rejected for now) — too much friction for non-techy users; overkill. Phase 3 maybe.

Decision: **Model A + slab pricing in Phase 1, auto-route over-cap to "coming soon" (Phase 2 → Model B).** Confirmed by 3-judge panel and owner (3 decisions locked: caps default, zero commission Phase 1, connector/evidence liability stance).

## 7. The design (decided parts)

### 7.1 Booking flow (customer app)
1. After route + vehicle, an **optional** "Loading help chahiye?" toggle (default OFF — Imran's 5-parcel day).
2. If ON, a **mode** is inferred/asked once: 🏠 **Ghar** | 🏪 **Dukaan/Godown**.
3. **Declared inputs** (picture buttons, Hindi), asked **separately for pickup and drop**:
   - HOME: load-size (chhota / medium / bada) × floor (ground / 1-2 / 3+) × lift (haan/na)
   - SHOP: quantity (≤15 / 15–40 / 40+) × access (shutter-direct / andar-stack / loft-basement)
4. App calls fare-estimate; backend returns **`labourCharge`** (and per-leg breakdown). Shown as **one bold locked total** with copy: **"Yeh final hai — delivery par kuch extra nahi."**
5. **Over-cap detection** (bada / floor 3+ / loft-basement / 40+ / heavy-item class): instead of a price, show **"Crew labour jald aa raha hai — abhi sirf transport book karein"** (Phase 1). Transport booking continues without labour.

### 7.2 Pricing (backend)
- New additive component in `pricingEngine.js`: `labourCharge` = `baseLabour × sizeMult × floorMult(lift)` (HOME) or `baseLabour × qtyMult × accessMult` (SHOP), **summed across pickup + drop legs**.
- All multipliers + base + the **cap thresholds** live in `app_settings` (owner-editable), with a global default and per-city override (mirrors existing rate-card pattern).
- Over-cap returns a flag `labourOverCap: true` (no charge) rather than a number.
- `labourCharge` appears as its own line in the fare breakdown + settlement (`labour_charge_amount`), never folded into transport fare.

### 7.3 Escrow + OTP release
- On booking with labour, `labourCharge` is **held** via the existing wallet/advance-hold path (reuse `wallet_advance_autopay` plumbing + cancel-refund guarantees — every cancel path already refunds held advance; labour hold rides the same rails).
- Driver sees "Labour ₹X — paid & locked" before/at accept.
- On the existing **unload/drop-OTP** event, the held `labourCharge` **releases to the driver (100%)** — *unless a dispute is open* (then it stays frozen; see 7.5).

### 7.4 On-site mismatch gate (the one trust mechanism, both sides)
- Driver app has **"Add extra labour"** at the unload stage. Driver picks the corrected inputs (e.g. floor 1-2 → 3+) → app computes the delta from the same slab → driver **must attach a photo** of the real situation.
- Customer gets a push: *"Driver ne bataya saaman zyada hai — ₹Y extra. Photo dekhein."* Customer **taps approve → extra held in escrow; only then driver does the extra work.**
- No approval → driver lifts **only the declared scope**, no penalty to either side. Declared inputs (snapshot) + photo stand as **dispute evidence**.
- This single loop stops **doorstep shakedown** (customer protected) and **under-declaration cheating** (driver protected).

### 7.5 Dispute → Executive resolution (new, owner-requested)
Covers: customer says driver didn't carry inside / damaged / overcharged; driver says customer refused to pay after lifting / abused / under-declared.

**States** (on the labour record / reuse settlement dispute fields):
`none → raised(pending) → under_review(executive assigned) → resolved`

- **Raise:** either party raises a labour dispute at/after the unload stage (`dispute_reason`, `dispute_raised_by` = `customer|driver`, `dispute_raised_at`). A driver-fair "customer refused / abused me" button (no auto-blame). Respectful wording.
- **Escrow freeze:** raising a dispute **blocks the OTP auto-release** — `labourCharge` stays held, neither side gets it, until an executive decides. (Transport fare settles normally; only labour freezes.)
- **Executive queue:** disputes land in a **per-city executive queue** (reuse the `executive` admin role + the guarantee-executive-queue pattern). Each case shows: declared inputs snapshot (both legs), any mismatch delta + driver photo(s), both parties' notes, amounts held.
- **Executive actions** (reuse `resolved_by / resolved_at / resolve_note`):
  1. **Release to driver** (full labour) — driver was right.
  2. **Refund to customer** (full) — customer was right; reverse the hold to wallet.
  3. **Split** — partial to driver, partial refunded (executive enters the driver amount; remainder refunds). Covers "half-done / partial fault".
  - Every action writes a `resolve_note` + notifies **both** parties with the outcome.
- **Audit:** each transition logged (reuse the event-log pattern used by cancel/settlement).

### 7.6 Driver opt-in & protection
- Driver profile toggle: **drive-only / light-only / full-loader** (+ badges). Dispatch router:
  - drive-only → never offered a labour job.
  - light-only → only ground/≤small labour jobs.
  - Declining a labour job **never** lowers normal-ride dispatch priority.
- Hard caps (same as over-cap thresholds) protect bodies: no fridge/cement/tandoor-class or floor 3+/bulk on one driver in Phase 1.

### 7.7 Admin / owner controls
- `app_settings`: feature switch (per-city, default OFF), all slab multipliers + base + caps, and the Phase-2 fee (ready but 0 in Phase 1).
- Executive dispute queue screen (list + evidence + resolve actions).
- Labour appears in order/settlement views as its own line.

## 8. What's left to the builder
- Exact slab numbers are owner-tuned at runtime (`app_settings`); the builder ships sane defaults (§ pricing examples) and the admin editors.
- UI polish/iconography for the picture-buttons (follow existing app_tokens theme).
- Precise reuse points in `wallet`/`settlement` code for the labour hold/release/split — follow the existing advance-hold + cancel-refund + settlement-dispute patterns; do not invent parallel plumbing.
- Translation strings (`.tr`) for all Hindi copy.
- Whether the executive queue is a new admin screen or a tab on the existing guarantee-executive queue (builder picks the lower-friction reuse).

## 9. Owner's 3 locked decisions (recorded)
1. **Caps:** chhota+medium, floor ≤2, shop ≤40, no fridge/cement/tandoor → Model A; rest = "coming soon". ✅
2. **Phase 1 commission:** zero. ✅
3. **Liability:** platform = connector; declared inputs + photos = evidence; owner/executive adjudicates case-by-case; no insurance promise yet. ✅

## 10. Risks (top 3)
1. **Driver opt-out cascade** — if caps too loose or decline hurts dispatch. Mitigation: hard caps + penalty-free toggle, enforced.
2. **One doorstep surprise** breaks the locked-price promise for a locality. Mitigation: airtight photo+approve gate; never "approx/varies" copy.
3. **Single-driver ceiling** loses the high-margin heavy/B2B loads. Mitigation: build Phase 1 router so it upgrades into Model B (Phase 2) with no rework.

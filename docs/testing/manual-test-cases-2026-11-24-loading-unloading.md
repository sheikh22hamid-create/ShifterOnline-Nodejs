# Loading/Unloading (saaman uthana) — Manual Test Cases

**Feature:** Phase 1 Model A (same driver lifts). Spec `docs/superpowers/specs/2026-11-24-loading-unloading-design.md`, plan `docs/superpowers/plans/2026-11-24-loading-unloading.md`.
**Branch:** `feature/loading-unloading` (local). **Flag:** `labour_enabled` default OFF.

This is the owner-run verification pass. The backend money-movement is already PROVEN on DEV via an
automated integration test (28/28 — hold/release/refund/dispute/split all correct, money conserved).
These cases confirm the **UI surfaces + the live end-to-end flow** once deployed.

---

## 0. Pre-requisites (DEV)

- [ ] Backend `feature/loading-unloading` deployed to DEV (push to `main` auto-deploys; or manual).
- [ ] Migration `20261124010000_add_labour_loading` applied on DEV DB `shifteronlinedev` — **already done** (labour cols + `labour_dispute` table + 9 `app_settings` keys).
- [ ] Turn labour **ON for Indore** on DEV only: `app_settings.labour_enabled` → `{"global":false,"cities":{"<indoreCityId>":true}}`.
- [ ] Customer app (Flutter) built from `feature/loading-unloading` on a test device.
- [ ] Admin panel (React) on DEV; log in as an **executive** (or admin/superadmin) whose city = Indore.
- [ ] Test customer has wallet balance (labour is collected from the wallet at booking).

---

## 1. Customer app — declaration + locked price

- [ ] In an **Indore** booking, after choosing a vehicle, the **"Saaman uthana chahiye?"** card appears. (In a city where labour is OFF, the card must NOT appear.)
- [ ] Toggle ON → declaration sheet opens: **Ghar/Flat** vs **Dukaan/Godown** mode; Pickup + Drop picture-buttons (size/floor/lift, or qty/access); "Bhaari saaman" checkbox.
- [ ] Declare a light job (e.g. Chhota, Ground) → **"Keemat dekho"** → card shows ONE bold locked total with "Yeh keemat lock hai…". The total is **separate** from the transport fare.
- [ ] **Over-cap** (Bada size / 3+ floor / 40+ items / Loft-Basement / Bhaari saaman) → card shows **"crew labour jald aa raha hai — abhi transport book karein"** and NO labour price.
- [ ] "Badlein" reopens the sheet with the previous declaration pre-filled; "Hata do" clears it back to a plain booking.

## 2. Customer app — booking + escrow

- [ ] Book with a (within-cap) labour declaration → order places. Customer **wallet is debited** by the labour amount (check wallet history: "Labour charge held for order #…").
- [ ] Book an **over-cap** declaration → books **transport-only**, NO labour charge, no wallet debit for labour.
- [ ] Insufficient wallet for the labour amount → booking should surface the shortfall (labour not held); transport proceeds per existing rules.

## 3. Driver app (built separately — native Android) — see / add-extra / dispute

> Driver app is native Android (Java); this section is pending that build.

- [ ] Driver sees the **declared inputs + labour amount BEFORE accepting** the order.
- [ ] At unload, **"Add extra labour"**: driver enters corrected inputs + **a photo** → customer gets an approval request; only on approval is the extra collected.
- [ ] A fair **"Customer refused / issue"** dispute button; raising it **freezes** the escrow (blocks the drop-OTP release).
- [ ] Driver `labour_mode` (drive_only / light_only / full_loader) — a drive_only driver is **never offered** a labour order.

## 4. Admin — executive dispute queue

- [ ] Open **Loading/Unloading Disputes** (sidebar). A pending dispute shows: order #, who raised it, reason, **escrowed amount**, base/extra (+approved?), the customer's declared snapshot, the driver's on-site correction + **photo link**.
- [ ] An executive sees **only their own city's** disputes. (Superadmin sees all.)
- [ ] **Release** → full held amount to the driver; order `labour_status=resolved`; customer + driver notified.
- [ ] **Refund** → full held amount back to the customer wallet.
- [ ] **Split** (driver ₹X) → driver gets X, customer refunded (held − X); amounts must **conserve** (driver + refund = held). X outside 0…held is rejected.
- [ ] A resolved dispute leaves the queue; it cannot be resolved twice.

## 5. End-to-end money flow (live confirmation of the proven logic)

- [ ] **Happy path:** book with labour (hold) → deliver → drop-OTP → labour **released** to driver's wallet (100%, Phase 1 no commission).
- [ ] **Cancel:** book with labour → cancel → labour **refunded** to customer wallet.
- [ ] **Dispute:** book with labour → raise dispute (freezes) → drop-OTP release is **blocked** → executive resolves (release/refund/split) → money moves exactly as chosen.
- [ ] No double-pay / double-refund on repeated drop-OTP or repeated cancel (idempotent).

---

## Notes
- The old static rate-card `loading_charge`/`unloading_charge` are **dead** (all NULL on DEV; not in the fare total) and are untouched by this feature — no conflict.
- Prod DB still needs the migration applied before any prod deploy.

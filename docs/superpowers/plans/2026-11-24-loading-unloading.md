# Loading / Unloading (Phase 1, Model A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an opt-in, locked-price, driver-does-it (Model A) loading/unloading add-on with escrowed pay released on drop-OTP, a photo+approve on-site mismatch gate, and an executive dispute-resolution path — all behind a per-city switch (default OFF).

**Architecture:** Backend adds a new additive `labourCharge` to the existing pricing engine, holds it via the existing wallet/advance-hold rails, and releases it on the existing drop-OTP event (unless a dispute freezes it). Disputes reuse the `executive` admin role + settlement dispute fields + the admin approve/decide pattern. Customer & driver Flutter apps get the declaration UI, locked-price display, add-extra+photo, and dispute buttons. Admin gets an executive dispute queue.

**Tech Stack:** Node/Express/Prisma/MySQL backend; Flutter/GetX customer app (`ShifterOnline/`, gitignored) + driver app (`ShifterDriver/`, gitignored); admin React frontend (`frontend/`).

**Spec:** docs/superpowers/specs/2026-11-24-loading-unloading-design.md

## Global Constraints
- Feature behind `app_settings` switch `labour_enabled` (per-city, **default OFF**). Migrations additive only; dev-only until owner applies on prod.
- Phase 1: driver keeps **100%** of `labourCharge`. No commission. (Fee key present but 0.)
- Caps (Model A vs "coming soon"): load ≤ medium, floor ≤ 2 (HOME), quantity ≤ 40 + access ≠ loft/basement (SHOP), and no heavy-item class → Model A; else `labourOverCap: true` (no charge).
- `labourCharge` is always its **own line**, never folded into transport fare.
- Escrow stays **held** while a dispute is open; OTP auto-release is blocked then.
- Declining a labour job must **never** change normal-ride dispatch priority.
- UI copy: Hindi picture-buttons, one bold locked total, **"Yeh final hai — delivery par kuch extra nahi."** Never "approx / starting from / varies". Never "coolie/labour" in driver UI.
- App dirs gitignored → `git add -f` exact files. Never push `feature/porter-style-ui` (Firebase key); commit locally. Commit attribution: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- Reuse, don't reinvent: `pricingEngine.js`, wallet advance-hold + cancel-refund, drop-OTP event, `order_settlement` dispute fields (`dispute_reason/raised_by/raised_at/resolved_by/resolved_at/resolve_note`), `order_cancel_request` approve/decide pattern, `executive` admin role, guarantee-executive-queue pattern.

## Review Focus
- **Over-cap leak:** an over-cap load must never produce a priced Model-A labour job dumped on one driver — estimate returns `labourOverCap` and the UI shows "coming soon". (Task 2, 8)
- **Cancel refunds held labour:** every existing cancel path must refund the held `labourCharge` (reuse advance-refund); a cancel that keeps labour held is a defect. (Task 4)
- **Dispute freezes release:** a drop-OTP firing while a labour dispute is `pending` must NOT release money to the driver. (Task 4, 6)
- **Split math:** executive split must conserve money (driver portion + customer refund == held amount, no rounding leak). (Task 6)
- **Decline ≠ penalty:** a driver declining a labour job must leave normal-ride dispatch priority untouched. (Task 7)
- **Switch OFF = invisible:** with `labour_enabled` OFF for a city, estimate returns no labour, apps show no labour UI, nothing in settlement. (Task 1, 2, 8)

---

### Task 1: DB migration + app_settings keys
**Files:**
- Create: `backend/prisma/migrations/2026112401XXXX_add_labour_loading/migration.sql`
- Modify: `backend/prisma/schema.prisma`

**Interfaces:**
- Produces: labour columns on the order/settlement path (`labour_charge_amount`, `labour_mode`, `labour_declared_json` snapshot, `labour_extra_amount`, `labour_extra_approved`, `labour_status` [none|held|released|refunded|disputed|resolved]); a `labour_dispute` concept (reuse `order_settlement` dispute fields where possible, else a `labour_dispute` table with `order_id, raised_by, reason, raised_at, status, assigned_executive_id, resolved_by, resolved_at, resolve_note, driver_amount, refund_amount`); driver profile `labour_mode` (`drive_only|light_only|full_loader`, default `drive_only`); `app_settings` keys (`labour_enabled` per-city, `labour_base`, size/floor/qty/access multiplier maps, `labour_caps`, `labour_fee` default 0).

- [ ] Step 1: Write the migration SQL (additive columns + optional `labour_dispute` table + seed default `app_settings` rows with feature OFF).
- [ ] Step 2: Mirror the changes in `schema.prisma`.
- [ ] Step 3: Apply on DEV (`prisma migrate resolve --applied` per existing convention); confirm no drift. Record "migration unapplied on prod" for the owner.
- [ ] Step 4: Commit.

### Task 2: Pricing engine — labourCharge + over-cap
**Files:**
- Modify: `backend/src/services/pricingEngine.js`
- Create: `backend/src/services/labourPricing.js`
- Test: `backend/src/services/__tests__/labourPricing.test.js`

**Interfaces:**
- Consumes: declared inputs `{ mode, legs: [{role:'pickup'|'drop', size?, floor?, lift?, qty?, access?}] }`, city, `app_settings`.
- Produces: `computeLabour(input) -> { labourCharge, perLeg, labourOverCap }`. Over-cap → `{ labourOverCap: true }` and no charge. Switch OFF → `{ labourCharge: 0, disabled: true }`.

- [ ] Step 1: Write failing tests: HOME small/ground = base×mult; HOME 3rd-floor-no-lift over cap; SHOP 40+ loft over cap; pickup+drop summed; switch OFF returns disabled; unknown city falls back to global defaults.
- [ ] Step 2: Run tests, verify they fail.
- [ ] Step 3: Implement `computeLabour` reading slabs/caps from `app_settings`; wire the result as an additive `labourCharge` line in `pricingEngine.js` (own line, not folded).
- [ ] Step 4: Run tests, verify pass.
- [ ] Step 5: Commit.

### Task 3: Fare-estimate API surfaces labour
**Files:**
- Modify: the fare-estimate controller/route (the one returning the `comparison` object today)
- Test: alongside existing fare-estimate tests

**Interfaces:**
- Consumes: optional `labour` block in the estimate request.
- Produces: estimate response gains `labour: { charge, perLeg, overCap }` (omitted/null when feature OFF or no labour requested).

- [ ] Step 1: Write failing test: request with labour block returns `labour.charge`; over-cap request returns `labour.overCap=true`, no charge; OFF city omits labour.
- [ ] Step 2: Verify fail.
- [ ] Step 3: Implement — call `computeLabour`, attach to response. No behavior change when labour absent.
- [ ] Step 4: Verify pass.
- [ ] Step 5: Commit.

### Task 4: Escrow hold + OTP release (dispute-aware)
**Files:**
- Modify: order-create path (where advance-hold happens), drop-OTP handler, cancel/refund paths
- Test: `backend/src/services/__tests__/labourEscrow.test.js`

**Interfaces:**
- Consumes: `labourCharge`, order lifecycle events.
- Produces: on booking, hold `labourCharge` (reuse advance-hold); set `labour_status='held'`. On drop-OTP: if no open dispute → release 100% to driver (`labour_status='released'`); if dispute pending → leave held. On any cancel: refund held labour to wallet (`labour_status='refunded'`).

- [ ] Step 1: Write failing tests: booking holds labour; drop-OTP releases to driver; drop-OTP with pending dispute does NOT release; each cancel path refunds held labour; double-OTP is idempotent.
- [ ] Step 2: Verify fail.
- [ ] Step 3: Implement, reusing advance-hold + cancel-refund rails; guard release behind "no open dispute".
- [ ] Step 4: Verify pass.
- [ ] Step 5: Commit.

### Task 5: On-site mismatch gate (add-extra + approve)
**Files:**
- Create: driver `POST /labour/extra` (corrected inputs + photo), customer `POST /labour/extra/approve`
- Test: `backend/src/services/__tests__/labourExtra.test.js`

**Interfaces:**
- Consumes: corrected declared inputs, photo upload, order id.
- Produces: computes delta via `computeLabour`; stores `labour_extra_amount` + photo + snapshot as `pending_approval`; on customer approve → hold the extra, mark `labour_extra_approved=true`; no approval → extra void, declared scope stands, both snapshots retained as evidence.

- [ ] Step 1: Write failing tests: extra computes correct delta; stays pending until approve; approve holds extra; decline/timeout voids extra with no penalty; photo required.
- [ ] Step 2: Verify fail.
- [ ] Step 3: Implement (reuse existing media-upload util; reuse advance-hold for the extra).
- [ ] Step 4: Verify pass.
- [ ] Step 5: Commit.

### Task 6: Dispute raise + executive resolve
**Files:**
- Create: `backend/src/services/labourDisputeService.js`; raise endpoint (driver + customer), executive list + resolve endpoints under `adminRoutes`
- Test: `backend/src/services/__tests__/labourDispute.test.js`

**Interfaces:**
- Consumes: raise `{ orderId, raisedBy, reason }`; resolve `{ disputeId, executiveId, action: 'release'|'refund'|'split', driverAmount?, note }`.
- Produces: raise → `status='pending'`, freezes escrow; list → per-city pending queue with evidence (declared snapshots both legs, extra photo, amounts); resolve → release (100% driver) / refund (100% wallet) / split (driverAmount to driver, remainder refunded; must equal held total); writes `resolved_by/at/note`; notifies both parties; logs each transition.

- [ ] Step 1: Write failing tests: raise freezes release; only `executive` role can resolve; release pays driver; refund returns to wallet; split conserves money exactly (no rounding leak); resolved dispute is idempotent; non-executive is 403.
- [ ] Step 2: Verify fail.
- [ ] Step 3: Implement, reusing the `order_cancel_request` approve/decide pattern + settlement dispute fields + RBAC (`adminRoutesRbac` pattern).
- [ ] Step 4: Verify pass.
- [ ] Step 5: Commit.

### Task 7: Driver profile toggle + dispatch gating
**Files:**
- Modify: driver profile endpoint; dispatch/assignment service (`dispatchManager.js` / `orderAssignmentService.js`)
- Test: alongside dispatch tests

**Interfaces:**
- Consumes: driver `labour_mode`, order's labour requirement.
- Produces: `drive_only` never receives labour jobs; `light_only` only ground/≤small; declining a labour offer leaves normal-ride priority unchanged.

- [ ] Step 1: Write failing tests: drive_only filtered out of labour orders; light_only gets only light; a declined labour offer does not change the driver's normal dispatch score/priority.
- [ ] Step 2: Verify fail.
- [ ] Step 3: Implement the gate in dispatch; expose the toggle on the profile endpoint.
- [ ] Step 4: Verify pass.
- [ ] Step 5: Commit.

### Task 8: Customer app — declaration UI + locked price + over-cap
**Files:**
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart` (+ new widgets under `lib/screens/home/widgets/`)
- Create: `lib/screens/home/widgets/labour_sheet.dart` (picture-button declaration), translation keys

**Interfaces:**
- Consumes: fare-estimate `labour` block.
- Produces: opt-in toggle (default OFF); mode (Ghar/Dukaan); per-leg picture-button inputs; calls estimate; shows one bold locked total + "Yeh final hai…"; over-cap → "Crew labour jald aa raha hai — abhi transport book karein" and books transport-only.

- [ ] Step 1: Build the labour sheet + wiring behind a local flag; default OFF.
- [ ] Step 2: `flutter analyze` (no new errors), `flutter build apk --debug`, install on device.
- [ ] Step 3: Device-verify: toggle ON → declare → locked price shows; over-cap route shows "coming soon"; switch-OFF city shows no labour UI.
- [ ] Step 4: Commit (`git add -f` exact files).

### Task 9: Driver app — see inputs, add-extra+photo, dispute
**Files:**
- Modify: `ShifterDriver/` order/trip screens (accept view + unload stage)

**Interfaces:**
- Consumes: order labour block; add-extra + dispute endpoints.
- Produces: declared inputs + labour amount visible **before accept**; at unload: "Add extra labour" (corrected inputs + photo) and a driver-fair "Customer refused / issue" dispute button; respectful wording.

- [ ] Step 1: Build the driver-side views + calls.
- [ ] Step 2: `flutter analyze` + debug build + install.
- [ ] Step 3: Device-verify: driver sees inputs pre-accept; add-extra sends photo + delta; customer approval flow; dispute raise freezes release.
- [ ] Step 4: Commit (`git add -f`).

### Task 10: Admin — executive dispute queue
**Files:**
- Modify: `frontend/` admin (new screen/tab) + `adminRoutes` wiring (done in Task 6)

**Interfaces:**
- Consumes: executive list + resolve endpoints.
- Produces: per-city pending labour-dispute list with evidence (declared snapshots, photo, amounts) + Release / Refund / Split (amount) + note.

- [ ] Step 1: Build the queue screen + resolve actions (reuse guarantee-executive-queue UI pattern).
- [ ] Step 2: Verify against DEV: raise a test dispute → appears in queue → each resolve action settles money correctly + notifies both parties.
- [ ] Step 3: Commit.

### Task 11: Switch, defaults, translations, end-to-end smoke
**Files:**
- Modify: `app_settings` seed/defaults; translation files; a short manual test-case doc under `docs/testing/`

- [ ] Step 1: Ship sane default slabs (spec § pricing examples), caps, fee=0, `labour_enabled` OFF globally + ON for Indore on DEV only.
- [ ] Step 2: Add all `.tr` Hindi strings.
- [ ] Step 3: End-to-end smoke on DEV + device: book with labour → hold → drop-OTP release; mismatch → photo+approve; dispute → executive resolve (all 3 actions); cancel → refund. Write the manual test-case doc.
- [ ] Step 4: Commit.

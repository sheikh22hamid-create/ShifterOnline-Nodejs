# Payment settlement - backend rollout

> **Status & corrections (reviewed 2026-10-07): ROLLOUT NOTES.** Enable `settlement_enabled` only after the new customer and driver builds are released; migration `20261004010000_add_order_settlement` must be on the target DB first. Current code-verified description: [Master Document sections 5.1 and 13.4](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

1. Back up the prod DB and diff the live schema against `prisma/schema.prisma` first (known dev/prod
   drift), then apply `backend/prisma/migrations/20261004010000_add_order_settlement/migration.sql` on the target DB
   (dev, then prod). It creates the tables `order_settlement` (including `city_id`, used for admin city
   scoping) and `order_settlement_event`. The backend does not need the tables while `settlement_enabled`
   is off, except `getPublicViewForOrder`, which tolerates a missing table.
2. Deploy the backend. Behaviour is unchanged (feature off).
3. Ship the new customer and driver app builds (separate plans), and the admin Settlements page.
4. HARD GATE before enabling (see below), then enable: set `settlement_enabled` = `1` on the admin Settings page. All settings are stored in
   `app_settings`; defaults in parentheses:
   - `settlement_enabled` (off)
   - `settlement_reminder_minutes` (`10,30`)
   - `settlement_escalate_after_minutes` (`60`)
   - `settlement_driver_block_grace_minutes` (`10`)
   - `settlement_dispute_window_hours` (`48`)
5. Rollback: set `settlement_enabled` = `0`. Orders already in a settlement keep working
   (endpoints and the admin API do not check the flag); new completions use the legacy flow.
   Customers/drivers blocked by a pending settlement are unblocked as soon as the flag is off.
   Turning the flag off also stops the sweep, so leftover `pending`/`disputed` settlements get no
   reminders and their commission has not been debited: an admin must work through the Settlements
   list after a rollback.

## HARD GATE before setting `settlement_enabled` = 1

The customer and driver settlement endpoints trust the posted `uid` / `rider_id` (the codebase's known,
deferred auth gap). With this feature that becomes money-moving: a customer can read their own order's
`rider_id` from order details and POST it to `/api/rider/settlement/received`, marking their own ride
"cash received" and debiting the driver's commission. Real driver/customer authentication (or a
per-order secret only the driver app holds) on `/api/rider/settlement/*` and `/api/order/settlement/*`
MUST ship before the flag is turned on. Merging and deploying with the flag OFF is safe.

Also enable only after the new customer and driver app builds are the minimum supported version: old
builds have no "Received" button, so their drivers would be dispatch-blocked after the grace period.

## Scope notes

- Monthly Driver and Daily Driver orders never get a settlement (they keep their own cash ledgers).

## Endpoints

- Customer: `POST /api/order/settlement/{state,choose-driver,pay-online/create,pay-online/verify,dispute}`
- Driver: `POST /api/rider/settlement/{state,received,dispute,pending}` (`pending` lists the driver's
  pending/disputed settlements, max 20)
- Admin (role superadmin/admin): `GET /api/v1/admin/settlements`, `GET /api/v1/admin/settlements/:id`,
  `POST /api/v1/admin/settlements/:id/resolve`. City-scoped: a city-bound admin only sees and resolves
  settlements of their own city; settlements with a null `city_id` (e.g. an order without a city) are
  visible to superadmin only.

## Known gaps / follow-ups

- Razorpay reconciliation for captured-but-unrecorded payments: when a verified payment arrives after the
  settlement changed state, a `PAID_BUT_STATE_CHANGED` event is written to `order_settlement_event` for
  admin follow-up; there is no automatic reconciliation via Razorpay's `/orders/:id/payments` yet.
- The `customer_owes` pay path is online-only (the driver cannot mark it cash received).
- The booking block returns HTTP 403 with a `code`; the customer app's Node wrapper drops `code`
  (handle in the customer-app plan).
- Settlements with a null `city_id` are superadmin-only.
- `alreadyDone` admin re-resolve drops the new note (surface in the admin UI plan).

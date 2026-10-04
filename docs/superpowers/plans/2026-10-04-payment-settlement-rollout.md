# Payment settlement - backend rollout

1. Apply `backend/prisma/migrations/20261004010000_add_order_settlement/migration.sql` on the target DB
   (dev, then prod). It creates the tables `order_settlement` (including `city_id`, used for admin city
   scoping) and `order_settlement_event`. The backend does not need the tables while `settlement_enabled`
   is off, except `getPublicViewForOrder`, which tolerates a missing table.
2. Deploy the backend. Behaviour is unchanged (feature off).
3. Ship the new customer and driver app builds (separate plans), and the admin Settlements page.
4. Enable: set `settlement_enabled` = `1` on the admin Settings page. All settings are stored in
   `app_settings`; defaults in parentheses:
   - `settlement_enabled` (off)
   - `settlement_reminder_minutes` (`10,30`)
   - `settlement_escalate_after_minutes` (`60`)
   - `settlement_driver_block_grace_minutes` (`10`)
   - `settlement_dispute_window_hours` (`48`)
5. Rollback: set `settlement_enabled` = `0`. Orders already in a settlement keep working
   (endpoints and the admin API do not check the flag); new completions use the legacy flow.
   Customers/drivers blocked by a pending settlement are unblocked as soon as the flag is off.

## Scope notes

- Monthly Driver and Daily Driver orders never get a settlement (they keep their own cash ledgers).

## Endpoints

- Customer: `POST /api/order/settlement/{state,choose-driver,pay-online/create,pay-online/verify,dispute}`
- Driver: `POST /api/rider/settlement/{state,received,dispute}`
- Admin (role superadmin/admin): `GET /api/v1/admin/settlements`, `GET /api/v1/admin/settlements/:id`,
  `POST /api/v1/admin/settlements/:id/resolve`. City-scoped: a city-bound admin only sees and resolves
  settlements of their own city; settlements with a null `city_id` (e.g. an order without a city) are
  visible to superadmin only.

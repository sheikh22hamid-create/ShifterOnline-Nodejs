# Order Goods Type — Design

> **Status & corrections (reviewed 2026-10-07): BUILT.** Matches the code. Current code-verified description: [Master Document section 5.10](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

Date: 2026-09-30

## Goal
Let a customer optionally say what goods a booking carries (e.g. Construction, Clothing) and show it to the driver. Admin owns the list of goods types. If none fits, the customer picks "Other" and types their own text.

## Decisions (agreed)
- Exactly one goods type per order (no multi-select).
- The field is optional at booking time.
- "Other" text is stored on the order only; it is never added to the master list.
- Set at order creation only; not editable afterwards.

## Data model
- New table `tbl_goods_type`: `id`, `name` (unique, varchar 100), `status` (bool, default true), `sort_order` (int, default 0), timestamps.
- `pkg_order` gains nullable `goods_type_id` (int), `goods_type_name` (varchar 100, snapshot of the name at booking), `goods_type_other` (varchar 100).
- The snapshot means renaming/deleting a type later never changes historical orders. Delete of a type in use = soft delete (`status=false`).

## Backend
- Admin CRUD `/api/admin/goods-types` (list/create/update/delete), same style as `masterDataController` categories; writes limited to superadmin.
- Customer endpoint returning active types ordered by `sort_order, name`.
- `createOrderCore` accepts optional `goods_type_id` and `goods_type_other`:
  - `goods_type_id` must reference an active type, else 400. On success store id + name snapshot.
  - `goods_type_other`: trimmed, max 100 chars, stored as given. If both id and other are sent, both are stored (other = extra detail).
  - Neither sent = all three columns null.
- Driver-facing order payloads (REST order details/history and the socket dispatch payload) expose a single display string `goods_type`: the type name, `Other: <text>` when only other text exists, `Name - <text>` when both, empty when none.

## Admin panel
- New "Goods Types" page modelled on `Categories.jsx` (list, add, edit, enable/disable, delete).
- `OrderDetailDrawer` shows goods type (and other text).

## Customer app (Flutter)
- `select_vehicle.dart`: optional "Goods type" picker fed by the active-types endpoint, plus an "Other" entry that reveals a text field. Sends `goods_type_id` / `goods_type_other` in the order body only when chosen.

## Driver app (Java)
- `PDOrderItem` gets `goods_type`; shown on the order details screen and the incoming-order card as "Goods: <value>", hidden when empty.

## Testing
- Backend: create order with valid type, only Other text, both, invalid/inactive id (rejected), neither (null); payload display-string formats; admin CRUD incl. soft delete of a type in use.
- Apps: manual verification on a booking flow (no automated UI tests exist for these screens).

## Out of scope
Multi-select, editing after booking, per-type pricing, admin-managed "Other" suggestions.

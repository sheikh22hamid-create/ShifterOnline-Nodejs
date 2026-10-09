# Trip Payment Settlement Design

> **Status & corrections (reviewed 2026-10-07): BUILT - dark by default.** Real endpoints differ from the table here: customer `POST /api/order/settlement/{state,choose-driver,pay-online/create,pay-online/verify,dispute,take-over,resend-link,receiver-phone}`; driver `POST /api/rider/settlement/{state,received,dispute,pending,receiver-refused,resend-link}`; admin `GET /settlements`, `GET /settlements/:id`, `POST /settlements/:id/resolve`, `POST /settlements/:id/convert-to-customer`. Settings are the `settlement_*` keys on the generic Settings page (there is no `/admin/settlement-settings`). Receiver-mode settlements are exempt from the driver dispatch block. Current code-verified description: [Master Document section 5.1](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

Date: 2026-10-04

## Purpose

Today an order becomes `Completed` the moment the driver finishes the drop.
The customer app then shows "Paid to Driver / Cash settled" on its own, the
driver popup shows "Cash to collect", and the commission is clawed back from
the driver's wallet immediately (`tripLifecycle.updateStatus`, `complete`),
all on the assumption that the driver really collected the cash. Nothing
records whether money actually changed hands, so a customer can say "my app
says paid" and the driver has no proof either way.

This design adds an explicit **settlement** step after completion:

- The customer chooses how to pay the amount still due: directly to the driver
  (cash/UPI) or online to the company.
- The driver confirms cash receipt in the app ("Received ₹X").
- Wallet movements (commission debit, online credit) happen when the
  settlement is confirmed, not at ride completion.
- Either side can raise a dispute; the admin can resolve any conflict from a
  new Settlements page.

## Non-goals

- Orders completed before the feature is enabled (they keep the old flow).
- Customer-wallet payment as an online method (Razorpay only for now).
- Changing fare calculation, advance payment or referral/coupon logic.
- Automatic judgement of disputes (always an admin decision).

## Decisions made with the product owner

| Topic | Decision |
|---|---|
| Who confirms cash | The **driver alone** ("Received"). The customer sees "Driver confirmed ₹X" and a "Report a problem" button. |
| Nobody acts | Settlement stays `pending`. Reminders go to both, the order is flagged to the admin after a threshold. Money never moves automatically. |
| Reminder/escalation timing | **Admin-configurable** (minutes), not hard-coded. |
| Conflicts | Full admin control: resolve, reverse, waive, or record as customer-owed. |
| Rollout | Behind a master switch, off by default. |

## Current behaviour this replaces (reference)

`tripLifecycle.updateStatus(... "complete")` computes
`finalTotal = total_dcharge + waitingCharge`, `prepaidTotal = advance_payment +
referral_points_amount + cou_amt`, and `cashCollected = finalTotal - prepaidTotal`
for cash orders. It then, in the same call: debits
`commission + perTripCharge - prepaidTotal` from the driver wallet
(`commission_debit:<orderId>`), or credits `advanceRefundDue`
(`advance_refund:<orderId>`), writes the Monthly Driver `CASH_COLLECTED`
ledger row, and debits the customer's advance back out
(`advance_apply:<orderId>`, customer wallet — not affected by this design).
`driverOrderHistoryController.formatPkgOrderForDriver` builds the "cash to
collect" numbers for the driver app.

## State machine

```
Completed ──► pending ──┬─► paid_online      (Razorpay verified)
                        ├─► cash_received    (driver taps "Received")
                        └─► disputed         (customer or driver reports a problem)

cash_received ──► disputed        (customer, within dispute_window_hours)
disputed ──► (admin resolve) ──► cash_received | paid_online | waived | customer_owes
pending ──► stays pending; flagged "unsettled" after escalate_after_minutes
```

Rules:

- `paid_online` is final for the customer/driver (no dispute from them; only
  admin can still reverse it).
- In `disputed`, the driver's "Received" and the customer's online pay are
  both rejected until the admin resolves.
- A settlement is created only when the feature is on **and** the order's
  `amount_due > 0` (`cashCollected` above). Orders fully covered by
  advance/points/coupon, and non-cash orders, are not given a settlement and
  behave exactly as today.

## Money rules

Define for an order: `fare = finalTotal`, `commission`, `perTripCharge`,
`prepaid = advance + referral points + coupon`, `netCommissionDue =
max(0, commission + perTripCharge - prepaid)`, `advanceRefundDue =
max(0, prepaid - (commission + perTripCharge))`.

A settlement carries a `wallet_effect` — what has actually been applied to the
driver wallet so far — one of `none | cash | online`.

| Effect | Driver wallet | Rationale |
|---|---|---|
| `none` | no movement | Settlement still pending/disputed. |
| `cash` | debit `netCommissionDue` (or credit `advanceRefundDue`) — exactly what `complete` does today; Monthly Driver `CASH_COLLECTED` ledger row | The driver holds the cash, company takes its commission. |
| `online` | credit `fare - commission - perTripCharge` | The company holds the money, so it pays the driver their net earning. Equals the cash case's end position (cash in hand + wallet delta = `fare - commission - perTripCharge`). |

Admin outcomes map to effects: `cash_received → cash`, `paid_online → online`,
`waived → online` (company absorbs the unpaid amount), `customer_owes →
online` plus the customer owes the amount (see Customer blocking).

**Transitions apply the difference.** Changing effect (e.g. `cash → online`
after a dispute) first reverses the previously applied effect with its own
unique-key reversal entries, then applies the new one. Every wallet row uses a
unique `payment_id` key (`settle_<orderId>_<effect>` / `..._reverse_<n>`),
the same idempotency pattern as `commission_debit:<orderId>` today, so retries
and double taps cannot move money twice.

When a settlement exists for an order, `complete` must **skip** the cash
commission debit / advance refund / Monthly Driver ledger writes and leave
them to the settlement service. The customer-wallet advance debit
(`advance_apply`) stays at completion.

## Data model

New tables (hand-applied SQL migration under `backend/prisma/migrations/`,
Prisma models added; prod needs the SQL run before deploy — see the existing
schema-drift caveat):

- `order_settlement` — `id`, `order_id` (unique), `uid`, `rid`, `amount_due`,
  `status`, `method` (`cash|online|null`), `wallet_effect`,
  `razorpay_order_id`, `razorpay_payment_id`, `pending_since`,
  `confirmed_at`, `confirmed_by` (`driver|customer_online|admin`),
  `last_reminder_at`, `reminders_sent`, `escalated_at`, `dispute_reason`,
  `dispute_raised_by`, `dispute_raised_at`, `resolved_by`, `resolved_at`,
  `resolve_note`, `created_at`, `updated_at`.
- `order_settlement_event` — append-only audit log: `settlement_id`, `actor`
  (`customer|driver|admin|system`), `actor_id`, `from_status`, `to_status`,
  `note`, `created_at`.
- `tbl_settlement_setting` — one row of admin settings (below).

## Admin settings

Configured in the admin Settings page ("Payment Settlement" block):

| Setting | Default | Meaning |
|---|---|---|
| `settlement_enabled` | off | Master switch; off keeps today's behaviour exactly. |
| `reminder_minutes` | `10, 30` | Minutes after completion at which customer and driver get a push (list). |
| `escalate_after_minutes` | 60 | Pending this long ⇒ flagged into the admin "Unsettled" queue. |
| `driver_block_grace_minutes` | 10 | Pending this long ⇒ the driver stops receiving new orders. |
| `dispute_window_hours` | 48 | How long after driver confirmation the customer may dispute. |

## APIs

| Caller | Endpoint | Purpose |
|---|---|---|
| Customer | `GET /api/order/settlement/:orderId` | State + amount due (also used on app resume). |
| Customer | `POST /api/order/settlement/pay-online` | Create the Razorpay order for `amount_due`; a second call verifies the payment signature and amount, then settles. |
| Customer | `POST /api/order/settlement/choose-driver` | Records "I will pay the driver" (informational; drives the driver screen). |
| Customer | `POST /api/order/settlement/dispute` | Dispute with a reason. |
| Driver | `POST /api/driver/settlement/received` | Confirm cash received (idempotent; rejected in `disputed`/`paid_online`). |
| Driver | `POST /api/driver/settlement/dispute` | Driver-raised problem. |
| Admin | `GET /api/admin/settlements` | List with filters: pending past threshold, disputed, resolved, by driver/customer/date. |
| Admin | `GET /api/admin/settlements/:id` | Detail + full event timeline + order fare breakdown. |
| Admin | `POST /api/admin/settlements/:id/resolve` | Outcome (`cash_received|paid_online|waived|customer_owes`) with mandatory note. |
| Admin | `GET/PUT /api/admin/settlement-settings` | The settings above. |

Existing driver/customer order payloads gain the settlement `status` and
`amount_due`; `formatPkgOrderForDriver`'s cash numbers stay as they are.

Every transition runs in one DB transaction with `SELECT ... FOR UPDATE` on the
settlement row. Only valid transitions are accepted (state machine above);
anything else returns a clear error without side effects.

Razorpay: the signature must verify (`verifyRazorpayPayment`) **and** the paid
amount must equal `amount_due`; otherwise the settlement stays `pending`.

## Realtime & reminders

- A `settlement:updated` socket event goes to `customer_<uid>` and the
  driver's room on every transition, so both screens stay live (e.g. the
  driver's "customer is paying online…" turns into "Paid online ₹X").
- A background sweep (same pattern as `sweepOverduePickups`) sends the
  configured reminders, stamps `last_reminder_at`/`reminders_sent` so a server
  restart never double-sends, and sets `escalated_at` at
  `escalate_after_minutes`.

## Customer app

- On `order:completed`, open a **Payment screen**: amount due, "Pay driver
  directly (cash/UPI)" and "Pay online (Razorpay)".
- Order screen shows "Payment pending" until settled; the "Paid to Driver"
  wording appears only after `cash_received`/`paid_online`.
- After driver confirmation: "Driver confirmed ₹X" with "Report a problem"
  for `dispute_window_hours`.
- A customer with a `pending` or `customer_owes` settlement cannot book a new
  order (clear error code `SETTLEMENT_PENDING`). `disputed` does **not**
  block booking.

## Driver app

- A dedicated **Trip Payment screen** replaces the completed-ride popup: fare
  breakdown, a large "Collect ₹X", and **Received ₹X** (with a confirm dialog
  against mis-taps; available any time in `pending`, regardless of the
  customer's choice).
- Live states: customer paying online, paid online (wallet credited),
  disputed (button disabled, "Admin will review").
- While a settlement has been `pending` longer than
  `driver_block_grace_minutes` (and is not `disputed`), the driver is skipped
  by dispatch.

## Admin panel

New **Settlements** page ([frontend/src/pages](../../../frontend/src/pages)):
list with filters, detail view with the event timeline and fare breakdown, and
the resolve actions with a mandatory note. Plus the settings block above.
Every admin action writes an `order_settlement_event`.

## Rollout & compatibility

- `settlement_enabled = off` by default; with it off no settlement rows are
  created and `complete` behaves as today.
- Older app builds that don't know the new screens keep working for orders
  without a settlement; with the flag on, old builds would still show the old
  popup, so enable the flag only after the new customer and driver builds are
  out.
- Prod needs the migration SQL applied before the backend deploy.

## Testing

- Backend (jest): every valid and invalid transition, double-confirm and
  retry idempotency, the wallet effect for each outcome and the
  difference-based reversal when an outcome changes, Razorpay amount
  mismatch, `amount_due = 0` / non-cash skip, `complete` skipping the
  commission writes when a settlement exists, reminder/escalation sweep
  without double sends, booking and dispatch blocks.
- Customer and driver apps: `flutter analyze` / Gradle build, then a device run
  of three real rides — cash, online, and dispute → admin resolve.
- Admin panel: lint/build and resolving real settlements.

## Assumptions to confirm during review

1. Online payment is Razorpay only in this iteration.
2. Disputed settlements do not block the customer's next booking, but
   `pending` and `customer_owes` do.
3. Existing completed orders are not migrated into settlements.

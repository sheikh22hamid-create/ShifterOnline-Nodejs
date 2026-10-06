# Receiver Pays (with booker commission) Design

Date: 2026-10-05

## Purpose

Today the customer who books an order (the **booker**) is the only party who
can pay for it: the advance at driver-accept, and the remainder after the
drop. The drop-side contact (`pkg_order.drop_name` / `dmobile`) is stored but
only used for calls and WhatsApp updates; nothing in the system lets that
person pay.

This design lets a booker choose, at booking time, that the **receiver** pays
the fare at the drop, with these properties:

- The receiver does **not** need the Shifter app. They get WhatsApp updates and
  a secure web pay link and pay online (Razorpay) from the phone browser.
- The booker still pays the advance at driver-accept (unchanged). In receiver
  mode the advance is a **refundable deposit**: it is not netted off the fare,
  and it goes back to the booker's Shifter wallet the moment the receiver's
  payment is confirmed.
- The booker may set a **commission %** on top of the fare. The receiver pays
  `amount + commission`; the commission is credited to the booker's wallet. The
  admin controls the maximum.
- If the receiver declines, the booker (or driver) can fall back to the normal
  flow with no money lost.

It is built **on top of the payment-settlement system**
([2026-10-04-payment-settlement-design.md](2026-10-04-payment-settlement-design.md)),
so it only works while `settlement_enabled` is on.

## Decisions made with the product owner

| Topic | Decision |
|---|---|
| Who pays the advance | Always the booker, at driver-accept, 2-minute window (unchanged). |
| Advance in receiver mode | Refundable deposit; not deducted from the receiver's amount; refunded to the booker's wallet when the receiver pays. |
| Commission base | The amount the receiver actually pays (fare after coupon / referral points). |
| Commission % | Chosen by the booker per order, 0 up to an admin-set maximum. |
| Coupon / referral points | Still reduce the fare before the receiver's amount (receiver pays fare minus them). |
| Booker uses own second number as receiver | Allowed; no special check. |
| Receiver without the app | WhatsApp updates + signed web pay link; no app needed. |
| Architecture | Extend the settlement system; pay page served by the backend itself (no new deploy). |
| Cash receiver | Allowed. **Update 2026-10-06:** the commission applies to cash too (see "Cash commission" below). |
| Customer wallet | **Spend-only.** The customer app has no withdraw option and none is to be added; the commission and refunded advance stay in the wallet to be spent on rides. |

## Non-goals

- ~~Commission on cash payments~~ - superseded 2026-10-06, see "Cash commission".
- Saved/trusted receivers, shareable seller pay links, receiver wallet.
- Changing fare, advance amount/timer, coupon or referral logic.
- Non-cash booking payment methods: receiver-pay is offered only on orders
  whose payment method is cash (`p_method_id` 2 or 0, the same `isCashOrder`
  test `tripLifecycle` uses), since only those produce a settlement.
- Monthly / Daily Driver trips: those drivers skip settlement
  (`tripLifecycle` ~L637), so such an order silently falls back to normal
  customer mode and the booker is notified.

## Money model

Let, for an order at completion: `fare = finalTotal`, `coupon` + `points` the
platform-absorbed discounts, `amount = fare - coupon - points` (the existing
settlement `amount_due` before the advance), `A` = advance actually captured,
`m = round2(amount * pct / 100)` capped by the admin amount cap.

| | Normal mode (today) | Receiver mode |
|---|---|---|
| Advance | netted off: `amount_due = amount - A` | **held**: still debited from booker wallet at completion (as today), refunded on receiver payment |
| `amount_due` stored | `amount - A` | `amount` |
| Payer pays | `amount_due` | `amount_due + m` (receiver) |
| Driver wallet effect | unchanged (`effectOps` cash / online) | unchanged; `prepaid_amount` holds only coupon + points, **not** the advance |
| Booker wallet on payment | nothing | `+A` (`receiver_advance_refund:<orderId>`), `+m` (`receiver_markup_credit:<orderId>`) |

Platform check (fare 100, coupon 10, A 20, commission c, online): receiver
pays 90 + m; driver credited `100 - c`; booker credited `A + m`; platform ends
with `c - 10` (the coupon it absorbs), exactly as in normal mode. Cash (m = 0)
nets the same: the driver keeps the cash, is debited `c - 10`, booker gets `A`.

Refund and markup happen **only** when the receiver actually pays
(`paid_online` by receiver, or driver `cash_received` on a receiver-mode
settlement). Waived / customer-owes outcomes do not refund the advance (see
Fallback).

`m` is computed at **completion** from the final fare and the percent locked
at booking; the booking screen only shows an approximation.

## Data model

Hand-applied SQL migration (`backend/sql/2026100X_receiver_pays.sql`) plus
Prisma models, the same drift caveat as the settlement tables: **prod needs the
SQL run before deploy**.

New table `order_receiver_pay` (1:1 with the order):
`id`, `order_id` (unique), `uid`, `receiver_phone` (normalised 10-digit
snapshot), `receiver_name`, `commission_percent` DECIMAL(5,2) (locked at
booking), `status` (`active | declined | paid | closed`), `token_hash`
CHAR(64) NULL, `token_expires_at`, `razorpay_order_id`, `declined_by`
(`receiver | driver | booker`), `declined_at`, `link_sent_at`,
`link_send_count`, `created_at`, `updated_at`.

`order_settlement` gains: `payer` VARCHAR(10) default `'customer'`
(`customer | receiver`), `receiver_markup` DECIMAL(10,2) default 0,
`advance_held` DECIMAL(10,2) default 0, `reversal_shortfall` DECIMAL(10,2)
default 0, `receiver_credited` TINYINT(1) default 0. `confirmed_by` also accepts
`receiver_online`. Existing rows and normal mode are untouched.

## Lifecycle

1. **Booking** (`orderController.createOrderCore`): optional
   `receiver_pays` + `receiver_commission_percent`. Rejected with a clear code
   (`RECEIVER_PAY_UNAVAILABLE`) unless settlement and receiver-pay are enabled,
   the order is cash, `dmobile` is a valid 10-digit number, and the percent is
   within the admin limits. Creates the `order_receiver_pay` row. The existing
   booked-WhatsApp message to `dmobile` gains a line: who chose them as payer,
   approx fare; the receiver can decline only from the pay link (no WhatsApp reply
   keyword).
2. **Driver accepts**: advance flow unchanged.
3. **Completion** (`tripLifecycle` settlement block): if an `active`
   `order_receiver_pay` exists and the driver is a regular driver, create the
   settlement in receiver mode (`payer = receiver`, `amount_due = amount`,
   `receiver_markup = m`, `advance_held = A`, `prepaid_amount = coupon +
   points`). The customer-wallet `advance_apply` debit still runs, which is
   what "holds" the advance. Mint the pay token (32 random bytes, only the
   SHA-256 stored), set `token_expires_at` (default 24 h) and WhatsApp the
   receiver the link plus the exact breakup.
4. **Receiver pays** (web page) or **driver taps Received** (cash): one
   settlement transition, under the existing `FOR UPDATE` lock, applies the
   driver wallet effect (existing `changeWalletEffect`) and the two booker
   credits, writes the audit events, and sets `order_receiver_pay.status =
   paid`. Booker gets a push + socket update. On the **cash** path the stored
   `receiver_markup` is zeroed in the same transition (the receiver only
   handed over `amount_due`), so only the advance refund is credited. If the
   driver confirms cash while the receiver is mid-payment, the existing lock
   and `PAID_BUT_STATE_CHANGED` reconciliation path decide the winner.
5. **Decline / take over** (see Fallback) at any point converts to normal mode.

## Receiver pay page and WhatsApp

New public routes mounted in `app.js` (token is the only auth; no login):

| Route | Purpose |
|---|---|
| `GET /pay/:token` | Server-rendered single page: order #, driver first name, booker first name, short pickup/drop, breakup (`Fare after discounts Rs 90 + service fee Rs 2.70 = Rs 92.70`), status, Pay and Decline buttons. Razorpay Checkout loaded from Razorpay's script. No booker phone number is exposed. |
| `GET /api/pay/:token` | JSON state for the page (refreshes after pay/decline). |
| `POST /api/pay/:token/order` | Create the Razorpay order for `amount_due + markup` (reusing `razorpayOrders.createRazorpayOrder`, receipt `rpay_<orderId>`), stored on `order_receiver_pay.razorpay_order_id`. |
| `POST /api/pay/:token/verify` | `verifyRazorpayPayment` with `expectedAmountRupees = amount_due + markup`; on success runs the settlement transition. Mismatch keeps the settlement `pending`. Idempotent on `payment_id`; a verified payment that can no longer be applied follows the existing "needs manual reconciliation" event path. |
| `POST /api/pay/:token/decline` | Receiver declines. |

Security: token compared by hash, expiry enforced, per-IP + per-token rate
limits, link dead once the settlement is no longer `pending` or the order is
cancelled (page shows a neutral "no payment needed" state). The receiver
declines on the pay page, the driver with *Receiver refused*, or the booker with
*I'll pay myself*; the link is resent by the driver or the booker (no WhatsApp
keyword, no admin resend).

## Fallback and edge cases

- **Decline** (receiver on the pay page, driver "Receiver refused", or booker
  "I'll pay myself"): before completion, status becomes `declined` and
  completion creates a normal settlement. After completion, under the lock, a
  `pending` receiver-mode settlement is converted: `payer = customer`,
  `amount_due = amount - advance_held`, `receiver_markup = 0`,
  `prepaid_amount += advance_held`, `advance_held` kept for audit; the
  receiver link is closed (`status = closed`). Booker and driver are notified
  and the settlement continues as today (cash, or customer online). Conversion
  is refused if the settlement is no longer `pending`.
- **Receiver never pays**: normal settlement reminders/escalation apply; admin
  can convert or resolve. `waived` / `customer_owes` are resolved against the
  converted (customer-mode) amounts, so the advance is consumed, never
  refunded.
- **Admin reverses** a receiver-paid settlement: the driver effect reverses as
  today and the booker credits are reversed with their own unique keys, capped
  at the booker's available balance (shortfall recorded, see Resolved items).
- **Cancel / early drop**: unaffected; no settlement means no receiver payment.
  Cancel refund logic for the advance is unchanged.
- **Advance not captured** (`A = 0`, no-advance plan, or wallet-paid order):
  nothing to refund; markup still applies.
- **Early-drop / fare change**: `m` is derived from `amount` at completion, so
  it always follows the final fare.

## Customer wallet stays spend-only

The customer app exposes no withdrawal, but the backend still accepts it:
`POST /wallet/withdraw` (`customerWalletController.withdrawWallet`,
`user.routes.js`) defaults to `wallet_type = "user"` and debits a customer
wallet. Since this feature credits real money (commission) into that wallet,
the endpoint gets a guard as part of this work: a request for
`wallet_type = "user"` (or a missing type) is rejected with a clear error;
the driver path (`wallet_type = "driver"`, admin-approved payouts) is
unchanged. A regression test covers both.

## Admin

Settings (existing Settings page flags, `app_settings` keys, read like
`settlementSettings.js`, fail-closed):

| Key | Default | Meaning |
|---|---|---|
| `receiver_pay_enabled` | off | Master switch for this feature. |
| `receiver_commission_max_percent` | 5 | Highest % a booker may set. |
| `receiver_commission_max_amount` | 0 (no cap) | Rupee cap on the commission per order. |
| `receiver_pay_link_ttl_hours` | 24 | Pay-link lifetime. |

Customer app reads limits from `GET /api/order/receiver-pay/config`. The
Settlements admin page shows payer, receiver phone, markup and advance held for
receiver-mode rows and can convert to customer mode (writes an
`order_settlement_event`). The public base URL for pay links comes from env
`PUBLIC_BASE_URL`.

## Apps

- **Customer app** (`ShifterOnline/`): booking toggle "Receiver pays" with a
  percent picker bounded by the config endpoint and an approx amount line;
  order screen shows receiver-payment status and a "I'll pay myself" action.
- **Driver app** (`ShifterDriver/`): Trip Payment screen shows
  "Collect Rs X from <receiver name / number>" in receiver mode, with
  **Received**, **Receiver refused** and **Resend link**.
- Both app directories are gitignored; their changes are added with
  `git add -f` on exact files only.

## Rollout

- `receiver_pay_enabled` off by default; with it off no receiver rows exist and
  every existing path is byte-for-byte the same.
- Requires `settlement_enabled` on, which itself waits on the new customer and
  driver builds. Receiver-pay is enabled after those builds also carry the
  receiver UI.
- Prod runs the migration SQL before the backend deploy.

## Testing

- Backend (jest): receiver-mode settlement creation and amounts (with and
  without coupon/points, advance 0, advance greater than amount); commission
  rounding and the admin percent/amount caps; booking validation rejections;
  receiver online pay (success, amount mismatch, replay, expired/closed token,
  payment after state change); driver cash Received refunds the advance with
  markup 0; decline before and after completion converts amounts exactly;
  advance refund and markup are idempotent and reversed with their own keys;
  Monthly/Daily driver and settlement-off fall back to normal mode; token
  hashing, expiry and rate limits.
- Customer / driver apps: analyze + build, then device runs of: receiver pays
  online, receiver pays cash, receiver declines (before and after drop).
- Pay page: real Razorpay test-mode payment from a phone browser.

## Resolved review items and risks

1. **Reversal never drives the booker wallet negative.** When an admin reverses
   a receiver-paid settlement, the booker credits (advance refund, commission)
   are debited only up to the wallet's available balance. Any shortfall is
   stored on the settlement (`order_settlement.reversal_shortfall` DECIMAL(10,2)
   default 0), written to the audit event, and shown in the admin Settlements
   page, where the admin can resolve it as `customer_owes`. This keeps wallet
   balances non-negative so wallet-paid booking and existing balance checks are
   unaffected.
2. **No tax logic in code.** The commission is credited with its own wallet
   entry label ("Receiver commission", key prefix `receiver_markup_credit:`) so
   accounting can report it separately. The GST/tax classification is a
   **launch-checklist item**: the CA confirms it before `receiver_pay_enabled`
   is switched on in prod. It does not block development.
3. New customer/driver endpoints follow the existing convention of trusting the
   supplied `uid`/`rider_id` (the known, deliberately deferred auth gap); the
   public pay routes are token-authenticated and are not affected by it.

## Implementation notes

Details decided during the build:

- The receiver pay page uses a namespaced per-route rate limiter keyed on the
  rightmost `x-forwarded-for` hop (`middleware/ipRateLimiter.js`).
- A decline racing completion converges via a post-create re-check (actor
  `system`).
- Admin reversal of a receiver settlement uses the ORIGINAL row for the driver
  wallet reversal.
- `/verify` failures lock the page's Pay button for the session.

## Cash commission (added 2026-10-06)

The booker's commission now applies when the receiver pays the driver in cash.

- The driver collects `amount_due + receiver_markup` in cash (`receiver_pay_total` in the settlement view).
- `effectOps(cash)` adds a driver-wallet debit of `receiver_markup` (remark "Receiver commission collected in
  cash"), appended after the normal commission ops. The platform credits the same amount to the booker, so it
  is neutral; the driver hands over what the receiver paid on top of the fare.
- `markCashReceived` and the admin `cash_received` outcome credit advance **and** commission to the booker and no
  longer zero `receiver_markup` (it must stay on the row so a later admin reversal can credit the driver back
  using the original locked row).
- Unchanged: decline / take-over / "Receiver refused" convert to customer mode with markup 0, so no commission.
- Driver history cash math adds the markup for receiver orders that are not `paid_online`.
- Risk: a driver who collects only the fare still has the commission debited, so the driver app shows the full
  total and a fee hint.

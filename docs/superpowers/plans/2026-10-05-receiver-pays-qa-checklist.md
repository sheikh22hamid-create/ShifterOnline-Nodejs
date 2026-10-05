# Receiver Pays: manual QA checklist (dev environment)

0. Apply `backend/prisma/migrations/20261005010000_add_receiver_pay/migration.sql` to the dev DB (it was NOT applied during development because no DATABASE_URL was available in this checkout) and run `npx prisma generate`. Expected: new columns/tables exist and the Prisma client regenerates without errors.
1. Enable `settlement_enabled` and `receiver_pay_enabled` (+ `PUBLIC_BASE_URL`, Razorpay **test** keys, WhatsApp client connected) in the dev DB/env. Expected: settings read as enabled; config endpoint returns the limits.
2. Book a cash order with `receiver_pays: true, receiver_commission_percent: 3`. Expected: response `receiver_pay: true`; receiver gets the booked WhatsApp with the payer line.
3. Book with `receiver_commission_percent` above the admin max. Expected: HTTP 400.
4. Driver accepts, booker pays the advance, ride completes. Expected: settlement row has `payer = receiver`, `advance_held = advance`, markup = 3% of the amount; receiver gets the pay link on WhatsApp with the exact total.
5. Open the link on a phone, pay with a Razorpay test card. Expected: settlement `paid_online` / `confirmed_by = receiver_online`; driver wallet credited `fare - commission`; booker wallet gets `+advance` and `+commission` rows (`receiver_advance_refund:<id>`, `receiver_markup_credit:<id>`); link now shows "Payment received".
6. Repeat 4, then driver taps **Received** instead. Expected: advance refund only, markup 0, receiver link shows "No payment is needed".
7. Repeat 4, receiver taps **Decline**. Expected: settlement `payer = customer`, `amount_due = amount - advance`, no booker credit; driver/booker apps receive `settlement:updated`.
8. Repeat 4, driver calls `receiver-refused`. Expected: same as 7. Booker `take-over` before completion: completion creates a normal settlement.
9. Resend link twice within a minute. Expected: second call `TOO_SOON`; old link stops working after a resend.
10. Admin: list shows payer/markup/advance; `convert-to-customer` works; resolving a receiver-paid settlement to `waived` reverses credits (check `reversal_shortfall` when the booker wallet was emptied first).
11. `POST /wallet/withdraw` with `wallet_type: "user"`. Expected: 403.
12. Feature off (`receiver_pay_enabled` = 0): booking with `receiver_pays: true` returns `RECEIVER_PAY_UNAVAILABLE`; a normal ride is byte-for-byte unchanged.
13. Prod launch gate: run `20261005010000_add_receiver_pay/migration.sql` on prod before deploy; CA signs off on the commission's GST treatment before switching `receiver_pay_enabled` on.

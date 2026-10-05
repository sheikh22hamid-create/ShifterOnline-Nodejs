# Receiver Pays - admin panel manual QA

Prerequisites: dev DB with migration `20261005010000_add_receiver_pay` applied, backend running against it (`cd backend && npm run dev`), admin panel running (`cd frontend && npm run dev`), logged in as a **superadmin**. Receiver-mode settlements come from the backend QA checklist (`2026-10-05-receiver-pays-qa-checklist.md`, item 4).

| # | Check | Expected |
|---|---|---|
| 1 | Settings > "Receiver Pays": change all four values, Save, reload | Section sits under "Trip Payment Settlement" with defaults Disabled / 5 / 0 / 24; values persist after reload; none of the four keys shows under "Other Feature Flags" |
| 2 | Settlements list, normal (customer-paid) rows | Look exactly as before: no badges, no `NaN` |
| 3 | Open a receiver-mode settlement | List row shows "Receiver pays" + "+ ₹fee · advance held ₹x". Drawer shows the Receiver Pays panel: receiver name/phone, link status `active`, "Sent 1×", commission %, fare due, fee, total, advance held, wallet credited "No" |
| 4 | Click "Convert to customer payment" then "Yes, convert" | Toast "Converted to customer payment."; panel title becomes "Converted to customer"; amount due drops by the advance; list row loses "Receiver pays"; link status `declined`; audit timeline shows "Receiver payment declined by admin ...". Double-clicking "Yes, convert" sends one request |
| 5 | Open a receiver settlement that is not pending (paid / cash received) | No convert button |
| 6 | Open a normal settlement | No Receiver Pays panel; third breakdown label still "Prepaid / Advance:" |
| 7 | Resolve a receiver-paid settlement as Waived (booker has spent the refund) | Panel reads "Converted to customer"; a "Reversal shortfall" row appears and the list row shows the red "Shortfall ₹x" badge |
| 8 | Stop the backend, click convert | Red toast with a message; drawer stays usable |
| 9 | DevTools > Network: `GET /api/v1/admin/settlements/:id` | Response contains `receiver_pay` and no `token_hash` / `razorpay_order_id` |

## Result log

- 2026-10-05: **not run.** No `DATABASE_URL` was available in this checkout, so the dev DB and a live backend could not be used. Verified instead: backend unit tests for the detail endpoint (receiver row, null row, thrown lookup, missing model, no token leak), `npm run build` passes, and a server-side render of `ReceiverPayPanel` for normal, legacy (no receiver fields), receiver, receiver-with-null-row and converted settlements (no `NaN`/`undefined`, convert button only for a pending receiver settlement). Run the table above once the dev DB has the migration.

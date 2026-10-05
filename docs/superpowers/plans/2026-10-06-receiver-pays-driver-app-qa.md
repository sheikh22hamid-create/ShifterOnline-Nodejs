# Receiver Pays - driver app manual QA

Prerequisites: dev backend with migration `20261005010000_add_receiver_pay` applied, `settlement_enabled` = 1 and `receiver_pay_enabled` = 1, `PUBLIC_BASE_URL` set, a regular (not Monthly/Daily) test driver, a customer app that can book with "Receiver pays" (see the customer QA checklist), WhatsApp client connected. Driver app built from this branch (`cd ShifterDriver/ShifterDriver && ./gradlew installDebug`).

| # | Check | Expected |
|---|---|---|
| 1 | Complete a receiver-pays ride (cash) | Trip Payment screen opens; status text reads "Collect ₹X.00 cash from <receiver name> (<phone>), or the receiver can pay online via the link we sent on WhatsApp."; a hint shows "Receiver's online total: ₹Y"; the buttons "Receiver refused" and "Resend link" are visible next to the existing Received / Report problem buttons; the grace warning no longer says "from the customer" |
| 2 | Tap "Received" | Confirm dialog says the cash is collected from the receiver; after confirming the status becomes cash received, the receiver buttons disappear; customer wallet gets the advance back, no commission |
| 3 | Tap "Resend link" twice quickly | First: Toast "Payment link sent to the receiver" (receiver gets a fresh WhatsApp link; the old one stops working); second within a minute: the wait message in an AlertDialog; buttons look dimmed and cannot be double-tapped while a request runs |
| 4 | Disconnect WhatsApp on the server, tap "Resend link" | Dialog "WhatsApp could not deliver the link. Share it with the receiver." with the link and a Copy button |
| 5 | Tap "Receiver refused" | Confirm dialog "Receiver refused to pay? The customer will be asked to pay instead."; after "Yes, refused" the screen switches to the normal pending text, the receiver buttons and hint disappear, the customer's sheet flips to normal options |
| 6 | Receiver pays online from another phone while the screen is open | Screen updates to paid online through the socket (or within 8 s through polling); buttons hidden; driver wallet credited fare minus commission |
| 7 | Open the ride from the Home "pending settlement" card or a push notification (no order item) | Screen renders with "the receiver" until the order history backfills, then shows the name and phone; no crash |
| 8 | Normal (customer-paid) ride | Trip Payment screen identical to before: no receiver buttons, original texts |
| 9 | Disputed / waived / customer-owes states of a receiver order | Receiver buttons hidden in every non-pending state |
| 10 | `./gradlew testDebugUnitTest` | All pass except the pre-existing `DemoRideTest.cashAdvanceAndOnlineReconcileWithoutDoubleCountingEarnings` |

## Result log

- 2026-10-06: **not run on a device.** Verified instead: `./gradlew --offline testDebugUnitTest` 56 tests pass except the pre-existing `DemoRideTest.cashAdvanceAndOnlineReconcileWithoutDoubleCountingEarnings` (that test does not reference any class changed here), `:app:compileDebugJavaWithJavac` succeeds so the ViewBinding ids and the layout compile, and the new pure-Java helper and the Gson model parsing are unit-tested. The UI behaviours above are covered by code review only.

# Receiver Pays - customer app manual QA

Prerequisites: dev backend with migration `20261005010000_add_receiver_pay` applied, `settlement_enabled` = 1 and `receiver_pay_enabled` = 1 (admin Settings), `PUBLIC_BASE_URL` set, a regular (non Monthly/Daily) test driver, Razorpay test keys, WhatsApp client connected, customer app built from this branch (`cd ShifterOnline && flutter run`).

| # | Check | Expected |
|---|---|---|
| 1 | Booking confirm screen with `receiver_pay_enabled` = 0 | No "Receiver pays" card; booking request body has no `receiver_*` keys |
| 2 | Enabled, payment = Cash, drop contact with a valid 10-digit number | "Receiver pays" card with a switch; switching it on shows the explanation line, percent chips (0% .. admin max, nothing above max) and the WhatsApp hint; 0% is preselected |
| 3 | Select Wallet after turning the switch on | Switch turns off, percent resets, card shows "Only for cash orders"; request carries no `receiver_*` keys and the wallet is debited as before |
| 4 | Drop number empty / 5 digits | Switch disabled with "Add a valid 10-digit drop contact number" |
| 5 | Drop number `+91 98765 43210` and `098765 43210` | Switch enabled; booking sends `dmobile` unchanged and backend accepts it |
| 6 | Book with receiver pays on, 3% | Order placed; backend has an `order_receiver_pay` row (3.00, active); receiver gets the booked WhatsApp with the payer line; order screen shows the "Receiver pays <name> ... commission 3%" row |
| 7 | Stop the backend config route (or set the flag off) while the app is open, reopen the confirm screen | Booking works exactly as before, no crash, no card |
| 8 | Admin turns the flag off after the card was shown, then confirm | Backend returns `RECEIVER_PAY_UNAVAILABLE`; friendly toast, stays on the screen |
| 9 | Complete the ride (driver) | Settlement sheet opens in receiver mode: "Receiver is paying", total (fare + fee), "I'll pay myself", "Resend payment link"; no pay-online / pay-driver options; order screen sub-label and hero say the receiver is paying, not "settle with your driver" |
| 10 | Tap "Resend payment link" twice quickly | First: "Payment link sent" toast (or link dialog with Copy when WhatsApp is down); second within a minute: the wait message |
| 11 | Tap "I'll pay myself" | Sheet switches to the normal pay options with the advance netted off; double-tap sends one request |
| 12 | Receiver pays online from another phone | Sheet/order screen update through the socket to paid; booker wallet shows the advance refund and the commission credit |
| 13 | Driver taps "Receiver refused" (driver app) | Sheet flips to normal options through the socket |
| 14 | Normal (non-receiver) order, end to end | Booking, settlement sheet and order screen unchanged |
| 15 | `flutter test` | All pass |

## Result log

- 2026-10-06: **not run on a device.** Verified instead: `flutter test` 56/56 pass (pure helpers for percent choices, number normalisation, config parsing, receiver-mode detection and totals are unit-tested), per-file `flutter analyze` shows no new issues versus the baseline for every touched file (project-wide analyze reports 203 pre-existing infos/warnings), backend tests for the order-details `receiver_pay` summary pass. The UI behaviours above are covered by code review only.

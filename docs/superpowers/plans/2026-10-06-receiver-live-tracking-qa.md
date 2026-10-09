# Receiver live tracking - manual QA

> **Status & corrections (reviewed 2026-10-07): QA CHECKLIST.** Manual QA for the built feature. Current code-verified description: [Master Document section 5.3](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

Prerequisites: dev backend with migration `20261006010000_add_order_track_link` applied (`npx prisma generate` run), `PUBLIC_BASE_URL`, `MAPTILER_KEY` set (key restricted to the domain), WhatsApp connected, `receiver_tracking_enabled` = 1, a driver account on a phone, a receiver phone with WhatsApp.

| # | Check | Expected |
|---|---|---|
| 1 | Book an order with a drop contact, driver accepts | Receiver gets a "driver assigned" WhatsApp with a Live track link; sender's messages unchanged |
| 2 | Open the link before pickup | Status "Driver is heading to the pickup point", driver card with Call button, timeline step 1, no map, no addresses |
| 3 | Driver reaches pickup, enters OTP | Step 3 "Your parcel is on the way"; map appears with pickup/drop pins, route line, moving driver marker, ETA and km |
| 4 | Watch the marker | Moves smoothly, rotates with heading; ETA refreshes about every minute, not every 5 s |
| 5 | Turn the driver's GPS off for 3 minutes | Marker greys out, "Waiting for the driver's location", ETA disappears; recovers when GPS returns |
| 6 | Driver reaches the drop | Step 4 "Driver has reached your location", no ETA |
| 7 | Complete the delivery | Page shows Delivered with the right IST time, map gone; link still opens for 24 h, then says expired |
| 8 | Cancel an order with a link | Page says the order was cancelled |
| 9 | Admin edits the order's drop contact | Old link says "no longer valid"; new number receives a new link (only while in progress) |
| 10 | Receiver-pays order: change the receiver number from the customer app | Both the pay link and the tracking link move to the new number |
| 11 | Same number for sender and receiver | No tracking link, no duplicate message |
| 12 | `receiver_tracking_enabled` = 0 | No links in new messages; an existing link says expired |
| 13 | Unset `MAPTILER_KEY` | Page works, no map |
| 14 | Block `unpkg`/`cdnjs` on the phone or use airplane mode mid-trip | Status, ETA and driver card still work; "Connection problem - retrying..." shows and clears |
| 15 | Open `/track/garbage` and `/api/track/garbage` | 404, no stack traces |
| 16 | View page source / network | No pickup OTP, booker details or fare anywhere in the API responses |
| 17 | `cd backend && npx jest` | All pass except the pre-existing `aadharPdfVerify` |
| 18 | Change the pickup or add or change a stop after the trip is on the way | The pin and route follow it |
| 19 | Open the link with MAPTILER_KEY set but a wrong/blocked key | Tiles missing, page still works |
| 20 | Open the tracking link on a phone in dark mode | Page is light with the orange header, never dark |
| 21 | Complete a delivery (cash order, no Receiver pays) and open the link | Delivered screen: summary, driven route on the map, rating form, help buttons, app button; NO payment card and no amounts anywhere |
| 22 | Complete a Receiver-pays delivery with a 3% commission | Payment card shows fare, service fee and total; "Pay now" opens the /pay page with the same total; after paying, returning to the tracking link shows "Paid" |
| 23 | Rate 5 stars and pick tags, submit | "Thanks for your feedback"; the Receiver tab in the admin Trip Feedback shows it; reloading the link shows the thank-you, not the form |
| 24 | Rate 2 stars | Negative tags are offered instead of positive ones |
| 25 | Double-tap Pay now / Submit | Only one request goes out |
| 26 | "Call support" and "WhatsApp" | Dialer opens with 9109114515; WhatsApp chat opens with "Order #<id> - I need help" prefilled |
| 27 | Open the link 25 hours after delivery | "This tracking link has expired"; none of the delivered cards show |

## Result log

- Not run on a device yet.
- Delivered screen and theme: not run on a device yet.


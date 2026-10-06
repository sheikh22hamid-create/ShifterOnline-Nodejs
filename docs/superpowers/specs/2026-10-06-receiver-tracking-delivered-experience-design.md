# Receiver tracking page - app theme and delivered experience

Date: 2026-10-06. Status: draft for review. Extends `2026-10-06-receiver-live-tracking-design.md` (same page, link and privacy model; read that first).

## Goal

1. Give the public tracking page the app's look: a light theme with the app's orange, instead of following the phone's dark mode.
2. Turn the "Delivered" state into a useful screen: trip summary, the route the driver actually took, a Pay button for Receiver-pays orders, a rating/review form, help buttons and an app-download button.

Out of scope: invoice/PDF, notifying the booker about the review, declining payment from the tracking page, a dark theme, any change to the customer or driver apps.

## Theme

- The page is always light (`color-scheme: light`; the dark `prefers-color-scheme` block is removed).
- Tokens from the app (`ShifterOnline/lib/utils/Colors.dart`): accent `#FF6B35`, card white `#FFFFFF`, page background `#F7F7F7`, text `#202020`, muted `#827E7E`, border `#DEE3E7`, success `#04D80D` (text uses a darker `#0B8A12` for contrast), warning `#E68C00`, error `#D93025`.
- Header is a gradient `#FF6B35 -> #FF8A5C` with white text; primary buttons are orange with white text; the timeline's active dot, ETA text, car marker and route line use the accent (route line stays blue `#1a73e8` for contrast on the map).
- Font stays the system stack (the app's Gilroy is a bundled font, not available on the web).

## Delivered screen

Shown while the link is in its 24 h delivered window (unchanged rule). Top to bottom:

| Block | Content |
|---|---|
| Status | "Delivered" and the delivery time (existing). |
| Trip summary | Driver first name and vehicle number, pickup and drop addresses (80 chars), distance in km. |
| Trip route map | The route the driver actually drove (the GPS trail), pickup and drop pins. Falls back to pickup -> drop pins and the planned distance when no trail was recorded. |
| Pay card | Only for a Receiver-pays order. `payable`: fare, service fee, total and a "Pay now" button. `paid`: "Paid" with the total. Not shown otherwise. |
| Rate the delivery | Driver stars (1-5), delivery stars (1-5), quick tags (same lists as the customer app, positive tags for 4-5 stars and negative for 1-3), optional comment. After submit: "Thanks for your feedback". |
| Need help? | "Call support" (`tel:`) and "WhatsApp" (`https://wa.me/<number>?text=Order #<id>`) buttons. |
| Get the app | A button to the Play Store listing (the URL the WhatsApp delivered message already uses). |

## Privacy

- The fare, service fee and total are included only when the order has a Receiver-pays row (they are what that receiver has to pay). For every other order the snapshot carries no money fields at all.
- Never returned: booker name or phone, pickup OTP, wallet or other payment data.
- The trip route is returned only in the `delivered` state, only for orders whose link is valid for the current `dmobile`, and is simplified to at most 150 points. It is not returned in `active`, `cancelled` or `expired`.
- The two new POST endpoints authorize through the same tracking token: the token must exist, the order's current `dmobile` must equal the link's `receiver_phone`, the order must be Completed and inside the 24 h window. They cannot act on any other order.

## Snapshot additions (`GET /api/track/:token`, state `delivered` only)

```
summary: { driver: { first_name, vehicle_no } | null, pickup: { address } | null, drop: { address } | null, distance_km: number | null },
trip_route: { has_trail: boolean, points: [[lat,lng],...], pickup: {lat,lng}|null, drop: {lat,lng}|null } | null,
pay: { state: "payable" | "paid", amount_due, markup, total } | null,
review: { submitted: boolean },
help: { phone, whatsapp },       // digits only
app_url: string
```

`trip_route` comes from the existing `tripRouteService.buildRoute` (GPS trail of the trip). `pay` comes from `order_receiver_pay` (+ `order_settlement` for the amounts: `amount_due`, `receiver_markup`, total = `amount_due + receiver_markup`); `payable` only while the settlement is `payer = receiver` and `pending`.

## New endpoints (public, token-authorized, rate limited per IP)

- `POST /api/track/:token/pay-link` (10/min): when `pay.state = payable`, mints a fresh pay token for the order **without sending WhatsApp** and returns `{ url }` (`<PUBLIC_BASE_URL>/pay/<token>`); the page redirects the receiver there. The existing `/pay` page does the Razorpay checkout, verification, retry and double-pay protection; nothing about payment is re-implemented. Minting rotates the pay token, so the earlier WhatsApp pay link stops working (accepted; the pay page's existing verify fallback covers a payment already started on the old link). Errors: `NOT_PAYABLE` (409), `NOT_CONFIGURED` (503 when `PUBLIC_BASE_URL` is missing).
- `POST /api/track/:token/review` (10/min): body `{ driver_rating, delivery_rating, tags: string[], comment }`. Ratings are integers 1-5 (at least one required), tags must come from the fixed whitelist (the customer app's ten tags), comment is trimmed and cut to 500 characters. One review per order: a second call answers 409 `ALREADY_SUBMITTED`. Success answers `{ ok: true }`.

## Data

New table `order_receiver_feedback`: `id`, `order_id` (unique), `rider_id`, `receiver_phone`, `driver_rating`, `delivery_rating`, `feedback_tags` (varchar 255), `comment` (text), `created_at`. Migration `20261006020000_add_order_receiver_feedback`. It is separate from `order_customer_feedback` (unique per order, written by the booker) so neither overwrites the other.

## Admin

`GET /receiver-feedback` (same auth, scope, search, rating and date filters as `/customer-feedback`, same row shape minus the vehicle rating) and a third tab "Receiver" on the Trip Feedback page next to Driver and Customer, reusing the customer tab's columns.

## Page behaviour

- The delivered state stays terminal for polling; the existing `visibilitychange` re-fetch refreshes it when the receiver comes back from the pay page (the card then shows "Paid").
- Pay: the button disables while the request runs; on any error a message is shown and the button re-enables; no payment logic runs in the page.
- Review: the form validates in the page and again on the server; on success the form is replaced by the thank-you text and `review.submitted` is true on the next fetch (so a reload does not offer the form again); a 409 is treated as already submitted.
- The route map reuses the page's map code (Leaflet/tiles guarded as today); without Leaflet or tiles the summary, pay, review and help blocks still work.

## Failure behaviour

- Missing trail data: the map shows the pickup and drop pins and the planned distance; no error.
- `PUBLIC_BASE_URL` missing: the Pay button answers "Payment link is not available right now"; the rest of the page is unaffected.
- Reading or writing feedback fails: the endpoint answers 500 with a generic message, the form stays editable.
- Tracking feature flag off: the whole page answers `expired`, so none of this is reachable.

## Testing

- Jest: snapshot (delivered additions present and correct; no money fields without a Receiver-pays row; `pay` states; no `trip_route` outside `delivered`; trail simplification), pay-link endpoint (payable / not payable / missing base URL / rotates the token / sends no WhatsApp), review endpoint (validation, whitelist, comment length, one per order, window, wrong token, wrong order), admin endpoint and filters, the new help and app values.
- Page behaviour tests (the existing fake-DOM harness): theme tokens present and no dark block, the delivered blocks render from a snapshot, Pay posts and redirects, the form submits and then shows the thank-you text, a 409 is handled, and no `innerHTML` with data.
- Manual QA rows appended to `docs/superpowers/plans/2026-10-06-receiver-live-tracking-qa.md`.

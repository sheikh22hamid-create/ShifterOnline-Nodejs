# Receiver live tracking - design

Date: 2026-10-06. Status: draft for review.

## Goal

Every order that has a drop contact number (`pkg_order.dmobile`) gives that receiver a WhatsApp link to a
public web page where they can follow the delivery live, with no app and no login: a moving driver on a
map, a route line, an ETA that keeps refreshing, and a status timeline. It is not limited to Receiver-pays
orders.

Out of scope for v1 (decided with the product owner or deliberately left out):
- Customer app and driver app: no changes.
- Pickup contact (`pmobile`) and intermediate stops of multi-stop orders: only the final drop contact gets the link.
- Paying from the tracking page. A Receiver-pays order keeps its own pay link; the tracking page only says
  that the pay link was sent on WhatsApp.
- A drop-side OTP: the product has none today.

## What the receiver sees

`GET /track/<token>` returns one inline HTML page (same style as the pay page: no build step, light and dark
theme, mobile first). Everything below comes from one JSON snapshot, polled every 5 seconds while the page
is visible.

| Element | Detail |
|---|---|
| Status timeline | Five steps: Driver assigned, Reached pickup, On the way (parcel picked up, the same moment), Reached drop, Delivered. The current step is highlighted. No per-step times except the delivery time (`pkg_order` mixes IST and UTC columns). |
| Driver card | First name, vehicle number, a "Call driver" button (`tel:`). Shown from assignment on. |
| ETA | "Arriving in ~12 min" and "4.2 km away", only while the parcel is on the way. Before pickup the page says "Driver is heading to the pickup point" with no distance. |
| Map | Leaflet. Pickup and drop markers, the route line, and the driver marker rotated by heading and animated between polls. Hidden until the parcel is picked up (see Privacy). |
| Stale location | If the last driver position is older than 2 minutes the marker is greyed and the page says "Waiting for the driver's location". |
| End states | Delivered (shows the delivery time), Cancelled, link expired, link invalid. None of them shows a map. |

The page has to be useful even if the map library or the tiles fail to load: the timeline, ETA and driver
card are plain DOM and keep working.

## Map provider

Leaflet (about 42 KB JS + 14 KB CSS) from cdnjs with an SRI hash, with raster tiles from MapTiler. The tile
URL template and key come from the server config, so the provider can change without touching the page logic.
The key is public by nature (it ships in the page); it must be restricted to the production domain in the
MapTiler dashboard. Google is still used server side for ETA and the route (the browser needs no Google key).

## Link and token

- Table `order_track_link`: `id`, `order_id` (unique), `token` (unique, 32 random bytes as base64url),
  `receiver_phone`, `created_at`, `last_viewed_at`. No `expires_at` / `revoked_at` columns (see Lifecycle).
- The link is created lazily and idempotently (`getOrCreate(orderId, rawPhone)`) the first time a receiver message
  that needs it is built, which is the driver-assigned message. It is the same link for the whole order, so
  later milestone messages repeat it instead of minting a new one.
- The token is stored in plain text. This is deliberate and differs from the pay link (hash only): the link
  has to be re-sent later, it is view-only, and it expires. A DB reader already sees every order anyway.
- Lifecycle: expiry is derived from the order, nothing is stored. The page is `expired` 24 hours after the
  order is Completed and `cancelled` as soon as it is Cancelled, so the receiver is not confused by a 404.
  A link is valid only while the order's current `dmobile` equals the row's `receiver_phone`.
- Changing the receiver number (the `changeReceiverPhone` feature, and the admin order edit) rotates the token
  on the same row for the new number and, if the order already has a driver, sends the new link to the new
  number. The old number's link then answers `invalid` ("link no longer valid").
- When sender and receiver are the same number, no link is added (that person booked in the app).
- Rate limit: reuses `ipRateLimiter` (per IP, rightmost X-Forwarded-For): page 60/min, API 120/min.

## Privacy rules (enforced server side, in the snapshot builder)

- The snapshot never contains the pickup OTP, booker name or phone, fare, payment or wallet data.
- The driver's live position and the route are included only when `order_status = 3` (on the way) and the
  order is not Completed/Cancelled. At statuses 1 and 2 only the timeline, driver card and a generic
  "heading to pickup" line are returned. After Completed no position is returned.
- Addresses are shortened to 80 characters, like the pay page. Coordinates for pickup and drop are returned
  only together with the live map (status 3), because the page does not need them earlier.
- The driver's phone number is returned because every existing receiver WhatsApp message already shows it.
- Responses carry `Cache-Control: no-store` and `X-Robots-Tag: noindex`; the page has `noindex`.

## API

`GET /api/track/:token` returns:

```
{ state: "active" | "delivered" | "cancelled" | "expired" | "invalid",
  order_id, step: 0..5 (0 = no driver yet), steps: [{key, at}],
  driver: { first_name, vehicle_no, phone } | null,
  eta: { minutes, distance_km, updated_at } | null,
  position: { lat, lng, heading, updated_at, stale } | null,
  route: [[lat,lng], ...] | null,
  pickup: {lat,lng,address} | null, drop: {lat,lng,address} | null,
  delivered_at, poll_ms }
```

`invalid` is returned for an unknown token (HTTP 404 with the same body shape). `poll_ms` lets the server
slow clients down (5000 normally, 15000 for non-active states) without a client release.

## Backend pieces

1. `trackLinkService`: `isTokenShape`, `getOrCreate(orderId, rawPhone)` (rotates the token when the phone differs),
   `findByToken`, `buildLink`, `touchViewed`.
2. `trackSnapshotService`: builds the JSON above from `pkg_order`, `tbl_rider`, `order_track_link` and the
   wait timer (arrival at drop = `pkg_order_wait_timer.drop_wait_start`), applying the privacy rules.
3. Live position: `trackingSocket` keeps an in-memory `Map<riderId, {lat,lng,heading,at}>` updated on every
   `driver:location_ping` (not throttled like the DB write). The snapshot reads it first, then falls back to
   `tbl_rider.rlats/rlongs` + `rloc_updated_at`. Single Node process on the VPS today; a second process would
   only see its own pings and fall back to the DB value, which is acceptable.
4. `trackEtaService`: ETA and route driver -> drop using the existing `fetchGoogleDrive` /
   `estimateDrive` from `pickupEtaService`, extended to also return the route polyline (new field mask
   `routes.polyline.geoJsonLinestring` via the `GEO_JSON_LINESTRING` encoding, so no polyline decoder is needed;
   simplified to at most about 150 points).
   Per order cache for 60 seconds, recomputed only when the driver moved more than 150 m or the cache is
   older than 2 minutes, with a single in-flight call per order. The route (pickup -> drop) is cached for
   the order until completion. Without a Google key or on failure it falls back to the straight-line
   estimate and a straight line route.
5. Routes and page: `routes/trackRoutes.js` (page router + API router, mounted at `/track` and `/api/track`
   in `app.js`), `controllers/trackController.js`, `controllers/trackPage.js` (inline HTML and script).
   The page injects the tile URL template through a JSON `<script type="application/json">` block, never by
   string concatenation of untrusted values; all dynamic text is set with `textContent`.
6. WhatsApp (`whatsapp/notifications.js`): the receiver message of driver assigned, reached pickup, trip
   started and reached drop gets a "Track live: <link>" line; `handleTrackingQuery` adds the link for a
   receiver-authorized number. The driver-assigned message to the receiver is new (`notifyDriverAssigned`
   only messaged the sender before) and is sent only when a link exists. The existing milestone
   de-duplication stays. If the link cannot be built (flag off, `PUBLIC_BASE_URL` missing) the messages are sent exactly as today.
7. Settings: new key `receiver_tracking_enabled` (default on) read through the same settings helper style as
   `receiverPaySettings`, plus a toggle on the admin Settings page. Env: `MAPTILER_KEY`, optional
   `MAPTILER_STYLE` (default `streets-v2`); `PUBLIC_BASE_URL` is reused. Without `MAPTILER_KEY` the page
   still works without the map (timeline, ETA, driver card only).
8. Migration `20261006010000_add_order_track_link` and the Prisma model. Not hand-applied columns on `pkg_order`.

## Failure behaviour

- Flag off: no link is created or sent; an existing link answers `expired`.
- Google or the in-memory position missing: ETA and route fall back, the page never errors.
- Snapshot builder throws: the API returns HTTP 500 with `{state:"error"}`; the page keeps showing its
  previous data and retries on the next poll.
- WhatsApp not connected: nothing changes for the order; the receiver simply gets no message (same as today).

## Testing

- Jest: `trackLinkService` (idempotent create, token rotation on a changed number, malformed-token rejection, link building), `trackSnapshotService`
  (privacy gating by status, stale position, delivered/cancelled/expired states, fallbacks),
  `trackEtaService` (cache window, 150 m movement rule, single in-flight call, Google failure fallback),
  controllers (404 shape, headers, rate limiter wiring), page (no untrusted
  interpolation, tile template injected as JSON), WhatsApp message builders (link line present/absent).
- Manual QA checklist (`docs/superpowers/plans/2026-10-06-receiver-live-tracking-qa.md`): a real order from booking to delivery on a phone
  with a weak network, checking each privacy rule and the end states.

## Open questions

None blocking. Two choices are recorded for review: the plain-text token (above) and polling instead of a
socket (decided with the product owner).

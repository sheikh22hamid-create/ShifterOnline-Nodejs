# Customer App (ShifterOnlineFinal) — Node/Socket Integration Design

## Context

The driver app (`ShifterPartnerFinal`, native Java/Android) was already migrated from
legacy PHP/Retrofit calls to direct REST + Socket.io calls against the Node backend
(`backend/`) — see `docs/superpowers/plans/2026-09-02-driver-app-node-socket-integration.md`
and its ledger at `.superpowers/sdd/2026-09-02-driver-app-node-socket-integration/progress.md`.
This spec covers the symmetric integration for the customer app
(`ShifterOnlineFinal`, Flutter), which today talks exclusively to the legacy PHP
backend (`https://admin.shifteronline.com/cust_api/...`).

**Key finding from research:** the Node backend already has full customer-facing
support built and deployed — REST routes (`/api/order/fare-estimate`, `/create`,
`/details`, `/customer-cancel`, `/rate`) and socket events (`order:assigned`,
`order:status_changed`, `order:completed`, `order:no_driver_found`) all already
exist (`backend/src/routes/orderRoutes.js`, `backend/src/sockets/orderSocket.js`,
`backend/src/services/dispatchManager.js`). This is purely a **client-side
integration task** in Flutter, plus one small backend addition (photo upload,
see below) — not new backend design.

## Global Constraints (mirrors the driver-app plan)

- **Photo upload** for order creation gets a small dedicated Node endpoint (new
  backend surface, see §4) rather than staying fully on PHP — the existing
  `pro_image.php` is for the user's *profile* photo and is not reusable for
  order/package photos. This is the one piece of new backend work in this plan.
- **Package/fare listing** (the Model 1-5 picker) stays exactly as it works
  today, on legacy PHP (`packagelist.php`) — out of scope, not touched.
- **Live driver-location map tracking** stays exactly as it works today
  (whatever mechanism `trackingway.dart` currently uses — confirmed NOT
  Firestore in that file; likely PHP polling via `map_info.php`, to be
  confirmed during implementation) — out of scope, not touched. This mirrors
  the driver app's own decision to keep live location on Firestore/PHP; since
  the driver app was never wired to emit `driver:location_ping` to Node, the
  `driver:location_stream` socket event has nothing to relay yet regardless.
- **Payment** (Razorpay etc.) stays on its current path, untouched.
- **Rating** (`rate.php` / Node's `/api/order/rate`) is out of scope for this
  phase — not part of the driver app's scope either, no reason to add scope
  here.
- Every Retrofit-equivalent call this plan touches gets fully replaced, not
  left as dead code alongside a new path (same rule as the driver-app plan).

## Architecture

### Socket connection lifecycle

A `NodeSocketManager`-equivalent singleton in Dart (using the `socket_io_client`
pub package — needs adding to `pubspec.yaml`), connected once when the user is
logged in (app start if a session exists, or right after login), disconnected
on logout. On connect, emits `customer:join` with `{user_id}` (no `order_id`)
— the server (`backend/src/sockets/socketServer.js`'s `rejoinActiveOrderRoomForCustomer`)
automatically finds and joins any order the customer currently has in flight
(`order_status` 0-3) into `order_<id>`, so the client never needs to track
"do I have an active order" itself on reconnect.

**One thing the client must still do manually:** because the connection is
long-lived (connected at login, not per-screen), the socket won't automatically
be in the room for an order that gets created *after* the initial join. So
right after a successful `/api/order/create` response, the client re-emits
`customer:join` with `{user_id, order_id}` (the newly created order's id) to
join that specific `order_<id>` room immediately — otherwise `order:status_changed`
/`order:completed` events (which broadcast to `order_<id>`, not `customer_<uid>`)
would be missed until some other reconnect happened to re-run the auto-rejoin
query.

Screens register and remove their own `socket.on()/off()` listeners directly on
the shared socket object exposed by the singleton — no new state-management
abstraction (Provider/ChangeNotifier) introduced for this; same low-ceremony
pattern the driver app used successfully.

### Events consumed (client listens)

| Event | Room | Payload | Used by |
|---|---|---|---|
| `order:assigned` | `customer_<uid>` | `{order_id, rider_id, rider_name, rider_phone, profile_picture, vehicle_no, rider_lat, rider_lng, otp, order_status, o_status}` | Tracking screen — show assigned driver's details |
| `order:status_changed` | `order_<id>` | `{order_id, order_status, o_status}` | Tracking screen — advance status UI (arrived/pickup/on-route) |
| `order:completed` | `order_<id>` | `{order_id, order_status, o_status}` | Tracking screen — move to rating/summary |
| `order:no_driver_found` | `customer_<uid>` | `{order_id}` | Tracking/order-creation screen — show retry/no-drivers state |

These replace whatever polling/manual-refresh currently drives the equivalent
UI transitions in `trackingway.dart` (exact current mechanism to be confirmed
during implementation — no polling loop was found in that file for order
status specifically, only a `Timer.periodic` for an unrelated on-screen
countdown; the actual refresh trigger needs tracing during the implementation
task, not guessed here).

Existing FCM push notifications for these same events (already implemented
server-side via `pushNotifier.js`) are untouched and keep covering the
backgrounded/killed-app case — same split as the driver app's Task 6 (socket,
foreground) + Task 7 (FCM overlay, background).

## Order Creation

`pickupdrop.dart`'s submission flow (currently one multipart POST to
`pks_order.php` carrying both the order fields and an optional package photo)
changes to:

1. If a photo was attached: upload it via the new Node endpoint (§4 below),
   get back a URL/path.
2. Call Node's `POST /api/order/create` with the order fields as JSON,
   including that URL (or `null`) in the `photos` field.
3. On success, re-emit `customer:join` with the returned `order_id` (see
   above) so the socket is immediately in that order's room.

Package/fare selection (`packagelist.php`) stays untouched, feeding the same
`delivery_type` package-id list into the new create call that it already
feeds into the old one — the request shape Node expects
(`backend/src/controllers/orderController.js`'s `createOrder`) is close enough
to the existing PHP payload that this should be closer to a field-rename than
a rebuild, but exact mapping is an implementation-time detail.

## New Backend Work: Order-Photo Upload Endpoint

**This is the one piece of genuinely new backend code in this plan** (everything
else server-side already exists). Small, scoped addition:

- New route, e.g. `POST /api/order/upload-photo` — accepts a single multipart
  image file (`multer`, a new dependency — not currently used anywhere in
  `backend/`), validates it's an image type and under a size limit (e.g. 5MB),
  stores it under `backend/public/images/order_photos/<generated-name>`, and
  returns `{Result: true, path: "images/order_photos/<generated-name>"}`.
- The stored *relative* path (not a full URL) matches the existing convention
  legacy PHP-stored paths already use (`backend/src/app.js`'s comment on
  `LEGACY_IMAGES_DIR`: paths like `"images/vehicle/x.jpg"`), so it's servable
  immediately via the existing `express.static(path.join(__dirname, "..", "public"))`
  mount with no new serving logic, and stays consistent with whatever already
  reads `pkg_order.photos` elsewhere (admin panel, driver app order details).
- No auth on this endpoint, matching every other customer-facing order route
  in this backend today (documented, accepted gap — see
  `memory/order_dispatch_auth_gap.md`; not something this plan changes).

## Cancel

The "Cancel Order" action in `trackingway.dart` swaps its call from
`pks_cancle.php` to Node's `POST /api/order/customer-cancel`
(`backend/src/controllers/orderController.js` → `tripLifecycle.customerCancel`).
Plain REST, no socket involved — mirrors that reject/cancel-type actions in
the driver app were REST or socket as dictated by the backend's actual
contract per action, not uniformly one or the other.

## Testing / Verification

Same pattern as the driver app: build a debug APK, install on a physical
phone, run live order-creation → assignment → status-progression → completion
flows against the same test-driver account(s) used in the driver-app work,
verifying state via direct DB checks after each step (Prisma scripts), same as
throughout the driver-app SDD process.

**Blocker to resolve before implementation starts:** `ShifterOnlineFinal/` is
currently missing `pubspec.yaml` (the Flutter project manifest) — the app
cannot be built at all without it. This needs to be restored/re-added before
any implementation or testing can happen.

## Out of Scope (explicit, matching driver-app precedent)

- Live driver-location map tracking mechanism (stays as-is).
- Photo upload for anything other than order-package photos (e.g. profile
  photos stay on `pro_image.php`).
- Payment flows (Razorpay, wallet, etc.).
- Rating (`rate.php` / Node's `/api/order/rate`).
- Package/fare listing and pricing display logic.
- Any auth/security hardening of the Node customer-facing routes (pre-existing,
  documented gap, unrelated to this plan).

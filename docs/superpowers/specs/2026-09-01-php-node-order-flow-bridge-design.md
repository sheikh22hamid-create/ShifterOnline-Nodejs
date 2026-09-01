# PHP ↔ Node Order-Flow Bridge — Design

**Date:** 2026-09-01
**Status:** Approved for planning
**Related:** `backend/ORDER_FLOW_NODEJS_SPECIFICATION.md`, `docs/superpowers/plans/2026-08-26-order-dispatch-engine.md`

## Goal

The published customer/driver mobile apps talk to the legacy PHP backend
(`php backend/public_html/admin/{cust_api,rider_api}`) and cannot be changed —
no new app release is in scope. The Node.js backend (`backend/`) already has a
correct, tested order-dispatch engine (cascade batching, driver locking,
atomic accept, round-robin tier rotation — see the order-dispatch-engine plan
and its three recent bug fixes). This design migrates order-flow *ownership*
to Node while keeping every existing app-facing URL and request/response
shape unchanged, so no app code changes are required.

## Current PHP architecture (as found)

Confirmed by reading the PHP source directly (`php backend/public_html/admin/`):

- The app does not use sockets. Real-time delivery to drivers is FCM push
  (`cust_api/firebase_push.php`, FCM v1 API with a service-account JSON),
  and OneSignal for simpler notifications (e.g. "order received").
- Order creation (`cust_api/pks_order.php`) synchronously pushes **Batch 1**
  only. Batches 2–5 are computed and pushed lazily inside
  `cust_api/check_driver.php`, which recalculates "what batch is due now"
  from `NOW()` vs `expires_at` on every call. No cron/scheduled worker in
  this codebase calls that file, and nothing else references it — so it can
  only be driven by **the app itself polling it** after order placement.
  This migration removes that polling dependency; it does not introduce one.
- PHP already writes to the same MySQL tables Node's Prisma layer already
  uses (`pkg_order`, `tbl_order_requests`) — same schema, no data-model gap.
- Live GPS location during an active trip (`cust_api/live_tracking.php` /
  `map_info.php`) is a separate, pre-existing lightweight-polling read
  against the driver's last-known lat/lng. Out of scope — untouched by this
  design.

## Ownership after migration

- **Node owns 100% of order-flow logic**: dispatch cascade, batching,
  driver locking, atomic accept-race, status transitions, cascade
  termination. Single source of truth, single set of DB writes for order
  state.
- **PHP owns 0% of order-flow logic.** Its only remaining responsibilities:
  saving uploaded package photos to local disk during order creation (a
  PHP/webroot-specific concern), and forwarding requests to Node /
  relaying Node's response back unchanged.
- **Sockets stay internal-only** (admin panel dashboard, the driver/customer
  test simulator at `backend/public/index.html`). They do not reach the
  real mobile apps.
- **Push (FCM + OneSignal) is the real-time channel to the real apps**,
  fired directly by Node at the same moments it currently does
  `io.emit(...)`. Every order-lifecycle event (driver popup, order
  assigned, arrived, picked up, completed, cancelled) is push-driven with
  zero polling. Node's own server-side timers (already built into
  `dispatchManager`) drive every batch — no client call is needed to
  advance the cascade, unlike today's PHP polling.

## Scope: 6 endpoints move, reads stay in PHP

Pure reads (order history, live tracking, notifications list) keep querying
the shared MySQL tables directly from PHP — no proxy needed, since Node
writes to the same tables. Only state-changing endpoints move:

| PHP file (URL unchanged) | Node logic it proxies to |
|---|---|
| `cust_api/pks_order.php` | `orderController` create-order |
| `rider_api/accept_order.php` | `tripLifecycle.acceptOrder` |
| `rider_api/reject_order.php` | `tripLifecycle.rejectOrder` |
| `rider_api/order_status_change.php` (arrived/pickup/complete) | `tripLifecycle.updateStatus` |
| `cust_api/pks_cancle.php` / `rider_api/cancel_order.php` | `tripLifecycle.customerCancel` |
| `cust_api/pkg_rate.php` | `tripLifecycle.rateOrder` |

`check_driver.php` is not proxied — its `expireStaleRequests()` and
batch-due-computation/push logic must be **removed**, not wrapped. If left
in place it would independently recompute and re-dispatch batches from
elapsed time, racing Node's own `activeDispatches` state machine and
double-firing pushes. If the app still calls this URL for some other
reason, it may remain as a harmless read-only status check; otherwise it
can be deprecated.

## Components

### 1. Node: legacy-compatible routes

New Express routes (e.g. under `/legacy/order/*`) that:
- Accept the exact `$_POST` field names the app already sends (not Node's
  current internal API's field names/shape).
- Return the exact JSON key names/format the corresponding PHP file
  currently returns, so the app's existing parsing code needs no changes.
- Wrap the existing `orderController`/`tripLifecycle` functions directly —
  no dispatch logic is duplicated here, this is an adapter layer only.

Exact field-by-field request/response mapping for each of the 6 endpoints
is enumerated during implementation planning (each PHP file's current
`$_POST` reads and `echo json_encode(...)` calls are the spec for that
mapping).

### 2. Node: push bridge (`pushNotifier.js`)

- Uses the `firebase-admin` SDK with the same service-account JSON already
  present in `php backend/public_html/admin/` (copy into Node's config,
  do not commit the raw key to a public location — treat like any other
  secret).
- Replicates OneSignal's REST call for the notification types PHP
  currently sends via OneSignal (e.g. "order received").
- Wired into `dispatchManager` at every point that currently does
  `io.to(...).emit("order:request" / "order:dismiss")`, and into
  `tripLifecycle` (`acceptOrder`, `updateStatus`, `customerCancel`) for
  customer-facing lifecycle pushes (assigned, arrived, on route, completed,
  cancelled).
- Payload field names/shape for each push type must match what the app's
  existing push handler already parses (the `$orderData` associative array
  built in `cust_api/pks_order.php` is the reference contract for the
  driver-popup payload).
- Socket emit and push emit fire from the same call site — one is not a
  replacement code path for the other, they're parallel notification
  channels serving different audiences (internal tools vs. real app).

### 3. PHP: thin proxies

Each of the 6 files is reduced to: handle `$_FILES` upload if applicable
(order creation only, saved to local disk exactly as today), `curl` the
same `$_POST` fields (plus any locally-computed values like uploaded image
paths) to the matching Node `/legacy/*` route, and echo Node's JSON
response back unchanged.

### 4. PHP: `check_driver.php` neutered

Remove the batch-dispatch/expire mutation logic as described above.

## Security

These 6 endpoints become the first externally-reachable, state-changing
entry points into Node's `/legacy/*` routes from a separate process. At
minimum: a shared-secret header that the PHP proxy sends and Node verifies
on every `/legacy/*` route, so the routes cannot be hit directly by anyone
who discovers the URL pattern.

This does **not** fix the broader, already-known gap: Node's order/rider
endpoints trust a client-supplied `uid`/`rider_id` with no real per-user
authentication (tracked in memory as the order-dispatch auth gap, deferred
deliberately because nothing hit these endpoints from the open internet).
Once this bridge ships, real production traffic flows through these
endpoints for the first time — that gap should be explicitly re-evaluated
as a follow-up, not silently left as "still fine to defer."

## Error handling

- If Node is unreachable or times out (~5s curl timeout, matching what the
  app already tolerates for these actions), PHP returns a clean failure
  response in the app's existing error shape.
- No silent fallback to the old PHP business logic on a Node failure — that
  would split source-of-truth between two engines and reintroduce exactly
  the races the three recent dispatch fixes closed.

## Testing

- Extend the existing `backend/scripts/test-*.js` pattern with a script
  that drives each of the 6 flows through the **PHP URL** (not Node
  directly), confirming: the proxy round-trip returns the correct shape,
  and pushes actually arrive (FCM/OneSignal call succeeds).
- Run against a staging copy of the PHP site before touching production —
  this is now real user-facing traffic, unlike the simulator-only testing
  done for the dispatch engine fixes so far.

## Explicitly out of scope

- Live GPS location polling (`live_tracking.php`/`map_info.php`) — untouched.
- Any endpoint outside the 6 listed (custom order bidding, advance payment,
  scheduled orders, wallet, coupons, ratings admin flows, etc.).
- Fixing the pre-existing uid/rider_id auth gap (flagged as a follow-up
  risk above, not fixed here).
- Removing PHP entirely / infra-level reverse proxy — ruled out because
  the current hosting only allows PHP-file-level edits, not web-server
  config changes.

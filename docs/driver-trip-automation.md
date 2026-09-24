# Driver trip automation

## Implemented journey

Accept/payment gate → automatic pickup arrival → customer notification and pickup timer → **driver enters customer OTP after goods handover** → automatic pickup completion → next stop/drop navigation → automatic stop/drop arrival → manual stop completion or final handover/payment confirmation.

Arrival never accepts a new order and never marks goods as delivered. Final delivery retains the existing settlement flow and now asks the driver to confirm handover/payment. For the new app, the server also requires recorded drop arrival before completion. Old app clients retain their previous completion contract.

## Arrival policy

`backend/src/services/tripArrivalPolicy.js` requires at least three distinct readings spanning 25 seconds, gaps no greater than 20 seconds, accuracy ≤35 m, speed ≤2.5 m/s, and distance plus accuracy ≤100 m. Unknown speed, mock locations, invalid coordinates, future/stale fixes and drive-bys do not qualify. A normal 10-second GPS cadence usually confirms on the fourth reading. Only the next unfinished destination can qualify.

The Android foreground location service sends observations even while Google Maps is open. Up to 120 observations (normally about 20 minutes) persist per order for reconnect replay. The server stores the confirmation sample time, never the initial proximity time, as arrival time. Older observations are discarded. GPS permissions, a running location service and OS background-service support are required. Manual arrival remains available for bad pins or weak GPS. OTP/manual actions need a connection; they are never shown as successful before server confirmation.

## State and notifications

- `POST /api/order/trip-progress`: `order_id`, `rider_id`, login `device_id`, `action`, optional `otp`, and optional `samples`.
- Actions: `sync`, `arrived`, `pickup`, `arrived_stop_N`, `complete_stop_N`, `arrived_drop`. `verify_otp` preserves old-client compatibility.
- Row-locked transactions serialize progress. Duplicate actions do not restart timers or create additional milestone events. Stop progress and OTP evidence survive process/device restarts.
- Global `order_status=4` still means **cancelled**. Driver `driver_flow_id=4` is derived from the drop timer; global status remains `3` until completion.
- Pickup and unloading seconds share the existing free-wait allowance/rate at settlement. Intermediate stop time is not newly billed.
- A transactional outbox emits user live updates and FCM pushes. Unsent pushes retry with a lease, stable event ID and Android notification tag. This is at-least-once transport, not a promise of exactly-once delivery across a crash between FCM success and DB acknowledgement. Foreground clients deduplicate event IDs.
- Driver gets a local trip notification; customer gets a live banner/push and persistent drop-arrival status. Push taps open the order. A separate receiver SMS/WhatsApp channel is not added.
- Existing admin and pickup/start WhatsApp integrations remain connected. Notification permissions and configured FCM credentials are needed for push delivery.

## Rollout

1. Apply only the new `20260924010000_driver_trip_automation` migration to the intended database with the repository's deployment migration process. Review other pending migrations separately.
2. Generate Prisma client and deploy backend, including the notification retry worker in `server.js`.
3. Install the updated driver app and customer app. Start testing with a fresh trip; older app versions only stored intermediate stop progress locally.
4. On a real device, test pickup/drop while Google Maps is foregrounded, background restrictions, weak GPS, passing nearby without stopping, offline/reconnect, incorrect OTP, app restart, multiple stops and notification taps.

Database migration and deployment were not executed as part of local implementation. Mobile source directories are intentionally ignored by the repository; some files were already tracked, while new/local-only mobile files remain on disk under the existing policy.

## Local checks

Backend policy, progress, notification, controller and existing lifecycle/controller tests; Prisma validation/client generation; Android debug APK build. Customer tracking/notification Dart analysis reports no issues, although the CLI exits with a sandbox telemetry-file permission error afterward. Full Android unit-test run has an unrelated `DemoRideTest.cashAdvanceAndOnlineReconcileWithoutDoubleCountingEarnings` failure (expected -40, got 0); demo settlement code was not changed by this feature. No physical-device GPS or real FCM delivery test has been performed.

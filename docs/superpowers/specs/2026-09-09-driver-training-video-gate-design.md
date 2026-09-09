# Driver Training Video Gate — Design

Status: approved, ready for implementation planning
Date: 2026-09-09

## Problem

New (and existing) drivers should not be able to reach the ride-taking
home screen (`HomeActivity`) until they have watched a mandatory
training video end-to-end. Playback must not be skippable or
seekable in the mandatory flow; only play/pause is allowed. Progress
must persist across app restarts (resume from last watched second,
not from zero), and the driver should see a live completion
percentage. Admin uploads/replaces the video via a link in the admin
panel; if no link is configured, the gate must not appear at all and
drivers go straight to Home. Admin must be able to see, per driver,
how much of the video they've watched.

## Current state (as found in the repo)

The driver app (`ShifterDriver/ShifterDriver`, native Android/Java)
already has a **fully built** mandatory-training player:
`driver/activity/TrainingVideoActivity.java` + layout
`activity_training_video.xml` + model `driver/model/TrainingData.java`.
It already does everything the mandatory flow needs: ExoPlayer with no
seek bar interaction, play/pause only, resume-from-saved-position,
live watch-progress %, local (SharedPreferences) + periodic server
sync of progress, and a completion dialog that unlocks navigation to
`HomeActivity`. **This code is being kept as-is** — no rewrite needed.

Two things are broken:

1. **Wrong backend.** `TrainingVideoActivity` and the login flows call
   `UserService` (`rider_api/get_training_status.php`,
   `save_training_progress.php`, `complete_training.php`) via
   `APIClient` (base URL `https://dev.shifteronline.com/`, the legacy
   PHP admin domain). None of these three PHP files exist in
   `Php Backend/`. Per [[order_flow_direct_app_integration]], the app
   should talk to the Node backend directly (`NodeApiClient`, base URL
   `https://shifteronline-nodejs-dev.onrender.com/`), the same way
   `NodeService.setStatus`/`updateLocation` already do. The PHP bridge
   was deliberately removed elsewhere and must not be recreated here.

2. **Gate bypassed on two of three entry paths.** The gate is only
   wired correctly in `LoginActivity.openHome()` (fresh login → calls
   `getTrainingStatus`, routes to `TrainingVideoActivity` or `HomeActivity`
   accordingly). `FirstActivity.checkAndNavigate()` (app reopen — the
   splash-screen path used every time the driver relaunches the app)
   and `SendOTPActivity` (OTP login for an existing approved driver)
   both contain a `// Training skipped for now -> directly navigate to
   HomeActivity` bypass. Both files already contain a correctly-written
   `checkTrainingGate()` / `checkTrainingGateAndProceed()` method — it's
   just never called. This is exactly the "driver watches 2 min, closes
   app, reopens" case from the request, and today it skips training
   entirely.

Nothing exists yet on the Node backend (no training table, no routes)
or in the admin panel (no video-link field, no per-driver progress
view). [[order_dispatch_auth_gap]] applies here too: driver-facing
endpoints trust `rider_id` in the body, no auth header — this feature
follows that same existing (deliberately deferred) pattern, it does
not introduce new auth.

## Decisions made during brainstorming

- **Re-training policy:** once a driver completes the video, they're
  done permanently. Uploading a new video does not force previously-completed
  drivers to re-watch. Admin can force an individual driver to re-watch
  via a manual reset action (see Extra 2).
- **Video source:** admin pastes a direct playable video URL (MP4/CDN/HLS)
  into the admin panel — no file-upload/storage pipeline. Matches
  `ExoPlayer`'s existing `MediaItem.fromUri(...)` usage and what the
  user asked for ("video link").
- **Extras in scope:** reminder push notification for incomplete
  training, admin manual per-driver reset, and confirming (no code
  change) that completion requires actually reaching the end of the
  video. A video-versioning/force-retrain-everyone policy and a file-upload
  pipeline are explicitly out of scope.

## Architecture

### 1. Data model (`backend/prisma/schema.prisma`)

No schema change needed for the video link itself — reuse the existing
`app_settings` key/value table (already the pattern for feature-flag-style
config, exposed through `settingsController` as `flags`). Two keys:

- `training_video_url`
- `training_video_title`

`training_video_url` empty/absent means training is not required —
this is exactly what `TrainingData.trainingRequired` already checks for
client-side (`getTrainingRequired() == 0`).

One new model for per-driver progress:

```prisma
model driver_training_progress {
  id                      Int       @id @default(autoincrement())
  rider_id                Int       @unique
  video_url               String    @db.Text
  current_position_seconds Int      @default(0)
  total_duration_seconds  Int       @default(0)
  watch_progress          Float     @default(0)
  is_completed            Boolean   @default(false)
  completed_at            DateTime? @db.DateTime(0)
  last_reminded_at        DateTime? @db.DateTime(0)
  updated_at              DateTime  @default(now()) @updatedAt
}
```

`video_url` on the row records which video the driver's progress
belongs to — purely informational under the "once completed, always
done" policy (no gating logic reads it to force a retrain).
`last_reminded_at` supports Extra 1 (one reminder per day, not one per
cron tick).

### 2. Backend APIs

**Driver-facing** (`backend/src/routes/riderRoutes.js`, mounted at
`/api/rider`, no auth — same trust model as `setStatus`/`updateLocation`):

- `POST /api/rider/training/status` — body `{ rider_id }`. Reads
  `app_settings` for the video link/title and the driver's
  `driver_training_progress` row (creates none if missing — absence
  means 0%, not completed). Response shape matches
  `TrainingData.java`'s existing `@SerializedName`s exactly:
  `Result`, `ResponseMsg`, `training_required` (0 if no video URL
  configured, else 1), `video_id` (constant `"training_v1"`, matching
  the app's default), `video_title`, `video_url`, `watch_progress`,
  `current_position_seconds`, `total_duration_seconds`, `is_completed`,
  `completed_at`. Matching this shape means **zero changes** to
  `TrainingVideoActivity`'s JSON handling.
- `POST /api/rider/training/progress` — body `{ rider_id, video_id,
  video_url, watch_progress, current_position_seconds,
  total_duration_seconds }`. Upserts `driver_training_progress`. Never
  sets `is_completed` (that only happens via the complete endpoint,
  which fires only on real `STATE_ENDED`).
- `POST /api/rider/training/complete` — body `{ rider_id, video_id,
  video_url }`. Sets `is_completed = true`, `completed_at = now()`.

**Admin-facing** (`backend/src/routes/adminRoutes.js`, mounted at
`/api/v1/admin`, `auth` + `authorize`):

- Video link config reuses the existing `GET/PUT /api/v1/admin/settings`
  (`flags.training_video_url`, `flags.training_video_title`) — no new
  endpoint.
- `GET /api/v1/admin/training/progress` — list all drivers with a
  `driver_training_progress` row or `training_required = 1`, each with
  `%`, completed/pending status, `updated_at`, `completed_at`. Supports
  a `status` filter (`pending` | `completed`). `authorize(...RIDER_ROLES)`,
  same roles as the existing riders list.
- `POST /api/v1/admin/training/progress/:riderId/reset` — deletes the
  driver's `driver_training_progress` row. `authorize("superadmin",
  "admin")` (destructive, matches the existing block/unblock pattern
  on `PATCH /riders/:id/status`).
- `adminRiderController.getOne` gets one additional field on its
  response: a `training` sub-object (`{ percent, is_completed,
  completed_at }` or `null` if no row) — feeds the detail drawer
  without a separate round-trip.

### 3. Driver app changes

- Add three methods to `NodeService.java` (same interface `NodeApiClient`
  already builds against): `getTrainingStatus`, `saveTrainingProgress`,
  `completeTraining`, posting to the three `/api/rider/training/*`
  paths above with a `Map<String, Object>` body (matching
  `setStatus`/`updateLocation`'s existing style).
- In `TrainingVideoActivity.java`, replace the three
  `APIClient.getInterface().<training call>` invocations with
  `NodeApiClient.getInterface().<same call>` — the surrounding logic
  (state machine, UI, local-cache fallback) is untouched.
- In `FirstActivity.java`: delete the `// Training skipped for now`
  bypass at the approved-driver branch of `checkAndNavigate()`; call
  the existing (currently dead) `checkTrainingGate(riderId)` instead
  of navigating straight to `HomeActivity`. Repoint its internal
  `APIClient` call to `NodeApiClient`.
- In `SendOTPActivity.java`: same fix — the approved-driver branch
  calls `checkTrainingGateAndProceed(riderId)` (already written, dead)
  instead of `openHome()` directly. Repoint to `NodeApiClient`.
- `LoginActivity.openHome()` already does this correctly; just repoint
  its `APIClient` call to `NodeApiClient` for backend consistency.
- **New "rewatch" entry point**: a "Training Video" row in the
  driver's Account/Profile screen (`AccountFragment`/`ProfileActivity`)
  that opens `TrainingVideoActivity` with a new intent extra
  `replay_mode=true`. In replay mode the activity allows normal
  seek-bar scrubbing and exiting at any time (no "must reach 100% to
  leave" lock) — the mandatory-gate behavior is unchanged when this
  extra is absent/false. This needs a small conditional in
  `TrainingVideoActivity` around the seek bar's touch handling and
  `onBackPressed()`/`btnUnlockHome` gating, not a new screen.

### 4. Admin panel changes

- `frontend/src/pages/Settings.jsx`: new `Section` "Driver Training"
  with two `Input`s bound to `flags.training_video_url` /
  `flags.training_video_title`, same pattern as the existing dynamic
  flags block — saved through the existing `PUT /settings` call
  already wired to `handleSave`.
- New admin page (e.g. `frontend/src/pages/DriverTraining.jsx`),
  added to `frontend/src/config/navigation.js`: a table of drivers ×
  `%` × status × last-updated, backed by
  `GET /api/v1/admin/training/progress`, default-sorted
  incomplete-first, with a status filter. Each row has a "Reset
  training" action (superadmin/admin only, confirm modal — destructive,
  same UX as the existing block/delete confirm modals in
  `DriverDetailDrawer.jsx`) calling the new reset endpoint.
- `DriverDetailDrawer.jsx`: one additional `Field` — "Training" —
  showing `percent% (completed on <date> | in progress | not started)`,
  sourced from `getOne`'s new `training` sub-object.

### 5. Extra 1 — reminder notification

- New dependency: `node-cron` (no scheduler infra exists yet in this
  backend — everything under `backend/scripts/` is a manually-run
  one-off script, not a scheduled job).
- New function in `backend/src/services/pushNotifier.js`:
  `notifyDriverTrainingIncomplete(fcmToken)`, same shape as the
  existing `notifyDriver*` functions.
- New daily job registered from `backend/src/app.js` (or a small new
  `backend/src/jobs/trainingReminder.js` required from there): query
  `driver_training_progress` where `is_completed = false` and
  (`last_reminded_at` is null or > 24h old) and the rider has an
  `fcm_token`; send the push; stamp `last_reminded_at = now()`.
  Guarantees at most one reminder per driver per day regardless of
  cron tick frequency.

### 6. Extra 2 — admin manual reset

Covered above: `POST /api/v1/admin/training/progress/:riderId/reset`
+ a confirm-gated button in the admin UI. Deleting the row is
sufficient — the driver-status endpoint already treats "no row" as
0%/not-completed.

### 7. Extra 3 — completion integrity (no code change)

Confirmed and to remain unchanged: `handleTrainingCompleted()` in
`TrainingVideoActivity` only fires from `Player.Listener.onPlaybackStateChanged`
when `playbackState == Player.STATE_ENDED` — i.e., completion requires
actually reaching the end of the video during real playback, not
merely accumulating 99% of watch-progress ticks or seeking to the
end (seeking is disabled in the mandatory flow in the first place).
This is documented here so it isn't accidentally "simplified" away
later.

## Error handling

- No video configured (`training_required = 0`): every driver-facing
  entry point (`LoginActivity`, `FirstActivity`, `SendOTPActivity`)
  routes straight to `HomeActivity`; `TrainingVideoActivity` is never
  opened.
- Training-status network failure: existing fallback behavior (open
  `TrainingVideoActivity`, let it retry / show "contact admin" if the
  video URL comes back empty) is kept as-is — this already exists in
  the current dead code paths and is reasonable: fail toward showing
  the gate rather than silently letting an unverified/untrained driver
  through.
- Progress-sync failures are silent/background (already the existing
  behavior) — local `SharedPreferences` cache remains the source of
  truth for resume position if the server sync temporarily fails.

## Testing

- Backend: unit tests for the three driver endpoints (`training_required`
  toggling on presence/absence of `app_settings` key; progress upsert;
  complete sets `is_completed`/`completed_at`) and the two admin
  endpoints (list shape, reset deletes the row, role authorization),
  following the existing `controllers/__tests__` pattern.
- Backend: unit test for the reminder job's "at most once per 24h"
  logic.
- Driver app: manual verification (per this repo's existing testing
  approach — no Android test suite in scope here) of: fresh registration
  → training gate → Home; app kill mid-video → reopen → resumes from
  saved second; app reopen after prior completion → straight to Home;
  no video configured → straight to Home on all three entry paths;
  replay mode from Account screen allows seek/exit.
- Admin panel: manual verification of saving/clearing the video link,
  progress table reflecting a real driver's watch %, and the reset
  action actually re-triggering the gate for that driver.

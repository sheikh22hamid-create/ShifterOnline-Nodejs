# Driver Training Video Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the mandatory driver-training video gate actually work end-to-end — fix the two broken pieces of the already-built driver-app player (wrong legacy PHP backend, gate silently bypassed on app-reopen and OTP-login), add the missing Node backend and admin-panel support, and add the three approved extras (rewatch section, reminder push, admin manual reset).

**Architecture:** The driver-app training player (`TrainingVideoActivity`) is fully built and correct — it's kept as-is except for repointing its network calls from the legacy PHP `APIClient` to the existing Node `NodeApiClient`, and a small conditional for a non-mandatory "replay" mode. The Node backend gets one new Prisma model (`driver_training_progress`) for per-driver state, reuses the existing `app_settings` key/value table for the single video-link config, and exposes driver-facing endpoints (no auth, matching the existing `riderRoutes.js` trust model) and admin-facing endpoints (JWT + role-gated, matching `adminRoutes.js`). The admin panel gets a new "Driver Training" settings section, a new progress-overview page, and one new field on the existing driver detail drawer.

**Tech Stack:** Node.js/Express/Prisma (MySQL) backend; native Android/Java driver app (ExoPlayer, Retrofit/Gson, view binding); React/Vite admin panel (axios, Tailwind-style inline `var(--token)` styling).

**Spec:** `docs/superpowers/specs/2026-09-09-driver-training-video-gate-design.md`

## Global Constraints

- Driver-facing Node endpoints use **no auth** — they trust `rider_id` in the request body, matching the existing pattern in `backend/src/routes/riderRoutes.js` and `backend/src/controllers/riderController.js` (see `memory/order_dispatch_auth_gap.md`). Do not add JWT/auth middleware to them.
- The driver-facing training endpoints' JSON response shape is **fixed by the existing, unmodified client code** in `TrainingData.java` and must match exactly: `Result` and `ResponseMsg` are JSON **strings** (`"true"`/`"false"`), not booleans, and completion is read from a **string** field `training_status` (`"NOT_STARTED"` | `"IN_PROGRESS"` | `"COMPLETED"`) — there is no `is_completed` boolean on the wire.
- Admin-facing Node endpoints use the existing `{ success, message, data }` convention (see `adminRiderController.js`, `settingsController.js`), `auth` + `authorize(...)` middleware, and — for anything listing drivers — `scopeFilter` for city scoping.
- Once a driver completes training, they stay completed permanently, even if admin later changes the video link. Only an explicit admin "reset" (Task 5) clears a driver's completion.
- No new npm dependencies for the reminder job — follow the existing `setInterval` + service-function sweep pattern already used in `backend/src/server.js` for `tripLifecycle.sweepOverduePickups`, not a cron library.
- Do not modify `TrainingVideoActivity.java`'s core player/progress/UI logic beyond what each task below specifies — it is already correct.

---

## Task 1: `driver_training_progress` Prisma model + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (insert alphabetically between `driver_activity` and `driver_withdraw_requests`, currently around line 96-109)

**Interfaces:**
- Produces: Prisma model `driver_training_progress` with fields `id`, `rider_id` (unique), `video_url`, `current_position_seconds`, `total_duration_seconds`, `watch_progress`, `is_completed`, `completed_at`, `last_reminded_at`, `updated_at` — every later backend task reads/writes this model via `prisma.driver_training_progress.*`.

- [ ] **Step 1: Add the model to schema.prisma**

Insert this block right after the closing `}` of `model driver_activity` (and before `model driver_withdraw_requests`):

```prisma
model driver_training_progress {
  id                        Int       @id @default(autoincrement())
  rider_id                  Int       @unique
  video_url                 String    @db.Text
  current_position_seconds  Int       @default(0)
  total_duration_seconds    Int       @default(0)
  watch_progress            Float     @default(0)
  is_completed              Boolean   @default(false)
  completed_at              DateTime? @db.DateTime(0)
  last_reminded_at          DateTime? @db.DateTime(0)
  updated_at                DateTime  @default(now()) @updatedAt
}
```

- [ ] **Step 2: Run the migration**

Run: `cd backend && npm run prisma:migrate -- --name add_driver_training_progress`
Expected: Prisma creates a new migration under `backend/prisma/migrations/` and applies it to the dev database without errors. If `DATABASE_URL` isn't reachable from this machine, at minimum run `npx prisma validate` to confirm the schema is syntactically correct, and note in the task result that the migration still needs to run against the real dev database.

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd backend && npm run prisma:generate`
Expected: completes without errors; `@prisma/client` now exposes `prisma.driver_training_progress`.

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(db): add driver_training_progress table for the training-video gate"
```

---

## Task 2: Driver-facing training API (`trainingController.js`)

**Files:**
- Create: `backend/src/controllers/trainingController.js`
- Create: `backend/src/controllers/__tests__/trainingController.test.js`
- Modify: `backend/src/routes/riderRoutes.js`

**Interfaces:**
- Consumes: `prisma.app_settings` (existing), `prisma.driver_training_progress` (Task 1)
- Produces: `module.exports = { getStatus, saveProgress, complete, TRAINING_VIDEO_ID }` from `trainingController.js` — Task 6 (driver-app `NodeService`) targets the routes this task wires up: `POST /api/rider/training/status`, `POST /api/rider/training/progress`, `POST /api/rider/training/complete`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/controllers/__tests__/trainingController.test.js`:

```js
jest.mock("../../config/db", () => ({
  app_settings: { findMany: jest.fn() },
  driver_training_progress: { findUnique: jest.fn(), upsert: jest.fn() },
}));

const prisma = require("../../config/db");
const { getStatus, saveProgress, complete } = require("../trainingController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("trainingController.getStatus", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports training_required = 0 when no video URL is configured", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    prisma.driver_training_progress.findUnique.mockResolvedValue(null);

    const req = { body: { rider_id: "5" } };
    const res = makeRes();
    await getStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.training_required).toBe(0);
    expect(payload.training_status).toBe("NOT_STARTED");
    expect(payload.Result).toBe("true");
  });

  it("stays COMPLETED for a driver who already finished, even after the video link changes", async () => {
    prisma.app_settings.findMany.mockResolvedValue([
      { setting_key: "training_video_url", setting_value: "https://cdn.example.com/new-video.mp4" },
      { setting_key: "training_video_title", setting_value: "New Training" },
    ]);
    prisma.driver_training_progress.findUnique.mockResolvedValue({
      rider_id: 5,
      video_url: "https://cdn.example.com/old-video.mp4",
      watch_progress: 100,
      current_position_seconds: 300,
      total_duration_seconds: 300,
      is_completed: true,
      completed_at: new Date("2026-08-01T00:00:00.000Z"),
    });

    const req = { body: { rider_id: "5" } };
    const res = makeRes();
    await getStatus(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.training_required).toBe(1);
    expect(payload.training_status).toBe("COMPLETED");
    expect(payload.video_url).toBe("https://cdn.example.com/new-video.mp4");
  });

  it("rejects a request with no rider_id", async () => {
    const req = { body: {} };
    const res = makeRes();
    await getStatus(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("trainingController.saveProgress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("upserts progress without ever touching is_completed", async () => {
    prisma.driver_training_progress.upsert.mockResolvedValue({});
    const req = {
      body: {
        rider_id: "5",
        video_id: "training_v1",
        video_url: "https://cdn.example.com/video.mp4",
        watch_progress: 42.5,
        current_position_seconds: 120,
        total_duration_seconds: 300,
      },
    };
    const res = makeRes();
    await saveProgress(req, res);

    const call = prisma.driver_training_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ rider_id: 5 });
    expect(call.create).not.toHaveProperty("is_completed");
    expect(call.update).not.toHaveProperty("is_completed");
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("trainingController.complete", () => {
  beforeEach(() => jest.clearAllMocks());

  it("marks the driver completed with a completed_at timestamp", async () => {
    prisma.driver_training_progress.upsert.mockResolvedValue({});
    const req = { body: { rider_id: "5", video_id: "training_v1", video_url: "https://cdn.example.com/video.mp4" } };
    const res = makeRes();
    await complete(req, res);

    const call = prisma.driver_training_progress.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ rider_id: 5 });
    expect(call.update).toMatchObject({ is_completed: true, watch_progress: 100 });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest trainingController -v`
Expected: FAIL — `Cannot find module '../trainingController'`

- [ ] **Step 3: Implement `trainingController.js`**

Create `backend/src/controllers/trainingController.js`:

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");

const TRAINING_VIDEO_ID = "training_v1";
const DEFAULT_VIDEO_TITLE = "Driver Training";

function statusFromProgress(progress) {
  if (!progress) return "NOT_STARTED";
  return progress.is_completed ? "COMPLETED" : "IN_PROGRESS";
}

async function loadVideoConfig() {
  const rows = await prisma.app_settings.findMany({
    where: { setting_key: { in: ["training_video_url", "training_video_title"] } },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
  return {
    videoUrl: byKey.training_video_url || "",
    videoTitle: byKey.training_video_title || DEFAULT_VIDEO_TITLE,
  };
}

/** Driver-facing — see TrainingData.java for the exact wire contract this must match. */
async function getStatus(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    if (!riderId) {
      return res.status(400).json({ ResponseCode: "0", Result: "false", ResponseMsg: "rider_id is required" });
    }

    const [{ videoUrl, videoTitle }, progress] = await Promise.all([
      loadVideoConfig(),
      prisma.driver_training_progress.findUnique({ where: { rider_id: riderId } }),
    ]);

    return res.status(200).json({
      ResponseCode: "1",
      Result: "true",
      ResponseMsg: "Training status fetched",
      rider_id: riderId,
      training_required: videoUrl ? 1 : 0,
      training_status: statusFromProgress(progress),
      video_id: TRAINING_VIDEO_ID,
      video_title: videoTitle,
      video_url: videoUrl,
      watch_progress: progress ? progress.watch_progress : 0,
      current_position_seconds: progress ? progress.current_position_seconds : 0,
      total_duration_seconds: progress ? progress.total_duration_seconds : 0,
      completed_at: progress && progress.completed_at ? progress.completed_at.toISOString() : null,
    });
  } catch (err) {
    logger.error("trainingController.getStatus failed:", err);
    return res.status(500).json({ ResponseCode: "0", Result: "false", ResponseMsg: "Internal server error" });
  }
}

/** Periodic in-video sync — never sets is_completed (only complete() does that). */
async function saveProgress(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    if (!riderId) {
      return res.status(400).json({ ResponseCode: "0", Result: "false", ResponseMsg: "rider_id is required" });
    }

    const videoUrl = req.body.video_url || "";
    const watchProgress = Math.min(100, Math.max(0, Number(req.body.watch_progress) || 0));
    const currentPositionSeconds = Math.max(0, Number(req.body.current_position_seconds) || 0);
    const totalDurationSeconds = Math.max(0, Number(req.body.total_duration_seconds) || 0);

    await prisma.driver_training_progress.upsert({
      where: { rider_id: riderId },
      create: {
        rider_id: riderId,
        video_url: videoUrl,
        watch_progress: watchProgress,
        current_position_seconds: currentPositionSeconds,
        total_duration_seconds: totalDurationSeconds,
      },
      update: {
        video_url: videoUrl,
        watch_progress: watchProgress,
        current_position_seconds: currentPositionSeconds,
        total_duration_seconds: totalDurationSeconds,
      },
    });

    return res.status(200).json({ ResponseCode: "1", Result: "true", ResponseMsg: "Progress saved" });
  } catch (err) {
    logger.error("trainingController.saveProgress failed:", err);
    return res.status(500).json({ ResponseCode: "0", Result: "false", ResponseMsg: "Internal server error" });
  }
}

/** Fires only when playback genuinely reaches the end (see TrainingVideoActivity.handleTrainingCompleted). */
async function complete(req, res) {
  try {
    const riderId = Number(req.body.rider_id);
    if (!riderId) {
      return res.status(400).json({ ResponseCode: "0", Result: "false", ResponseMsg: "rider_id is required" });
    }

    const videoUrl = req.body.video_url || "";

    await prisma.driver_training_progress.upsert({
      where: { rider_id: riderId },
      create: {
        rider_id: riderId,
        video_url: videoUrl,
        watch_progress: 100,
        is_completed: true,
        completed_at: new Date(),
      },
      update: {
        video_url: videoUrl,
        watch_progress: 100,
        is_completed: true,
        completed_at: new Date(),
      },
    });

    return res.status(200).json({ ResponseCode: "1", Result: "true", ResponseMsg: "Training marked complete" });
  } catch (err) {
    logger.error("trainingController.complete failed:", err);
    return res.status(500).json({ ResponseCode: "0", Result: "false", ResponseMsg: "Internal server error" });
  }
}

module.exports = { getStatus, saveProgress, complete, TRAINING_VIDEO_ID };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest trainingController -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire the routes**

In `backend/src/routes/riderRoutes.js`, add the import and three routes:

```js
const express = require("express");
const riderController = require("../controllers/riderController");
const trainingController = require("../controllers/trainingController");

const router = express.Router();

router.get("/test-drivers", riderController.listTestDrivers);
router.get("/:riderId/delivery-types", riderController.getDeliveryTypes);
router.post("/delivery-type", riderController.setDeliveryType);
router.post("/status", riderController.setStatus);
router.post("/location", riderController.updateLocation);
router.post("/isolate-test-drivers", riderController.isolateTestDrivers);

router.post("/training/status", trainingController.getStatus);
router.post("/training/progress", trainingController.saveProgress);
router.post("/training/complete", trainingController.complete);

module.exports = router;
```

- [ ] **Step 6: Manual smoke check**

Run: `cd backend && npm run dev` (in one terminal), then in another:
```bash
curl -X POST http://localhost:5000/api/rider/training/status -H "Content-Type: application/json" -d "{\"rider_id\": 1}"
```
Expected: `200` with `"training_required": 0` (assuming no `training_video_url` app_setting yet) and `"Result": "true"`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/trainingController.js backend/src/controllers/__tests__/trainingController.test.js backend/src/routes/riderRoutes.js
git commit -m "feat(training): add driver-facing training status/progress/complete API"
```

---

## Task 3: Admin training-progress API (`adminTrainingController.js`)

**Files:**
- Create: `backend/src/controllers/adminTrainingController.js`
- Create: `backend/src/controllers/__tests__/adminTrainingController.test.js`
- Modify: `backend/src/routes/adminRoutes.js`

**Interfaces:**
- Consumes: `prisma.tbl_rider`, `prisma.driver_training_progress` (Task 1)
- Produces: `GET /api/v1/admin/training/progress` (optional `?status=pending|completed`), `POST /api/v1/admin/training/progress/:riderId/reset` — Task 14 (admin panel `DriverTraining.jsx`) consumes these.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/controllers/__tests__/adminTrainingController.test.js`:

```js
jest.mock("../../config/db", () => ({
  tbl_rider: { findMany: jest.fn(), findUnique: jest.fn() },
  driver_training_progress: { findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
}));

const prisma = require("../../config/db");
const { listProgress, resetProgress } = require("../adminTrainingController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("adminTrainingController.listProgress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("includes drivers with no progress row as 0%, not completed", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 1, first_name: "A", last_name: "B", full_name: null, fmobile: "999", city_id: 1 }]);
    prisma.driver_training_progress.findMany.mockResolvedValue([]);

    const req = { query: {}, scopedCityId: null };
    const res = makeRes();
    await listProgress(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toEqual([expect.objectContaining({ rider_id: 1, watch_progress: 0, is_completed: false })]);
  });

  it("filters to pending drivers when status=pending", async () => {
    prisma.tbl_rider.findMany.mockResolvedValue([
      { id: 1, full_name: "Done", fmobile: "1", city_id: 1 },
      { id: 2, full_name: "Not done", fmobile: "2", city_id: 1 },
    ]);
    prisma.driver_training_progress.findMany.mockResolvedValue([
      { rider_id: 1, watch_progress: 100, is_completed: true, completed_at: new Date(), updated_at: new Date() },
    ]);

    const req = { query: { status: "pending" }, scopedCityId: null };
    const res = makeRes();
    await listProgress(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].rider_id).toBe(2);
  });
});

describe("adminTrainingController.resetProgress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("deletes the driver's progress row", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ city_id: 1 });
    prisma.driver_training_progress.findUnique.mockResolvedValue({ rider_id: 7 });
    prisma.driver_training_progress.delete.mockResolvedValue({});

    const req = { params: { riderId: "7" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await resetProgress(req, res);

    expect(prisma.driver_training_progress.delete).toHaveBeenCalledWith({ where: { rider_id: 7 } });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("404s when the driver has no progress to reset", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ city_id: 1 });
    prisma.driver_training_progress.findUnique.mockResolvedValue(null);

    const req = { params: { riderId: "7" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await resetProgress(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(prisma.driver_training_progress.delete).not.toHaveBeenCalled();
  });

  it("403s when a city-scoped admin targets a driver outside their city", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ city_id: 2 });

    const req = { params: { riderId: "7" }, user: { role: "admin", city_id: 1 } };
    const res = makeRes();
    await resetProgress(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(prisma.driver_training_progress.delete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest adminTrainingController -v`
Expected: FAIL — `Cannot find module '../adminTrainingController'`

- [ ] **Step 3: Implement `adminTrainingController.js`**

Create `backend/src/controllers/adminTrainingController.js`:

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function riderName(r) {
  return r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;
}

async function listProgress(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;

    const riders = await prisma.tbl_rider.findMany({
      where,
      select: { id: true, first_name: true, last_name: true, full_name: true, fmobile: true, city_id: true },
      orderBy: { id: "desc" },
    });
    const riderIds = riders.map((r) => r.id);

    const progressRows = await prisma.driver_training_progress.findMany({ where: { rider_id: { in: riderIds } } });
    const progressByRider = Object.fromEntries(progressRows.map((p) => [p.rider_id, p]));

    let rows = riders.map((r) => {
      const progress = progressByRider[r.id];
      return {
        rider_id: r.id,
        full_name: riderName(r),
        fmobile: r.fmobile,
        watch_progress: progress ? progress.watch_progress : 0,
        is_completed: progress ? progress.is_completed : false,
        completed_at: progress ? progress.completed_at : null,
        updated_at: progress ? progress.updated_at : null,
      };
    });

    if (req.query.status === "completed") {
      rows = rows.filter((r) => r.is_completed);
    } else if (req.query.status === "pending") {
      rows = rows.filter((r) => !r.is_completed);
    }

    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "adminTraining.listProgress");
  }
}

/** Deletes the driver's progress row — their next status check comes back NOT_STARTED / 0%. */
/** Same rule adminRiderController.toggleStatus applies to any single-rider mutation: an admin/executive can only act within their own city. */
function isScopedOut(req, riderCityId) {
  return req.user.role !== "superadmin" && riderCityId !== parseInt(req.user.city_id, 10);
}

async function resetProgress(req, res) {
  try {
    const riderId = parseInt(req.params.riderId, 10);
    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { city_id: true } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const existing = await prisma.driver_training_progress.findUnique({ where: { rider_id: riderId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "No training progress recorded for this driver" });
    }

    await prisma.driver_training_progress.delete({ where: { rider_id: riderId } });
    return res.status(200).json({ success: true, message: "Training progress reset" });
  } catch (err) {
    return internalError(res, err, "adminTraining.resetProgress");
  }
}

module.exports = { listProgress, resetProgress };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest adminTrainingController -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the routes**

In `backend/src/routes/adminRoutes.js`:

Add the import near the other controller imports (after `const settingsController = ...` on line 13):

```js
const adminTrainingController = require("../controllers/adminTrainingController");
```

Add these two routes right after the `--- Platform Master Settings & Payment Gateways ---` block (after line 122, `router.put("/settings/payment-gateways/:id", ...)`):

```js
// --- Driver Training Progress -------------------------------------------------
router.get("/training/progress", auth, authorize(...RIDER_ROLES), scopeFilter, adminTrainingController.listProgress);
router.post("/training/progress/:riderId/reset", auth, authorize("superadmin", "admin"), adminTrainingController.resetProgress);
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminTrainingController.js backend/src/controllers/__tests__/adminTrainingController.test.js backend/src/routes/adminRoutes.js
git commit -m "feat(training): add admin training-progress list and reset endpoints"
```

---

## Task 4: Surface training status on the existing driver-detail endpoint

**Files:**
- Modify: `backend/src/controllers/adminRiderController.js:106-147` (the `getOne` function)
- Create: `backend/src/controllers/__tests__/adminRiderController.test.js`

**Interfaces:**
- Consumes: `prisma.driver_training_progress` (Task 1)
- Produces: `GET /api/v1/admin/riders/:id` response gains a `training` field (`{ percent, is_completed, completed_at }` or `null`) — Task 13 (`DriverDetailDrawer.jsx`) reads this.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/__tests__/adminRiderController.test.js`:

```js
jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  tbl_city: { findUnique: jest.fn() },
  tbl_personal_doc: { findFirst: jest.fn() },
  tbl_vehicle_details: { findMany: jest.fn() },
  tbl_bank_account: { findMany: jest.fn() },
  tbl_eme_contact: { findFirst: jest.fn() },
  tbl_kit: { findFirst: jest.fn() },
  driver_training_progress: { findUnique: jest.fn() },
}));

const prisma = require("../../config/db");
const { getOne } = require("../adminRiderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("adminRiderController.getOne", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 3, city_id: 1, first_name: "A", last_name: "B", full_name: null });
    prisma.tbl_city.findUnique.mockResolvedValue({ title: "City" });
    prisma.tbl_personal_doc.findFirst.mockResolvedValue(null);
    prisma.tbl_vehicle_details.findMany.mockResolvedValue([]);
    prisma.tbl_bank_account.findMany.mockResolvedValue([]);
    prisma.tbl_eme_contact.findFirst.mockResolvedValue(null);
    prisma.tbl_kit.findFirst.mockResolvedValue(null);
  });

  it("includes a null training field when the driver has no progress row", async () => {
    prisma.driver_training_progress.findUnique.mockResolvedValue(null);

    const req = { params: { id: "3" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await getOne(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.training).toBeNull();
  });

  it("includes percent/completion when a progress row exists", async () => {
    prisma.driver_training_progress.findUnique.mockResolvedValue({
      watch_progress: 55.5,
      is_completed: false,
      completed_at: null,
    });

    const req = { params: { id: "3" }, user: { role: "superadmin", city_id: 1 } };
    const res = makeRes();
    await getOne(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.data.training).toEqual({ percent: 55.5, is_completed: false, completed_at: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest adminRiderController -v`
Expected: FAIL — `payload.data.training` is `undefined`, not `null`/the expected object.

- [ ] **Step 3: Extend `getOne`**

In `backend/src/controllers/adminRiderController.js`, change the `Promise.all` at line 106 to also fetch training progress, and add the `training` field to the response object.

Replace:
```js
    const [cityName, personalDoc, vehicleDetails, bankAccounts, emergencyContact, kit] = await Promise.all([
      rider.city_id ? prisma.tbl_city.findUnique({ where: { id: rider.city_id }, select: { title: true } }) : null,
      prisma.tbl_personal_doc.findFirst({ where: { rider_id: id } }),
      prisma.tbl_vehicle_details.findMany({ where: { rider_id: id } }),
      prisma.tbl_bank_account.findMany({ where: { rider_id: id } }),
      prisma.tbl_eme_contact.findFirst({ where: { rider_id: id } }),
      prisma.tbl_kit.findFirst({ where: { rider_id: id } }),
    ]);
```

with:
```js
    const [cityName, personalDoc, vehicleDetails, bankAccounts, emergencyContact, kit, trainingProgress] = await Promise.all([
      rider.city_id ? prisma.tbl_city.findUnique({ where: { id: rider.city_id }, select: { title: true } }) : null,
      prisma.tbl_personal_doc.findFirst({ where: { rider_id: id } }),
      prisma.tbl_vehicle_details.findMany({ where: { rider_id: id } }),
      prisma.tbl_bank_account.findMany({ where: { rider_id: id } }),
      prisma.tbl_eme_contact.findFirst({ where: { rider_id: id } }),
      prisma.tbl_kit.findFirst({ where: { rider_id: id } }),
      prisma.driver_training_progress.findUnique({ where: { rider_id: id } }),
    ]);
```

Then, inside the `data: { ... }` object in the response (right after the `kit,` line at line 145), add:
```js
        kit,
        training: trainingProgress
          ? { percent: trainingProgress.watch_progress, is_completed: trainingProgress.is_completed, completed_at: trainingProgress.completed_at }
          : null,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest adminRiderController -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/adminRiderController.js backend/src/controllers/__tests__/adminRiderController.test.js
git commit -m "feat(training): surface training progress on the driver detail endpoint"
```

---

## Task 5: Reminder push for incomplete training

**Files:**
- Modify: `backend/src/services/pushNotifier.js`
- Modify: `backend/src/config/constants.js`
- Create: `backend/src/services/trainingReminder.js`
- Create: `backend/src/services/__tests__/trainingReminder.test.js`
- Modify: `backend/src/server.js`

**Interfaces:**
- Consumes: `prisma.driver_training_progress`, `prisma.tbl_rider` (existing), `sendPushNotification` from `config/firebase.js` (existing)
- Produces: `services/trainingReminder.js` exports `sweepIncompleteTraining()` — called from `server.js`'s `setInterval`, same pattern as `tripLifecycle.sweepOverduePickups`.

- [ ] **Step 1: Add the notification function**

In `backend/src/services/pushNotifier.js`, add this function (after `notifyDriverPickupTimeoutCancel`, before `module.exports`):

```js
/** See trainingReminder.sweepIncompleteTraining — nudges a driver who hasn't finished mandatory training. */
async function notifyDriverTrainingIncomplete(fcmToken) {
  return sendPushNotification(
    fcmToken,
    "Complete Your Training",
    "Finish your mandatory training video to start accepting orders and earning.",
    { type: "training_reminder" }
  );
}
```

Update the `module.exports` block to include it:

```js
module.exports = {
  notifyDriverOrderRequest,
  notifyDriverDismiss,
  notifyCustomerOrderAssigned,
  notifyCustomerNoDriverFound,
  notifyCustomerPickupTimeoutCancel,
  notifyDriverPickupTimeoutCancel,
  notifyDriverTrainingIncomplete,
};
```

- [ ] **Step 2: Add the two new constants**

In `backend/src/config/constants.js`, add before the closing `};` (after `PICKUP_TIMEOUT_SWEEP_INTERVAL_MS: 60 * 1000,`):

```js

  // Training reminder sweep — how often the sweep runs vs. how long it
  // waits before re-reminding the same driver. A 1h sweep interval with a
  // 24h cooldown means each incomplete driver gets at most one push a day.
  TRAINING_REMINDER_SWEEP_INTERVAL_MS: 60 * 60 * 1000,
  TRAINING_REMINDER_COOLDOWN_MS: 24 * 60 * 60 * 1000,
```

- [ ] **Step 3: Write the failing tests**

Create `backend/src/services/__tests__/trainingReminder.test.js`:

```js
jest.mock("../../config/db", () => ({
  driver_training_progress: { findMany: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
}));
jest.mock("../pushNotifier", () => ({ notifyDriverTrainingIncomplete: jest.fn() }));

const prisma = require("../../config/db");
const { notifyDriverTrainingIncomplete } = require("../pushNotifier");
const { sweepIncompleteTraining } = require("../trainingReminder");

describe("trainingReminder.sweepIncompleteTraining", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reminds a driver who hasn't been reminded yet and has an fcm token", async () => {
    prisma.driver_training_progress.findMany.mockResolvedValue([{ rider_id: 9, last_reminded_at: null }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "token-abc" });
    notifyDriverTrainingIncomplete.mockResolvedValue({ sent: true });
    prisma.driver_training_progress.update.mockResolvedValue({});

    await sweepIncompleteTraining();

    expect(notifyDriverTrainingIncomplete).toHaveBeenCalledWith("token-abc");
    expect(prisma.driver_training_progress.update).toHaveBeenCalledWith({
      where: { rider_id: 9 },
      data: { last_reminded_at: expect.any(Date) },
    });
  });

  it("skips a driver with no fcm token without crashing the sweep", async () => {
    prisma.driver_training_progress.findMany.mockResolvedValue([{ rider_id: 9, last_reminded_at: null }]);
    prisma.tbl_rider.findUnique.mockResolvedValue({ fcm_token: "" });

    await sweepIncompleteTraining();

    expect(notifyDriverTrainingIncomplete).not.toHaveBeenCalled();
    expect(prisma.driver_training_progress.update).not.toHaveBeenCalled();
  });

  it("keeps sweeping the rest of the batch if one driver's lookup throws", async () => {
    prisma.driver_training_progress.findMany.mockResolvedValue([
      { rider_id: 1, last_reminded_at: null },
      { rider_id: 2, last_reminded_at: null },
    ]);
    prisma.tbl_rider.findUnique.mockRejectedValueOnce(new Error("db down")).mockResolvedValueOnce({ fcm_token: "token-2" });
    notifyDriverTrainingIncomplete.mockResolvedValue({ sent: true });
    prisma.driver_training_progress.update.mockResolvedValue({});

    await sweepIncompleteTraining();

    expect(notifyDriverTrainingIncomplete).toHaveBeenCalledTimes(1);
    expect(notifyDriverTrainingIncomplete).toHaveBeenCalledWith("token-2");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd backend && npx jest trainingReminder -v`
Expected: FAIL — `Cannot find module '../trainingReminder'`

- [ ] **Step 5: Implement `trainingReminder.js`**

Create `backend/src/services/trainingReminder.js`:

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { notifyDriverTrainingIncomplete } = require("./pushNotifier");
const { TRAINING_REMINDER_COOLDOWN_MS } = require("../config/constants");

/** Nudges drivers who started training but haven't finished, at most once per TRAINING_REMINDER_COOLDOWN_MS. */
async function sweepIncompleteTraining() {
  const cutoff = new Date(Date.now() - TRAINING_REMINDER_COOLDOWN_MS);
  let candidates;
  try {
    candidates = await prisma.driver_training_progress.findMany({
      where: {
        is_completed: false,
        OR: [{ last_reminded_at: null }, { last_reminded_at: { lte: cutoff } }],
      },
    });
  } catch (err) {
    logger.error("sweepIncompleteTraining: failed to query incomplete progress rows:", err);
    return;
  }

  for (const row of candidates) {
    try {
      const rider = await prisma.tbl_rider.findUnique({ where: { id: row.rider_id }, select: { fcm_token: true } });
      if (!rider || !rider.fcm_token) continue;

      await notifyDriverTrainingIncomplete(rider.fcm_token);
      await prisma.driver_training_progress.update({
        where: { rider_id: row.rider_id },
        data: { last_reminded_at: new Date() },
      });
    } catch (err) {
      logger.error(`sweepIncompleteTraining: failed for rider ${row.rider_id}:`, err);
    }
  }
}

module.exports = { sweepIncompleteTraining };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && npx jest trainingReminder -v`
Expected: PASS (3 tests)

- [ ] **Step 7: Register the sweep in `server.js`**

In `backend/src/server.js`, add the import near the other service imports (after `const tripLifecycle = require("./services/tripLifecycle");`):

```js
const trainingReminder = require("./services/trainingReminder");
```

Change the constants import to also pull the new one:

```js
const { PICKUP_TIMEOUT_SWEEP_INTERVAL_MS, TRAINING_REMINDER_SWEEP_INTERVAL_MS } = require("./config/constants");
```

Add a second `setInterval` after the existing `sweepOverduePickups` one at the bottom of the file:

```js

// Training-incomplete reminder push — see trainingReminder.sweepIncompleteTraining
// doc comment for the once-per-24h-per-driver guarantee.
setInterval(() => {
  trainingReminder.sweepIncompleteTraining().catch((err) =>
    logger.error("sweepIncompleteTraining interval failed:", err)
  );
}, TRAINING_REMINDER_SWEEP_INTERVAL_MS);
```

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/pushNotifier.js backend/src/config/constants.js backend/src/services/trainingReminder.js backend/src/services/__tests__/trainingReminder.test.js backend/src/server.js
git commit -m "feat(training): remind drivers with incomplete training once a day via push"
```

---

## Task 6: Driver app — add training endpoints to `NodeService`

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/retrofit/NodeService.java`

**Interfaces:**
- Produces: `NodeService.getTrainingStatus(Map)`, `NodeService.saveTrainingProgress(Map)`, `NodeService.completeTraining(Map)` — Task 7, 8, 9, 10 call these via `NodeApiClient.getInterface()`.

- [ ] **Step 1: Add the three methods**

Replace the full contents of `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/retrofit/NodeService.java` with:

```java
package com.shifter.driver.retrofit;

import com.google.gson.JsonObject;

import java.util.Map;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.POST;

/**
 * Node backend REST endpoints the driver app needs outside the socket
 * connection — see backend/API_INTEGRATION_GUIDE.md §4. No auth header:
 * the Node backend trusts rider_id in the body (see
 * memory/order_dispatch_auth_gap.md).
 */
public interface NodeService {

    @POST("api/rider/status")
    Call<JsonObject> setStatus(@Body Map<String, Object> body);

    @POST("api/rider/location")
    Call<JsonObject> updateLocation(@Body Map<String, Object> body);

    @POST("api/rider/training/status")
    Call<JsonObject> getTrainingStatus(@Body Map<String, Object> body);

    @POST("api/rider/training/progress")
    Call<JsonObject> saveTrainingProgress(@Body Map<String, Object> body);

    @POST("api/rider/training/complete")
    Call<JsonObject> completeTraining(@Body Map<String, Object> body);
}
```

- [ ] **Step 2: Commit**

```bash
git add "ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/retrofit/NodeService.java"
git commit -m "feat(driver-app): add training endpoints to NodeService"
```

---

## Task 7: Driver app — repoint `TrainingVideoActivity` to Node + add replay mode

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/TrainingVideoActivity.java`

**Interfaces:**
- Consumes: `NodeApiClient.getInterface().{getTrainingStatus,saveTrainingProgress,completeTraining}` (Task 6)
- Produces: a new `replay_mode` boolean intent extra this activity honors — Task 11 (`AccountFragment`) launches it with `replay_mode=true`.

This task edits one file with several distinct changes. Apply them in order; there is no separate test harness for this Android app (see spec's Testing section) — verification is the build + manual check in Step 7.

- [ ] **Step 1: Swap imports**

At the top of `TrainingVideoActivity.java`, replace:

```java
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
```

with:

```java
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import retrofit2.Call;
```

Also replace the import `import com.shifter.driver.retrofit.APIClient;` with `import com.shifter.driver.retrofit.NodeApiClient;`.

- [ ] **Step 2: Add the `replay_mode` field and read it**

Add a field alongside the other instance fields (near `private boolean hasRestoredPosition = false;`):

```java
    private boolean isReplayMode = false;
```

In `initIntentExtras()`, add one line at the end of the method body (after the existing `isCompleted = intent.getBooleanExtra(...)` line, still inside the `if (intent != null)` block):

```java
            isReplayMode = intent.getBooleanExtra("replay_mode", false);
```

- [ ] **Step 3: Enable ExoPlayer's native controller in replay mode**

In `onCreate()`, right after the `initIntentExtras();` call, add:

```java
        if (isReplayMode) {
            binding.touchBlocker.setVisibility(View.GONE);
            binding.playerView.setUseController(true);
        }
```

- [ ] **Step 4: Let a completed driver actually see the video in replay mode**

In the `callback()` method's `GET_STATUS` branch, replace:

```java
                        // If already completed on server, go straight to home
                        if (isCompleted) {
                            navigateToHome();
                            return;
                        }
```

with:

```java
                        // If already completed on server, go straight to home —
                        // unless this is a replay-mode rewatch, which is the
                        // whole point of opening the activity for a completed driver.
                        if (isCompleted && !isReplayMode) {
                            navigateToHome();
                            return;
                        }
```

- [ ] **Step 5: Let replay mode exit any time**

Replace the `btnUnlockHome` click listener inside `setupClickListeners()`:

```java
        // Unlock Home Button
        binding.btnUnlockHome.setOnClickListener(v -> {
            if (isCompleted || watchProgress >= 99.0f) {
                navigateToHome();
            } else {
                Toast.makeText(this, "Please watch the video 100% to unlock Home Dashboard", Toast.LENGTH_SHORT).show();
            }
        });
```

with:

```java
        // Unlock Home Button — in replay mode, always allowed to exit.
        binding.btnUnlockHome.setOnClickListener(v -> {
            if (isReplayMode) {
                navigateToHome();
            } else if (isCompleted || watchProgress >= 99.0f) {
                navigateToHome();
            } else {
                Toast.makeText(this, "Please watch the video 100% to unlock Home Dashboard", Toast.LENGTH_SHORT).show();
            }
        });
```

Replace `onBackPressed()`:

```java
    @Override
    public void onBackPressed() {
        if (isCompleted) {
            navigateToHome();
        } else {
            new AlertDialog.Builder(this)
                    .setTitle("Training Incomplete")
                    .setMessage("Watching this training video is mandatory before accessing delivery orders. Your progress (" + Math.round(watchProgress) + "%) is saved. Are you sure you want to exit?")
                    .setPositiveButton("Exit App", (dialog, which) -> finish())
                    .setNegativeButton("Continue Watching", null)
                    .show();
        }
    }
```

with:

```java
    @Override
    public void onBackPressed() {
        if (isReplayMode || isCompleted) {
            navigateToHome();
        } else {
            new AlertDialog.Builder(this)
                    .setTitle("Training Incomplete")
                    .setMessage("Watching this training video is mandatory before accessing delivery orders. Your progress (" + Math.round(watchProgress) + "%) is saved. Are you sure you want to exit?")
                    .setPositiveButton("Exit App", (dialog, which) -> finish())
                    .setNegativeButton("Continue Watching", null)
                    .show();
        }
    }
```

Add a replay badge/label branch at the top of `updateUI()`:

```java
    private void updateUI() {
        if (isReplayMode) {
            binding.tvStatusBadge.setText("REPLAY");
            binding.tvStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.purple_500));
            binding.tvStatusBadge.setBackgroundResource(R.drawable.bg_badge_orange_light);
            binding.btnUnlockHome.setText("Close");
            binding.btnUnlockHome.setAlpha(1.0f);
            binding.btnUnlockHome.setBackgroundResource(R.drawable.rounded_button_green);
            return;
        }
        if (isCompleted || watchProgress >= 99.0f) {
```

(Keep the rest of the existing `updateUI()` body — that opening `if` line already exists; you're only adding the new `if (isReplayMode) { ... return; }` block immediately before it.)

- [ ] **Step 6: Repoint the three network calls and skip the completion dialog in replay mode**

Replace `fetchTrainingStatus()`'s body-construction block:

```java
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", String.valueOf(riderData.getId()));
            jsonObject.put("rid", String.valueOf(riderData.getId()));
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getTrainingStatus(body);
```

with:

```java
        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderData.getId());

        Call<JsonObject> call = NodeApiClient.getInterface().getTrainingStatus(body);
```

Replace `saveProgressToServer()`'s body-construction block:

```java
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("rid", riderData.getId());
            jsonObject.put("video_id", videoId);
            jsonObject.put("video_url", videoUrl);
            jsonObject.put("watch_progress", progress);
            jsonObject.put("current_position_seconds", currentPosSec);
            jsonObject.put("total_duration_seconds", durationSec);
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().saveTrainingProgress(body);
```

with:

```java
        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderData.getId());
        body.put("video_id", videoId);
        body.put("video_url", videoUrl);
        body.put("watch_progress", progress);
        body.put("current_position_seconds", currentPosSec);
        body.put("total_duration_seconds", durationSec);

        Call<JsonObject> call = NodeApiClient.getInterface().saveTrainingProgress(body);
```

Replace `handleTrainingCompleted()` in full:

```java
    private void handleTrainingCompleted() {
        isCompleted = true;
        watchProgress = 100.0f;
        updateUI();

        if (riderData != null) {
            saveLocalProgress(totalDurationSeconds, 100.0f);

            JSONObject jsonObject = new JSONObject();
            try {
                jsonObject.put("rider_id", riderData.getId());
                jsonObject.put("rid", riderData.getId());
                jsonObject.put("video_id", videoId);
                jsonObject.put("video_url", videoUrl);
            } catch (JSONException e) {
                e.printStackTrace();
            }

            RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            Call<JsonObject> call = APIClient.getInterface().completeTraining(body);
            GetResult getResult = new GetResult();
            getResult.setMyListener(this);
            getResult.callForLogin(call, "COMPLETE_TRAINING");
        }

        // Show Success Celebration Dialog
        new AlertDialog.Builder(this)
                .setTitle("🎉 Training Completed!")
                .setMessage("Congratulations! You have successfully completed the mandatory driver training. Your Home dashboard is now unlocked.")
                .setPositiveButton("Go To Home", (dialog, which) -> navigateToHome())
                .setCancelable(false)
                .show();
    }
```

with:

```java
    private void handleTrainingCompleted() {
        isCompleted = true;
        watchProgress = 100.0f;
        updateUI();

        if (riderData != null) {
            saveLocalProgress(totalDurationSeconds, 100.0f);

            Map<String, Object> body = new HashMap<>();
            body.put("rider_id", riderData.getId());
            body.put("video_id", videoId);
            body.put("video_url", videoUrl);

            Call<JsonObject> call = NodeApiClient.getInterface().completeTraining(body);
            GetResult getResult = new GetResult();
            getResult.setMyListener(this);
            getResult.callForLogin(call, "COMPLETE_TRAINING");
        }

        if (isReplayMode) {
            navigateToHome();
            return;
        }

        // Show Success Celebration Dialog
        new AlertDialog.Builder(this)
                .setTitle("🎉 Training Completed!")
                .setMessage("Congratulations! You have successfully completed the mandatory driver training. Your Home dashboard is now unlocked.")
                .setPositiveButton("Go To Home", (dialog, which) -> navigateToHome())
                .setCancelable(false)
                .show();
    }
```

- [ ] **Step 7: Build to verify no compile errors**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug` (or open in Android Studio and build)
Expected: `BUILD SUCCESSFUL` — no references to the removed `APIClient`/`JSONObject`/`RequestBody`/`MediaType` symbols remain in this file, and `NodeApiClient`/`Map`/`HashMap` resolve correctly.

- [ ] **Step 8: Commit**

```bash
git add "ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/TrainingVideoActivity.java"
git commit -m "fix(driver-app): point training video to Node backend, add replay mode"
```

---

## Task 8: Driver app — fix the app-reopen bypass in `FirstActivity`

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/FirstActivity.java`

**Interfaces:**
- Consumes: `NodeApiClient.getInterface().getTrainingStatus` (Task 6)

- [ ] **Step 1: Swap imports**

Replace:

```java
import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.TrainingData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
```

with:

```java
import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.TrainingData;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.SessionManager;

import java.util.HashMap;
import java.util.Map;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
```

- [ ] **Step 2: Actually call the training gate**

In `checkAndNavigate()`, replace:

```java
                // Training skipped for now -> directly navigate to HomeActivity
                proceedToIntent(new Intent(FirstActivity.this, HomeActivity.class));
```

with:

```java
                checkTrainingGate(riderData.getId());
```

- [ ] **Step 3: Repoint `checkTrainingGate`'s network call**

Replace:

```java
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", String.valueOf(riderId));
            jsonObject.put("rid", String.valueOf(riderId));
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getTrainingStatus(body);
```

with:

```java
        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderId);

        Call<JsonObject> call = NodeApiClient.getInterface().getTrainingStatus(body);
```

- [ ] **Step 4: Build to verify no compile errors**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add "ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/FirstActivity.java"
git commit -m "fix(driver-app): enforce the training gate when the app is reopened"
```

---

## Task 9: Driver app — fix the OTP-login bypass in `SendOTPActivity`

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/SendOTPActivity.java`

**Interfaces:**
- Consumes: `NodeApiClient.getInterface().getTrainingStatus` (Task 6)

- [ ] **Step 1: Add the new imports**

Add these two imports at the top of `SendOTPActivity.java`, alongside the existing `import com.shifter.driver.retrofit.APIClient;` line (keep that one — it's still used elsewhere in this file for OTP send/resend):

```java
import com.shifter.driver.retrofit.NodeApiClient;

import java.util.HashMap;
import java.util.Map;
```

- [ ] **Step 2: Actually call the training gate**

Replace:

```java
            if (allVerify != null && "approved".equalsIgnoreCase(allVerify)) {
                // Training skipped for now -> directly navigate to HomeActivity
                openHome();
            } else {
```

with:

```java
            if (allVerify != null && "approved".equalsIgnoreCase(allVerify)) {
                checkTrainingGateAndProceed(riderData.getId());
            } else {
```

- [ ] **Step 3: Repoint `checkTrainingGateAndProceed`'s network call**

Replace:

```java
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", String.valueOf(riderId));
            jsonObject.put("rid", String.valueOf(riderId));
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getTrainingStatus(body);
```

with:

```java
        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderId);

        Call<JsonObject> call = NodeApiClient.getInterface().getTrainingStatus(body);
```

- [ ] **Step 4: Build to verify no compile errors**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add "ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/SendOTPActivity.java"
git commit -m "fix(driver-app): enforce the training gate on OTP login for existing drivers"
```

---

## Task 10: Driver app — repoint `LoginActivity`'s already-correct gate to Node

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/LoginActivity.java`

**Interfaces:**
- Consumes: `NodeApiClient.getInterface().getTrainingStatus` (Task 6)

`LoginActivity.openHome()` already calls the gate correctly (unlike Tasks 8/9) — this task only repoints its network call, no control-flow change.

- [ ] **Step 1: Add the new imports**

Add near the existing `import com.shifter.driver.retrofit.APIClient;` (find it near the top of the file; keep that import if `APIClient` is used elsewhere in this file, which it is for the login call itself):

```java
import com.shifter.driver.retrofit.NodeApiClient;

import java.util.HashMap;
import java.util.Map;
```

- [ ] **Step 2: Repoint `openHome()`'s network call**

Replace:

```java
            JSONObject jsonObject = new JSONObject();
            try {
                jsonObject.put("rider_id", String.valueOf(riderId));
                jsonObject.put("rid", String.valueOf(riderId));
            } catch (Exception ignored) {}

            RequestBody body = RequestBody.create(
                    MediaType.parse("application/json"), jsonObject.toString());

            custPrograssbar.prograssCreate(this);
            APIClient.getInterface().getTrainingStatus(body).enqueue(new retrofit2.Callback<JsonObject>() {
```

with:

```java
            Map<String, Object> body = new HashMap<>();
            body.put("rider_id", riderId);

            custPrograssbar.prograssCreate(this);
            NodeApiClient.getInterface().getTrainingStatus(body).enqueue(new retrofit2.Callback<JsonObject>() {
```

- [ ] **Step 3: Build to verify no compile errors**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add "ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/activity/LoginActivity.java"
git commit -m "fix(driver-app): point LoginActivity's training gate check to Node backend"
```

---

## Task 11: Driver app — "Training Video" rewatch entry point

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/res/layout/fragment_account.xml`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/fragment/AccountFragment.java`

**Interfaces:**
- Produces: launches `TrainingVideoActivity` with `replay_mode=true` (consumes Task 7's behavior)

- [ ] **Step 1: Add the menu row to the layout**

In `fragment_account.xml`, insert this block right after the `lvl_refer_earn` `</LinearLayout>` and its following divider `<View android:layout_width="15dp" android:layout_height="1dp" />` (i.e., right before the `lvl_payoutlist` block), matching the existing row pattern exactly:

```xml
            <!-- Training Video -->
            <LinearLayout
                android:id="@+id/lvl_training"
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center"
                android:padding="10dp">

                <ImageView
                    android:layout_width="25dp"
                    android:layout_height="25dp"
                    android:padding="2dp"
                    android:src="@drawable/ic_youtube_play" />

                <TextView
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginLeft="5dp"
                    android:layout_weight="1"
                    android:text="Training Video"
                    android:textColor="@color/black"
                    android:textSize="15dp"
                    android:textStyle="bold" />

                <ImageView
                    android:layout_width="100dp"
                    android:layout_height="wrap_content"
                    android:src="@drawable/arow_right" />
            </LinearLayout>

            <View
                android:layout_width="15dp"
                android:layout_height="1dp" />

```

- [ ] **Step 2: Wire the click listener**

In `AccountFragment.java`, add the import:

```java
import com.shifter.driver.activity.TrainingVideoActivity;
```

Add the listener registration in `onCreateView()`, alongside the other `setOnClickListener` calls:

```java
        binding.lvlEdit.setOnClickListener(this::onBindClick);
        binding.lvlLogout.setOnClickListener(this::onBindClick);
        binding.lvlLanguage.setOnClickListener(this::onBindClick);
        binding.lvlPremiumPlans.setOnClickListener(this::onBindClick);
        binding.lvlReferEarn.setOnClickListener(this::onBindClick);
        binding.lvlTraining.setOnClickListener(this::onBindClick);
```

Add the branch in `onBindClick()`:

```java
        } else if (id == R.id.lvl_refer_earn) {
            showReferTypeDialog();

        } else if (id == R.id.lvl_training) {
            Intent i = new Intent(getActivity(), TrainingVideoActivity.class);
            i.putExtra("replay_mode", true);
            startActivity(i);

        } else if (id == R.id.lvl_setting) {
```

- [ ] **Step 3: Build to verify no compile errors**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL` — `binding.lvlTraining` resolves (view-binding auto-generates it from `@+id/lvl_training`).

- [ ] **Step 4: Manual verification**

Install the debug build, sign in as an already-approved/completed driver, open Account tab, tap "Training Video". Expected: video opens with native ExoPlayer seek bar visible, can scrub freely, "Close" button and back-press both exit to Home immediately regardless of position.

- [ ] **Step 5: Commit**

```bash
git add "ShifterDriver/ShifterDriver/app/src/main/res/layout/fragment_account.xml" "ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/fragment/AccountFragment.java"
git commit -m "feat(driver-app): add Training Video rewatch entry point to Account screen"
```

---

## Task 12: Admin panel — video link configuration in Settings

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

**Interfaces:**
- Consumes: existing `PUT /settings` with `flags.training_video_url` / `flags.training_video_title` (already generic — no backend change needed, per Global Constraints)

- [ ] **Step 1: Add the section**

In `frontend/src/pages/Settings.jsx`, insert a new `Section` between the existing `"Referral defaults"` section (ends at line 179) and the `"Payment methods"` `<section>` (starts at line 181):

```jsx
        <Section title="Driver Training">
          <div>
            <Label htmlFor="training_video_url">Training video URL</Label>
            <Input
              id="training_video_url"
              placeholder="https://cdn.example.com/driver-training.mp4"
              value={flags.training_video_url ?? ''}
              onChange={(e) => setFlags((f) => ({ ...f, training_video_url: e.target.value }))}
            />
          </div>
          <div>
            <Label htmlFor="training_video_title">Training video title</Label>
            <Input
              id="training_video_title"
              placeholder="Driver Training"
              value={flags.training_video_title ?? ''}
              onChange={(e) => setFlags((f) => ({ ...f, training_video_title: e.target.value }))}
            />
          </div>
        </Section>

```

This binds directly into the same `flags` state and `handleSave` (`api.put('/settings', { ...form, ...paymentMethods, flags })`) already wired at the top of `SettingsForm` — no other change needed. Leaving `training_video_url` empty and saving clears it (empty string), which is what makes the driver-side `training_required` flag turn to `0`.

- [ ] **Step 2: Manual verification**

Run: `cd frontend && npm run dev`, open Settings as superadmin, fill in "Training video URL" with a real playable MP4 URL, save, reload the page — the value should persist (confirms the round-trip through `GET /settings` → `flags.training_video_url` → this input).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "feat(admin): add driver training video link configuration to Settings"
```

---

## Task 13: Admin panel — training field on the driver detail drawer

**Files:**
- Modify: `frontend/src/components/drivers/DriverDetailDrawer.jsx`

**Interfaces:**
- Consumes: `training` field on `GET /riders/:id` response (Task 4)

- [ ] **Step 1: Add the field**

In `DriverDetailDrawer.jsx`, inside the "Profile" `section` (lines 136-148), add one more `Field` after the existing `Joined` field:

```jsx
                <Field label="Mobile" value={<span className="font-mono-data">{rider.fmobile}</span>} />
                <Field label="Email" value={rider.email} />
                <Field label="Vehicle" value={rider.vehicle} />
                <Field label="Plate no." value={<span className="font-mono-data">{rider.vehicle_no}</span>} />
                <Field label="Wallet" value={<span className="font-mono-data">{formatCurrency(rider.wallet_balance)}</span>} />
                <Field label="Joined" value={formatDateTime(rider.rdate)} />
                <Field
                  label="Training"
                  value={
                    !rider.training
                      ? 'Not started'
                      : rider.training.is_completed
                        ? `Completed — ${formatDateTime(rider.training.completed_at)}`
                        : `${Math.round(rider.training.percent)}% in progress`
                  }
                />
```

- [ ] **Step 2: Manual verification**

Open Drivers Fleet, click into a driver with no training progress — should show "Not started". After that driver watches part of the video in the app (or after seeding a test row), reopen the drawer — should show "N% in progress" or "Completed — <date>".

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/drivers/DriverDetailDrawer.jsx
git commit -m "feat(admin): show training progress on the driver detail drawer"
```

---

## Task 14: Admin panel — Driver Training progress page

**Files:**
- Create: `frontend/src/pages/DriverTraining.jsx`
- Modify: `frontend/src/config/navigation.js`
- Modify: `frontend/src/App.jsx`

**Interfaces:**
- Consumes: `GET /training/progress?status=...` and `POST /training/progress/:riderId/reset` (Task 3)

- [ ] **Step 1: Create the page**

Create `frontend/src/pages/DriverTraining.jsx`:

```jsx
import { useCallback, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import useApiQuery from '../hooks/useApiQuery'
import Badge from '../components/common/Badge'
import Modal from '../components/common/Modal'
import { formatDateTime } from '../utils/format'

export default function DriverTraining() {
  const { hasRole } = useAuth()
  const toast = useToast()
  const canReset = hasRole('superadmin', 'admin')

  const [status, setStatus] = useState('')
  const [resetTarget, setResetTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  const fetcher = useCallback(() => api.get('/training/progress', { params: { status: status || undefined } }).then((res) => res.data), [status])
  const { data, loading, error, refetch } = useApiQuery(fetcher)
  const rows = data?.data ?? []

  async function handleReset() {
    if (!resetTarget) return
    setBusy(true)
    try {
      await api.post(`/training/progress/${resetTarget.rider_id}/reset`)
      toast.success(`Training reset for ${resetTarget.full_name || `Driver #${resetTarget.rider_id}`}.`)
      setResetTarget(null)
      refetch()
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not reset training.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
        Driver Training
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
        Mandatory training-video completion per driver. Configure the video link under Platform Settings.
      </p>

      <div className="mt-4 flex gap-2">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--ink)' }}
        >
          <option value="">All drivers</option>
          <option value="pending">Pending / in progress</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      <div className="surface-card mt-4 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {['Driver', 'Progress', 'Status', 'Last updated', ''].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={5} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No drivers match this filter.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr key={r.rider_id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div style={{ color: 'var(--ink)' }}>{r.full_name || `Driver #${r.rider_id}`}</div>
                      <div className="font-mono-data text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
                        {r.fmobile}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {Math.round(r.watch_progress)}%
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={r.is_completed ? 'success' : 'warning'}>{r.is_completed ? 'Completed' : 'Pending'}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {r.updated_at ? formatDateTime(r.updated_at) : '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {canReset && (
                        <button
                          type="button"
                          onClick={() => setResetTarget(r)}
                          className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[12px] font-medium"
                          style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
                        >
                          <RotateCcw size={12} /> Reset
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        open={!!resetTarget}
        onClose={() => setResetTarget(null)}
        title="Reset training"
        footer={
          <>
            <button type="button" onClick={() => setResetTarget(null)} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={handleReset} className="rounded-lg px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: 'var(--danger)' }}>
              {busy ? 'Resetting…' : 'Reset training'}
            </button>
          </>
        }
      >
        <p className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          This clears {resetTarget?.full_name || `Driver #${resetTarget?.rider_id}`}'s training progress. They'll be required to watch the training video again from the beginning before reaching the Home dashboard.
        </p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `frontend/src/App.jsx`, add the lazy import near the other page imports (after `const Customers = lazy(() => import('./pages/Customers'))`):

```js
const DriverTraining = lazy(() => import('./pages/DriverTraining'))
```

Add the route after `<Route path="/customers" element={<Customers />} />`:

```jsx
            <Route path="/driver-training" element={<DriverTraining />} />
```

- [ ] **Step 3: Add the nav entry**

In `frontend/src/config/navigation.js`, add `GraduationCap` to the `lucide-react` import list:

```js
import {
  LayoutDashboard,
  Radar,
  Package,
  CalendarClock,
  Users,
  ShieldCheck,
  UserCircle,
  GraduationCap,
  Tag,
```

Add the nav item to the `'Operations'` group, right after the `/drivers` entry:

```js
      { to: '/drivers', label: 'Drivers Fleet', icon: Users, roles: ALL_STAFF, built: true },
      { to: '/driver-training', label: 'Driver Training', icon: GraduationCap, roles: ALL_STAFF, built: true },
      { to: '/kyc', label: 'KYC Approval Dock', icon: ShieldCheck, roles: ALL_STAFF, built: true },
```

- [ ] **Step 4: Manual verification**

Run: `cd frontend && npm run dev`, sign in, confirm "Driver Training" appears in the sidebar under Operations, the table loads (empty state if no drivers have progress yet), the status filter works, and (as superadmin/admin) the Reset button on a row with progress opens the confirm modal and actually clears that driver's row (verify via the driver detail drawer showing "Not started" afterward).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/DriverTraining.jsx frontend/src/App.jsx frontend/src/config/navigation.js
git commit -m "feat(admin): add Driver Training progress overview page"
```

---

## Post-implementation checklist

- [ ] End-to-end manual pass on a real device/emulator: fresh driver registration → KYC approved → training gate appears → watch a few seconds → kill the app → reopen → resumes from saved position (not zero) → finish video → lands on Home → kill and reopen the app again → goes straight to Home (no re-gate).
- [ ] Clear the `training_video_url` setting in admin panel → confirm a driver who reaches the gate now goes straight to Home instead.
- [ ] Confirm `npx jest` passes cleanly for the whole `backend/` suite (not just the new files), in case any shared mock/module surface was touched.

# Driver Contact-Referral (Lead) — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the backend half of the driver contact-referral feature —
drivers submit phone leads, admins verify them by phone call, a
matching signup auto-creates a `source: "lead"` referral that reuses
the existing reward/favorite-driver machinery.

**Architecture:** One new Prisma model (`tbl_driver_lead`) plus two
small columns on existing referral tables. Two new controllers
(driver-facing submit/list, admin-facing verify queue) wired into the
existing route files. One new call site inside
`customerAuthController.register` that matches a verified lead by
phone and creates a normal `tbl_referral` row (so
`referralRewardService` needs only a one-line branch, not new logic).
A `setInterval` sweep (matching the existing `tripLifecycle` sweep
pattern in `server.js`) expires stale verified leads.

**Tech Stack:** Node/Express, Prisma (MySQL), Jest (existing test
convention: `jest.mock("../../config/db", ...)`, no real DB in tests).

**Spec:** `docs/superpowers/specs/2026-09-18-driver-contact-referral-design.md`

## Global Constraints

- Mobile-app-facing endpoints (driver app) return `{ Result, ResponseCode, ResponseMsg, ... }` with HTTP 200 even on business-logic failure — this matches every existing `riderController.js`/`riderAuthController.js` endpoint. Do not use REST-style 4xx/5xx for these.
- Admin-panel-facing endpoints return `{ success, message?, data? }` with real HTTP status codes — this matches `referralController.js`. Do not mix the two response shapes.
- Driver identity on driver-app endpoints comes from `req.body.rider_id` (or `rid`), not JWT — matches `riderController.applyReferral`. Admin endpoints use the existing `auth` + `authorize(...)` middleware from `backend/src/middleware/`.
- `tbl_user.mobile` is stored as `Float`/`Number`; `tbl_rider.fmobile` is stored as `String` (`Text`). Any phone matching logic must normalize both sides to digits-only strings before comparing.
- No migrations directory currently exists in `backend/prisma/`; run `npx prisma migrate dev --name <name>` to create one, per the existing `prisma:migrate` script in `backend/package.json`.

---

### Task 1: Schema — `tbl_driver_lead` + referral columns

**Files:**
- Modify: `backend/prisma/schema.prisma` (add new model near `tbl_referral`, ~line 794; add columns to `tbl_referral` at line 778 and `tbl_referral_setting` at line 812)

**Interfaces:**
- Produces: Prisma model `tbl_driver_lead` with fields `id, driver_id, name, phone, status, submitted_at, verified_at, verified_by_admin_id, expires_at, converted_user_id, converted_at`. Status values used by later tasks: `"pending"`, `"verified"`, `"rejected"`, `"converted"`, `"expired"`.
- Produces: `tbl_referral.source` (String, default `"code"`) — later tasks read/write `"lead"` for lead-based referrals, existing rows keep `"code"`.
- Produces: `tbl_referral_setting.lead_referral_points` (Int, default 100) and `lead_verification_window_days` (Int, default 45).

- [ ] **Step 1: Add the new columns to existing models**

In `backend/prisma/schema.prisma`, inside `model tbl_referral { ... }` (starts line 778), add one field after `status`:

```prisma
model tbl_referral {
  id             Int       @id @default(autoincrement())
  referrer_id    Int
  referrer_type  String    @default("USER") @db.VarChar(10)
  referred_id    Int
  referred_type  String    @default("USER") @db.VarChar(10)
  referral_code  String    @db.VarChar(20)
  status         String    @default("pending") @db.VarChar(15)
  source         String    @default("code") @db.VarChar(10)
  points_awarded Int       @default(0)
  ride_id        Int       @default(0)
  registered_at  DateTime  @db.DateTime(0)
  verified_at    DateTime? @db.DateTime(0)

  @@unique([referred_id, referred_type], map: "uniq_referred")
  @@index([referrer_id, referrer_type], map: "idx_referrer")
  @@index([status], map: "idx_status")
}
```

In `model tbl_referral_setting { ... }` (starts line 812), add two fields after `driver_points_per_referral`:

```prisma
model tbl_referral_setting {
  id                            Int       @id @default(autoincrement())
  user_points_per_referral      Int       @default(100)
  driver_points_per_referral    Int       @default(100)
  lead_referral_points          Int       @default(100)
  lead_verification_window_days Int       @default(45)
  point_value                   Decimal   @default(1.00) @db.Decimal(10, 2)
  referral_enabled              Boolean   @default(true)
  share_message                 String?   @db.Text
  updated_at                    DateTime? @db.DateTime(0)
}
```

- [ ] **Step 2: Add the new `tbl_driver_lead` model**

Add this new model directly after `tbl_referral_point_log` (around line 810), before `tbl_referral_setting`:

```prisma
model tbl_driver_lead {
  id                    Int       @id @default(autoincrement())
  driver_id             Int
  name                  String    @db.VarChar(150)
  phone                 String    @unique(map: "uniq_lead_phone") @db.VarChar(20)
  status                String    @default("pending") @db.VarChar(15)
  submitted_at          DateTime  @db.DateTime(0)
  verified_at           DateTime? @db.DateTime(0)
  verified_by_admin_id  Int?
  expires_at            DateTime? @db.DateTime(0)
  converted_user_id     Int?
  converted_at          DateTime? @db.DateTime(0)

  @@index([driver_id], map: "idx_lead_driver")
  @@index([status], map: "idx_lead_status")
}
```

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name add_driver_lead`
Expected: migration created and applied, `backend/node_modules/.prisma/client` regenerated (Prisma runs `generate` automatically after `migrate dev`).

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat: add tbl_driver_lead model and lead-referral schema columns"
```

---

### Task 2: Driver-side lead submission + listing

**Files:**
- Create: `backend/src/controllers/driverLeadController.js`
- Modify: `backend/src/routes/riderRoutes.js` (add two routes near the existing `check-referral`/`apply-referral` lines, ~line 46-47)
- Test: `backend/src/controllers/__tests__/driverLeadController.test.js`

**Interfaces:**
- Consumes: `prisma.tbl_driver_lead`, `prisma.tbl_user`, `prisma.tbl_rider` (from `../config/db`).
- Produces: `module.exports = { submitLeads, listMyLeads }`, mounted at `POST /rider/leads` and `GET /rider/leads`. Response shape for both: `{ Result: "true"|"false", ResponseCode, ResponseMsg, ...extra }`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/controllers/__tests__/driverLeadController.test.js`:

```javascript
jest.mock("../../config/db", () => ({
  tbl_driver_lead: { findMany: jest.fn(), findFirst: jest.fn(), createMany: jest.fn(), create: jest.fn() },
  tbl_user: { findFirst: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
}));

const prisma = require("../../config/db");
const { submitLeads, listMyLeads } = require("../driverLeadController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("driverLeadController.submitLeads", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_user.findFirst.mockResolvedValue(null);
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);
    prisma.tbl_driver_lead.create.mockResolvedValue({ id: 1 });
  });

  it("rejects with no rider_id", async () => {
    const res = mockRes();
    await submitLeads({ body: { rider_id: 0, contacts: [{ name: "A", phone: "9998887771" }] } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", ResponseCode: "400" }));
  });

  it("accepts a new, unregistered, unclaimed number", async () => {
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "9998887771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ driver_id: 55, name: "Ravi", phone: "9998887771", status: "pending" }),
    });
    const payload = res.json.mock.calls[0][0];
    expect(payload.Result).toBe("true");
    expect(payload.accepted).toBe(1);
    expect(payload.skipped).toHaveLength(0);
  });

  it("skips a number already registered as a customer", async () => {
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 9 });
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "9998887771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.accepted).toBe(0);
    expect(payload.skipped[0]).toEqual(expect.objectContaining({ phone: "9998887771", reason: "already_registered" }));
  });

  it("skips a number another driver already submitted", async () => {
    prisma.tbl_driver_lead.findFirst.mockResolvedValue({ id: 3, driver_id: 999 });
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "9998887771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).not.toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.skipped[0]).toEqual(expect.objectContaining({ phone: "9998887771", reason: "already_submitted" }));
  });

  it("strips non-digit characters from phone before matching/storing", async () => {
    const res = mockRes();
    await submitLeads({ body: { rider_id: 55, contacts: [{ name: "Ravi", phone: "+91 999-888-7771" }] } }, res);

    expect(prisma.tbl_driver_lead.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone: "919998887771" }) })
    );
  });
});

describe("driverLeadController.listMyLeads", () => {
  it("returns this driver's leads only", async () => {
    prisma.tbl_driver_lead.findMany.mockResolvedValue([{ id: 1, driver_id: 55, name: "Ravi", phone: "1", status: "pending" }]);
    const res = mockRes();
    await listMyLeads({ query: { rider_id: "55" } }, res);

    expect(prisma.tbl_driver_lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { driver_id: 55 } })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true" }));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest driverLeadController -v`
Expected: FAIL — `Cannot find module '../driverLeadController'`

- [ ] **Step 3: Implement the controller**

Create `backend/src/controllers/driverLeadController.js`:

```javascript
const prisma = require("../config/db");
const logger = require("../utils/logger");

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

/** Driver bulk-submits phone contacts as referral leads (POST /rider/leads) */
async function submitLeads(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || req.body?.rid || 0);
    const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];

    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required." });
    if (!contacts.length) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "At least one contact is required." });

    let accepted = 0;
    const skipped = [];
    const now = new Date();

    for (const contact of contacts) {
      const name = String(contact?.name || "").trim();
      const phone = normalizePhone(contact?.phone);
      if (!phone || phone.length < 6) {
        skipped.push({ phone: contact?.phone || "", reason: "invalid_phone" });
        continue;
      }

      // Digits-only comparison on both sides: tbl_user.mobile is numeric,
      // tbl_rider.fmobile is free-text, neither guaranteed to match a raw
      // string with punctuation/country-code formatting differences.
      const [existingUser, existingRider, existingLead] = await Promise.all([
        prisma.tbl_user.findFirst({ where: { mobile: Number(phone) } }),
        prisma.tbl_rider.findFirst({ where: { fmobile: phone } }),
        prisma.tbl_driver_lead.findFirst({ where: { phone } }),
      ]);

      if (existingUser || existingRider) {
        skipped.push({ phone, reason: "already_registered" });
        continue;
      }
      if (existingLead) {
        skipped.push({ phone, reason: "already_submitted" });
        continue;
      }

      await prisma.tbl_driver_lead.create({
        data: { driver_id: riderId, name: name || phone, phone, status: "pending", submitted_at: now },
      });
      accepted += 1;
    }

    return res.status(200).json({
      Result: "true",
      ResponseCode: "200",
      ResponseMsg: `${accepted} contact(s) submitted, ${skipped.length} skipped.`,
      accepted,
      skipped,
    });
  } catch (err) {
    logger.error("driverLeadController.submitLeads failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

/** Driver views their own submitted leads and current status (GET /rider/leads) */
async function listMyLeads(req, res) {
  try {
    const riderId = Number(req.query?.rider_id || req.query?.rid || 0);
    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required." });

    const leads = await prisma.tbl_driver_lead.findMany({
      where: { driver_id: riderId },
      orderBy: { id: "desc" },
    });

    return res.status(200).json({ Result: "true", ResponseCode: "200", ResponseMsg: "OK", leads });
  } catch (err) {
    logger.error("driverLeadController.listMyLeads failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

module.exports = { submitLeads, listMyLeads };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest driverLeadController -v`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Wire the routes**

In `backend/src/routes/riderRoutes.js`, add near line 47 (after `apply-referral`):

```javascript
const driverLeadController = require("../controllers/driverLeadController");
router.post("/leads", driverLeadController.submitLeads);
router.get("/leads", driverLeadController.listMyLeads);
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/driverLeadController.js backend/src/controllers/__tests__/driverLeadController.test.js backend/src/routes/riderRoutes.js
git commit -m "feat: add driver lead submission and listing endpoints"
```

---

### Task 3: Admin verification queue

**Files:**
- Create: `backend/src/controllers/adminDriverLeadController.js`
- Modify: `backend/src/routes/adminRoutes.js` (add near the existing referral routes, ~line 173)
- Test: `backend/src/controllers/__tests__/adminDriverLeadController.test.js`

**Interfaces:**
- Consumes: `prisma.tbl_driver_lead`, `prisma.tbl_referral_setting` (for `lead_verification_window_days`).
- Produces: `module.exports = { listLeads, verifyLead, rejectLead }`, mounted at `GET /admin/driver-leads`, `POST /admin/driver-leads/:id/verify`, `POST /admin/driver-leads/:id/reject`. Response shape: `{ success, message?, data? }` matching `referralController.js`.

- [ ] **Step 1: Write the failing tests**

Create `backend/src/controllers/__tests__/adminDriverLeadController.test.js`:

```javascript
jest.mock("../../config/db", () => ({
  tbl_driver_lead: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
}));

const prisma = require("../../config/db");
const { listLeads, verifyLead, rejectLead } = require("../adminDriverLeadController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("adminDriverLeadController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("listLeads defaults to pending status", async () => {
    prisma.tbl_driver_lead.findMany.mockResolvedValue([]);
    const res = mockRes();
    await listLeads({ query: {} }, res);
    expect(prisma.tbl_driver_lead.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "pending" } })
    );
  });

  it("verifyLead sets status verified with an expiry from settings", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue({ id: 5, status: "pending" });
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({ lead_verification_window_days: 30 });
    prisma.tbl_driver_lead.update.mockResolvedValue({ id: 5, status: "verified" });
    const res = mockRes();

    await verifyLead({ params: { id: "5" }, user: { id: 77 } }, res);

    const call = prisma.tbl_driver_lead.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 5 });
    expect(call.data.status).toBe("verified");
    expect(call.data.verified_by_admin_id).toBe(77);
    const daysDiff = Math.round((call.data.expires_at - call.data.verified_at) / (24 * 60 * 60 * 1000));
    expect(daysDiff).toBe(30);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("verifyLead 404s on unknown id", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue(null);
    const res = mockRes();
    await verifyLead({ params: { id: "999" }, user: { id: 77 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("verifyLead rejects a lead that isn't pending", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue({ id: 5, status: "converted" });
    const res = mockRes();
    await verifyLead({ params: { id: "5" }, user: { id: 77 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_driver_lead.update).not.toHaveBeenCalled();
  });

  it("rejectLead sets status rejected", async () => {
    prisma.tbl_driver_lead.findUnique.mockResolvedValue({ id: 5, status: "pending" });
    prisma.tbl_driver_lead.update.mockResolvedValue({ id: 5, status: "rejected" });
    const res = mockRes();

    await rejectLead({ params: { id: "5" }, user: { id: 77 } }, res);

    expect(prisma.tbl_driver_lead.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({ status: "rejected", verified_by_admin_id: 77 }),
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx jest adminDriverLeadController -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the controller**

Create `backend/src/controllers/adminDriverLeadController.js`:

```javascript
const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

/** Admin queue of leads awaiting a verification call (GET /admin/driver-leads) */
async function listLeads(req, res) {
  try {
    const status = req.query?.status || "pending";
    const leads = await prisma.tbl_driver_lead.findMany({
      where: { status },
      orderBy: { submitted_at: "asc" },
    });
    return res.status(200).json({ success: true, data: leads });
  } catch (err) {
    return internalError(res, err, "adminDriverLeads.listLeads");
  }
}

/** Admin marks a lead verified after the phone call (POST /admin/driver-leads/:id/verify) */
async function verifyLead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const lead = await prisma.tbl_driver_lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.status !== "pending") return res.status(400).json({ success: false, message: `Lead is already ${lead.status}` });

    const settings = await prisma.tbl_referral_setting.findFirst();
    const windowDays = settings?.lead_verification_window_days || 45;
    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.tbl_driver_lead.update({
      where: { id },
      data: { status: "verified", verified_at: verifiedAt, expires_at: expiresAt, verified_by_admin_id: req.user?.id },
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return internalError(res, err, "adminDriverLeads.verifyLead");
  }
}

/** Admin marks a lead rejected after the phone call (POST /admin/driver-leads/:id/reject) */
async function rejectLead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const lead = await prisma.tbl_driver_lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.status !== "pending") return res.status(400).json({ success: false, message: `Lead is already ${lead.status}` });

    const updated = await prisma.tbl_driver_lead.update({
      where: { id },
      data: { status: "rejected", verified_at: new Date(), verified_by_admin_id: req.user?.id },
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return internalError(res, err, "adminDriverLeads.rejectLead");
  }
}

module.exports = { listLeads, verifyLead, rejectLead };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx jest adminDriverLeadController -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Wire the routes**

In `backend/src/routes/adminRoutes.js`, add near line 173 (after `referrals/adjust-points`):

```javascript
const adminDriverLeadController = require("../controllers/adminDriverLeadController");
router.get("/driver-leads", auth, authorize(...RIDER_ROLES), adminDriverLeadController.listLeads);
router.post("/driver-leads/:id/verify", auth, authorize(...RIDER_ROLES), adminDriverLeadController.verifyLead);
router.post("/driver-leads/:id/reject", auth, authorize(...RIDER_ROLES), adminDriverLeadController.rejectLead);
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminDriverLeadController.js backend/src/controllers/__tests__/adminDriverLeadController.test.js backend/src/routes/adminRoutes.js
git commit -m "feat: add admin driver-lead verification queue endpoints"
```

---

### Task 4: Signup match — convert a verified lead into a referral

**Files:**
- Modify: `backend/src/controllers/customerAuthController.js` (inside `register`, after `newUser` is created — currently lines 200-269)
- Test: `backend/src/controllers/__tests__/customerAuthController.leadMatch.test.js`

**Interfaces:**
- Consumes: `prisma.tbl_driver_lead.findFirst`, `prisma.tbl_driver_lead.update`, `prisma.tbl_referral.create`, `prisma.tbl_favorite_driver.findFirst/create` (already imported in this file).
- Produces: when a signup's phone matches a `verified`, non-expired lead, a `tbl_referral` row is created with `source: "lead"`, the lead is marked `converted`, and a `tbl_favorite_driver` row is created for (driver, new user) — mirroring the existing normal-referral-code favorite-add at lines 257-267.

- [ ] **Step 1: Write the failing test**

Create `backend/src/controllers/__tests__/customerAuthController.leadMatch.test.js`. This tests only the new branch in isolation by calling `register` with a mocked `prisma` — follow the existing mocking style used elsewhere in this file's test suite (check `backend/src/controllers/__tests__/riderController.test.js` for the project's `jest.mock` idiom on `../../config/db` if one for `customerAuthController` doesn't already exist).

```javascript
jest.mock("../../config/db", () => ({
  tbl_user: { findFirst: jest.fn(), create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
  tbl_referral: { create: jest.fn() },
  tbl_favorite_driver: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  tbl_driver_lead: { findFirst: jest.fn(), update: jest.fn() },
}));
jest.mock("../../services/deviceSessionService", () => ({ registerDevice: jest.fn() }));

const prisma = require("../../config/db");
const { register } = require("../customerAuthController");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("customerAuthController.register — lead match", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_user.findFirst.mockResolvedValue(null); // mobile/email not taken
    prisma.tbl_rider.findFirst.mockResolvedValue(null); // no referral code path
    prisma.tbl_user.create.mockResolvedValue({ id: 42 });
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 42, wallet: 0 });
    prisma.tbl_favorite_driver.findFirst.mockResolvedValue(null);
  });

  it("creates a source:lead referral and favorites the driver when phone matches a verified lead", async () => {
    prisma.tbl_driver_lead.findFirst.mockResolvedValue({ id: 9, driver_id: 55, phone: "9998887771", status: "verified" });

    const res = mockRes();
    await register({ body: { fname: "Ravi", email: "r@x.com", mobile: "9998887771", password: "pw123456" } }, res);

    expect(prisma.tbl_referral.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        referrer_id: 55,
        referrer_type: "DRIVER",
        referred_id: 42,
        referred_type: "USER",
        status: "pending",
        source: "lead",
      }),
    });
    expect(prisma.tbl_driver_lead.update).toHaveBeenCalledWith({
      where: { id: 9 },
      data: expect.objectContaining({ status: "converted", converted_user_id: 42 }),
    });
    expect(prisma.tbl_favorite_driver.create).toHaveBeenCalledWith({
      data: { user_id: 42, rider_id: 55, status: 1 },
    });
  });

  it("does nothing extra when no lead matches the phone", async () => {
    prisma.tbl_driver_lead.findFirst.mockResolvedValue(null);

    const res = mockRes();
    await register({ body: { fname: "Ravi", email: "r@x.com", mobile: "9998887771", password: "pw123456" } }, res);

    expect(prisma.tbl_referral.create).not.toHaveBeenCalled();
    expect(prisma.tbl_favorite_driver.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest customerAuthController.leadMatch -v`
Expected: FAIL — `tbl_referral.create` not called (no lead-match branch exists yet)

- [ ] **Step 3: Add the lead-match branch**

In `backend/src/controllers/customerAuthController.js`, insert this block right after the `if (referrerId > 0) { ... }` block ends (after line 269, before `const created = await prisma.tbl_user.findUnique...` at line 271):

```javascript
    // A driver-submitted, admin-verified lead for this phone number takes
    // the same path as a manually-entered referral code once the number
    // signs up on its own - one tbl_referral row, source:"lead" so
    // referralRewardService can pick a different point setting, and the
    // same immediate favorite-driver add the manual-code path does above
    // (dispatchManager's existing is_favorite boost handles the rest).
    const normalizedPhone = mobile.replace(/\D/g, "");
    const matchedLead = await prisma.tbl_driver_lead.findFirst({
      where: { phone: normalizedPhone, status: "verified", expires_at: { gte: now } },
    });
    if (matchedLead) {
      await prisma.tbl_referral.create({
        data: {
          referrer_id: matchedLead.driver_id,
          referrer_type: "DRIVER",
          referred_id: newUser.id,
          referred_type: "USER",
          referral_code: "",
          status: "pending",
          source: "lead",
          points_awarded: 0,
          ride_id: 0,
          registered_at: now,
        },
      });
      await prisma.tbl_driver_lead.update({
        where: { id: matchedLead.id },
        data: { status: "converted", converted_user_id: newUser.id, converted_at: now },
      });
      await prisma.tbl_favorite_driver.create({
        data: { user_id: newUser.id, rider_id: matchedLead.driver_id, status: 1 },
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest customerAuthController.leadMatch -v`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full existing customerAuthController suite to check for regressions**

Run: `cd backend && npx jest customerAuthController -v`
Expected: PASS — the new branch only runs on a lead match (mocked as returning `null` by default elsewhere), so untouched signup paths are unaffected.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/customerAuthController.js backend/src/controllers/__tests__/customerAuthController.leadMatch.test.js
git commit -m "feat: match verified driver leads at customer signup"
```

---

### Task 5: Lead-sourced reward amount in referralRewardService

**Files:**
- Modify: `backend/src/services/referralRewardService.js:48` (the `pointsToAward` line)
- Modify: `backend/src/services/__tests__/referralRewardService.test.js` (add one test; existing tests must still pass unchanged)

**Interfaces:**
- Consumes: `referral.source` (now present on every row after Task 1's migration — old rows default to `"code"`).
- Produces: no signature change to `processReferralRewardsForCompletedOrder`/`creditReferralIfFirstOrder` — same exports, same call sites in `tripLifecycle.js`.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/services/__tests__/referralRewardService.test.js` (inside the existing `describe` block, after the `driver_points_per_referral` test):

```javascript
  it("uses lead_referral_points instead of user_points_per_referral when the referral source is 'lead'", async () => {
    prisma.tbl_referral.findFirst.mockImplementation(({ where }) =>
      where.referred_type === "USER" ? Promise.resolve(baseReferral({ source: "lead" })) : Promise.resolve(null)
    );
    prisma.pkg_order.count.mockResolvedValue(1);
    prisma.tbl_referral_setting.findFirst.mockResolvedValue({
      referral_enabled: true,
      user_points_per_referral: 100,
      driver_points_per_referral: 250,
      lead_referral_points: 400,
    });

    await processReferralRewardsForCompletedOrder({ uid: 20, riderId: null, orderId: 999 });

    expect(prisma.tbl_referral.updateMany).toHaveBeenCalledWith({
      where: { id: 501, status: "pending" },
      data: expect.objectContaining({ points_awarded: 400 }),
    });
  });
```

- [ ] **Step 2: Run tests to verify the new one fails**

Run: `cd backend && npx jest referralRewardService -v`
Expected: new test FAILS (expects 400, current code computes 100); all prior tests still PASS

- [ ] **Step 3: Branch on `source` when picking the reward amount**

In `backend/src/services/referralRewardService.js`, replace line 48:

```javascript
    const pointsToAward = referredType === "DRIVER" ? settings.driver_points_per_referral : settings.user_points_per_referral;
```

with:

```javascript
    const pointsToAward =
      referral.source === "lead"
        ? settings.lead_referral_points
        : referredType === "DRIVER"
          ? settings.driver_points_per_referral
          : settings.user_points_per_referral;
```

- [ ] **Step 4: Run tests to verify they all pass**

Run: `cd backend && npx jest referralRewardService -v`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/referralRewardService.js backend/src/services/__tests__/referralRewardService.test.js
git commit -m "feat: use lead_referral_points for lead-sourced referral rewards"
```

---

### Task 6: Expiry sweep for stale verified leads

**Files:**
- Create: `backend/src/services/driverLeadService.js`
- Modify: `backend/src/config/constants.js` (add one constant near the other `SWEEP_INTERVAL_MS` values, ~line 75)
- Modify: `backend/src/server.js` (add one `setInterval` block near line 73, after the scheduled-order sweep)
- Test: `backend/src/services/__tests__/driverLeadService.test.js`

**Interfaces:**
- Produces: `module.exports = { expireStaleLeads }` from `driverLeadService.js` — a verified lead whose `expires_at` has passed and which never converted is flipped to `"expired"`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/services/__tests__/driverLeadService.test.js`:

```javascript
jest.mock("../../config/db", () => ({
  tbl_driver_lead: { updateMany: jest.fn() },
}));

const prisma = require("../../config/db");
const { expireStaleLeads } = require("../driverLeadService");

describe("driverLeadService.expireStaleLeads", () => {
  it("flips verified leads past their expiry to expired", async () => {
    prisma.tbl_driver_lead.updateMany.mockResolvedValue({ count: 3 });

    const result = await expireStaleLeads();

    expect(prisma.tbl_driver_lead.updateMany).toHaveBeenCalledWith({
      where: { status: "verified", expires_at: { lt: expect.any(Date) } },
      data: { status: "expired" },
    });
    expect(result).toEqual({ count: 3 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest driverLeadService -v`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the sweep function**

Create `backend/src/services/driverLeadService.js`:

```javascript
const prisma = require("../config/db");
const logger = require("../utils/logger");

/** Flips verified-but-unconverted leads past their expiry window to "expired". */
async function expireStaleLeads() {
  try {
    return await prisma.tbl_driver_lead.updateMany({
      where: { status: "verified", expires_at: { lt: new Date() } },
      data: { status: "expired" },
    });
  } catch (err) {
    logger.error("driverLeadService.expireStaleLeads failed:", err);
    return { count: 0 };
  }
}

module.exports = { expireStaleLeads };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest driverLeadService -v`
Expected: PASS

- [ ] **Step 5: Add the constant and wire the sweep into server.js**

In `backend/src/config/constants.js`, add near line 75:

```javascript
  // Same periodic-sweep pattern as the other *_SWEEP_INTERVAL_MS values -
  // hourly is plenty since expiry only matters at day granularity.
  LEAD_EXPIRY_SWEEP_INTERVAL_MS: 60 * 60 * 1000,
```

In `backend/src/server.js`, add near line 73 (after the `SCHEDULED_ORDER_SWEEP_INTERVAL_MS` block):

```javascript
const driverLeadService = require("./services/driverLeadService");
const { LEAD_EXPIRY_SWEEP_INTERVAL_MS } = require("./config/constants"); // merge into existing constants import if one is already destructured above

setInterval(() => {
  driverLeadService.expireStaleLeads().catch((err) =>
    logger.error("expireStaleLeads interval failed:", err)
  );
}, LEAD_EXPIRY_SWEEP_INTERVAL_MS);
```

(If `constants` is already destructured in one `require` at the top of `server.js`, add `LEAD_EXPIRY_SWEEP_INTERVAL_MS` to that existing destructure instead of adding a second `require` line.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/driverLeadService.js backend/src/services/__tests__/driverLeadService.test.js backend/src/config/constants.js backend/src/server.js
git commit -m "feat: expire stale verified driver leads on a periodic sweep"
```

---

### Task 7: Full backend test suite regression check

**Files:** none (verification-only task)

- [ ] **Step 1: Run the entire backend test suite**

Run: `cd backend && npx jest`
Expected: PASS — no test outside the ones this plan touched should change behavior (all new logic is additive: a new table, a new `source` column defaulting to `"code"` on existing rows, a new branch that only fires on an explicit `"lead"` match).

- [ ] **Step 2: Manually sanity-check with Prisma Studio (optional but recommended before merging)**

Run: `cd backend && npx prisma studio`
Confirm `tbl_driver_lead` exists and `tbl_referral`/`tbl_referral_setting` have their new columns with the stated defaults.

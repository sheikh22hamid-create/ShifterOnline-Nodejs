# Wallet & Referral Points History Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the already-populated `tbl_wallet_history` and `tbl_referral_point_log` ledgers in the admin panel with searchable/filterable list views and a click-through transaction detail, and add the missing driver wallet admin-adjust endpoint so driver wallet changes get the same audit trail as customer wallet changes.

**Architecture:** Two new backend list endpoints (`GET /admin/wallet-history`, `GET /admin/referral-points-history`) in a new `historyController.js`, following the existing admin-controller pattern (JWT auth, role authorize, city scope, Prisma). One new backend endpoint (`POST /admin/riders/:id/wallet-adjust`) that mirrors the existing customer wallet-adjust exactly. One schema change (`performed_by_admin_id` on `tbl_wallet_history`) so manual admin adjustments are distinguishable from self-service/system rows. On the frontend: a shared `TransactionDetailDrawer`, a standalone `WalletReferralHistory` page with two tabs, and "View History" links wired into the three existing pages that already show wallet/points (Customers, Drivers, Referrals).

**Tech Stack:** Node.js/Express, Prisma (MySQL), Jest for backend tests; React + Vite, react-router-dom v7, Tailwind for frontend (no frontend test runner in this repo — frontend tasks end in manual browser verification).

**Spec:** [docs/superpowers/specs/2026-09-19-wallet-referral-history-ledger-design.md](../specs/2026-09-19-wallet-referral-history-ledger-design.md)

## Global Constraints

- All new/changed admin routes go through `auth` + `authorize(...)` + `scopeFilter` middleware, exactly like every other route in `backend/src/routes/adminRoutes.js`.
- Superadmin sees all cities; `admin`/`executive` are hard-scoped to `req.user.city_id` via `req.scopedCityId` (set by `scopeFilter`).
- List endpoints are paginated: `page` (default 1), `limit` (default 20, max 100), response shape `{ success, total, page, limit, data }` — matches every other list endpoint in this codebase.
- No new frontend test framework is introduced — frontend tasks are verified manually in the browser per the project's existing convention (see `frontend/package.json` — no test script exists).
- Follow existing file conventions exactly: controllers in `backend/src/controllers/`, routes only in `backend/src/routes/adminRoutes.js`, frontend pages in `frontend/src/pages/`, shared components in `frontend/src/components/common/`.

---

### Task 1: Add `performed_by_admin_id` to `tbl_wallet_history`

**Files:**
- Modify: `backend/prisma/schema.prisma` (`tbl_wallet_history` model, around line 1064)
- Create: `backend/prisma/migrations/20260919000001_add_wallet_history_admin_id/migration.sql`

**Interfaces:**
- Produces: `tbl_wallet_history.performed_by_admin_id` (nullable Int) — Task 2 and Task 3 write to it, Task 4 reads it.

- [ ] **Step 1: Add the column to the Prisma schema**

In `backend/prisma/schema.prisma`, inside `model tbl_wallet_history`, add one field (nullable, no relation — same style as `tbl_driver_lead.verified_by_admin_id`):

```prisma
model tbl_wallet_history {
  id                  Int                             @id @default(autoincrement())
  user_id             Int
  mobile              String?                         @db.VarChar(20)
  amount              Decimal                         @db.Decimal(10, 2)
  type                tbl_wallet_history_type
  remark              String?                         @db.VarChar(255)
  payment_id          String?                         @db.VarChar(255)
  created_at          DateTime?                       @default(now()) @db.DateTime(0)
  wallet_type         tbl_wallet_history_wallet_type? @default(user)
  order_id            Int?
  razorpay_payment_id String?                         @unique @db.VarChar(255)
  // Null = self-service or system-generated row (recharge, withdraw, order
  // settlement). Non-null = an admin performed a manual adjustment via the
  // admin panel — see adminCustomerController.walletAdjust /
  // adminRiderController.walletAdjust.
  performed_by_admin_id Int?
}
```

- [ ] **Step 2: Write the migration SQL**

```sql
-- AlterTable
ALTER TABLE `tbl_wallet_history` ADD COLUMN `performed_by_admin_id` INTEGER NULL;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd backend && npx prisma generate`
Expected: completes without error; `node_modules/.prisma/client` now has `performed_by_admin_id` on `tbl_wallet_history`.

- [ ] **Step 4: Apply the migration against the dev database**

Run: `cd backend && npx prisma migrate deploy` (or the project's usual dev-migration command if different — check `backend/package.json` scripts first; use whatever the last migration in `backend/prisma/migrations/` was applied with)
Expected: migration applies cleanly, no errors.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260919000001_add_wallet_history_admin_id
git commit -m "feat(db): add performed_by_admin_id to tbl_wallet_history"
```

---

### Task 2: Record `performed_by_admin_id` on customer wallet adjust

**Files:**
- Modify: `backend/src/controllers/adminCustomerController.js:154-200` (`walletAdjust`)
- Test: `backend/src/controllers/__tests__/adminCustomerController.walletAdjust.test.js`

**Interfaces:**
- Consumes: `tbl_wallet_history.performed_by_admin_id` (Task 1)
- Produces: no new exports — `walletAdjust` keeps its existing signature `(req, res)`, called from `POST /customers/:id/wallet-adjust`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/adminCustomerController.walletAdjust.test.js
jest.mock("../../config/db", () => ({
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));

const prisma = require("../../config/db");
const { walletAdjust } = require("../adminCustomerController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("adminCustomerController.walletAdjust", () => {
  afterEach(() => jest.clearAllMocks());

  it("records performed_by_admin_id from req.user.id on the ledger row", async () => {
    prisma.tbl_user.findUnique.mockResolvedValue({ id: 10, wallet: 100, city_id: 1 });
    prisma.tbl_user.update.mockReturnValue(Promise.resolve({ id: 10, wallet: 150 }));
    prisma.tbl_wallet_history.create.mockReturnValue(Promise.resolve({}));

    const req = {
      params: { id: "10" },
      body: { amount: 50, type: "credit", remark: "Promo" },
      user: { id: 7, role: "superadmin", city_id: 1 },
    };
    const res = makeRes();

    await walletAdjust(req, res);

    // prisma.$transaction is called with an array of already-built Prisma
    // promises (prisma.tbl_user.update(...), prisma.tbl_wallet_history.create(...)),
    // so tbl_wallet_history.create has already recorded its call args by the
    // time this assertion runs, regardless of what $transaction does with them.
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ performed_by_admin_id: 7 }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest adminCustomerController.walletAdjust`
Expected: FAIL — `performed_by_admin_id` is `undefined` in the actual call (current code doesn't set it yet).

- [ ] **Step 4: Implement — set `performed_by_admin_id` in the ledger create**

In `backend/src/controllers/adminCustomerController.js`, modify the `tbl_wallet_history.create` call inside `walletAdjust` (currently lines 184-193):

```js
      prisma.tbl_wallet_history.create({
        data: {
          user_id: id,
          amount: amt,
          type,
          remark: remark || `Manual ${type} by admin #${req.user.id}`,
          wallet_type: "user",
          performed_by_admin_id: req.user.id,
          created_at: new Date(),
        },
      }),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npx jest adminCustomerController.walletAdjust`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminCustomerController.js backend/src/controllers/__tests__/adminCustomerController.walletAdjust.test.js
git commit -m "feat(wallet): record performed_by_admin_id on customer wallet adjustments"
```

---

### Task 3: Add driver wallet admin-adjust endpoint

**Files:**
- Modify: `backend/src/controllers/adminRiderController.js` (add `walletAdjust`, update `module.exports` at the current last line)
- Modify: `backend/src/routes/adminRoutes.js` (add route near line 113, `isScopedOut` pattern already imported via controller)
- Test: `backend/src/controllers/__tests__/adminRiderController.walletAdjust.test.js`

**Interfaces:**
- Consumes: `isScopedOut(req, riderCityId)` — already defined at `adminRiderController.js:21`, reuse it (do not redefine).
- Produces: `walletAdjust(req, res)` exported from `adminRiderController.js`, mounted at `POST /admin/riders/:id/wallet-adjust`. Response shape identical to the customer one: `{ success: true, message: "Wallet adjusted", data: { id, wallet_balance } }`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/adminRiderController.walletAdjust.test.js
jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));

const prisma = require("../../config/db");
const { walletAdjust } = require("../adminRiderController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("adminRiderController.walletAdjust", () => {
  afterEach(() => jest.clearAllMocks());

  it("rejects a debit larger than the current balance", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 5, wallet_balance: 30, city_id: 1 });
    const req = {
      params: { id: "5" },
      body: { amount: 100, type: "debit" },
      user: { id: 3, role: "superadmin", city_id: 1 },
    };
    const res = makeRes();

    await walletAdjust(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining("Insufficient") }));
  });

  it("credits the driver wallet and writes a ledger row with wallet_type driver", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 5, wallet_balance: 30, city_id: 1 });
    prisma.tbl_rider.update.mockReturnValue(Promise.resolve({ id: 5, wallet_balance: 80 }));
    prisma.tbl_wallet_history.create.mockReturnValue(Promise.resolve({}));

    const req = {
      params: { id: "5" },
      body: { amount: 50, type: "credit", remark: "Bonus" },
      user: { id: 3, role: "superadmin", city_id: 1 },
    };
    const res = makeRes();

    await walletAdjust(req, res);

    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ user_id: 5, wallet_type: "driver", performed_by_admin_id: 3, amount: 50, type: "credit" }),
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: { id: 5, wallet_balance: 80 } }));
  });

  it("returns 403 when an admin adjusts a driver outside their city", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue({ id: 5, wallet_balance: 30, city_id: 2 });
    const req = {
      params: { id: "5" },
      body: { amount: 10, type: "credit" },
      user: { id: 3, role: "admin", city_id: 1 },
    };
    const res = makeRes();

    await walletAdjust(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest adminRiderController.walletAdjust`
Expected: FAIL — `walletAdjust` is not exported from `adminRiderController.js` (`TypeError: walletAdjust is not a function` or `undefined`).

- [ ] **Step 3: Implement `walletAdjust`**

In `backend/src/controllers/adminRiderController.js`, add this function (place it near `toggleStatus`, following the same style as `adminCustomerController.walletAdjust`):

```js
async function walletAdjust(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const { amount, type, remark } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "amount must be a positive number" });
    }
    if (!["credit", "debit"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be credit or debit" });
    }

    const rider = await prisma.tbl_rider.findUnique({ where: { id } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const amt = Number(amount);
    if (type === "debit" && Number(rider.wallet_balance) < amt) {
      return res.status(400).json({ success: false, message: "Insufficient wallet balance for this debit" });
    }

    const [updatedRider] = await prisma.$transaction([
      prisma.tbl_rider.update({
        where: { id },
        data: { wallet_balance: type === "credit" ? { increment: amt } : { decrement: amt } },
      }),
      prisma.tbl_wallet_history.create({
        data: {
          user_id: id,
          amount: amt,
          type,
          remark: remark || `Manual ${type} by admin #${req.user.id}`,
          wallet_type: "driver",
          performed_by_admin_id: req.user.id,
          created_at: new Date(),
        },
      }),
    ]);

    return res.status(200).json({ success: true, message: "Wallet adjusted", data: { id: updatedRider.id, wallet_balance: updatedRider.wallet_balance } });
  } catch (err) {
    return internalError(res, err, "riders.walletAdjust");
  }
}
```

Check the top of `adminRiderController.js` for the existing `internalError` helper and `prisma` import — reuse them (do not redeclare); if `internalError` isn't already defined in this file (it is defined per the same pattern as `adminCustomerController.js`), match whatever the file's existing error helper is named instead.

Update the `module.exports` line at the bottom of the file to include `walletAdjust`:

```js
module.exports = { list, getOne, create, kycDecision, toggleStatus, remove, toggleModel, setPaymentComplete, updateProfile, walletAdjust };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest adminRiderController.walletAdjust`
Expected: PASS (all 3 cases)

- [ ] **Step 5: Wire the route**

In `backend/src/routes/adminRoutes.js`, add this line immediately after line 113 (`router.patch("/riders/:id/payment", ...)`):

```js
router.post("/riders/:id/wallet-adjust", auth, authorize("superadmin", "admin"), scopeFilter, adminRiderController.walletAdjust);
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/adminRiderController.js backend/src/routes/adminRoutes.js backend/src/controllers/__tests__/adminRiderController.walletAdjust.test.js
git commit -m "feat(wallet): add admin wallet-adjust endpoint for drivers"
```

---

### Task 4: `GET /admin/wallet-history` list endpoint

**Files:**
- Create: `backend/src/controllers/historyController.js`
- Modify: `backend/src/routes/adminRoutes.js`
- Test: `backend/src/controllers/__tests__/historyController.walletHistory.test.js`

**Interfaces:**
- Produces: `walletHistory(req, res)` from `historyController.js`, mounted at `GET /admin/wallet-history`. Query params: `user_id?`, `wallet_type?` (`user`|`driver`), `search?`, `date_from?`, `date_to?`, `type?` (`credit`|`debit`), `page?`, `limit?`. Response: `{ success, total, page, limit, data: [{ id, user_id, wallet_type, target_name, target_mobile, amount, type, remark, payment_id, razorpay_payment_id, order_id, created_at, performed_by }] }` where `performed_by` is an admin name string or `null`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/historyController.walletHistory.test.js
jest.mock("../../config/db", () => ({
  tbl_wallet_history: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
  admin: { findMany: jest.fn() },
}));

const prisma = require("../../config/db");
const { walletHistory } = require("../historyController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("historyController.walletHistory", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns paginated rows with resolved target name/mobile and performed_by", async () => {
    prisma.tbl_wallet_history.findMany.mockResolvedValue([
      { id: 1, user_id: 10, wallet_type: "user", amount: 50, type: "credit", remark: "Promo", payment_id: null, razorpay_payment_id: null, order_id: null, created_at: new Date("2026-09-01"), performed_by_admin_id: 7 },
      { id: 2, user_id: 5, wallet_type: "driver", amount: 20, type: "debit", remark: "Fine", payment_id: null, razorpay_payment_id: null, order_id: null, created_at: new Date("2026-09-02"), performed_by_admin_id: null },
    ]);
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 10, name: "Asha", mobile: 9876543210, city_id: 1 }]);
    prisma.tbl_rider.findMany.mockResolvedValue([{ id: 5, full_name: "Ravi", first_name: null, last_name: null, fmobile: "9123456780", city_id: 1 }]);
    prisma.admin.findMany.mockResolvedValue([{ id: 7, name: "Priya Admin" }]);

    const req = { query: {}, user: { role: "superadmin" }, scopedCityId: null };
    const res = makeRes();

    await walletHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.total).toBe(2);
    expect(payload.data[0]).toEqual(expect.objectContaining({ id: 1, target_name: "Asha", target_mobile: "9876543210", performed_by: "Priya Admin" }));
    expect(payload.data[1]).toEqual(expect.objectContaining({ id: 2, target_name: "Ravi", target_mobile: "9123456780", performed_by: null }));
  });

  it("scopes results to the admin's city when not superadmin", async () => {
    prisma.tbl_wallet_history.findMany.mockResolvedValue([
      { id: 1, user_id: 10, wallet_type: "user", amount: 50, type: "credit", remark: null, payment_id: null, razorpay_payment_id: null, order_id: null, created_at: new Date(), performed_by_admin_id: null },
      { id: 2, user_id: 11, wallet_type: "user", amount: 20, type: "credit", remark: null, payment_id: null, razorpay_payment_id: null, order_id: null, created_at: new Date(), performed_by_admin_id: null },
    ]);
    prisma.tbl_user.findMany.mockResolvedValue([
      { id: 10, name: "In City", mobile: 111, city_id: 1 },
      { id: 11, name: "Other City", mobile: 222, city_id: 2 },
    ]);
    prisma.tbl_rider.findMany.mockResolvedValue([]);
    prisma.admin.findMany.mockResolvedValue([]);

    const req = { query: {}, user: { role: "admin", city_id: "1" }, scopedCityId: 1 };
    const res = makeRes();

    await walletHistory(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.total).toBe(1);
    expect(payload.data[0].id).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest historyController.walletHistory`
Expected: FAIL — `Cannot find module '../historyController'`.

- [ ] **Step 3: Implement `historyController.js`**

```js
// backend/src/controllers/historyController.js
const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function resolveTargets(userWalletRows, driverWalletRows) {
  const userIds = [...new Set(userWalletRows.map((r) => r.user_id))];
  const driverIds = [...new Set(driverWalletRows.map((r) => r.user_id))];

  const [users, drivers] = await Promise.all([
    userIds.length ? prisma.tbl_user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, mobile: true, city_id: true } }) : [],
    driverIds.length ? prisma.tbl_rider.findMany({ where: { id: { in: driverIds } }, select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, city_id: true } }) : [],
  ]);

  const userById = Object.fromEntries(users.map((u) => [u.id, u]));
  const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
  return { userById, driverById };
}

async function resolveAdmins(adminIds) {
  const ids = [...new Set(adminIds.filter(Boolean))];
  if (!ids.length) return {};
  const admins = await prisma.admin.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, username: true } });
  return Object.fromEntries(admins.map((a) => [a.id, a.name || a.username]));
}

async function walletHistory(req, res) {
  try {
    const { user_id, wallet_type, search, date_from, date_to, type } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const where = {};
    if (user_id) where.user_id = parseInt(user_id, 10);
    if (wallet_type === "user" || wallet_type === "driver") where.wallet_type = wallet_type;
    if (type === "credit" || type === "debit") where.type = type;
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = new Date(date_from);
      if (date_to) where.created_at.lte = new Date(date_to);
    }

    const rows = await prisma.tbl_wallet_history.findMany({ where, orderBy: { created_at: "desc" } });

    const userRows = rows.filter((r) => r.wallet_type !== "driver");
    const driverRows = rows.filter((r) => r.wallet_type === "driver");
    const { userById, driverById } = await resolveTargets(userRows, driverRows);
    const adminById = await resolveAdmins(rows.map((r) => r.performed_by_admin_id));

    const decorated = rows.map((r) => {
      const target = r.wallet_type === "driver" ? driverById[r.user_id] : userById[r.user_id];
      const target_name = r.wallet_type === "driver"
        ? target ? (target.full_name || `${target.first_name || ""} ${target.last_name || ""}`.trim() || `Driver #${r.user_id}`) : `Driver #${r.user_id}`
        : target ? (target.name || `Customer #${r.user_id}`) : `Customer #${r.user_id}`;
      const target_mobile = r.wallet_type === "driver" ? target?.fmobile || null : target?.mobile ? String(target.mobile) : null;
      return {
        id: r.id,
        user_id: r.user_id,
        wallet_type: r.wallet_type,
        target_name,
        target_mobile,
        amount: r.amount,
        type: r.type,
        remark: r.remark,
        payment_id: r.payment_id,
        razorpay_payment_id: r.razorpay_payment_id,
        order_id: r.order_id,
        created_at: r.created_at,
        performed_by: r.performed_by_admin_id ? adminById[r.performed_by_admin_id] || null : null,
        _city_id: target?.city_id ?? null,
      };
    });

    const searchLower = (search || "").trim().toLowerCase();
    const filtered = decorated.filter((r) => {
      if (req.scopedCityId && r._city_id !== req.scopedCityId) return false;
      if (!searchLower) return true;
      return (r.target_name || "").toLowerCase().includes(searchLower) || (r.target_mobile || "").includes(searchLower);
    });

    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * limit, (page - 1) * limit + limit).map(({ _city_id, ...rest }) => rest);

    return res.status(200).json({ success: true, total, page, limit, data: pageRows });
  } catch (err) {
    return internalError(res, err, "history.walletHistory");
  }
}

module.exports = { walletHistory, resolveAdmins, resolveTargets };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest historyController.walletHistory`
Expected: PASS

- [ ] **Step 5: Wire the route**

In `backend/src/routes/adminRoutes.js`:
1. Add near the top with the other controller requires: `const historyController = require("../controllers/historyController");`
2. Add the route immediately after line 144 (`router.delete("/customers/:id", ...)`):

```js
router.get("/wallet-history", auth, authorize(...RIDER_ROLES), scopeFilter, historyController.walletHistory);
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/historyController.js backend/src/routes/adminRoutes.js backend/src/controllers/__tests__/historyController.walletHistory.test.js
git commit -m "feat(wallet): add admin wallet history list endpoint"
```

---

### Task 5: `GET /admin/referral-points-history` list endpoint

**Files:**
- Modify: `backend/src/controllers/historyController.js` (add `referralPointsHistory`, reuse `resolveAdmins`/target-resolution helpers from Task 4)
- Modify: `backend/src/routes/adminRoutes.js`
- Test: `backend/src/controllers/__tests__/historyController.referralPointsHistory.test.js`

**Interfaces:**
- Consumes: `resolveAdmins(adminIds)` from Task 4 (already exported from `historyController.js`).
- Produces: `referralPointsHistory(req, res)`, mounted at `GET /admin/referral-points-history`. Query params: `user_id?`, `user_type?` (`USER`|`DRIVER`), `search?`, `date_from?`, `date_to?`, `txn_type?` (`credit`|`debit`), `page?`, `limit?`. Response: `{ success, total, page, limit, data: [{ id, user_id, user_type, target_name, target_mobile, points, txn_type, source, ref_id, balance_after, note, created_at }] }`. Note: `tbl_referral_point_log` has no `performed_by_admin_id` column (Task 1 didn't touch it) — `source` (already `"admin_adjustment"` for manual ones, per `referralController.adjustPoints:277`) is what the frontend uses to distinguish manual vs system rows, so no `performed_by` field here.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/historyController.referralPointsHistory.test.js
jest.mock("../../config/db", () => ({
  tbl_referral_point_log: { findMany: jest.fn() },
  tbl_user: { findMany: jest.fn() },
  tbl_rider: { findMany: jest.fn() },
}));

const prisma = require("../../config/db");
const { referralPointsHistory } = require("../historyController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe("historyController.referralPointsHistory", () => {
  afterEach(() => jest.clearAllMocks());

  it("returns rows with resolved target name/mobile, no performed_by field", async () => {
    prisma.tbl_referral_point_log.findMany.mockResolvedValue([
      { id: 1, user_id: 10, user_type: "USER", points: 50, txn_type: "credit", source: "admin_adjustment", ref_id: 0, balance_after: 150, note: "Manual", created_at: new Date("2026-09-01") },
    ]);
    prisma.tbl_user.findMany.mockResolvedValue([{ id: 10, name: "Asha", mobile: 9876543210, city_id: 1 }]);
    prisma.tbl_rider.findMany.mockResolvedValue([]);

    const req = { query: {}, user: { role: "superadmin" }, scopedCityId: null };
    const res = makeRes();

    await referralPointsHistory(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data[0]).toEqual(
      expect.objectContaining({ id: 1, target_name: "Asha", target_mobile: "9876543210", points: 50, source: "admin_adjustment" })
    );
    expect(payload.data[0].performed_by).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest historyController.referralPointsHistory`
Expected: FAIL — `referralPointsHistory is not a function`.

- [ ] **Step 3: Implement `referralPointsHistory`**

Add to `backend/src/controllers/historyController.js` (below `walletHistory`, reusing the existing `resolveTargets`-style logic but for `user_type` USER/DRIVER instead of `wallet_type`):

```js
async function resolveReferralTargets(rows) {
  const userIds = [...new Set(rows.filter((r) => r.user_type !== "DRIVER").map((r) => r.user_id))];
  const driverIds = [...new Set(rows.filter((r) => r.user_type === "DRIVER").map((r) => r.user_id))];

  const [users, drivers] = await Promise.all([
    userIds.length ? prisma.tbl_user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, mobile: true, city_id: true } }) : [],
    driverIds.length ? prisma.tbl_rider.findMany({ where: { id: { in: driverIds } }, select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, city_id: true } }) : [],
  ]);

  return {
    userById: Object.fromEntries(users.map((u) => [u.id, u])),
    driverById: Object.fromEntries(drivers.map((d) => [d.id, d])),
  };
}

async function referralPointsHistory(req, res) {
  try {
    const { user_id, user_type, search, date_from, date_to, txn_type } = req.query;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

    const where = {};
    if (user_id) where.user_id = parseInt(user_id, 10);
    if (user_type === "USER" || user_type === "DRIVER") where.user_type = user_type;
    if (txn_type === "credit" || txn_type === "debit") where.txn_type = txn_type;
    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = new Date(date_from);
      if (date_to) where.created_at.lte = new Date(date_to);
    }

    const rows = await prisma.tbl_referral_point_log.findMany({ where, orderBy: { created_at: "desc" } });
    const { userById, driverById } = await resolveReferralTargets(rows);

    const decorated = rows.map((r) => {
      const target = r.user_type === "DRIVER" ? driverById[r.user_id] : userById[r.user_id];
      const target_name = r.user_type === "DRIVER"
        ? target ? (target.full_name || `${target.first_name || ""} ${target.last_name || ""}`.trim() || `Driver #${r.user_id}`) : `Driver #${r.user_id}`
        : target ? (target.name || `Customer #${r.user_id}`) : `Customer #${r.user_id}`;
      const target_mobile = r.user_type === "DRIVER" ? target?.fmobile || null : target?.mobile ? String(target.mobile) : null;
      return {
        id: r.id,
        user_id: r.user_id,
        user_type: r.user_type,
        target_name,
        target_mobile,
        points: r.points,
        txn_type: r.txn_type,
        source: r.source,
        ref_id: r.ref_id,
        balance_after: r.balance_after,
        note: r.note,
        created_at: r.created_at,
        _city_id: target?.city_id ?? null,
      };
    });

    const searchLower = (search || "").trim().toLowerCase();
    const filtered = decorated.filter((r) => {
      if (req.scopedCityId && r._city_id !== req.scopedCityId) return false;
      if (!searchLower) return true;
      return (r.target_name || "").toLowerCase().includes(searchLower) || (r.target_mobile || "").includes(searchLower);
    });

    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * limit, (page - 1) * limit + limit).map(({ _city_id, ...rest }) => rest);

    return res.status(200).json({ success: true, total, page, limit, data: pageRows });
  } catch (err) {
    return internalError(res, err, "history.referralPointsHistory");
  }
}

module.exports = { walletHistory, referralPointsHistory, resolveAdmins, resolveTargets };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest historyController.referralPointsHistory`
Expected: PASS

- [ ] **Step 5: Wire the route**

In `backend/src/routes/adminRoutes.js`, add immediately after the `wallet-history` route added in Task 4:

```js
router.get("/referral-points-history", auth, authorize(...RIDER_ROLES), scopeFilter, historyController.referralPointsHistory);
```

- [ ] **Step 6: Run the full backend test suite to catch regressions**

Run: `cd backend && npx jest`
Expected: all tests pass (existing + new).

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/historyController.js backend/src/routes/adminRoutes.js backend/src/controllers/__tests__/historyController.referralPointsHistory.test.js
git commit -m "feat(referrals): add admin referral points history list endpoint"
```

---

### Task 6: Generalize `WalletAdjustModal` for both customers and drivers

**Files:**
- Modify: `frontend/src/components/customers/WalletAdjustModal.jsx` → move/rename to `frontend/src/components/common/WalletAdjustModal.jsx`
- Modify: `frontend/src/components/customers/CustomerDetailDrawer.jsx` (update import path and call site)

**Interfaces:**
- Produces: `WalletAdjustModal({ open, entityLabel, endpoint, currentBalance, onClose, onDone })` — a generic wallet-adjust modal usable for both customer and driver targets.
- Consumes (Task 9): `DriverDetailDrawer.jsx` will import this same component.

- [ ] **Step 1: Move and generalize the component**

Create `frontend/src/components/common/WalletAdjustModal.jsx` with the same content as the existing `frontend/src/components/customers/WalletAdjustModal.jsx`, but replace the `customer` prop with `entityLabel` (a plain string the caller computes) and `endpoint` (the full relative URL to POST to):

```jsx
import { useState } from 'react'
import api from '../../services/api'
import Modal from './Modal'

export default function WalletAdjustModal({ open, entityLabel, endpoint, onClose, onDone }) {
  const [type, setType] = useState('credit')
  const [amount, setAmount] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit() {
    setSubmitting(true)
    setError('')
    try {
      await api.post(endpoint, { amount: Number(amount), type, remark })
      onDone()
      setAmount('')
      setRemark('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not adjust this wallet.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Adjust wallet — ${entityLabel}`}
      footer={
        <>
          <button type="button" onClick={onClose} className="rounded-lg border px-3 py-1.5 text-[13px]" style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}>
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting || !amount || Number(amount) <= 0}
            onClick={handleSubmit}
            className="rounded-lg px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50"
            style={{ background: type === 'credit' ? 'var(--success)' : 'var(--danger)', color: '#fff' }}
          >
            {submitting ? 'Saving…' : type === 'credit' ? 'Credit wallet' : 'Debit wallet'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-[12.5px]" style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger-soft-border)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="mb-3 flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)' }}>
        {['credit', 'debit'].map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            className="flex-1 rounded-md py-1.5 text-[12.5px] font-semibold capitalize"
            style={{ background: type === t ? (t === 'credit' ? 'var(--success-soft)' : 'var(--danger-soft)') : 'transparent', color: type === t ? (t === 'credit' ? 'var(--success)' : 'var(--danger)') : 'var(--ink-muted)' }}
          >
            {t}
          </button>
        ))}
      </div>

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="wallet-amount">
        Amount (₹)
      </label>
      <input
        id="wallet-amount"
        type="number"
        min="0"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="mb-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />

      <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="wallet-remark">
        Remark
      </label>
      <input
        id="wallet-remark"
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
        placeholder="e.g. Delayed delivery promotional refund"
        className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }}
      />
    </Modal>
  )
}
```

- [ ] **Step 2: Delete the old file**

Run: `git rm frontend/src/components/customers/WalletAdjustModal.jsx`

- [ ] **Step 3: Update `CustomerDetailDrawer.jsx`**

In `frontend/src/components/customers/CustomerDetailDrawer.jsx`:

Change the import (line 10):
```js
import WalletAdjustModal from '../common/WalletAdjustModal'
```

Change the render call (around lines 218-228):
```jsx
      <WalletAdjustModal
        open={walletOpen}
        entityLabel={customer?.name || `Customer #${customer?.id}`}
        endpoint={`/customers/${customerId}/wallet-adjust`}
        onClose={() => setWalletOpen(false)}
        onDone={() => {
          setWalletOpen(false)
          toast.success('Wallet adjusted.')
          refetch()
          onChanged?.()
        }}
      />
```

- [ ] **Step 4: Manual verification**

Run: `cd frontend && npm run dev`, open the admin panel, go to Customers, open a customer, click "Adjust wallet", submit a credit — confirm it still works exactly as before (balance updates, modal closes, toast shows).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/common/WalletAdjustModal.jsx frontend/src/components/customers/CustomerDetailDrawer.jsx
git commit -m "refactor(wallet): generalize WalletAdjustModal for reuse across customers and drivers"
```

---

### Task 7: Shared `TransactionDetailDrawer` component

**Files:**
- Create: `frontend/src/components/common/TransactionDetailDrawer.jsx`

**Interfaces:**
- Produces: `TransactionDetailDrawer({ open, kind, transaction, onClose })` where `kind` is `"wallet" | "referral"` and `transaction` is one row from the `wallet-history` or `referral-points-history` API response (or `null`).
- Consumes (Task 8): the standalone history page renders this on row click.

- [ ] **Step 1: Implement the component**

```jsx
// frontend/src/components/common/TransactionDetailDrawer.jsx
import Modal from './Modal'
import { formatCurrency, formatDateTime } from '../../utils/format'

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b py-2 text-[13px] last:border-b-0" style={{ borderColor: 'var(--border)' }}>
      <span style={{ color: 'var(--ink-faint)' }}>{label}</span>
      <span className="font-mono-data text-right" style={{ color: 'var(--ink)' }}>{value ?? '—'}</span>
    </div>
  )
}

export default function TransactionDetailDrawer({ open, kind, transaction, onClose }) {
  if (!transaction) return null

  const isWallet = kind === 'wallet'

  return (
    <Modal open={open} onClose={onClose} title={isWallet ? 'Wallet transaction detail' : 'Referral points transaction detail'} width={440}>
      <div className="space-y-0.5">
        <Row label="Transaction ID" value={`#${transaction.id}`} />
        <Row label={isWallet ? 'Account' : 'User'} value={`${transaction.target_name}${transaction.target_mobile ? ` (${transaction.target_mobile})` : ''}`} />
        <Row label="Type" value={<span className="capitalize">{isWallet ? transaction.type : transaction.txn_type}</span>} />
        <Row label={isWallet ? 'Amount' : 'Points'} value={isWallet ? formatCurrency(transaction.amount) : `${transaction.points} pts`} />
        {isWallet ? (
          <>
            <Row label="Remark" value={transaction.remark} />
            <Row label="Payment ID" value={transaction.payment_id} />
            <Row label="Razorpay payment ID" value={transaction.razorpay_payment_id} />
            <Row label="Order ID" value={transaction.order_id ? `#${transaction.order_id}` : null} />
            <Row label="Performed by" value={transaction.performed_by || 'Self-service / system'} />
          </>
        ) : (
          <>
            <Row label="Source" value={transaction.source} />
            <Row label="Note" value={transaction.note} />
            <Row label="Reference ID" value={transaction.ref_id ? `#${transaction.ref_id}` : null} />
            <Row label="Balance after" value={`${transaction.balance_after} pts`} />
          </>
        )}
        <Row label="Date" value={formatDateTime(transaction.created_at)} />
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Manual verification**

This component has no page rendering it yet — verification happens in Task 8 once the standalone page wires it up. Skip standalone verification here; proceed to commit.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/common/TransactionDetailDrawer.jsx
git commit -m "feat(history): add shared transaction detail drawer component"
```

---

### Task 8: Standalone "Wallet & Referral History" page

**Files:**
- Create: `frontend/src/pages/WalletReferralHistory.jsx`
- Modify: `frontend/src/App.jsx` (add lazy import + route)
- Modify: `frontend/src/config/navigation.js` (add nav entry)

**Interfaces:**
- Consumes: `TransactionDetailDrawer` (Task 7), `Pagination` (existing `frontend/src/components/common/Pagination.jsx`), `useApiQuery` (existing `frontend/src/hooks/useApiQuery.js`).
- Route: `/wallet-referral-history`. Query params read on mount via `useSearchParams`: `tab` (`wallet`|`referral`, default `wallet`), `user_id`, `wallet_type`/`user_type` — this is how Task 9's "View History" links pre-filter the page.

- [ ] **Step 1: Implement the page**

```jsx
// frontend/src/pages/WalletReferralHistory.jsx
import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search } from 'lucide-react'
import api from '../services/api'
import useApiQuery from '../hooks/useApiQuery'
import Pagination from '../components/common/Pagination'
import TransactionDetailDrawer from '../components/common/TransactionDetailDrawer'
import { formatCurrency, formatDateTime } from '../utils/format'

const FIELD_STYLE = { borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink)' }
const LIMIT = 20

export default function WalletReferralHistory() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'referral' ? 'referral' : 'wallet'
  const presetUserId = searchParams.get('user_id') || ''
  const presetWalletType = searchParams.get('wallet_type') || ''
  const presetUserType = searchParams.get('user_type') || ''

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)

  function switchTab(next) {
    setSearchParams({ tab: next })
    setSearch('')
    setPage(1)
    setSelected(null)
  }

  const walletFetcher = useCallback(
    () =>
      api
        .get('/wallet-history', {
          params: { page, limit: LIMIT, search: search || undefined, user_id: presetUserId || undefined, wallet_type: presetWalletType || undefined },
        })
        .then((res) => res.data),
    [page, search, presetUserId, presetWalletType]
  )
  const referralFetcher = useCallback(
    () =>
      api
        .get('/referral-points-history', {
          params: { page, limit: LIMIT, search: search || undefined, user_id: presetUserId || undefined, user_type: presetUserType || undefined },
        })
        .then((res) => res.data),
    [page, search, presetUserId, presetUserType]
  )

  const { data, loading, error } = useApiQuery(tab === 'wallet' ? walletFetcher : referralFetcher)
  const rows = data?.data ?? []
  const total = data?.total ?? 0

  const columns = tab === 'wallet' ? ['Account', 'Type', 'Amount', 'Remark', 'Performed by', 'Date'] : ['User', 'Type', 'Points', 'Source', 'Date']

  return (
    <div>
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight" style={{ color: 'var(--ink)' }}>
          Wallet & Referral History
        </h1>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--ink-muted)' }}>
          Full transaction ledger for wallet balances and referral points.
        </p>
      </div>

      <div className="mt-4 flex gap-1 rounded-lg border p-0.5" style={{ borderColor: 'var(--border)', width: 'fit-content' }}>
        {[
          { key: 'wallet', label: 'Wallet History' },
          { key: 'referral', label: 'Referral Points History' },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchTab(t.key)}
            className="rounded-md px-3 py-1.5 text-[12.5px] font-semibold"
            style={{ background: tab === t.key ? 'var(--brand)' : 'transparent', color: tab === t.key ? 'var(--brand-ink)' : 'var(--ink-muted)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2" style={{ ...FIELD_STYLE, maxWidth: 360 }}>
        <Search size={14} style={{ color: 'var(--ink-faint)' }} />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(1)
          }}
          placeholder="Search by name or mobile…"
          className="flex-1 bg-transparent text-[13px] outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </div>

      <div className="surface-card mt-3 overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr style={{ background: 'var(--bg)' }}>
                {columns.map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                    <td colSpan={columns.length} className="px-4 py-3">
                      <div className="h-4 animate-pulse rounded" style={{ background: 'var(--border)' }} />
                    </td>
                  </tr>
                ))}
              {!loading && error && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--danger)' }}>
                    {error}
                  </td>
                </tr>
              )}
              {!loading && !error && rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-10 text-center text-[13px]" style={{ color: 'var(--ink-faint)' }}>
                    No transactions found.
                  </td>
                </tr>
              )}
              {!loading &&
                !error &&
                rows.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className="cursor-pointer hover:opacity-90"
                    style={{ borderTop: '1px solid var(--border)' }}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      <div className="font-medium text-[13px]">{r.target_name}</div>
                      {r.target_mobile && (
                        <div className="font-mono-data text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                          {r.target_mobile}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 capitalize" style={{ color: 'var(--ink-muted)' }}>
                      {tab === 'wallet' ? r.type : r.txn_type}
                    </td>
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink)' }}>
                      {tab === 'wallet' ? formatCurrency(r.amount) : `${r.points} pts`}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                      {tab === 'wallet' ? r.remark || '—' : r.source}
                    </td>
                    {tab === 'wallet' && (
                      <td className="whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-muted)' }}>
                        {r.performed_by || 'Self-service'}
                      </td>
                    )}
                    <td className="font-mono-data whitespace-nowrap px-4 py-2.5" style={{ color: 'var(--ink-faint)' }}>
                      {formatDateTime(r.created_at)}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={LIMIT} total={total} onPageChange={setPage} />
      </div>

      <TransactionDetailDrawer open={Boolean(selected)} kind={tab} transaction={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
```

- [ ] **Step 2: Add the route**

In `frontend/src/App.jsx`:

Add the lazy import next to the other page imports (around line 33, after `Referrals`):
```js
const WalletReferralHistory = lazy(() => import('./pages/WalletReferralHistory'))
```

Add the route next to `/referrals` (around line 101):
```jsx
<Route path="/wallet-referral-history" element={<WalletReferralHistory />} />
```

- [ ] **Step 3: Add the nav entry**

In `frontend/src/config/navigation.js`:

Add `History` to the lucide-react import list (line 1-37 block).

Add a nav item to the `Financials & Growth` group, right after the `/referrals` entry (line 80):
```js
{ to: '/wallet-referral-history', label: 'Wallet & Referral History', icon: History, roles: ALL_STAFF, built: true },
```

- [ ] **Step 4: Manual verification**

Run: `cd frontend && npm run dev`. Log in, navigate to "Wallet & Referral History" in the sidebar. Confirm:
- Wallet History tab loads, shows rows with correct amount/type/remark/performed-by, search narrows results, pagination works, clicking a row opens the detail modal with all fields.
- Switching to Referral Points History tab does the same for points data.
- As a non-superadmin (city-scoped) test account, confirm only that city's rows appear.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/WalletReferralHistory.jsx frontend/src/App.jsx frontend/src/config/navigation.js
git commit -m "feat(history): add standalone wallet & referral history page"
```

---

### Task 9: Per-user "View History" entry points

**Files:**
- Modify: `frontend/src/components/customers/CustomerDetailDrawer.jsx`
- Modify: `frontend/src/components/drivers/DriverDetailDrawer.jsx`
- Modify: `frontend/src/pages/Referrals.jsx`

**Interfaces:**
- Consumes: the `/wallet-referral-history` route from Task 8, and `WalletAdjustModal` from Task 6 (driver side, new usage).

- [ ] **Step 1: Add "View History" link to `CustomerDetailDrawer.jsx`**

Add `Link` and `History` to the imports (top of file, near line 1-2):
```js
import { Link } from 'react-router-dom'
import { ShieldBan, ShieldCheck, Wallet, Trash2, MapPin, Heart, History } from 'lucide-react'
```

In the action-buttons row (around line 100-108, right after the "Adjust wallet" button), add:
```jsx
<Link
  to={`/wallet-referral-history?tab=wallet&user_id=${customerId}&wallet_type=user`}
  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
>
  <History size={13} /> View wallet history
</Link>
```

- [ ] **Step 2: Add wallet adjust + "View History" to `DriverDetailDrawer.jsx`**

Add imports (top of file):
```js
import { Link } from 'react-router-dom'
```
Add `Wallet` and `History` to the existing lucide-react import block, and:
```js
import WalletAdjustModal from '../common/WalletAdjustModal'
```

Add state near the other `useState` declarations (around line 188):
```js
const [walletOpen, setWalletOpen] = useState(false)
```

In the `canModerate` action-buttons block (around line 373-382, right after the "Edit Profile" button), add:
```jsx
<button
  type="button"
  onClick={() => setWalletOpen(true)}
  className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold"
  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
>
  <Wallet size={13} /> Adjust wallet
</button>
<Link
  to={`/wallet-referral-history?tab=wallet&user_id=${riderId}&wallet_type=driver`}
  className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
>
  <History size={13} /> View wallet history
</Link>
```

Add the modal render near the other modals at the bottom of the component's JSX (follow the existing pattern used for `blockModalOpen`/`deleteModalOpen`):
```jsx
<WalletAdjustModal
  open={walletOpen}
  entityLabel={rider?.full_name || `Driver #${riderId}`}
  endpoint={`/riders/${riderId}/wallet-adjust`}
  onClose={() => setWalletOpen(false)}
  onDone={() => {
    setWalletOpen(false)
    toast.success('Wallet adjusted.')
    refetch()
    onChanged?.()
  }}
/>
```

- [ ] **Step 3: Add "View History" link to `Referrals.jsx` rows**

In `frontend/src/pages/Referrals.jsx`, add a `History` icon to the lucide-react import (line 2) and add an "Actions" column to the table. Change the header array (line 202):
```js
{['Referrer', 'Referred', 'Code', 'Status', 'Points', 'Date', ''].map((h) => (
```
and the `colSpan` values on lines 213, 220, 227 from `6` to `7`.

Add a new cell at the end of each row (after the Date `<td>`, around line 275):
```jsx
<td className="whitespace-nowrap px-4 py-2.5 text-right">
  <Link
    to={`/wallet-referral-history?tab=referral&user_id=${r.referrer?.id}&user_type=${r.referrer?.type}`}
    className="inline-flex items-center gap-1 text-[11.5px] font-medium underline"
    style={{ color: 'var(--brand)' }}
  >
    <History size={12} /> History
  </Link>
</td>
```

(`Link` is already imported in this file at line 3.)

- [ ] **Step 4: Manual verification**

Run: `cd frontend && npm run dev`.
1. Customers → open a customer → "View wallet history" → confirm it lands on the history page pre-filtered to that customer's wallet rows only.
2. Drivers → open a driver → "Adjust wallet" → credit/debit → confirm balance updates and a ledger row appears; "View wallet history" → confirm it's pre-filtered to that driver.
3. Referrals → click "History" on a row → confirm it lands on the referral tab pre-filtered to that referrer.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/customers/CustomerDetailDrawer.jsx frontend/src/components/drivers/DriverDetailDrawer.jsx frontend/src/pages/Referrals.jsx
git commit -m "feat(history): wire per-user wallet/referral history entry points"
```

---

## Post-implementation check

- [ ] Run `cd backend && npx jest` once more — full green.
- [ ] Run `cd frontend && npm run lint` — no new errors introduced.
- [ ] Re-read the spec (`docs/superpowers/specs/2026-09-19-wallet-referral-history-ledger-design.md`) against the finished feature: standalone page ✅, per-user entry points ✅, driver wallet adjust ✅, separate wallet/referral tabs ✅, detail-on-click ✅.

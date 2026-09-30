# Order Goods Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can optionally pick a goods type (admin-managed list, or free-text "Other") when booking, and the driver sees it on the order.

**Architecture:** New `tbl_goods_type` master table + three nullable columns on `pkg_order` (id, name snapshot, other text). A small `goodsTypeService` validates input and formats the driver-facing display string; it is used by `createOrderCore` and by every driver-facing payload. Admin CRUD follows the `CancelReasons` pattern; customer app and driver app are thin consumers.

**Tech Stack:** Node/Express + Prisma (MySQL) + Jest (backend), React + Vite (admin), Flutter (customer app), Java/Android + Gson (driver app).

**Spec:** `docs/superpowers/specs/2026-09-30-order-goods-type-design.md`

**Commits:** the user has not asked for commits in this session. Do not `git add`/`git commit` unless they ask.

## Global Constraints

- Exactly one goods type per order; the field is optional (all three columns may be null).
- `goods_type_other` is trimmed and capped at 100 characters; it never becomes a master-list entry.
- `goods_type_name` is a snapshot copied at booking; renaming/deleting a type never changes old orders.
- Deleting a type used by any order = soft delete (`status=false`); unused type = hard delete.
- Driver display string: name only → `Name`; other only → `Other: <text>`; both → `Name - <text>`; neither → empty string.
- Admin writes are `superadmin` only (same as cancel reasons); list is any staff.
- Customer list endpoint: `GET /api/order/goods-types`, active types only, ordered by `sort_order, name`.

## Review Focus

- Customer sends `goods_type_id: ""`, `0`, `null` or omits it → treated as "no type", order still succeeds.
- Customer sends a non-numeric or unknown/inactive `goods_type_id` → 400 with a clear message, no order created.
- `goods_type_other` that is only whitespace, or longer than 100 chars → whitespace = null, long = truncated to 100.
- Admin deletes a type that old orders reference → soft delete, old orders still show the snapshot name.
- Admin creates a duplicate name (case-insensitive) → 409, not a 500.

## File Structure

- Modify `backend/prisma/schema.prisma`; Create `backend/prisma/migrations/20260930020000_add_goods_type/migration.sql`
- Create `backend/src/services/goodsTypeService.js` — validation + display formatting (one responsibility, no HTTP)
- Create `backend/src/controllers/goodsTypeController.js` — admin CRUD + customer list
- Modify `backend/src/routes/adminRoutes.js`, `backend/src/routes/orderRoutes.js`
- Modify `backend/src/controllers/orderController.js` (`createOrderCore`, `createOrder`, `getOrderDetails`), `backend/src/services/dispatchManager.js`, `backend/src/controllers/driverOrderHistoryController.js`
- Create `frontend/src/pages/GoodsTypes.jsx`, `frontend/src/components/cms/GoodsTypeFormModal.jsx`; Modify `frontend/src/App.jsx`, `frontend/src/config/navigation.js`, `frontend/src/components/orders/OrderDetailDrawer.jsx`
- Modify `ShifterOnline/lib/Api/config.dart`, `ShifterOnline/lib/screens/home/select_vehicle.dart`
- Modify `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/{model/PDOrderItem.java, activity/OrderDetailsActivity.java, activity/BaseActivity.java, utility/OrderDialogHelper.java}`

---

### Task 1: Schema, migration and goodsTypeService

**Files:**
- Modify: `backend/prisma/schema.prisma` (add model; add 3 columns to `pkg_order`, e.g. after `description`)
- Create: `backend/prisma/migrations/20260930020000_add_goods_type/migration.sql`
- Create: `backend/src/services/goodsTypeService.js`
- Test: `backend/src/services/__tests__/goodsTypeService.test.js`

**Interfaces:**
- Produces: `resolveGoodsType({ goodsTypeId, goodsTypeOther }) -> Promise<{ ok: true, goods_type_id: number|null, goods_type_name: string|null, goods_type_other: string|null } | { ok: false, code: "INVALID_GOODS_TYPE", msg: string }>` and `formatGoodsType(order) -> string` (reads `order.goods_type_name`, `order.goods_type_other`).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/__tests__/goodsTypeService.test.js
jest.mock("../../config/db", () => ({ tbl_goods_type: { findFirst: jest.fn() } }));
const prisma = require("../../config/db");
const { resolveGoodsType, formatGoodsType } = require("../goodsTypeService");

beforeEach(() => jest.clearAllMocks());

describe("resolveGoodsType", () => {
  it("returns all-null when nothing is sent (field is optional)", async () => {
    for (const goodsTypeId of [undefined, null, "", 0, "0"]) {
      const r = await resolveGoodsType({ goodsTypeId, goodsTypeOther: undefined });
      expect(r).toEqual({ ok: true, goods_type_id: null, goods_type_name: null, goods_type_other: null });
    }
    expect(prisma.tbl_goods_type.findFirst).not.toHaveBeenCalled();
  });

  it("snapshots the name of an active type", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 4, name: "Construction" });
    const r = await resolveGoodsType({ goodsTypeId: "4" });
    expect(prisma.tbl_goods_type.findFirst).toHaveBeenCalledWith({ where: { id: 4, status: true } });
    expect(r).toEqual({ ok: true, goods_type_id: 4, goods_type_name: "Construction", goods_type_other: null });
  });

  it("rejects an unknown or inactive id", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue(null);
    const r = await resolveGoodsType({ goodsTypeId: 99 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("INVALID_GOODS_TYPE");
  });

  it("rejects a non-numeric id without hitting the database", async () => {
    const r = await resolveGoodsType({ goodsTypeId: "abc" });
    expect(r.ok).toBe(false);
    expect(prisma.tbl_goods_type.findFirst).not.toHaveBeenCalled();
  });

  it("trims Other text, turns whitespace-only into null, and caps at 100 chars", async () => {
    expect((await resolveGoodsType({ goodsTypeOther: "  Bricks  " })).goods_type_other).toBe("Bricks");
    expect((await resolveGoodsType({ goodsTypeOther: "   " })).goods_type_other).toBeNull();
    expect((await resolveGoodsType({ goodsTypeOther: "x".repeat(150) })).goods_type_other).toHaveLength(100);
  });

  it("keeps both the type and the Other text when both are sent", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 4, name: "Construction" });
    const r = await resolveGoodsType({ goodsTypeId: 4, goodsTypeOther: "Tiles" });
    expect(r).toEqual({ ok: true, goods_type_id: 4, goods_type_name: "Construction", goods_type_other: "Tiles" });
  });
});

describe("formatGoodsType", () => {
  it("formats every combination", () => {
    expect(formatGoodsType({ goods_type_name: "Clothing" })).toBe("Clothing");
    expect(formatGoodsType({ goods_type_other: "Tiles" })).toBe("Other: Tiles");
    expect(formatGoodsType({ goods_type_name: "Clothing", goods_type_other: "Silk" })).toBe("Clothing - Silk");
    expect(formatGoodsType({})).toBe("");
    expect(formatGoodsType(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/goodsTypeService.test.js`
Expected: FAIL — `Cannot find module '../goodsTypeService'`.

- [ ] **Step 3: Add schema + migration**

In `schema.prisma` add the model (place near `tbl_cancel_reason`):

```prisma
model tbl_goods_type {
  id         Int      @id @default(autoincrement())
  name       String   @unique @db.VarChar(100)
  status     Boolean  @default(true)
  sort_order Int      @default(0)
  created_at DateTime @default(now()) @db.DateTime(0)
}
```

In `model pkg_order`, directly under `description String? @db.Text`, add:

```prisma
  goods_type_id    Int?
  goods_type_name  String? @db.VarChar(100)
  goods_type_other String? @db.VarChar(100)
```

`migration.sql`:

```sql
-- CreateTable
CREATE TABLE `tbl_goods_type` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    UNIQUE INDEX `tbl_goods_type_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `pkg_order`
    ADD COLUMN `goods_type_id` INTEGER NULL,
    ADD COLUMN `goods_type_name` VARCHAR(100) NULL,
    ADD COLUMN `goods_type_other` VARCHAR(100) NULL;
```

Then run `cd backend && npx prisma generate` (do not run `migrate deploy` against a live DB without the user's say-so).

- [ ] **Step 4: Implement the service**

```js
// backend/src/services/goodsTypeService.js
const prisma = require("../config/db");

const MAX_OTHER_LENGTH = 100;

function cleanOther(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim().slice(0, MAX_OTHER_LENGTH);
  return text || null;
}

/**
 * Validates the optional goods-type inputs of a booking. Empty/0 id means
 * "no type chosen" (the field is optional); a non-empty id must reference an
 * active type, whose NAME is snapshotted so later renames/deletes never
 * change historical orders.
 */
async function resolveGoodsType({ goodsTypeId, goodsTypeOther } = {}) {
  const other = cleanOther(goodsTypeOther);
  const raw = goodsTypeId === undefined || goodsTypeId === null ? "" : String(goodsTypeId).trim();
  if (raw === "" || raw === "0") {
    return { ok: true, goods_type_id: null, goods_type_name: null, goods_type_other: other };
  }
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 0) {
    return { ok: false, code: "INVALID_GOODS_TYPE", msg: "goods_type_id is not valid" };
  }
  const type = await prisma.tbl_goods_type.findFirst({ where: { id, status: true } });
  if (!type) {
    return { ok: false, code: "INVALID_GOODS_TYPE", msg: "Selected goods type is not available" };
  }
  return { ok: true, goods_type_id: type.id, goods_type_name: type.name, goods_type_other: other };
}

/** Single display string shown to drivers/admin; "" when the order has no goods info. */
function formatGoodsType(order) {
  const name = order?.goods_type_name ? String(order.goods_type_name).trim() : "";
  const other = order?.goods_type_other ? String(order.goods_type_other).trim() : "";
  if (name && other) return `${name} - ${other}`;
  if (name) return name;
  if (other) return `Other: ${other}`;
  return "";
}

module.exports = { resolveGoodsType, formatGoodsType };
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/goodsTypeService.test.js`
Expected: PASS (7 tests).

---

### Task 2: Admin CRUD and customer list endpoint

**Files:**
- Create: `backend/src/controllers/goodsTypeController.js`
- Modify: `backend/src/routes/adminRoutes.js` (after the cancel-reasons routes, line ~280), `backend/src/routes/orderRoutes.js` (next to `referral-discount-info`, line ~47)
- Test: `backend/src/controllers/__tests__/goodsTypeController.test.js`

**Interfaces:**
- Consumes: `prisma.tbl_goods_type`, `prisma.pkg_order.count`.
- Produces: handlers `listGoodsTypes` (admin, all rows), `createGoodsType`, `updateGoodsType`, `deleteGoodsType`, `listActiveGoodsTypes` (customer). Admin responses use `{ success, data }`; the customer list returns `{ ResponseCode: "200", Result: true, data: [{ id, name }] }` to match the other `api/order/*` endpoints the Flutter app reads.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/goodsTypeController.test.js
jest.mock("../../config/db", () => ({
  tbl_goods_type: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  pkg_order: { count: jest.fn() },
}));
const prisma = require("../../config/db");
const c = require("../goodsTypeController");

function res() {
  const r = {};
  r.status = jest.fn().mockReturnValue(r);
  r.json = jest.fn().mockReturnValue(r);
  return r;
}
beforeEach(() => jest.clearAllMocks());

describe("goodsTypeController", () => {
  it("customer list returns only active types ordered by sort_order then name", async () => {
    prisma.tbl_goods_type.findMany.mockResolvedValue([{ id: 1, name: "Clothing", status: true, sort_order: 0 }]);
    const r = res();
    await c.listActiveGoodsTypes({}, r);
    expect(prisma.tbl_goods_type.findMany).toHaveBeenCalledWith({
      where: { status: true }, orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
    expect(r.json).toHaveBeenCalledWith({ ResponseCode: "200", Result: true, data: [{ id: 1, name: "Clothing" }] });
  });

  it("create requires a non-blank name", async () => {
    const r = res();
    await c.createGoodsType({ body: { name: "   " } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(prisma.tbl_goods_type.create).not.toHaveBeenCalled();
  });

  it("create rejects a case-insensitive duplicate with 409", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 2, name: "Clothing" });
    const r = res();
    await c.createGoodsType({ body: { name: "clothing" } }, r);
    expect(r.status).toHaveBeenCalledWith(409);
    expect(prisma.tbl_goods_type.create).not.toHaveBeenCalled();
  });

  it("create trims the name and stores it", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue(null);
    prisma.tbl_goods_type.create.mockResolvedValue({ id: 3, name: "Furniture" });
    const r = res();
    await c.createGoodsType({ body: { name: "  Furniture ", sort_order: "2" } }, r);
    expect(prisma.tbl_goods_type.create).toHaveBeenCalledWith({ data: { name: "Furniture", sort_order: 2 } });
    expect(r.status).toHaveBeenCalledWith(201);
  });

  it("update 404s for a missing type", async () => {
    prisma.tbl_goods_type.findUnique.mockResolvedValue(null);
    const r = res();
    await c.updateGoodsType({ params: { id: "9" }, body: { name: "X" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });

  it("delete soft-deletes a type that orders reference", async () => {
    prisma.tbl_goods_type.findUnique.mockResolvedValue({ id: 5, name: "Cement" });
    prisma.pkg_order.count.mockResolvedValue(3);
    const r = res();
    await c.deleteGoodsType({ params: { id: "5" } }, r);
    expect(prisma.tbl_goods_type.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: false } });
    expect(prisma.tbl_goods_type.delete).not.toHaveBeenCalled();
  });

  it("delete hard-deletes an unused type", async () => {
    prisma.tbl_goods_type.findUnique.mockResolvedValue({ id: 6, name: "Unused" });
    prisma.pkg_order.count.mockResolvedValue(0);
    const r = res();
    await c.deleteGoodsType({ params: { id: "6" } }, r);
    expect(prisma.tbl_goods_type.delete).toHaveBeenCalledWith({ where: { id: 6 } });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/goodsTypeController.test.js`
Expected: FAIL — `Cannot find module '../goodsTypeController'`.

- [ ] **Step 3: Implement the controller**

```js
// backend/src/controllers/goodsTypeController.js
const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function listGoodsTypes(req, res) {
  try {
    const rows = await prisma.tbl_goods_type.findMany({ orderBy: [{ sort_order: "asc" }, { name: "asc" }] });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "goodsType.list");
  }
}

// Customer app picker: active types only.
async function listActiveGoodsTypes(req, res) {
  try {
    const rows = await prisma.tbl_goods_type.findMany({
      where: { status: true }, orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    });
    return res.status(200).json({ ResponseCode: "200", Result: true, data: rows.map((r) => ({ id: r.id, name: r.name })) });
  } catch (err) {
    logger.error("goodsType.listActive failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: false, ResponseMsg: "Internal server error" });
  }
}

async function nameTaken(name, exceptId) {
  // MySQL's default collation is case-insensitive, so a plain equality
  // match is a case-insensitive duplicate check.
  const found = await prisma.tbl_goods_type.findFirst({ where: { name } });
  return Boolean(found && found.id !== exceptId);
}

async function createGoodsType(req, res) {
  try {
    const name = String(req.body?.name ?? "").trim().slice(0, 100);
    if (!name) return res.status(400).json({ success: false, message: "name is required" });
    if (await nameTaken(name)) return res.status(409).json({ success: false, message: "A goods type with this name already exists" });
    const sortOrder = Number.parseInt(req.body?.sort_order, 10);
    const created = await prisma.tbl_goods_type.create({
      data: { name, sort_order: Number.isFinite(sortOrder) ? sortOrder : 0 },
    });
    return res.status(201).json({ success: true, message: "Goods type created", data: created });
  } catch (err) {
    return internalError(res, err, "goodsType.create");
  }
}

async function updateGoodsType(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_goods_type.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Goods type not found" });
    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim().slice(0, 100);
      if (!name) return res.status(400).json({ success: false, message: "name cannot be blank" });
      if (await nameTaken(name, id)) return res.status(409).json({ success: false, message: "A goods type with this name already exists" });
      data.name = name;
    }
    if (req.body?.status !== undefined) data.status = Boolean(req.body.status);
    if (req.body?.sort_order !== undefined) {
      const sortOrder = Number.parseInt(req.body.sort_order, 10);
      if (Number.isFinite(sortOrder)) data.sort_order = sortOrder;
    }
    const updated = await prisma.tbl_goods_type.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Goods type updated", data: updated });
  } catch (err) {
    return internalError(res, err, "goodsType.update");
  }
}

async function deleteGoodsType(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_goods_type.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: "Goods type not found" });
    const used = await prisma.pkg_order.count({ where: { goods_type_id: id } });
    if (used > 0) {
      // Old orders keep their name snapshot; just hide the type from new bookings.
      await prisma.tbl_goods_type.update({ where: { id }, data: { status: false } });
      return res.status(200).json({ success: true, message: "Goods type is used by existing orders, so it was deactivated instead of deleted" });
    }
    await prisma.tbl_goods_type.delete({ where: { id } });
    return res.status(200).json({ success: true, message: "Goods type deleted" });
  } catch (err) {
    return internalError(res, err, "goodsType.delete");
  }
}

module.exports = { listGoodsTypes, listActiveGoodsTypes, createGoodsType, updateGoodsType, deleteGoodsType };
```

- [ ] **Step 4: Wire routes**

`adminRoutes.js` — add the require next to the other controller requires and, after the cancel-reasons routes:

```js
const goodsTypeController = require("../controllers/goodsTypeController");
// ...
router.get("/goods-types", auth, goodsTypeController.listGoodsTypes);
router.post("/goods-types", auth, authorize("superadmin"), goodsTypeController.createGoodsType);
router.put("/goods-types/:id", auth, authorize("superadmin"), goodsTypeController.updateGoodsType);
router.delete("/goods-types/:id", auth, authorize("superadmin"), goodsTypeController.deleteGoodsType);
```

`orderRoutes.js` — next to `referral-discount-info`:

```js
router.get("/goods-types", require("../controllers/goodsTypeController").listActiveGoodsTypes);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/goodsTypeController.test.js`
Expected: PASS (7 tests).

---

### Task 3: Save on order creation and expose to drivers/admin

**Files:**
- Modify: `backend/src/controllers/orderController.js` — `createOrderCore` (signature line ~209, validation after line ~224, `prisma.pkg_order.create` data ~442), `createOrder` (destructure ~573, call ~581, error mapping ~598), `getOrderDetails` (~762)
- Modify: `backend/src/services/dispatchManager.js` — `buildOrderRequestPayload` (~312)
- Modify: `backend/src/controllers/driverOrderHistoryController.js` (~214)
- Test: `backend/src/controllers/__tests__/orderController.test.js`, `backend/src/services/__tests__/dispatchManager.test.js`

**Interfaces:**
- Consumes: `resolveGoodsType`, `formatGoodsType` from Task 1 (`require("../services/goodsTypeService")`).
- Produces: `createOrderCore` accepts `goodsTypeId`, `goodsTypeOther`; returns `{ ok:false, code:"INVALID_GOODS_TYPE", msg }` on bad id. Driver-facing payloads gain a `goods_type` string key; the dispatch payload's `order_details` gets an extra `\nGoods: <value>` line when present.

- [ ] **Step 1: Write the failing tests**

In `orderController.test.js`, add `tbl_goods_type: { findFirst: jest.fn() }` to the top `jest.mock("../../config/db", ...)` factory, then inside `describe("orderController.createOrderCore")` (reuses `baseInput`):

```js
  it("stores the goods type id, snapshot name and Other text on the order", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue({ id: 4, name: "Construction" });
    await createOrderCore({ ...baseInput, goodsTypeId: "4", goodsTypeOther: " Tiles " });
    expect(prisma.pkg_order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ goods_type_id: 4, goods_type_name: "Construction", goods_type_other: "Tiles" }),
    });
  });

  it("books normally with all-null goods columns when no goods type is sent", async () => {
    const result = await createOrderCore({ ...baseInput, goodsTypeId: "", goodsTypeOther: undefined });
    expect(result.ok).toBe(true);
    expect(prisma.pkg_order.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ goods_type_id: null, goods_type_name: null, goods_type_other: null }),
    });
  });

  it("rejects an unknown goods type id and creates no order", async () => {
    prisma.tbl_goods_type.findFirst.mockResolvedValue(null);
    const result = await createOrderCore({ ...baseInput, goodsTypeId: 99 });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("INVALID_GOODS_TYPE");
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });
```

In `dispatchManager.test.js` (find the existing `buildOrderRequestPayload` test and copy its argument setup), add:

```js
  it("adds the goods type to the driver payload and order_details", () => {
    const order = { ...baseOrderForPayload, goods_type_name: "Clothing", goods_type_other: null };
    const payload = buildOrderRequestPayload(order, 6, 5, 100, "Mini Truck", Date.now() + 15000);
    expect(payload.goods_type).toBe("Clothing");
    expect(payload.order_details).toContain("\nGoods: Clothing");
  });

  it("leaves order_details untouched and goods_type empty when the order has no goods info", () => {
    const payload = buildOrderRequestPayload({ ...baseOrderForPayload }, 6, 5, 100, "Mini Truck", Date.now() + 15000);
    expect(payload.goods_type).toBe("");
    expect(payload.order_details).not.toContain("Goods:");
  });
```

(`baseOrderForPayload` = whatever order fixture the existing payload test in that file already builds; reuse its name/shape and export/import `buildOrderRequestPayload` the same way that test does.)

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx jest src/controllers/__tests__/orderController.test.js src/services/__tests__/dispatchManager.test.js`
Expected: the 5 new tests FAIL (goods columns undefined / no `goods_type` key); existing tests pass.

- [ ] **Step 3: Implement**

`orderController.js` top: `const { resolveGoodsType, formatGoodsType } = require("../services/goodsTypeService");`

`createOrderCore` signature: add `goodsTypeId, goodsTypeOther,` to the destructured params (next to `body_type, bodyType`). Immediately after the first `VALIDATION` return block (line ~224) add:

```js
  const goods = await resolveGoodsType({ goodsTypeId, goodsTypeOther });
  if (!goods.ok) return goods;
```

In `prisma.pkg_order.create` data (after `description: description || null,`):

```js
      goods_type_id: goods.goods_type_id,
      goods_type_name: goods.goods_type_name,
      goods_type_other: goods.goods_type_other,
```

`createOrder`: destructure `goods_type_id, goods_type_other` from `req.body`, pass `goodsTypeId: goods_type_id, goodsTypeOther: goods_type_other` to `createOrderCore`, and add next to the other error mappings:

```js
    if (!result.ok && result.code === "INVALID_GOODS_TYPE") {
      return res.status(400).json({ ResponseCode: "400", Result: "false", ResponseMsg: result.msg });
    }
```

`getOrderDetails` (next to `description: order.description,`):

```js
          goods_type: formatGoodsType(order),
          goods_type_id: order.goods_type_id,
          goods_type_other: order.goods_type_other,
```

`dispatchManager.js`: require `formatGoodsType` at top; in `buildOrderRequestPayload` compute `const goods = formatGoodsType(order);` before the `return {`, change `order_details` to a template that appends `${goods ? `\nGoods: ${goods}` : ""}` at the end of the existing expression, and add `goods_type: goods,` right after `order_details`. (Line ~748 appends `\nYour route match…` to `order_details` afterwards, which still works.)

`driverOrderHistoryController.js`: require `formatGoodsType`; after `description: row.description,` add `goods_type: formatGoodsType(row),`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/controllers src/services`
Expected: all suites PASS (no regressions).

---

### Task 4: Admin panel — Goods Types page and order drawer

**Files:**
- Create: `frontend/src/pages/GoodsTypes.jsx`, `frontend/src/components/cms/GoodsTypeFormModal.jsx`
- Modify: `frontend/src/App.jsx` (lazy import + `<Route path="/cms/goods-types" ...>` beside cancel-reasons, line ~124), `frontend/src/config/navigation.js` (line ~103, add an item; import a `Package` icon from `lucide-react` if not already imported), `frontend/src/components/orders/OrderDetailDrawer.jsx` (line ~349)

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /goods-types` (Task 2, via `../services/api`), `order.goods_type_name` / `order.goods_type_other` (returned by the admin order endpoint through its `...order` spread — no backend change needed).

- [ ] **Step 1: Create `GoodsTypeFormModal.jsx`** — copy `frontend/src/components/cms/CancelReasonFormModal.jsx` and change: `EMPTY_FORM = { name: '', sort_order: 0, status: true }`; the seed line to `{ name: item.name, sort_order: item.sort_order, status: item.status }`; API calls to `api.put(`/goods-types/${item.id}`, form)` / `api.post('/goods-types', form)`; titles to "Edit goods type" / "New goods type"; error text "Could not save this goods type."; disable submit on `!form.name.trim()`; replace the reason input with a "Name" input (placeholder "e.g. Construction material") and the "Shown to" select with a numeric "Sort order" input (`type="number"`). Keep the Active checkbox for edit.

- [ ] **Step 2: Create `GoodsTypes.jsx`** — copy `frontend/src/pages/CancelReasons.jsx` and change: component name `GoodsTypes`; fetch `/goods-types`; heading "Goods Types" with subtitle "Options customers can pick as the goods being carried when booking."; table headers `['Name', 'Sort', 'Status']` (+ actions column); row cells `t.name`, `t.sort_order`, status badge; button label "New goods type"; delete calls `api.delete(`/goods-types/${deleteTarget.id}`)` and shows `res.data.message` as the success toast (the backend says when it deactivated instead of deleting); delete modal text uses `deleteTarget?.name`; toasts "Goods type updated." / "Goods type created."; use `GoodsTypeFormModal`.

- [ ] **Step 3: Register route and nav**

`App.jsx`: `const GoodsTypes = lazy(() => import('./pages/GoodsTypes'))` and `<Route path="/cms/goods-types" element={<GoodsTypes />} />`.
`navigation.js`, in the same group as cancel reasons: `{ to: '/cms/goods-types', label: 'Goods Types', icon: Package, roles: ALL_STAFF, built: true },`.

- [ ] **Step 4: Show it in the order drawer** — under the `Package Weight` `<Field>` (line ~349) add:

```jsx
<Field label="Goods Type" value={[order.goods_type_name, order.goods_type_other && (order.goods_type_name ? order.goods_type_other : `Other: ${order.goods_type_other}`)].filter(Boolean).join(' - ') || '—'} />
```

- [ ] **Step 5: Verify**

Run: `cd frontend && npm run lint && npm run build`
Expected: no new lint errors; build succeeds. Then run the dev server, open `/cms/goods-types` as superadmin, create "Construction", edit it, delete it; open an order and confirm the Goods Type row renders "—" for old orders.

---

### Task 5: Customer app — optional picker in booking

**Files:**
- Modify: `ShifterOnline/lib/Api/config.dart` (beside `nodeReferralDiscountInfo`, line ~169)
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart` (state near line 89, fetch near `_fetchReferralDiscountInfo` line ~176 and wherever it is called in `initState`, the body map near line 785, and the widget just before the closing `]));` after the referral-points block ~1815)

**Interfaces:**
- Consumes: `GET api/order/goods-types` → `{ Result: true, data: [{id, name}] }`; sends `goods_type_id` (int) and/or `goods_type_other` (string) in the existing order body (Task 3).

- [ ] **Step 1: Config** — add `static const String nodeGoodsTypes = "api/order/goods-types";`.

- [ ] **Step 2: State + fetch** — next to `bool _useReferralPoints = false;` add:

```dart
  List<Map<String, dynamic>> _goodsTypes = [];
  int? _goodsTypeId;
  bool _goodsOtherSelected = false;
  final TextEditingController _goodsOtherController = TextEditingController();
```

Add `_goodsOtherController.dispose();` in the existing `dispose()` (create one calling `super.dispose()` if absent). Add and call (from the same place `_fetchReferralDiscountInfo()` is called):

```dart
  Future<void> _fetchGoodsTypes() async {
    final response = await ApiWrapper.dataGetNode(Config.nodeGoodsTypes);
    if (!mounted) return;
    if (response is Map && (response['Result'] == true || response['Result'] == 'true') && response['data'] is List) {
      setState(() {
        _goodsTypes = (response['data'] as List).whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      });
    }
  }
```

A failed fetch leaves the list empty; the section then shows only the "Other" option, so booking is never blocked.

- [ ] **Step 3: Send in the order body** — beside the `use_referral_points` line (~785):

```dart
      if (_goodsTypeId != null) 'goods_type_id': _goodsTypeId,
      if (_goodsOtherSelected && _goodsOtherController.text.trim().isNotEmpty) 'goods_type_other': _goodsOtherController.text.trim(),
```

- [ ] **Step 4: Add the UI** — before the closing `]));` of the fare/referral card (after the `if (_referralDiscountEnabled ...) ...[ ... ],` block), add:

```dart
      const SizedBox(height: 14),
      Text('Goods type (optional)', style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 14)),
      const SizedBox(height: 8),
      Wrap(spacing: 8, runSpacing: 8, children: [
        ..._goodsTypes.map((t) {
          final id = int.tryParse(t['id'].toString());
          final selected = !_goodsOtherSelected && _goodsTypeId == id;
          return ChoiceChip(
            label: Text(_text(t['name'])),
            selected: selected,
            selectedColor: linercolor.withOpacity(.15),
            // Tapping the selected chip again clears it — the field is optional.
            onSelected: (_) => setState(() { _goodsOtherSelected = false; _goodsTypeId = selected ? null : id; }),
          );
        }),
        ChoiceChip(
          label: const Text('Other'),
          selected: _goodsOtherSelected,
          selectedColor: linercolor.withOpacity(.15),
          onSelected: (_) => setState(() { _goodsOtherSelected = !_goodsOtherSelected; if (_goodsOtherSelected) _goodsTypeId = null; }),
        ),
      ]),
      if (_goodsOtherSelected) Padding(
        padding: const EdgeInsets.only(top: 8),
        child: TextField(
          controller: _goodsOtherController,
          maxLength: 100,
          style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium'),
          decoration: InputDecoration(hintText: 'Describe your goods', hintStyle: TextStyle(color: greaycolor), border: OutlineInputBorder(borderRadius: BorderRadius.circular(12))),
        ),
      ),
```

- [ ] **Step 5: Verify**

Run: `cd ShifterOnline && flutter analyze lib/screens/home/select_vehicle.dart lib/Api/config.dart`
Expected: no new errors. Manual: book with (a) nothing chosen, (b) "Construction", (c) "Other" + text, (d) "Other" chosen but text left blank; confirm each order shows the right value in the admin drawer. The booking must succeed in every case.

---

### Task 6: Driver app — show goods type

**Files:**
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/model/PDOrderItem.java`
- Modify: `.../activity/OrderDetailsActivity.java` (rebuild at ~2408, timeline call ~1040)
- Modify: `.../activity/BaseActivity.java` (`buildOrderItemFromData`, ~228), `.../utility/OrderDialogHelper.java` (`startOrderDetailsActivity`, ~553)

**Interfaces:**
- Consumes: `goods_type` string key (Task 3) in the REST/history JSON (Gson, auto-mapped by `@SerializedName`) and in the FCM/socket data map.
- Produces: `PDOrderItem.getGoodsType()` / `setGoodsType(String)`.

- [ ] **Step 1: `PDOrderItem`** — after the `freeWaitingTime` field block add a NON-final field (so the big constructor and its 3 call sites stay untouched):

```java
	@SerializedName("goods_type")
	private String goodsType;
```

Add accessors next to `getFreeWaitingTime()`:

```java
	public String getGoodsType() {
		return goodsType;
	}

	public void setGoodsType(String goodsType) {
		this.goodsType = goodsType;
	}
```

In the `Parcel` constructor, after `paymentStatus = in.readString();` add `goodsType = in.readString();`. In `writeToParcel`, after `parcel.writeString(paymentStatus);` add `parcel.writeString(goodsType);` (read/write order must match — both are last).

- [ ] **Step 2: Fill it from push/socket data** — in `BaseActivity.buildOrderItemFromData`, change `return new PDOrderItem(...)` to assign to a local `PDOrderItem item`, then `item.setGoodsType(getMapValue(data, "goods_type", "")); return item;`. In `OrderDialogHelper.startOrderDetailsActivity`, right after `orderItem.setAdvancePayment(...)` add `orderItem.setGoodsType(getMapValue(data, "goods_type", ""));`.

- [ ] **Step 3: Keep it when the order item is rebuilt** — in `OrderDetailsActivity` at the `orderItem = new PDOrderItem(... )` rebuild (~2408): before it capture `String existingGoodsType = orderItem.getGoodsType();` (next to `existingStops`), and right after `orderItem.setStops(existingStops);` add `orderItem.setGoodsType(existingGoodsType);`.

- [ ] **Step 4: Show it** — replace the call at ~1040 with:

```java
        String packageNote = orderItem.getDescription();
        String goodsType = orderItem.getGoodsType();
        // The socket/FCM payload already appends "Goods: …" to order_details
        // (which becomes the description); only add it when it is missing so
        // it never shows twice.
        if (!TextUtils.isEmpty(goodsType) && (packageNote == null || !packageNote.contains("Goods: "))) {
            packageNote = "Goods: " + goodsType + (TextUtils.isEmpty(packageNote) ? "" : "\n" + packageNote);
        }
        buildDeliveryTimeline(pAddress, dAddress, orderItem.getStops(), packageNote);
```

- [ ] **Step 5: Verify**

Run: `cd ShifterDriver/ShifterDriver && ./gradlew :app:compileDebugJavaWithJavac` (Windows: `gradlew.bat`).
Expected: BUILD SUCCESSFUL. Manual: with an order that has a goods type — the incoming-order popup shows the "Goods: …" line, the order-details screen shows it after accept, and it is still there after pickup-complete (the rebuild path) and after reopening the app (saved active order). An order without a goods type shows no goods line.

---

## Self-Review

- **Spec coverage:** table + columns + snapshot (T1); admin CRUD, soft delete, 409 duplicates, customer list (T2); optional/validated create, driver display string, `order_details` line, history/detail payloads (T3); admin page + drawer (T4); customer picker with Other (T5); driver display (T6). Testing section covered by T1–T3 automated tests and T4–T6 manual checks.
- **Placeholders:** none; `baseOrderForPayload` in T3 is explicitly "reuse the existing fixture in that test file".
- **Type consistency:** `resolveGoodsType`/`formatGoodsType` names and the `goods_type` payload key are identical across T1, T3, T6; Flutter sends `goods_type_id` / `goods_type_other`, which `createOrder` reads in T3.

# Admin-Configurable Vehicle Detail Specs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `getVehicleSpecs()` lookup table with admin-editable per-category fields (dimensions, max load, detail image) and a global policy-notes list, and add a customer-app "Details" screen that shows them.

**Architecture:** Four new nullable columns on `pkg_category` (read by the existing `availableVehicles` endpoint instead of the hardcoded function it currently calls); the global notes list piggybacks on the existing generic `app_settings` key/value "flags" mechanism (zero new backend code needed for storage — only a dedicated admin UI textarea instead of the generic single-line flag editor). Flutter gets one new screen fed entirely from data the Select Vehicle screen already fetches — no second API call.

**Tech Stack:** Node/Express/Prisma/MySQL backend, React admin panel, Flutter (Dart) customer app — all pre-existing in this repo, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-17-vehicle-detail-specs-design.md`

## Global Constraints

- All five new `pkg_category` columns are nullable, no defaults required — a category with unset specs must omit that section on the detail screen, never fabricate a zero or empty string as if it were real data.
- Policy notes and the three badges (Safe & Secure / Fast Delivery / Affordable) are global, not per-category — one list applies to every category's detail screen. Badges are hardcoded in Flutter, not admin-editable.
- Images stay a path/URL text field (matches every other image field in this codebase) — no file upload capability is added.
- `max_load_kg` is informational display only — it must not be read anywhere in pricing or dispatch eligibility logic.
- Existing `cat_img`/`other_image` columns and every current reader of them are untouched.

---

### Task 1: Database migration — `pkg_category` detail-spec columns

**Files:**
- Create: `backend/sql/20260917_vehicle_detail_specs.sql`
- Modify: `backend/prisma/schema.prisma` (`pkg_category` model, currently at line 163)

**Interfaces:**
- Produces: `pkg_category.max_load_kg` (Decimal?), `pkg_category.dim_length` (Decimal?), `pkg_category.dim_width` (Decimal?), `pkg_category.dim_height` (Decimal?), `pkg_category.dim_unit` (String?), `pkg_category.detail_image` (String?) — read by Task 3, written by Task 2.

- [ ] **Step 1: Write the migration SQL**

```sql
-- backend/sql/20260917_vehicle_detail_specs.sql
-- Admin-configurable vehicle detail specs shown on the customer app's new
-- "Details" screen per vehicle category, replacing the hardcoded
-- getVehicleSpecs() lookup table in orderAvailabilityController.js.
ALTER TABLE pkg_category
  ADD COLUMN max_load_kg DECIMAL(10,2) NULL,
  ADD COLUMN dim_length DECIMAL(10,2) NULL,
  ADD COLUMN dim_width DECIMAL(10,2) NULL,
  ADD COLUMN dim_height DECIMAL(10,2) NULL,
  ADD COLUMN dim_unit VARCHAR(4) NULL,
  ADD COLUMN detail_image TEXT NULL;
```

- [ ] **Step 2: Apply the migration**

Run against the configured `DATABASE_URL` (from `backend/.env`):

```bash
cd backend
node -e "
const prisma = require('./src/config/db');
const fs = require('fs');
const sql = fs.readFileSync('sql/20260917_vehicle_detail_specs.sql', 'utf8')
  .split(';').map(s => s.trim()).filter(Boolean);
(async () => {
  for (const stmt of sql) await prisma.\$executeRawUnsafe(stmt);
  console.log('Migration applied');
  await prisma.\$disconnect();
})();
"
```

Expected: prints `Migration applied` with no error. If it errors with "Duplicate column name", the migration already ran — safe to treat as done.

- [ ] **Step 3: Update `schema.prisma`**

In `backend/prisma/schema.prisma`, find the `pkg_category` model (currently):

```prisma
model pkg_category {
  cat_img     String  @db.Text
  other_image String? @db.VarChar(255)
  id          Int     @id @default(autoincrement())
  cat_status  Int
  cat_name    String  @db.Text
  city_id     Int?
  sort_order  Int?
}
```

Replace with:

```prisma
model pkg_category {
  cat_img       String   @db.Text
  other_image   String?  @db.VarChar(255)
  id            Int      @id @default(autoincrement())
  cat_status    Int
  cat_name      String   @db.Text
  city_id       Int?
  sort_order    Int?
  max_load_kg   Decimal? @db.Decimal(10, 2)
  dim_length    Decimal? @db.Decimal(10, 2)
  dim_width     Decimal? @db.Decimal(10, 2)
  dim_height    Decimal? @db.Decimal(10, 2)
  dim_unit      String?  @db.VarChar(4)
  detail_image  String?  @db.Text
}
```

- [ ] **Step 4: Regenerate the Prisma client**

```bash
cd backend
npx prisma generate
```

Expected: "Generated Prisma Client" with no error.

- [ ] **Step 5: Sanity-check the new columns load**

```bash
cd backend
node -e "
const prisma = require('./src/config/db');
prisma.pkg_category.findFirst().then((row) => {
  console.log('max_load_kg' in row, 'dim_length' in row, 'detail_image' in row);
  process.exit(0);
});
"
```

Expected: `true true true`.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/20260917_vehicle_detail_specs.sql backend/prisma/schema.prisma
git commit -m "$(cat <<'EOF'
feat(db): add admin-configurable vehicle detail spec columns to pkg_category

max_load_kg, dim_length/width/height, dim_unit, detail_image — replaces
the hardcoded getVehicleSpecs() lookup table (next task).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Admin CRUD — `masterDataController.createCategory`/`updateCategory`

**Files:**
- Modify: `backend/src/controllers/masterDataController.js:164-207`
- Test: `backend/src/controllers/__tests__/masterDataController.test.js` (new file)

**Interfaces:**
- Consumes: `prisma.pkg_category` from Task 1's schema.
- Produces: `createCategory`/`updateCategory` accept and persist `max_load_kg`, `dim_length`, `dim_width`, `dim_height`, `dim_unit`, `detail_image` in `req.body` — read by Task 4 (admin UI).

- [ ] **Step 1: Write the failing tests**

```javascript
// backend/src/controllers/__tests__/masterDataController.test.js
jest.mock("../../config/db", () => ({
  pkg_category: { create: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
}));

const prisma = require("../../config/db");
const { createCategory, updateCategory } = require("../masterDataController");

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("masterDataController category detail specs", () => {
  beforeEach(() => jest.clearAllMocks());

  it("createCategory persists detail-spec fields when provided", async () => {
    prisma.pkg_category.create.mockResolvedValue({ id: 1 });
    const req = {
      body: {
        cat_name: "Bike", cat_img: "images/category/bike.png",
        max_load_kg: 20, dim_length: 1.5, dim_width: 1, dim_height: 1,
        dim_unit: "ft", detail_image: "images/category/bike_detail.png",
      },
    };

    await createCategory(req, makeRes());

    expect(prisma.pkg_category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        max_load_kg: 20, dim_length: 1.5, dim_width: 1, dim_height: 1,
        dim_unit: "ft", detail_image: "images/category/bike_detail.png",
      }),
    });
  });

  it("createCategory defaults detail-spec fields to null when omitted", async () => {
    prisma.pkg_category.create.mockResolvedValue({ id: 1 });
    const req = { body: { cat_name: "Bike", cat_img: "images/category/bike.png" } };

    await createCategory(req, makeRes());

    expect(prisma.pkg_category.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        max_load_kg: null, dim_length: null, dim_width: null,
        dim_height: null, dim_unit: null, detail_image: null,
      }),
    });
  });

  it("updateCategory only writes detail-spec fields that are present in the request", async () => {
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 1, cat_name: "Bike" });
    prisma.pkg_category.update.mockResolvedValue({ id: 1 });
    const req = { params: { id: "1" }, body: { max_load_kg: 25 } };

    await updateCategory(req, makeRes());

    const data = prisma.pkg_category.update.mock.calls[0][0].data;
    expect(data.max_load_kg).toBe(25);
    expect(data).not.toHaveProperty("dim_length");
    expect(data).not.toHaveProperty("detail_image");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
npx jest src/controllers/__tests__/masterDataController.test.js
```

Expected: FAIL — `create`/`update` not called with the new fields (current code doesn't send them).

- [ ] **Step 3: Update `createCategory`**

In `backend/src/controllers/masterDataController.js`, replace:

```javascript
async function createCategory(req, res) {
  try {
    const { cat_name, cat_img, cat_status, city_id, sort_order, other_image } = req.body;
    if (!cat_name || !cat_img) {
      return res.status(400).json({ success: false, message: "cat_name and cat_img are required" });
    }
    const created = await prisma.pkg_category.create({
      data: {
        cat_name,
        cat_img,
        other_image: other_image ?? null,
        cat_status: cat_status === undefined ? 1 : Number(cat_status),
        city_id: city_id ? parseInt(city_id, 10) : null,
        sort_order: sort_order !== undefined ? parseInt(sort_order, 10) : 0,
      },
    });
    return res.status(201).json({ success: true, message: "Category created", data: created });
  } catch (err) {
    return internalError(res, err, "createCategory");
  }
}
```

with:

```javascript
async function createCategory(req, res) {
  try {
    const {
      cat_name, cat_img, cat_status, city_id, sort_order, other_image,
      max_load_kg, dim_length, dim_width, dim_height, dim_unit, detail_image,
    } = req.body;
    if (!cat_name || !cat_img) {
      return res.status(400).json({ success: false, message: "cat_name and cat_img are required" });
    }
    const created = await prisma.pkg_category.create({
      data: {
        cat_name,
        cat_img,
        other_image: other_image ?? null,
        cat_status: cat_status === undefined ? 1 : Number(cat_status),
        city_id: city_id ? parseInt(city_id, 10) : null,
        sort_order: sort_order !== undefined ? parseInt(sort_order, 10) : 0,
        max_load_kg: max_load_kg !== undefined && max_load_kg !== "" ? Number(max_load_kg) : null,
        dim_length: dim_length !== undefined && dim_length !== "" ? Number(dim_length) : null,
        dim_width: dim_width !== undefined && dim_width !== "" ? Number(dim_width) : null,
        dim_height: dim_height !== undefined && dim_height !== "" ? Number(dim_height) : null,
        dim_unit: dim_unit || null,
        detail_image: detail_image || null,
      },
    });
    return res.status(201).json({ success: true, message: "Category created", data: created });
  } catch (err) {
    return internalError(res, err, "createCategory");
  }
}
```

- [ ] **Step 4: Update `updateCategory`**

Replace:

```javascript
    const { cat_name, cat_img, cat_status, city_id, sort_order, other_image } = req.body;
    const data = {};
    if (cat_name !== undefined) data.cat_name = cat_name;
    if (cat_img !== undefined) data.cat_img = cat_img;
    if (other_image !== undefined) data.other_image = other_image;
    if (cat_status !== undefined) data.cat_status = Number(cat_status);
    if (city_id !== undefined) data.city_id = city_id ? parseInt(city_id, 10) : null;
    if (sort_order !== undefined) data.sort_order = parseInt(sort_order, 10);
```

with:

```javascript
    const {
      cat_name, cat_img, cat_status, city_id, sort_order, other_image,
      max_load_kg, dim_length, dim_width, dim_height, dim_unit, detail_image,
    } = req.body;
    const data = {};
    if (cat_name !== undefined) data.cat_name = cat_name;
    if (cat_img !== undefined) data.cat_img = cat_img;
    if (other_image !== undefined) data.other_image = other_image;
    if (cat_status !== undefined) data.cat_status = Number(cat_status);
    if (city_id !== undefined) data.city_id = city_id ? parseInt(city_id, 10) : null;
    if (sort_order !== undefined) data.sort_order = parseInt(sort_order, 10);
    if (max_load_kg !== undefined) data.max_load_kg = max_load_kg === "" ? null : Number(max_load_kg);
    if (dim_length !== undefined) data.dim_length = dim_length === "" ? null : Number(dim_length);
    if (dim_width !== undefined) data.dim_width = dim_width === "" ? null : Number(dim_width);
    if (dim_height !== undefined) data.dim_height = dim_height === "" ? null : Number(dim_height);
    if (dim_unit !== undefined) data.dim_unit = dim_unit || null;
    if (detail_image !== undefined) data.detail_image = detail_image || null;
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend
npx jest src/controllers/__tests__/masterDataController.test.js
```

Expected: PASS (3/3).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/masterDataController.js backend/src/controllers/__tests__/masterDataController.test.js
git commit -m "$(cat <<'EOF'
feat(admin): accept vehicle detail-spec fields on category create/update

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `orderAvailabilityController` — replace hardcoded specs, add notes

**Files:**
- Modify: `backend/src/controllers/orderAvailabilityController.js`
- Test: `backend/src/controllers/__tests__/orderAvailabilityController.test.js`

**Interfaces:**
- Consumes: `pkg_category.max_load_kg`/`dim_length`/`dim_width`/`dim_height`/`dim_unit`/`detail_image` from Task 1. `prisma.app_settings.findFirst()` for the global notes list (same table `settingsController.getSettings` already reads for `flags`).
- Produces: each `categories`/`vehicle_categories` entry in the `availableVehicles` response gains `max_load_kg`, `max_dimensions` (formatted string, e.g. `"1.5 x 1 x 1 ft"`, or `null` if any of the three is missing), `detail_image`. Response gains a top-level (and `data.`) `vehicle_detail_notes: string[]`. Consumed by Task 6/7 (Flutter).

- [ ] **Step 1: Write the failing tests**

Add to the existing `backend/src/controllers/__tests__/orderAvailabilityController.test.js` (extend the mock and `stubCommonLookups` already there — add `app_settings: { findFirst: jest.fn() }` to the `jest.mock("../../config/db", ...)` block, and have `stubCommonLookups()` set `prisma.app_settings.findFirst.mockResolvedValue(null)` by default):

```javascript
  it("reads max load/dimensions from the category row instead of a hardcoded table", async () => {
    stubCommonLookups();
    prisma.pkg_category.findMany.mockResolvedValue([{
      id: 1, cat_name: "Bike", cat_img: null,
      max_load_kg: 20, dim_length: 1.5, dim_width: 1, dim_height: 1, dim_unit: "ft",
      detail_image: "images/category/bike_detail.png",
    }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const payload = res.json.mock.calls[0][0];
    const category = payload.categories[0];
    expect(category.max_load_kg).toBe(20);
    expect(category.max_dimensions).toBe("1.5 x 1 x 1 ft");
    expect(category.detail_image).toBe("images/category/bike_detail.png");
  });

  it("omits max_dimensions when any dimension is unset, without fabricating a value", async () => {
    stubCommonLookups();
    prisma.pkg_category.findMany.mockResolvedValue([{
      id: 1, cat_name: "Bike", cat_img: null,
      max_load_kg: null, dim_length: null, dim_width: null, dim_height: null, dim_unit: null,
      detail_image: null,
    }]);
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const category = res.json.mock.calls[0][0].categories[0];
    expect(category.max_load_kg).toBeNull();
    expect(category.max_dimensions).toBeNull();
  });

  it("surfaces the global vehicle_detail_notes list from app_settings", async () => {
    stubCommonLookups();
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: "vehicle_detail_notes", setting_value: "Note one.\nNote two." });
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    const payload = res.json.mock.calls[0][0];
    expect(payload.vehicle_detail_notes).toEqual(["Note one.", "Note two."]);
    expect(payload.data.vehicle_detail_notes).toEqual(["Note one.", "Note two."]);
  });

  it("returns an empty notes list when the setting is unset", async () => {
    stubCommonLookups();
    prisma.$queryRaw.mockResolvedValueOnce([{ rider_id: 1, distance_km: 1.2 }]);

    const req = { body: { pickup_lat: 22.7, pickup_lng: 75.8, radius_km: 4, booking_type: "now" } };
    const res = makeRes();
    await availableVehicles(req, res);

    expect(res.json.mock.calls[0][0].vehicle_detail_notes).toEqual([]);
  });
```

Also update `stubCommonLookups()` to add `prisma.app_settings.findFirst.mockResolvedValue(null);` and add `app_settings: { findFirst: jest.fn() }` to the top `jest.mock` block.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
npx jest src/controllers/__tests__/orderAvailabilityController.test.js
```

Expected: FAIL — `category.max_load_kg`/`max_dimensions`/`detail_image` undefined (still hardcoded), `payload.vehicle_detail_notes` undefined.

- [ ] **Step 3: Remove `getVehicleSpecs()` and add a notes helper**

In `backend/src/controllers/orderAvailabilityController.js`, delete the entire `getVehicleSpecs` function (lines 37-58):

```javascript
function getVehicleSpecs(catName) {
  const c = String(catName || "").toLowerCase();
  if (c.includes("bike") || c.includes("two") || c.includes("motorcycle")) {
    return { max_weight_kg: 10, max_dimensions: "40 x 40 x 40 cm" };
  }
  if (c.includes("scooter")) {
    return { max_weight_kg: 15, max_dimensions: "45 x 45 x 45 cm" };
  }
  if (c.includes("auto") || c.includes("three") || c.includes("3")) {
    return { max_weight_kg: 100, max_dimensions: "100 x 100 x 100 cm" };
  }
  if (c.includes("loader") || c.includes("electric")) {
    return { max_weight_kg: 350, max_dimensions: "150 x 100 x 100 cm" };
  }
  if (c.includes("ace") || c.includes("tata") || c.includes("chota") || c.includes("four") || c.includes("4")) {
    return { max_weight_kg: 750, max_dimensions: "210 x 140 x 140 cm" };
  }
  if (c.includes("pickup") || c.includes("8ft") || c.includes("bolero")) {
    return { max_weight_kg: 1200, max_dimensions: "250 x 150 x 150 cm" };
  }
  return { max_weight_kg: 20, max_dimensions: "50 x 50 x 50 cm" };
}
```

Replace it with:

```javascript
// Admin-configured per-category specs (pkg_category.max_load_kg/dim_*),
// not derived or guessed - a category with any dimension unset shows no
// dimensions at all rather than fabricating one (see Global Constraints).
function formatVehicleSpecs(category) {
  const maxLoadKg = category.max_load_kg !== null && category.max_load_kg !== undefined ? Number(category.max_load_kg) : null;
  const { dim_length, dim_width, dim_height, dim_unit } = category;
  const hasAllDims = dim_length !== null && dim_length !== undefined
    && dim_width !== null && dim_width !== undefined
    && dim_height !== null && dim_height !== undefined;
  const maxDimensions = hasAllDims
    ? `${Number(dim_length)} x ${Number(dim_width)} x ${Number(dim_height)} ${dim_unit || "ft"}`
    : null;
  return { max_weight_kg: maxLoadKg, max_dimensions: maxDimensions, detail_image: category.detail_image || null };
}

// One global list, admin-edited under Settings > "Vehicle Detail Notes"
// (Task 5) — stored via the existing generic app_settings key/value
// mechanism settingsController already exposes as `flags`, newline-
// separated rather than JSON since the admin UI is a single textarea.
async function getVehicleDetailNotes() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: "vehicle_detail_notes" } });
  if (!row?.setting_value) return [];
  return row.setting_value.split("\n").map((line) => line.trim()).filter(Boolean);
}
```

- [ ] **Step 4: Use `formatVehicleSpecs` instead of `getVehicleSpecs`**

Find (inside the `for (const pkg of packages)` loop):

```javascript
      const specs = getVehicleSpecs(catName);

      vehicles.push({
```

Replace with:

```javascript
      const specs = formatVehicleSpecs(category);

      vehicles.push({
```

(`specs.max_weight_kg`/`specs.max_dimensions` below are unchanged — same field names, new values. `specs.detail_image` is not needed on the per-model `vehicles` entries, only on the category summary — see next step.)

- [ ] **Step 5: Carry the specs onto `categoriesSummary` entries**

Find the `catMap` construction:

```javascript
    const catMap = new Map();
    for (const v of vehicles) {
      if (!catMap.has(v.cat_id)) {
        catMap.set(v.cat_id, {
          id: v.cat_id,
          cat_id: v.cat_id,
          cat_name: v.cat_name,
          name: v.cat_name,
          title: v.cat_name,
          vehicle_type: v.cat_name,
          cat_img: v.cat_img,
          image: v.image,
          available: false,
```

Add three fields right after `image: v.image,`:

```javascript
          cat_img: v.cat_img,
          image: v.image,
          max_load_kg: v.max_weight_kg,
          max_dimensions: v.max_dimensions,
          detail_image: v.detail_image,
          available: false,
```

This requires `v.max_weight_kg`/`v.max_dimensions`/`v.detail_image` to exist on each `vehicles` push — they already do for the first two (existing fields, now sourced from `formatVehicleSpecs`); add `detail_image` to the `vehicles.push({...})` object from Step 4, right after the existing `max_dimensions: specs.max_dimensions,` line:

```javascript
        max_weight_kg: specs.max_weight_kg,
        max_dimensions: specs.max_dimensions,
        detail_image: specs.detail_image,
        reason_unavailable: reasonUnavailable,
```

- [ ] **Step 6: Fetch and include `vehicle_detail_notes` in the response**

Find (near the top of `availableVehicles`, after `const settingRow = await prisma.setting.findFirst();` line):

```javascript
    const settingRow = await prisma.setting.findFirst();
    const currency = settingRow?.currency || "INR";
```

Add a line to fetch notes in parallel:

```javascript
    const [settingRow, vehicleDetailNotes] = await Promise.all([
      prisma.setting.findFirst(),
      getVehicleDetailNotes(),
    ]);
    const currency = settingRow?.currency || "INR";
```

Then find the final response object and add `vehicle_detail_notes` at both the top level and inside `data`:

```javascript
    return res.status(200).json({
      success: true,
      serviceable: true,
      search_radius_km: radiusKm,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Available vehicles fetched successfully",
      message: "Available vehicles fetched successfully",
      pickup_area: pickupArea,
      vehicles,
      categories: categoriesSummary,
      vehicle_categories: categoriesSummary,
      pkgc: categoriesSummary,
      radius_suggestion: radiusSuggestion,
      vehicle_detail_notes: vehicleDetailNotes,
      data: {
        serviceable: true,
        search_radius_km: radiusKm,
        pickup_area: pickupArea,
        vehicles,
        categories: categoriesSummary,
        radius_suggestion: radiusSuggestion,
        vehicle_detail_notes: vehicleDetailNotes,
      },
    });
```

- [ ] **Step 7: Run tests to verify they pass**

```bash
cd backend
npx jest src/controllers/__tests__/orderAvailabilityController.test.js
```

Expected: PASS (all tests, including the 4 new ones).

- [ ] **Step 8: Run the full backend suite**

```bash
cd backend
npx jest
```

Expected: same pass count as before this task plus the new tests — no regressions (the one pre-existing unrelated `aadharPdfVerify` failure may still be present; that's not this task's concern).

- [ ] **Step 9: Commit**

```bash
git add backend/src/controllers/orderAvailabilityController.js backend/src/controllers/__tests__/orderAvailabilityController.test.js
git commit -m "$(cat <<'EOF'
feat(orders): serve admin-configured vehicle specs instead of a hardcoded table

getVehicleSpecs() is gone - max_weight_kg/max_dimensions now come straight
from pkg_category's admin-editable columns (Task 1/2), with no fabricated
values when a category has none set. Also surfaces a global
vehicle_detail_notes list (app_settings) for the new customer-app Details
screen.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Admin panel — `CategoryFormModal.jsx` detail-spec fields

**Files:**
- Modify: `frontend/src/components/master/CategoryFormModal.jsx`

**Interfaces:**
- Consumes: `PUT /categories/:id` / `POST /categories` from Task 2, which now accepts `max_load_kg`, `dim_length`, `dim_width`, `dim_height`, `dim_unit`, `detail_image`.

No backend test harness exists for this React admin panel (confirmed — no existing `.test.jsx` files anywhere under `frontend/`); verification is a manual smoke test per the spec's Testing section, not an automated test file.

- [ ] **Step 1: Extend `EMPTY_FORM` and the edit-seed effect**

Find:

```javascript
const EMPTY_FORM = { cat_name: '', cat_img: '', city_id: '', sort_order: '0', cat_status: 1 }
```

Replace with:

```javascript
const EMPTY_FORM = {
  cat_name: '', cat_img: '', city_id: '', sort_order: '0', cat_status: 1,
  max_load_kg: '', dim_length: '', dim_width: '', dim_height: '', dim_unit: 'ft', detail_image: '',
}
```

Find the `useEffect` that seeds `form` from `category`:

```javascript
    setForm(
      category
        ? { cat_name: category.cat_name, cat_img: category.cat_img, city_id: category.city_id ?? '', sort_order: String(category.sort_order ?? 0), cat_status: category.cat_status }
        : EMPTY_FORM
    )
```

Replace with:

```javascript
    setForm(
      category
        ? {
            cat_name: category.cat_name, cat_img: category.cat_img, city_id: category.city_id ?? '',
            sort_order: String(category.sort_order ?? 0), cat_status: category.cat_status,
            max_load_kg: category.max_load_kg ?? '', dim_length: category.dim_length ?? '',
            dim_width: category.dim_width ?? '', dim_height: category.dim_height ?? '',
            dim_unit: category.dim_unit || 'ft', detail_image: category.detail_image ?? '',
          }
        : EMPTY_FORM
    )
```

- [ ] **Step 2: Add the form fields**

Find the closing of the city/sort-order grid (right before the `{isEdit && (...status select...)}` block):

```javascript
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-city">
            City (optional)
          </label>
          <select id="cat-city" value={form.city_id} onChange={(e) => setForm((f) => ({ ...f, city_id: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value="">All cities</option>
            {cities?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-sort">
            Sort order
          </label>
          <input id="cat-sort" type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} />
        </div>
      </div>

      {isEdit && (
```

Insert a new block between the grid's closing `</div>` and `{isEdit && (`:

```javascript
      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }} htmlFor="cat-detail-img">
          Detail photo path (shown on the customer app's vehicle Details screen)
        </label>
        <input
          id="cat-detail-img"
          value={form.detail_image}
          onChange={(e) => setForm((f) => ({ ...f, detail_image: e.target.value }))}
          className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
          style={FIELD_STYLE}
          placeholder="images/category/bike_detail.png (falls back to the icon above if left blank)"
        />
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Max load capacity
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={form.max_load_kg}
            onChange={(e) => setForm((f) => ({ ...f, max_load_kg: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none"
            style={FIELD_STYLE}
            placeholder="e.g. 20"
          />
          <span className="text-[13px]" style={{ color: 'var(--ink-muted)' }}>kg</span>
        </div>
      </div>

      <div className="mb-3">
        <label className="mb-1.5 block text-[12px] font-medium" style={{ color: 'var(--ink-muted)' }}>
          Dimensions (shown on the Details screen; leave any blank to hide this section)
        </label>
        <div className="grid grid-cols-4 gap-2">
          <input type="number" value={form.dim_length} onChange={(e) => setForm((f) => ({ ...f, dim_length: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Length" />
          <input type="number" value={form.dim_width} onChange={(e) => setForm((f) => ({ ...f, dim_width: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Width" />
          <input type="number" value={form.dim_height} onChange={(e) => setForm((f) => ({ ...f, dim_height: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE} placeholder="Height" />
          <select value={form.dim_unit} onChange={(e) => setForm((f) => ({ ...f, dim_unit: e.target.value }))} className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none" style={FIELD_STYLE}>
            <option value="ft">ft</option>
            <option value="cm">cm</option>
          </select>
        </div>
      </div>

      {isEdit && (
```

- [ ] **Step 3: Manual smoke test**

Run the admin panel dev server (`cd frontend && npm run dev`), open Master Data > Categories, edit a category, fill in the new fields, save, reopen the edit modal, and confirm the values persisted (came back pre-filled). Also create a brand-new category leaving the new fields blank and confirm it saves without error.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/master/CategoryFormModal.jsx
git commit -m "$(cat <<'EOF'
feat(admin): edit vehicle detail specs from the category form

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Admin panel — global "Vehicle Detail Notes" settings section

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

**Interfaces:**
- Consumes: `GET /settings` (already returns `data.flags`, a generic `app_settings` key/value map per `settingsController.getSettings`); `PUT /settings` (already accepts `{ flags: {...} }` and upserts each key into `app_settings` per `settingsController.updateSettings` — no backend change needed here, confirmed in Task 3's investigation).
- Produces: `flags.vehicle_detail_notes` — a newline-separated string, read by Task 3's `getVehicleDetailNotes()`.

- [ ] **Step 1: Add a dedicated notes section**

Find the section that renders after the KYC cookies section and before the generic "Other Feature Flags" block:

```javascript
        {Object.keys(flags).filter((k) => !['training_video_url', 'training_video_title', 'acko_session_cookie', 'sarathi_state_id'].includes(k)).length > 0 && (
```

Insert a new `<section>` immediately before this line:

```javascript
        <section className="surface-card rounded-xl p-4">
          <div className="mb-3">
            <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
              Vehicle Detail Notes
            </h3>
            <p className="text-[12px] mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              One note per line. Shown as a numbered list on every vehicle category's Details screen in the customer app —
              this text is the same for every vehicle, only its dimensions/max load (set per category above) differ.
            </p>
          </div>
          <Textarea
            id="flag-vehicle_detail_notes"
            rows={5}
            placeholder={"Fare doesn't include labour charges for loading & unloading.\nThe amount shown to you right now is an estimate. The actual amount will be shown based on waiting time or location changes.\nParking charges to be paid by customer.\nFare doesn't include toll and permit charges."}
            value={flags.vehicle_detail_notes ?? ''}
            onChange={(e) => setFlags((f) => ({ ...f, vehicle_detail_notes: e.target.value }))}
          />
          <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-[11.5px]" style={{ color: 'var(--ink-faint)' }}>
              Multi-line — use the button, Enter won't save this field.
            </span>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold shadow-xs transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              <Save size={14} /> {saving ? 'Saving…' : 'Save Notes'}
            </button>
          </div>
        </section>

        {Object.keys(flags).filter((k) => !['training_video_url', 'training_video_title', 'acko_session_cookie', 'sarathi_state_id', 'vehicle_detail_notes'].includes(k)).length > 0 && (
```

(Note the added `'vehicle_detail_notes'` in the filter on the last line — without it, this key would also render a second time as a single-line input in the generic "Other Feature Flags" grid below.)

- [ ] **Step 2: Update the other filter in the same generic-flags block**

A few lines further down, find:

```javascript
              {Object.entries(flags)
                .filter(([key]) => !['training_video_url', 'training_video_title', 'acko_session_cookie', 'sarathi_state_id'].includes(key))
```

Replace with:

```javascript
              {Object.entries(flags)
                .filter(([key]) => !['training_video_url', 'training_video_title', 'acko_session_cookie', 'sarathi_state_id', 'vehicle_detail_notes'].includes(key))
```

- [ ] **Step 3: Manual smoke test**

Run `cd frontend && npm run dev`, open Settings, type a few lines into "Vehicle Detail Notes", click "Save Notes", reload the page, and confirm the lines persisted. Confirm the key does not also appear in "Other Feature Flags" below it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "$(cat <<'EOF'
feat(admin): add a dedicated Vehicle Detail Notes settings section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Flutter — "Details" entry point on Select Vehicle

**Files:**
- Modify: `ShifterOnline/lib/screens/home/select_vehicle.dart`

**Interfaces:**
- Consumes: `decoded['vehicle_detail_notes']` (List, from Task 3's response), `_categoryOf(selected)` (existing helper, now carries `max_load_kg`/`max_dimensions`/`detail_image` per Task 3 Step 5).
- Produces: navigates to `VehicleDetailsScreen` (Task 7) with `category` and `notes` params.

- [ ] **Step 1: Add state for the global notes list**

Find:

```dart
  double? _fareDistanceKm;
  bool _hasPlanDiscount = false;
```

Add a line above it:

```dart
  List<String> _vehicleDetailNotes = [];
  double? _fareDistanceKm;
  bool _hasPlanDiscount = false;
```

- [ ] **Step 2: Populate it in `_refreshAvailability()`**

Find (inside `_refreshAvailability`, in the `setState` block):

```dart
      setState(() {
        _vehicles = refreshed;
        _availabilityError = decoded['serviceable'] == true || refreshed.isNotEmpty ? null : "We couldn't find an available vehicle near your pickup location right now.";
        _selectedIndex = retainedIndex >= 0 ? retainedIndex : -1;
        _selectedModelIndex = null;
      });
```

Replace with:

```dart
      final rawNotes = decoded['vehicle_detail_notes'];
      final notes = rawNotes is List ? rawNotes.map((n) => n.toString()).where((n) => n.trim().isNotEmpty).toList() : <String>[];
      setState(() {
        _vehicles = refreshed;
        _availabilityError = decoded['serviceable'] == true || refreshed.isNotEmpty ? null : "We couldn't find an available vehicle near your pickup location right now.";
        _selectedIndex = retainedIndex >= 0 ? retainedIndex : -1;
        _selectedModelIndex = null;
        _vehicleDetailNotes = notes;
      });
```

- [ ] **Step 3: Add the import**

Find the import block at the top of the file:

```dart
import 'add_stops_screen.dart';
import 'confirm_order_map.dart';
import 'waiting_screen.dart';
```

Add:

```dart
import 'add_stops_screen.dart';
import 'confirm_order_map.dart';
import 'vehicle_details_screen.dart';
import 'waiting_screen.dart';
```

- [ ] **Step 4: Add the "Details" affordance**

Find (`_selectedVehicleSection`'s header row):

```dart
      Row(children: [Expanded(child: Text(_vehicleName(selected), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 19))), if (_loadingModels) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))]),
```

Replace with:

```dart
      Row(children: [
        Expanded(child: Text(_vehicleName(selected), style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 19))),
        if (_loadingModels) const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2)),
        TextButton.icon(
          onPressed: () => Get.to(() => VehicleDetailsScreen(category: _categoryOf(selected), notes: _vehicleDetailNotes)),
          icon: Icon(Icons.info_outline_rounded, color: linercolor, size: 16),
          label: Text('Details', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 12)),
          style: TextButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 6), minimumSize: Size.zero, tapTargetSize: MaterialTapTargetSize.shrinkWrap),
        ),
      ]),
```

- [ ] **Step 5: Commit**

(Deferred to the end of Task 7 — this task and Task 7 are reviewed together since Task 6 references `VehicleDetailsScreen`, which doesn't exist until Task 7. If executing via subagent-driven-development, treat Tasks 6 and 7 as one unit for review purposes, or complete Task 7 first.)

---

### Task 7: Flutter — `vehicle_details_screen.dart`

**Files:**
- Create: `ShifterOnline/lib/screens/home/vehicle_details_screen.dart`

**Interfaces:**
- Consumes: `category` (Map, from `_categoryOf()` in Task 6 — keys: `cat_name`, `cat_img`, `detail_image`, `max_load_kg`, `max_dimensions`), `notes` (`List<String>`, from Task 6).

- [ ] **Step 1: Write the screen**

```dart
import 'package:flutter/material.dart';
import 'package:get/get.dart';
import 'package:provider/provider.dart';

import '../../Api/config.dart';
import '../../utils/colors.dart';

class VehicleDetailsScreen extends StatelessWidget {
  final Map<String, dynamic> category;
  final List<String> notes;

  const VehicleDetailsScreen({super.key, required this.category, this.notes = const []});

  String _text(dynamic value) => value?.toString().trim() ?? '';

  @override
  Widget build(BuildContext context) {
    notifier = Provider.of(context, listen: true);

    final catName = _text(category['cat_name']).isEmpty ? 'Vehicle' : _text(category['cat_name']);
    final detailImage = _text(category['detail_image']).isNotEmpty ? _text(category['detail_image']) : _text(category['cat_img']);
    final maxLoad = _text(category['max_load_kg']);
    final maxDimensions = _text(category['max_dimensions']);

    final allNotes = <String>[
      ...notes,
      if (maxLoad.isNotEmpty || maxDimensions.isNotEmpty)
        'Loading capacity:' +
            (maxLoad.isNotEmpty ? ' Max Load: $maxLoad kg' : '') +
            (maxDimensions.isNotEmpty ? '  Max Size: $maxDimensions' : ''),
    ];

    return Scaffold(
      backgroundColor: notifier.lightBgColor,
      appBar: AppBar(
        backgroundColor: notifier.lightBgColor,
        elevation: 0,
        iconTheme: IconThemeData(color: notifier.text),
        title: Text(catName, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Bold', fontSize: 18)),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
        children: [
          if (detailImage.isNotEmpty)
            Container(
              height: 180,
              decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(16)),
              child: FadeInImage.assetNetwork(
                placeholder: 'assets/loading.gif',
                image: '${Config.nodeImageURLPath}$detailImage',
                fit: BoxFit.contain,
                imageErrorBuilder: (_, __, ___) => Icon(Icons.local_shipping_outlined, color: greaycolor, size: 56),
              ),
            ),
          const SizedBox(height: 18),

          if (maxDimensions.isNotEmpty) ...[
            Builder(builder: (context) {
              // maxDimensions is formatted server-side as "L x W x H unit"
              // (see orderAvailabilityController.formatVehicleSpecs) - split
              // on the literal " x " separator, then strip the trailing unit
              // off the last (height) part. Plain index checks, not
              // elementAtOrNull (that's package:collection, not core Dart).
              final parts = maxDimensions.split(' x ');
              final length = parts.isNotEmpty ? parts[0] : '';
              final width = parts.length > 1 ? parts[1] : '';
              final heightWithUnit = parts.length > 2 ? parts[2] : '';
              final heightParts = heightWithUnit.split(' ');
              final height = heightParts.isNotEmpty ? heightParts[0] : '';
              return Row(mainAxisAlignment: MainAxisAlignment.spaceAround, children: [
                _dimensionStat('Length', length),
                _dimensionStat('Width', width),
                _dimensionStat('Height', height),
              ]);
            }),
            const SizedBox(height: 18),
          ],

          if (maxLoad.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 16),
              decoration: BoxDecoration(border: Border.all(color: notifier.bordecolor), borderRadius: BorderRadius.circular(14)),
              child: Column(children: [
                Text('$maxLoad KG', style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 26)),
                const SizedBox(height: 2),
                Text('MAX LOAD CAPACITY', style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Bold', fontSize: 11, letterSpacing: 0.5)),
              ]),
            ),
          const SizedBox(height: 18),

          Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
            _badge(Icons.verified_user_outlined, 'Safe & Secure'),
            _badge(Icons.bolt_outlined, 'Fast Delivery'),
            _badge(Icons.account_balance_wallet_outlined, 'Affordable'),
          ]),
          const SizedBox(height: 18),

          if (allNotes.isNotEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(color: notifier.getBgColor, borderRadius: BorderRadius.circular(14)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (var i = 0; i < allNotes.length; i++)
                  Padding(
                    padding: EdgeInsets.only(bottom: i == allNotes.length - 1 ? 0 : 12),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      CircleAvatar(radius: 11, backgroundColor: linercolor, child: Text('${i + 1}', style: TextStyle(color: Colors.white, fontSize: 11, fontFamily: 'Gilroy_Bold'))),
                      const SizedBox(width: 10),
                      Expanded(child: Text(allNotes[i], style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 13, height: 1.35))),
                    ]),
                  ),
              ]),
            ),
        ],
      ),
    );
  }

  Widget _dimensionStat(String label, String value) => Column(children: [
        Text(value, style: TextStyle(color: linercolor, fontFamily: 'Gilroy_Bold', fontSize: 18)),
        Text(label, style: TextStyle(color: greaycolor, fontFamily: 'Gilroy_Medium', fontSize: 11)),
      ]);

  Widget _badge(IconData icon, String label) => Column(children: [
        CircleAvatar(radius: 20, backgroundColor: linercolor, child: Icon(icon, color: Colors.white, size: 18)),
        const SizedBox(height: 6),
        Text(label, textAlign: TextAlign.center, style: TextStyle(color: notifier.text, fontFamily: 'Gilroy_Medium', fontSize: 11)),
      ]);
}
```

- [ ] **Step 2: Run static analysis**

```bash
cd ShifterOnline
dart analyze lib/screens/home/vehicle_details_screen.dart lib/screens/home/select_vehicle.dart
```

Expected: no errors (warnings/info about unrelated pre-existing lines are fine — confirm nothing new and nothing referencing `VehicleDetailsScreen`/`category`/`notes` is flagged).

- [ ] **Step 3: Manual smoke test**

Run the app (`flutter run`), reach Select Vehicle for any order, select a vehicle with specs configured (from Task 4's admin test category) and tap "Details" — confirm dimensions/max load/image/notes render. Then select (or configure) a category with no specs set and confirm the screen renders without crashing, simply omitting the dimensions/max-load sections.

- [ ] **Step 4: Commit**

```bash
git add "ShifterOnline/lib/screens/home/vehicle_details_screen.dart" "ShifterOnline/lib/screens/home/select_vehicle.dart"
git commit -m "$(cat <<'EOF'
feat(app): add vehicle details screen sourced from admin-configured specs

Reachable via a new "Details" button next to the selected vehicle's name
on Select Vehicle. Renders dimensions/max load/photo (per category) and
the global policy notes list — all from data the screen already fetched,
no extra API call.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation checklist

- [ ] Full backend suite green (`cd backend && npx jest`) except the pre-existing unrelated `aadharPdfVerify` failure.
- [ ] `dart analyze` clean on both touched/new Flutter files.
- [ ] Admin panel manual smoke test done (Task 4 + Task 5 steps).
- [ ] Flutter manual smoke test done, including a no-specs-set category (Task 7 Step 4).
- [ ] New APKs built and dropped in `APKs/` if the user asks, same as prior sessions (`flutter build apk --release`, driver app untouched this round so no rebuild needed there).

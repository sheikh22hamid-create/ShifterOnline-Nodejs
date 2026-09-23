# Driver Tier Cards & Admin-Driven Info Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove per-km/min-fare from the driver app's tier cards, turn the tier info button into a prominent "Details" chip, and make every word of the tier info popup (plus the card's one-line subtitle) editable per tier from the admin panel instead of hardcoded in the app.

**Architecture:** Three nullable columns are added to `tbl_package` — two subtitle strings and a JSON array of `{heading, body}` sections. A small pure-function service owns normalizing admin input and parsing stored JSON, and both the admin write path (`rateCardController`) and the driver read path (`riderController.packageListForDriver`) use it. The admin panel gains a repeatable sections editor in the existing rate-card modal. The Android app drops its two hardcoded if/else chains: tier icon/colour comes from the existing `TierTheme.resolve(...)`, and all copy comes from the API.

**Tech Stack:** Node.js, Express, Prisma 6 (MySQL), Jest (backend); React + Vite (admin panel); native Android Java with Gson + Retrofit (driver app).

**Spec:** `docs/superpowers/specs/2026-09-23-driver-tier-info-dynamic-design.md`

## Global Constraints

- Exactly three new columns, all nullable and additive: `driver_card_subtitle VarChar(255)?`, `driver_info_subtitle VarChar(255)?`, `driver_info_sections Text?`. No backfill, no seeding of the existing hardcoded copy.
- Section limits, enforced on write: at most **12 sections**, `heading` at most **120 characters**, `body` at most **2000 characters**.
- A normalized sections array that ends up empty is persisted as `null`, never as `"[]"`.
- The driver read path must **never throw** on bad stored data: malformed or non-array JSON degrades to an empty array so the rest of the tier list still renders.
- Section content is **plain text only** — no markdown, no HTML rendering.
- Driver-facing only. Do not change customer-facing fields (`user_title`, `user_detail_image`) beyond the `user_title` select-list bug fix named in Task 4.
- **Driver app files must never be committed.** `.gitignore:8` ignores `ShifterDriver/`; do not `git add -f` any app file. Only backend and `frontend/` changes are committed.
- Backend test convention: `jest.mock("../../config/db", () => ({ ... }))` declaring only the Prisma models the file uses (see `backend/src/controllers/__tests__/rateCardGenerateModels.test.js`).
- Response envelopes stay as they are: `{ success, message, data }` for admin routes, and the always-HTTP-200 `{ PackageData, ResponseCode, Result, ResponseMsg }` envelope for `api/rider/package-list`.

## Review Focus

- **Malformed JSON already in the column** (hand-edited row, or a failed partial write): the driver tier list must still return every tier with an empty sections array, not a 500. — covered by Task 1 (`parseInfoSections`) and Task 4.
- **A section with a heading but no body, or a body but no heading**: only entries where *both* are empty are dropped; a half-filled section is legitimate content and must survive the round trip. — covered by Task 1.
- **Non-array JSON submitted by the admin** (`{"a":1}`, `"hello"`, `42`): must be rejected with a 400 and a readable message, never silently stored or crashed on. — covered by Tasks 1 and 3.
- **Over-long body or too many sections**: must be rejected on write with a message naming the limit, rather than truncated silently or stored and later breaking the app layout. — covered by Task 1.
- **A tier with sections but no popup subtitle (or a subtitle but no sections)**: the Details chip must still appear, and the popup must render the half it has. Only a tier with *neither* hides the chip. — data side covered by Task 4; UI side is an explicit manual verification step in Tasks 6 and 7.

---

### Task 1: `driverTierInfo` normalize/parse service

**Files:**
- Create: `backend/src/services/driverTierInfo.js`
- Test: `backend/src/services/__tests__/driverTierInfo.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeInfoSections(input): string | null` — accepts an array, a JSON string, `null`/`undefined`/`""`; returns a JSON string ready to persist, or `null` when the result is empty. Throws `InvalidSectionsError` on bad shape or limit violations.
  - `parseInfoSections(stored): Array<{heading: string, body: string}>` — never throws; returns `[]` for null/malformed/non-array.
  - `InvalidSectionsError` — error class; Tasks 3 and 4 use `err instanceof InvalidSectionsError` to decide on a 400.
  - Constants `MAX_SECTIONS = 12`, `MAX_HEADING_LENGTH = 120`, `MAX_BODY_LENGTH = 2000`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/__tests__/driverTierInfo.test.js
const {
  normalizeInfoSections,
  parseInfoSections,
  InvalidSectionsError,
  MAX_SECTIONS,
} = require("../driverTierInfo");

describe("driverTierInfo.normalizeInfoSections", () => {
  it("returns null for null, undefined and empty string", () => {
    expect(normalizeInfoSections(null)).toBeNull();
    expect(normalizeInfoSections(undefined)).toBeNull();
    expect(normalizeInfoSections("")).toBeNull();
    expect(normalizeInfoSections("   ")).toBeNull();
  });

  it("accepts an array and returns a JSON string", () => {
    const out = normalizeInfoSections([{ heading: "Earnings", body: "Up to 20/km" }]);
    expect(JSON.parse(out)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });

  it("accepts an already-serialized JSON string", () => {
    const out = normalizeInfoSections('[{"heading":"Earnings","body":"Up to 20/km"}]');
    expect(JSON.parse(out)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });

  it("trims heading and body", () => {
    const out = normalizeInfoSections([{ heading: "  Earnings  ", body: "  Up to 20/km  " }]);
    expect(JSON.parse(out)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });

  it("drops entries where heading and body are both empty, but keeps half-filled ones", () => {
    const out = normalizeInfoSections([
      { heading: "", body: "" },
      { heading: "Only heading", body: "" },
      { heading: "", body: "Only body" },
    ]);
    expect(JSON.parse(out)).toEqual([
      { heading: "Only heading", body: "" },
      { heading: "", body: "Only body" },
    ]);
  });

  it("returns null when every entry is empty", () => {
    expect(normalizeInfoSections([{ heading: "", body: "" }])).toBeNull();
    expect(normalizeInfoSections([])).toBeNull();
  });

  it("treats missing heading or body keys as empty strings", () => {
    const out = normalizeInfoSections([{ heading: "Only heading" }, { body: "Only body" }]);
    expect(JSON.parse(out)).toEqual([
      { heading: "Only heading", body: "" },
      { heading: "", body: "Only body" },
    ]);
  });

  it("rejects JSON that is not an array", () => {
    expect(() => normalizeInfoSections('{"a":1}')).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections('"hello"')).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections("42")).toThrow(InvalidSectionsError);
  });

  it("rejects a string that is not valid JSON", () => {
    expect(() => normalizeInfoSections("not json at all")).toThrow(InvalidSectionsError);
  });

  it("rejects elements that are not plain objects", () => {
    expect(() => normalizeInfoSections(["a string"])).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections([null])).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections([["nested"]])).toThrow(InvalidSectionsError);
  });

  it("rejects non-string heading or body", () => {
    expect(() => normalizeInfoSections([{ heading: 5, body: "ok" }])).toThrow(InvalidSectionsError);
    expect(() => normalizeInfoSections([{ heading: "ok", body: { a: 1 } }])).toThrow(InvalidSectionsError);
  });

  it("rejects more than MAX_SECTIONS sections", () => {
    const tooMany = Array.from({ length: MAX_SECTIONS + 1 }, (_, i) => ({ heading: `H${i}`, body: "b" }));
    expect(() => normalizeInfoSections(tooMany)).toThrow(/12/);
  });

  it("rejects an over-long heading or body", () => {
    expect(() => normalizeInfoSections([{ heading: "x".repeat(121), body: "b" }])).toThrow(/120/);
    expect(() => normalizeInfoSections([{ heading: "h", body: "x".repeat(2001) }])).toThrow(/2000/);
  });

  it("keeps newlines inside a body", () => {
    const out = normalizeInfoSections([{ heading: "Suitable for", body: "line one\nline two" }]);
    expect(JSON.parse(out)[0].body).toBe("line one\nline two");
  });
});

describe("driverTierInfo.parseInfoSections", () => {
  it("returns an empty array for null and empty string", () => {
    expect(parseInfoSections(null)).toEqual([]);
    expect(parseInfoSections("")).toEqual([]);
  });

  it("parses a stored JSON string", () => {
    expect(parseInfoSections('[{"heading":"Earnings","body":"Up to 20/km"}]')).toEqual([
      { heading: "Earnings", body: "Up to 20/km" },
    ]);
  });

  it("returns an empty array for malformed JSON instead of throwing", () => {
    expect(parseInfoSections("{not json")).toEqual([]);
  });

  it("returns an empty array for valid JSON that is not an array", () => {
    expect(parseInfoSections('{"heading":"x"}')).toEqual([]);
  });

  it("drops junk entries and coerces missing keys to empty strings", () => {
    expect(parseInfoSections('[null,"str",{"heading":"H"},{"heading":"","body":""}]')).toEqual([
      { heading: "H", body: "" },
    ]);
  });

  it("passes an already-parsed array through", () => {
    expect(parseInfoSections([{ heading: "H", body: "B" }])).toEqual([{ heading: "H", body: "B" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/driverTierInfo.test.js`
Expected: FAIL — `Cannot find module '../driverTierInfo'`

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/driverTierInfo.js

// Per-tier info content shown in the driver app's tier cards and info
// popup. Stored on tbl_package.driver_info_sections as a JSON array of
// { heading, body }; array order is display order. Admin input is
// untrusted, so normalizeInfoSections validates on the way in, while
// parseInfoSections is deliberately total - a row with junk in it must
// degrade to "no sections" rather than break the whole tier list.

const MAX_SECTIONS = 12;
const MAX_HEADING_LENGTH = 120;
const MAX_BODY_LENGTH = 2000;

class InvalidSectionsError extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidSectionsError";
  }
}

function normalizeInfoSections(input) {
  if (input === undefined || input === null) return null;

  let arr = input;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return null;
    try {
      arr = JSON.parse(trimmed);
    } catch (e) {
      throw new InvalidSectionsError("driver_info_sections must be valid JSON");
    }
  }

  if (!Array.isArray(arr)) {
    throw new InvalidSectionsError("driver_info_sections must be an array of sections");
  }
  if (arr.length > MAX_SECTIONS) {
    throw new InvalidSectionsError(`driver_info_sections cannot have more than ${MAX_SECTIONS} sections`);
  }

  const out = [];
  for (const raw of arr) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new InvalidSectionsError("each section must be an object with a heading and a body");
    }
    const rawHeading = raw.heading === undefined || raw.heading === null ? "" : raw.heading;
    const rawBody = raw.body === undefined || raw.body === null ? "" : raw.body;
    if (typeof rawHeading !== "string" || typeof rawBody !== "string") {
      throw new InvalidSectionsError("section heading and body must be strings");
    }

    const heading = rawHeading.trim();
    const body = rawBody.trim();
    if (!heading && !body) continue;

    if (heading.length > MAX_HEADING_LENGTH) {
      throw new InvalidSectionsError(`section heading cannot exceed ${MAX_HEADING_LENGTH} characters`);
    }
    if (body.length > MAX_BODY_LENGTH) {
      throw new InvalidSectionsError(`section body cannot exceed ${MAX_BODY_LENGTH} characters`);
    }
    out.push({ heading, body });
  }

  return out.length ? JSON.stringify(out) : null;
}

function parseInfoSections(stored) {
  if (!stored) return [];

  let arr = stored;
  if (typeof stored === "string") {
    try {
      arr = JSON.parse(stored);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];

  return arr
    .filter((s) => s !== null && typeof s === "object" && !Array.isArray(s))
    .map((s) => ({
      heading: typeof s.heading === "string" ? s.heading : "",
      body: typeof s.body === "string" ? s.body : "",
    }))
    .filter((s) => s.heading || s.body);
}

module.exports = {
  normalizeInfoSections,
  parseInfoSections,
  InvalidSectionsError,
  MAX_SECTIONS,
  MAX_HEADING_LENGTH,
  MAX_BODY_LENGTH,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/driverTierInfo.test.js`
Expected: PASS (all tests in both describes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driverTierInfo.js backend/src/services/__tests__/driverTierInfo.test.js
git commit -m "feat(tiers): add driver tier info section normalize/parse service"
```

---

### Task 2: Schema columns + migration

**Files:**
- Modify: `backend/prisma/schema.prisma:590-630` (`tbl_package`)
- Create: `backend/prisma/migrations/20260923010000_add_driver_tier_info/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `tbl_package.driver_card_subtitle`, `tbl_package.driver_info_subtitle`, `tbl_package.driver_info_sections` on the Prisma client — Tasks 3 and 4 select and write these names.

This task has no unit test: it is a schema change, and its verification is that Prisma validates the schema and that the generated client exposes the new fields.

- [ ] **Step 1: Add the columns to the Prisma schema**

In `backend/prisma/schema.prisma`, inside `model tbl_package`, add these three lines immediately after the `driver_title` line (currently line 594):

```prisma
  driver_card_subtitle         String?          @db.VarChar(255)
  driver_info_subtitle         String?          @db.VarChar(255)
  driver_info_sections         String?          @db.Text
```

- [ ] **Step 2: Write the migration SQL**

Create `backend/prisma/migrations/20260923010000_add_driver_tier_info/migration.sql`:

```sql
-- AlterTable
ALTER TABLE `tbl_package`
    ADD COLUMN `driver_card_subtitle` VARCHAR(255) NULL,
    ADD COLUMN `driver_info_subtitle` VARCHAR(255) NULL,
    ADD COLUMN `driver_info_sections` TEXT NULL;
```

- [ ] **Step 3: Validate the schema and regenerate the client**

Run: `cd backend && npx prisma validate && npx prisma generate`
Expected: `The schema at prisma\schema.prisma is valid` followed by a successful `Generated Prisma Client` message.

- [ ] **Step 4: Confirm the generated client knows the new fields**

Run: `cd backend && node -e "const {Prisma}=require('@prisma/client'); const f=Prisma.dmmf.datamodel.models.find(m=>m.name==='tbl_package').fields.map(x=>x.name); console.log(['driver_card_subtitle','driver_info_subtitle','driver_info_sections'].every(n=>f.includes(n)));"`
Expected: `true`

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20260923010000_add_driver_tier_info/migration.sql
git commit -m "feat(tiers): add driver tier info columns to tbl_package"
```

---

### Task 3: Admin write path — `rateCardController`

**Files:**
- Modify: `backend/src/controllers/rateCardController.js` — imports (top of file), `serializePackage:38-64`, `create:137-189`, `update.directFields:217-244`
- Test: `backend/src/controllers/__tests__/rateCardTierInfo.test.js`

**Interfaces:**
- Consumes: `normalizeInfoSections`, `parseInfoSections`, `InvalidSectionsError` from `../services/driverTierInfo` (Task 1); the three columns from Task 2.
- Produces: `POST /rate-cards` and `PUT /rate-cards/:id` accept `driver_card_subtitle`, `driver_info_subtitle` and `driver_info_sections` (array or JSON string), rejecting bad sections with HTTP 400. `serializePackage` returns `driver_info_sections` as a parsed array — the shape Task 5's admin form consumes.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/rateCardTierInfo.test.js
const { create, update } = require("../rateCardController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_package: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  pkg_category: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

const VALID_BODY = {
  title: "Model 3",
  type: "DRIVER",
  cat_id: 8,
  city_id: "1",
  min_charge: "40",
  per_km_charge: "9",
  free_waiting_time: "5",
  waiting_charge: "2",
  start_time: "00:00",
  end_time: "00:00",
};

describe("rateCardController tier info fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.pkg_category.findUnique.mockResolvedValue({ id: 8, cat_name: "Bike" });
    prisma.tbl_package.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    prisma.tbl_package.findUnique.mockResolvedValue({ id: 1, cat_id: 8 });
    prisma.tbl_package.update.mockImplementation(({ data }) => Promise.resolve({ id: 1, cat_id: 8, ...data }));
  });

  it("create persists both subtitles and the normalized sections JSON", async () => {
    const res = mockRes();
    await create({
      body: {
        ...VALID_BODY,
        driver_card_subtitle: "  Regular deliveries  ",
        driver_info_subtitle: "Steady earnings",
        driver_info_sections: [{ heading: " Earnings ", body: " Up to 20/km " }],
      },
    }, res);

    const data = prisma.tbl_package.create.mock.calls[0][0].data;
    expect(data.driver_card_subtitle).toBe("Regular deliveries");
    expect(data.driver_info_subtitle).toBe("Steady earnings");
    expect(JSON.parse(data.driver_info_sections)).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("create stores null when sections are absent or empty", async () => {
    const res = mockRes();
    await create({ body: { ...VALID_BODY, driver_info_sections: [] } }, res);
    expect(prisma.tbl_package.create.mock.calls[0][0].data.driver_info_sections).toBeNull();
  });

  it("create rejects malformed sections with a 400 and does not touch the database", async () => {
    const res = mockRes();
    await create({ body: { ...VALID_BODY, driver_info_sections: '{"a":1}' } }, res);
    expect(prisma.tbl_package.create).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining("array") })
    );
  });

  it("update persists the three fields", async () => {
    const res = mockRes();
    await update({
      params: { id: "1" },
      body: {
        driver_card_subtitle: "Long distance loads",
        driver_info_subtitle: "High value",
        driver_info_sections: [{ heading: "Example", body: "15 km trip" }],
      },
    }, res);

    const data = prisma.tbl_package.update.mock.calls[0][0].data;
    expect(data.driver_card_subtitle).toBe("Long distance loads");
    expect(data.driver_info_subtitle).toBe("High value");
    expect(JSON.parse(data.driver_info_sections)).toEqual([{ heading: "Example", body: "15 km trip" }]);
  });

  it("update rejects an over-long section body with a 400", async () => {
    const res = mockRes();
    await update({
      params: { id: "1" },
      body: { driver_info_sections: [{ heading: "H", body: "x".repeat(2001) }] },
    }, res);
    expect(prisma.tbl_package.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, message: expect.stringContaining("2000") })
    );
  });

  it("update clears a subtitle when an empty string is sent", async () => {
    const res = mockRes();
    await update({ params: { id: "1" }, body: { driver_card_subtitle: "" } }, res);
    expect(prisma.tbl_package.update.mock.calls[0][0].data.driver_card_subtitle).toBeNull();
  });

  it("returns driver_info_sections to the admin UI as a parsed array", async () => {
    const res = mockRes();
    await update({
      params: { id: "1" },
      body: { driver_info_sections: [{ heading: "Earnings", body: "Up to 20/km" }] },
    }, res);
    const payload = res.json.mock.calls[0][0];
    expect(payload.data.driver_info_sections).toEqual([{ heading: "Earnings", body: "Up to 20/km" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/rateCardTierInfo.test.js`
Expected: FAIL — `data.driver_card_subtitle` is `undefined` (the controller does not know the new fields yet).

- [ ] **Step 3: Write minimal implementation**

In `backend/src/controllers/rateCardController.js`:

**(a)** Add the import after the existing `slabPricingService` import block (which currently ends on line 12):

```js
const {
  normalizeInfoSections,
  parseInfoSections,
  InvalidSectionsError,
} = require("../services/driverTierInfo");
```

**(b)** In `serializePackage`, add one line to the returned object, immediately after the `driver_title: pkg.driver_title || null,` line:

```js
    driver_info_sections: parseInfoSections(pkg.driver_info_sections),
```

**(c)** In `create`, immediately after the `type` validation and before the `pkg_category.findUnique` lookup (i.e. after the `if (!PACKAGE_TYPES.includes(b.type))` block, currently ending line 130), add:

```js
    let infoSections;
    try {
      infoSections = normalizeInfoSections(b.driver_info_sections);
    } catch (e) {
      if (e instanceof InvalidSectionsError) {
        return res.status(400).json({ success: false, message: e.message });
      }
      throw e;
    }
```

Then add these three entries to the `prisma.tbl_package.create` data object, immediately after the `driver_title:` entry:

```js
        driver_card_subtitle: b.driver_card_subtitle ? String(b.driver_card_subtitle).trim() : null,
        driver_info_subtitle: b.driver_info_subtitle ? String(b.driver_info_subtitle).trim() : null,
        driver_info_sections: infoSections,
```

**(d)** In `update`, add the two subtitles to the `directFields` array (after `"driver_title",`):

```js
      "driver_card_subtitle",
      "driver_info_subtitle",
```

and extend the trimming branch inside the `for (const field of directFields)` loop so the two new subtitle fields are trimmed and blanked to `null` like the titles already are — replace the existing condition:

```js
        if (
          field === "user_title" ||
          field === "driver_title" ||
          field === "driver_card_subtitle" ||
          field === "driver_info_subtitle"
        ) {
          data[field] = b[field] ? String(b[field]).trim() : null;
        } else {
          data[field] = b[field];
        }
```

Finally, handle sections in `update` by adding this immediately after the `if (b.status !== undefined) data.status = parseInt(b.status, 10);` line (currently line 272), before the `prisma.tbl_package.update` call:

```js
    if (b.driver_info_sections !== undefined) {
      try {
        data.driver_info_sections = normalizeInfoSections(b.driver_info_sections);
      } catch (e) {
        if (e instanceof InvalidSectionsError) {
          return res.status(400).json({ success: false, message: e.message });
        }
        throw e;
      }
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/rateCardTierInfo.test.js src/controllers/__tests__/rateCardGenerateModels.test.js`
Expected: PASS — the new suite plus the pre-existing rate-card suite, proving `create`/`update`/`serializePackage` still behave for everything else.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/rateCardController.js backend/src/controllers/__tests__/rateCardTierInfo.test.js
git commit -m "feat(tiers): accept and validate driver tier info fields on rate cards"
```

---

### Task 4: Driver read path — `packageListForDriver`

**Files:**
- Modify: `backend/src/controllers/riderController.js:142-174` (select list and response map)
- Test: `backend/src/controllers/__tests__/packageListTierInfo.test.js`

**Interfaces:**
- Consumes: `parseInfoSections` from `../services/driverTierInfo` (Task 1); the columns from Task 2.
- Produces: each entry of `PackageData` gains `driver_card_subtitle` (string, `""` when null), `driver_info_subtitle` (string, `""` when null) and `driver_info_sections` (array of `{heading, body}`, `[]` when null or malformed). `user_title` becomes a real value instead of always falling back to `title`. Task 6's `PackageData.java` maps exactly these JSON keys.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/packageListTierInfo.test.js
const { packageListForDriver } = require("../riderController");
const prisma = require("../../config/db");

jest.mock("../../config/db", () => ({
  tbl_rider: { findUnique: jest.fn() },
  pkg_category: { findFirst: jest.fn() },
  tbl_package: { findMany: jest.fn() },
  tbl_rider_delivery_type: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

async function callWith(packages) {
  prisma.tbl_rider.findUnique.mockResolvedValue({ vehicle: "Bike" });
  prisma.pkg_category.findFirst.mockResolvedValue({ id: 8, cat_name: "Bike" });
  prisma.tbl_package.findMany.mockResolvedValue(packages);
  prisma.tbl_rider_delivery_type.findMany.mockResolvedValue([]);
  const res = mockRes();
  await packageListForDriver({ body: { uid: 7 } }, res);
  return res.json.mock.calls[0][0];
}

const BASE_PKG = {
  id: 21,
  title: "Model 3",
  user_title: "Comfort",
  driver_title: "Prime Tier",
  driver_detail_image: null,
  user_detail_image: null,
  per_km_charge: "10.34",
  min_charge: "46.2",
};

describe("packageListForDriver tier info", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the subtitles and parsed sections", async () => {
    const payload = await callWith([
      {
        ...BASE_PKG,
        driver_card_subtitle: "High demand & priority trips",
        driver_info_subtitle: "Premium deliveries",
        driver_info_sections: '[{"heading":"Earnings","body":"Up to 22/km"}]',
      },
    ]);

    expect(payload.PackageData[0].driver_card_subtitle).toBe("High demand & priority trips");
    expect(payload.PackageData[0].driver_info_subtitle).toBe("Premium deliveries");
    expect(payload.PackageData[0].driver_info_sections).toEqual([
      { heading: "Earnings", body: "Up to 22/km" },
    ]);
  });

  it("returns empty string / empty array when the columns are null", async () => {
    const payload = await callWith([
      { ...BASE_PKG, driver_card_subtitle: null, driver_info_subtitle: null, driver_info_sections: null },
    ]);

    expect(payload.PackageData[0].driver_card_subtitle).toBe("");
    expect(payload.PackageData[0].driver_info_subtitle).toBe("");
    expect(payload.PackageData[0].driver_info_sections).toEqual([]);
  });

  it("degrades malformed stored JSON to an empty array without failing the whole list", async () => {
    const payload = await callWith([
      { ...BASE_PKG, id: 21, driver_info_sections: "{not json" },
      { ...BASE_PKG, id: 22, driver_info_sections: '[{"heading":"Ok","body":"Fine"}]' },
    ]);

    expect(payload.Result).toBe("true");
    expect(payload.PackageData).toHaveLength(2);
    expect(payload.PackageData[0].driver_info_sections).toEqual([]);
    expect(payload.PackageData[1].driver_info_sections).toEqual([{ heading: "Ok", body: "Fine" }]);
  });

  it("carries a subtitle with no sections, and sections with no subtitle, independently", async () => {
    const payload = await callWith([
      { ...BASE_PKG, id: 21, driver_info_subtitle: "Premium deliveries", driver_info_sections: null },
      { ...BASE_PKG, id: 22, driver_info_subtitle: null, driver_info_sections: '[{"heading":"Ok","body":"Fine"}]' },
    ]);

    // The app shows its Details chip when EITHER of these is non-empty, so
    // neither may be flattened away when the other is missing.
    expect(payload.PackageData[0].driver_info_subtitle).toBe("Premium deliveries");
    expect(payload.PackageData[0].driver_info_sections).toEqual([]);
    expect(payload.PackageData[1].driver_info_subtitle).toBe("");
    expect(payload.PackageData[1].driver_info_sections).toEqual([{ heading: "Ok", body: "Fine" }]);
  });

  it("selects and returns the real user_title instead of falling back to title", async () => {
    const payload = await callWith([BASE_PKG]);
    expect(prisma.tbl_package.findMany.mock.calls[0][0].select.user_title).toBe(true);
    expect(payload.PackageData[0].user_title).toBe("Comfort");
  });

  it("selects the three tier info columns", async () => {
    await callWith([BASE_PKG]);
    const select = prisma.tbl_package.findMany.mock.calls[0][0].select;
    expect(select.driver_card_subtitle).toBe(true);
    expect(select.driver_info_subtitle).toBe(true);
    expect(select.driver_info_sections).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/packageListTierInfo.test.js`
Expected: FAIL — `driver_card_subtitle` is `undefined` in the response and `select.user_title` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/controllers/riderController.js`:

**(a)** Add the import next to the other requires at the top of the file:

```js
const { parseInfoSections } = require("../services/driverTierInfo");
```

**(b)** Replace the `select` block inside `packageListForDriver`'s `prisma.tbl_package.findMany` call (currently lines 145-153) with:

```js
      select: {
        id: true,
        title: true,
        user_title: true,
        driver_title: true,
        driver_detail_image: true,
        user_detail_image: true,
        per_km_charge: true,
        min_charge: true,
        driver_card_subtitle: true,
        driver_info_subtitle: true,
        driver_info_sections: true,
      },
```

(`user_title` was referenced in the response map but missing from this select, so it always resolved to `undefined` and silently fell back to `title`.)

**(c)** Add three entries to the object built in `packages.map(...)`, immediately after the `user_title:` line:

```js
      driver_card_subtitle: p.driver_card_subtitle || "",
      driver_info_subtitle: p.driver_info_subtitle || "",
      driver_info_sections: parseInfoSections(p.driver_info_sections),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/packageListTierInfo.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Run the whole backend suite to confirm nothing regressed**

Run: `cd backend && npx jest --testPathIgnorePatterns "aadharPdfVerify.test.js" "driverScheduledTripsController.test.js"`
Expected: PASS. (Those two suites fail on `main` for reasons unrelated to this work — a pre-existing environment issue — so they are excluded; every other suite must be green.)

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/riderController.js backend/src/controllers/__tests__/packageListTierInfo.test.js
git commit -m "feat(tiers): serve driver tier info content in the package list"
```

---

### Task 5: Admin panel — "Driver info" editor

**Files:**
- Modify: `frontend/src/components/ratecards/RateCardFormModal.jsx` — `EMPTY_FORM:9-39`, the load-for-edit `setForm` block at 298-331, and the JSX after the `driver_title` field at 507-516

**Interfaces:**
- Consumes: `GET /rate-cards` returning `driver_info_sections` as a parsed array (Task 3's `serializePackage`); `PUT`/`POST /rate-cards` accepting the three fields (Task 3).
- Produces: nothing other tasks consume.

There is no test harness in `frontend/` (no test script, no test files), so this task is verified by a successful production build plus an explicit manual checklist.

- [ ] **Step 1: Add the three fields to the blank form state**

In `EMPTY_FORM` (starts line 9), add after the `driver_title: '',` line:

```js
  driver_card_subtitle: '',
  driver_info_subtitle: '',
  driver_info_sections: [],
```

- [ ] **Step 2: Map them when loading an existing rate card for edit**

In the `setForm(rateCard ? { ... } : EMPTY_FORM)` block, add after the `driver_cancel_user_earning:` line:

```js
            driver_card_subtitle: rateCard.driver_card_subtitle ?? '',
            driver_info_subtitle: rateCard.driver_info_subtitle ?? '',
            driver_info_sections: Array.isArray(rateCard.driver_info_sections)
              ? rateCard.driver_info_sections
              : [],
```

- [ ] **Step 3: Add the section list helpers**

Immediately after the existing `function set(key, value) { ... }` helper (line 334), add:

```js
  function setSection(index, key, value) {
    setForm((f) => {
      const next = f.driver_info_sections.map((s, i) => (i === index ? { ...s, [key]: value } : s))
      return { ...f, driver_info_sections: next }
    })
  }

  function addSection() {
    setForm((f) => ({ ...f, driver_info_sections: [...f.driver_info_sections, { heading: '', body: '' }] }))
  }

  function removeSection(index) {
    setForm((f) => ({ ...f, driver_info_sections: f.driver_info_sections.filter((_, i) => i !== index) }))
  }

  function moveSection(index, delta) {
    setForm((f) => {
      const target = index + delta
      if (target < 0 || target >= f.driver_info_sections.length) return f
      const next = [...f.driver_info_sections]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      return { ...f, driver_info_sections: next }
    })
  }
```

- [ ] **Step 4: Add the "Driver info" block to the form**

Immediately after the closing `</div>` of the grid holding `user_title` and `driver_title` (the block ending at line 516), insert:

```jsx
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: 'var(--ink-faint)' }}>
            Driver info
          </div>
          <p className="mb-3 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
            Shown in the driver app. Leave everything blank to hide the tier's Details button entirely.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="driver_card_subtitle">Card subtitle</Label>
              <Input
                id="driver_card_subtitle"
                value={form.driver_card_subtitle}
                onChange={(e) => set('driver_card_subtitle', e.target.value)}
                placeholder="e.g. Regular deliveries, steady earnings"
              />
            </div>
            <div>
              <Label htmlFor="driver_info_subtitle">Popup subtitle</Label>
              <Input
                id="driver_info_subtitle"
                value={form.driver_info_subtitle}
                onChange={(e) => set('driver_info_subtitle', e.target.value)}
                placeholder="e.g. High demand & priority trips"
              />
            </div>
          </div>

          <div className="mt-3">
            <Label>Info sections</Label>
            {form.driver_info_sections.length === 0 ? (
              <p className="mb-2 text-[12px]" style={{ color: 'var(--ink-faint)' }}>
                No sections yet — the Details button stays hidden for this tier.
              </p>
            ) : (
              form.driver_info_sections.map((section, index) => (
                <div key={index} className="mb-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)' }}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <Input
                      value={section.heading}
                      onChange={(e) => setSection(index, 'heading', e.target.value)}
                      placeholder="Heading, e.g. Earnings"
                      maxLength={120}
                    />
                    <button
                      type="button"
                      onClick={() => moveSection(index, -1)}
                      disabled={index === 0}
                      aria-label="Move section up"
                      className="px-1.5 disabled:opacity-30"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(index, 1)}
                      disabled={index === form.driver_info_sections.length - 1}
                      aria-label="Move section down"
                      className="px-1.5 disabled:opacity-30"
                      style={{ color: 'var(--ink-muted)' }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSection(index)}
                      aria-label="Remove section"
                      className="px-1.5"
                      style={{ color: 'var(--danger)' }}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={section.body}
                    onChange={(e) => setSection(index, 'body', e.target.value)}
                    placeholder="Body text shown under the heading"
                    maxLength={2000}
                    rows={3}
                    className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none resize-y"
                    style={FIELD_STYLE}
                  />
                </div>
              ))
            )}
            <button
              type="button"
              onClick={addSection}
              disabled={form.driver_info_sections.length >= 12}
              className="mt-1 rounded-lg border px-2.5 py-1 text-[12px] disabled:opacity-40"
              style={{ borderColor: 'var(--border)', color: 'var(--ink-muted)' }}
            >
              + Add section
            </button>
            {form.driver_info_sections.length >= 12 && (
              <span className="ml-2 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Maximum of 12 sections reached.
              </span>
            )}
          </div>
        </div>
```

- [ ] **Step 5: Build to verify there are no syntax or import errors**

Run: `cd frontend && npx vite build`
Expected: `✓ built in …` with no errors. (`npx eslint` is not usable here — `eslint.config.js` throws a pre-existing `TypeError: Cannot read properties of undefined (reading 'recommended')` on `main`, unrelated to this change.)

- [ ] **Step 6: Manual verification checklist**

With the backend running and the admin panel open on Rate Cards → edit any tier:
- Add two sections, fill heading and body on both, save, reopen — both come back in the same order with the same text.
- Reorder with ↑/↓, save, reopen — the new order persisted.
- Remove a section, save, reopen — it is gone.
- Remove every section, save, reopen — the list is empty and the "No sections yet" hint shows.
- Fill only a heading on one section (leave its body blank), save, reopen — the section survives with an empty body.
- Confirm the "+ Add section" button disables at 12 sections.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ratecards/RateCardFormModal.jsx
git commit -m "feat(tiers): add driver info editor to the rate card form"
```

---

### Task 6: Driver app — model fields and tier card

**Files (all untracked — do NOT `git add` any of these):**
- Create: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/model/TierInfoSection.java`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/model/PackageData.java`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/res/layout/item_delivery_type_card.xml:93-118` (rates row) and `62-78` (info button)
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/utility/DeliveryPreferencesBottomSheet.java:89-153` (`bindTierCard`)

**Interfaces:**
- Consumes: the `driver_card_subtitle`, `driver_info_subtitle` and `driver_info_sections` JSON keys from Task 4.
- Produces: `PackageData.getCardSubtitle()`, `getInfoSubtitle()`, `getInfoSections()` (never null) and `hasInfoContent()` — Task 7's `ModelInfoBottomSheet` consumes all four. `TierInfoSection` exposes `getHeading()` / `getBody()`.

The app has no test harness; verification is a Gradle build plus a manual pass.

- [ ] **Step 1: Create the section model**

```java
// ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/model/TierInfoSection.java
package com.shifter.driver.model;

public class TierInfoSection {
    private String heading;
    private String body;

    public String getHeading() { return heading != null ? heading : ""; }
    public void setHeading(String heading) { this.heading = heading; }

    public String getBody() { return body != null ? body : ""; }
    public void setBody(String body) { this.body = body; }

    public boolean isEmpty() {
        return getHeading().trim().isEmpty() && getBody().trim().isEmpty();
    }
}
```

- [ ] **Step 2: Add the new fields to `PackageData`**

In `PackageData.java`, add these fields and accessors immediately before the closing `}` of the class (after `isActive()`):

```java
    @com.google.gson.annotations.SerializedName("driver_card_subtitle")
    private String driverCardSubtitle;

    @com.google.gson.annotations.SerializedName("driver_info_subtitle")
    private String driverInfoSubtitle;

    @com.google.gson.annotations.SerializedName("driver_info_sections")
    private java.util.List<TierInfoSection> driverInfoSections;

    public String getCardSubtitle() {
        return driverCardSubtitle != null ? driverCardSubtitle.trim() : "";
    }
    public void setCardSubtitle(String value) { this.driverCardSubtitle = value; }

    public String getInfoSubtitle() {
        return driverInfoSubtitle != null ? driverInfoSubtitle.trim() : "";
    }
    public void setInfoSubtitle(String value) { this.driverInfoSubtitle = value; }

    /** Never null, and never contains a section that is blank on both fields. */
    public java.util.List<TierInfoSection> getInfoSections() {
        java.util.List<TierInfoSection> out = new java.util.ArrayList<>();
        if (driverInfoSections != null) {
            for (TierInfoSection s : driverInfoSections) {
                if (s != null && !s.isEmpty()) out.add(s);
            }
        }
        return out;
    }
    public void setInfoSections(java.util.List<TierInfoSection> value) { this.driverInfoSections = value; }

    /** The Details chip is hidden entirely when this is false. */
    public boolean hasInfoContent() {
        return !getInfoSubtitle().isEmpty() || !getInfoSections().isEmpty();
    }
```

- [ ] **Step 3: Replace the rates row with the Details chip in the card layout**

In `item_delivery_type_card.xml`, delete the bare info `FrameLayout` currently at lines 62-78 (the one containing the 15dp `ic_info` ImageView), so the title row holds only `txt_model_title`. Then replace the entire "Rates Row" block (lines 93-118, the `LinearLayout` containing `txt_model_rate` and `txt_model_base_fare`) with:

```xml
        <!-- Details chip: opens the tier info sheet -->
        <LinearLayout
            android:id="@+id/btn_model_info"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="6dp"
            android:background="@drawable/rounded_corner_box"
            android:backgroundTint="@color/shifter_orange_light"
            android:clickable="true"
            android:contentDescription="Tier Information"
            android:focusable="true"
            android:gravity="center_vertical"
            android:minHeight="32dp"
            android:orientation="horizontal"
            android:paddingStart="10dp"
            android:paddingEnd="10dp">

            <ImageView
                android:layout_width="14dp"
                android:layout_height="14dp"
                android:src="@drawable/ic_info"
                app:tint="@color/shifter_orange" />

            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:layout_marginStart="5dp"
                android:text="Details"
                android:textColor="@color/shifter_orange"
                android:textSize="12sp"
                android:textStyle="bold" />
        </LinearLayout>
```

The chip keeps the id `btn_model_info`, so `bindTierCard`'s existing `findViewById` and click handler continue to resolve.

- [ ] **Step 4: Rewrite `bindTierCard`'s branding, subtitle and rate handling**

In `DeliveryPreferencesBottomSheet.java`, inside `bindTierCard`:

Delete the `txtRate` and `txtBaseFare` `findViewById` lines (currently 96-97) and the whole "Dynamic Rates" block (currently 135-148).

Replace the entire tier-branding if/else chain (currently lines 104-133) with:

```java
        // Tier branding comes from TierTheme, the same resolver the order
        // request popup uses - one place decides what a tier looks like.
        TierTheme theme = TierTheme.resolve(packageData.getId(), title, packageData.getRawTitle());
        layoutIconBg.setBackgroundTintList(ColorStateList.valueOf(theme.highlightBgColor));
        imgTierIcon.setImageResource(theme.headerIconRes);
        imgTierIcon.setColorFilter(theme.headerBgColor);

        // Card subtitle is admin-authored; hide the line when it is blank.
        String cardSubtitle = packageData.getCardSubtitle();
        if (cardSubtitle.isEmpty()) {
            txtSubtitle.setVisibility(View.GONE);
        } else {
            txtSubtitle.setVisibility(View.VISIBLE);
            txtSubtitle.setText(cardSubtitle);
        }
```

Then replace the info click handler block (currently 150-153) with:

```java
        // Details chip: hidden entirely when the admin has configured no
        // content for this tier, so it can never open an empty sheet.
        if (packageData.hasInfoContent()) {
            btnInfo.setVisibility(View.VISIBLE);
            btnInfo.setOnClickListener(v -> ModelInfoBottomSheet.show(context, packageData));
        } else {
            btnInfo.setVisibility(View.GONE);
            btnInfo.setOnClickListener(null);
        }
```

- [ ] **Step 5: Build the app**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`. If the Gradle wrapper cannot run in this environment, compile-check instead by confirming every symbol used above exists: `TierTheme.resolve`, `theme.headerIconRes`, `theme.headerBgColor`, `theme.highlightBgColor`, `R.color.shifter_orange_light`, `R.drawable.rounded_corner_box`, `R.drawable.ic_info` — and report that the full build was not run.

- [ ] **Step 6: Manual verification**

On the home screen tier list and inside the Delivery Preferences sheet:
- No `₹ / km` and no `Min ₹` text appears on any card, in either place.
- The Details chip is visible and easily tappable on a tier that has info content.
- A tier with no admin content shows no chip and no subtitle line, and its card still lays out correctly.
- Toggling a tier on/off still works and still persists.

- [ ] **Step 7: Do NOT commit**

These files are ignored by `.gitignore:8` and must stay untracked. Confirm nothing was staged:

```bash
git status --short ShifterDriver/
```
Expected: no output.

---

### Task 7: Driver app — dynamic info popup

**Files (all untracked — do NOT `git add` any of these):**
- Create: `ShifterDriver/ShifterDriver/app/src/main/res/layout/item_model_info_section.xml`
- Modify: `ShifterDriver/ShifterDriver/app/src/main/res/layout/bottom_sheet_model_info.xml:106-399` (the six hardcoded cards)
- Modify: `ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/utility/ModelInfoBottomSheet.java` (whole file)

**Interfaces:**
- Consumes: `PackageData.getInfoSubtitle()`, `getInfoSections()`, `getTitle()`, `getRawTitle()`, `getId()` and `TierInfoSection.getHeading()` / `getBody()` from Task 6.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Create the section item layout**

```xml
<?xml version="1.0" encoding="utf-8"?>
<!-- ShifterDriver/ShifterDriver/app/src/main/res/layout/item_model_info_section.xml -->
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_marginBottom="10dp"
    android:background="@drawable/bg_info_card_pill"
    android:orientation="vertical"
    android:padding="14dp">

    <TextView
        android:id="@+id/txt_section_heading"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:textColor="@color/driver_text_primary"
        android:textSize="14sp"
        android:textStyle="bold"
        tools:text="Earnings" />

    <TextView
        android:id="@+id/txt_section_body"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="3dp"
        android:lineSpacingExtra="2dp"
        android:textColor="@color/driver_text_secondary"
        android:textSize="13sp"
        tools:text="You can earn up to 22 per km on this tier." />
</LinearLayout>
```

- [ ] **Step 2: Replace the six hardcoded cards with one container**

In `bottom_sheet_model_info.xml`, replace everything between the `NestedScrollView`'s opening tag and its closing tag — that is, the inner `LinearLayout` at lines 101-399 containing all six cards — with this single container:

```xml
        <LinearLayout
            android:id="@+id/layout_info_sections"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical" />
```

Leave the drag handle, the header block (`icon_container`, `img_tier_icon`, `txt_tier_title`, `txt_tier_subtitle`, `btn_close_sheet`), the `NestedScrollView` itself and the `btn_got_it` button exactly as they are.

- [ ] **Step 3: Rewrite `ModelInfoBottomSheet`**

Replace the whole contents of `ModelInfoBottomSheet.java` with:

```java
package com.shifter.driver.utility;

import android.content.Context;
import android.content.res.ColorStateList;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.shifter.driver.R;
import com.shifter.driver.model.PackageData;
import com.shifter.driver.model.TierInfoSection;

import java.util.List;

/**
 * Tier info sheet. Every word shown here is authored by an admin per rate
 * card and delivered by api/rider/package-list - nothing is hardcoded, so
 * copy changes ship without an app release.
 */
public class ModelInfoBottomSheet {

    public static void show(Context context, PackageData packageData) {
        if (context == null || packageData == null) return;

        BottomSheetDialog dialog = new BottomSheetDialog(context, R.style.CustomBottomSheetDialogTheme);
        View view = LayoutInflater.from(context).inflate(R.layout.bottom_sheet_model_info, null);
        dialog.setContentView(view);

        ImageView imgTierIcon = view.findViewById(R.id.img_tier_icon);
        FrameLayout iconContainer = view.findViewById(R.id.icon_container);
        TextView txtTierTitle = view.findViewById(R.id.txt_tier_title);
        TextView txtTierSubtitle = view.findViewById(R.id.txt_tier_subtitle);
        LinearLayout sectionsContainer = view.findViewById(R.id.layout_info_sections);
        View btnClose = view.findViewById(R.id.btn_close_sheet);
        Button btnGotIt = view.findViewById(R.id.btn_got_it);

        String title = packageData.getTitle();
        txtTierTitle.setText(title != null && !title.trim().isEmpty() ? title : "Delivery Tier");

        // Same resolver the order request popup and the tier card use.
        TierTheme theme = TierTheme.resolve(packageData.getId(), title, packageData.getRawTitle());
        imgTierIcon.setImageResource(theme.headerIconRes);
        imgTierIcon.setColorFilter(theme.headerBgColor);
        iconContainer.setBackgroundTintList(ColorStateList.valueOf(theme.highlightBgColor));

        String subtitle = packageData.getInfoSubtitle();
        if (subtitle.isEmpty()) {
            txtTierSubtitle.setVisibility(View.GONE);
        } else {
            txtTierSubtitle.setVisibility(View.VISIBLE);
            txtTierSubtitle.setText(subtitle);
        }

        sectionsContainer.removeAllViews();
        List<TierInfoSection> sections = packageData.getInfoSections();
        LayoutInflater inflater = LayoutInflater.from(context);
        for (TierInfoSection section : sections) {
            View row = inflater.inflate(R.layout.item_model_info_section, sectionsContainer, false);
            TextView txtHeading = row.findViewById(R.id.txt_section_heading);
            TextView txtBody = row.findViewById(R.id.txt_section_body);

            String heading = section.getHeading().trim();
            String body = section.getBody().trim();

            if (heading.isEmpty()) {
                txtHeading.setVisibility(View.GONE);
            } else {
                txtHeading.setVisibility(View.VISIBLE);
                txtHeading.setText(heading);
            }

            if (body.isEmpty()) {
                txtBody.setVisibility(View.GONE);
            } else {
                txtBody.setVisibility(View.VISIBLE);
                txtBody.setText(body);
            }

            sectionsContainer.addView(row);
        }

        View.OnClickListener dismissListener = v -> dialog.dismiss();
        btnClose.setOnClickListener(dismissListener);
        btnGotIt.setOnClickListener(dismissListener);

        dialog.show();
    }
}
```

- [ ] **Step 4: Build the app**

Run: `cd "ShifterDriver/ShifterDriver" && ./gradlew assembleDebug`
Expected: `BUILD SUCCESSFUL`, with no unresolved references to the deleted ids (`txt_what_is_it_body`, `txt_earnings_body`, `txt_distance_body`, `txt_suitable_for_body`, `txt_example_body`, `txt_how_it_works_body`). If the wrapper cannot run here, grep the app source for those six ids and confirm there are no remaining references, and report that the full build was not run.

- [ ] **Step 5: Manual verification**

- A tier with three admin sections shows exactly those three, in the admin's order, with the admin's headings.
- Changing the text in the admin panel and reopening the sheet shows the new text with no app rebuild.
- A tier with a popup subtitle but zero sections opens and shows the header with an empty body area (and its chip is still visible).
- A tier with sections but no subtitle opens with the subtitle line hidden and the sections listed.
- A section with a heading and no body renders the heading alone; one with a body and no heading renders the body alone.
- A body containing newlines renders across multiple lines.
- Close and "Got it" both dismiss the sheet.

- [ ] **Step 6: Do NOT commit**

```bash
git status --short ShifterDriver/
```
Expected: no output.

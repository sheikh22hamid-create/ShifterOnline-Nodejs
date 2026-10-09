# Receiver Live Tracking Implementation Plan

> **Status & corrections (reviewed 2026-10-07): BUILT.** Implementation record - kept for history. Where it differs from the code, the code and the master document win. Current code-verified description: [Master Document section 5.3](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the drop contact (`pkg_order.dmobile`) of every order a WhatsApp link to a public, no-login page that shows the delivery live (map, route, ETA, status timeline).

**Architecture:** A per-order token link (`order_track_link`) served by a public page `/track/:token` and a polling JSON API `/api/track/:token`. A snapshot builder applies the privacy rules by order status. Live driver position comes from an in-memory store fed by the existing `driver:location_ping` socket handler (DB fallback). ETA and route come from the existing Google Routes integration with a per-order cache. WhatsApp milestone messages carry the link to the receiver only.

**Tech Stack:** Node/Express, Prisma/MySQL, Jest, Leaflet 1.9.4 (cdnjs) with MapTiler raster tiles, vanilla JS page (same style as the pay page), React admin Settings page (one toggle).

**Spec:** `docs/superpowers/specs/2026-10-06-receiver-live-tracking-design.md`

## Deviations from the spec (decided while planning, from facts found in the code)

1. **No `expires_at` / `revoked_at` columns.** Expiry is derived from the order: the page is `expired` 24 h after delivery, `cancelled` after cancel. A link is valid only while the order's current `dmobile` equals `receiver_phone`; changing the number rotates the token (same row) so the old link answers `invalid`. Fewer states, same behaviour.
2. **Route geometry** uses the Routes API `GEO_JSON_LINESTRING` encoding (already used in `favoriteRouteService.js`), so no polyline decoder is needed.
3. **Timeline has 5 steps**, not 6: "Parcel picked up" and "On the way" are the same moment (order_status 3 starts when the pickup OTP is verified).
4. **No per-step times** except the delivery time. `pkg_order` columns mix IST wall-clock and UTC (see the comment in `driverOrderHistoryController.js`), so showing times for every step would risk wrong times. The delivery time follows the existing earnings rule (`drop_time` is IST wall-clock).
5. **`notifyDriverAssigned` currently messages only the sender.** This plan adds a new receiver message there (only when a link exists).
6. When sender and receiver are the **same number**, no link is added (that person booked in the app).

## Global Constraints

- Link path `/track/<token>`, API path `/api/track/<token>`; token = 32 random bytes, base64url, 43 chars.
- Page poll every 5000 ms while active, 15000 ms hint for non-active states (`poll_ms`); stop polling in terminal states.
- Live position, route and pickup/drop coordinates only when `order_status = 3` (on the way). Never return pickup OTP, booker name/phone, fare, payment or wallet data.
- Position is `stale` when older than 2 minutes (`RIDER_LOCATION_FRESHNESS_MS` = `2 * 60 * 1000` in `config/constants.js`).
- ETA cache: reuse for 60 s; up to 120 s if the driver moved less than 150 m; one in-flight Google call per order.
- Addresses shortened to 80 characters.
- Responses: `Cache-Control: no-store`, `X-Robots-Tag: noindex`; page also `Referrer-Policy: no-referrer`.
- Rate limits via `createIpRateLimiter`: page 60/min, API 120/min.
- Settings key `receiver_tracking_enabled` (default ON, fail closed on read error). Env `MAPTILER_KEY`, optional `MAPTILER_STYLE` (default `streets-v2`), `PUBLIC_BASE_URL` reused.
- Leaflet from cdnjs with SRI: JS `sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=`, CSS `sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=` (both verified against the 1.9.4 files).
- Dynamic page text is only ever set with `textContent` (no `innerHTML`).
- Customer app and driver app: no changes. Backend tests run with `cd backend && npx jest <path>`. Known pre-existing failure: `src/utils/__tests__/aadharPdfVerify.test.js`.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. An admin edits `dmobile` on an order that has no receiver-pays row: the old number's link must stop working and the new number must get a link (Task 4 `invalid` test, Task 6 `syncReceiverPhone` tests).
2. The driver's position, route and coordinates must never appear before pickup (order_status 1 or 2) or after delivery (Task 4 privacy tests).
3. Orders with blank or non-numeric coordinates, a driver with no position at all, or no Google key must not crash the snapshot or the page (Task 3 fallback tests, Task 4 null-coordinate test, Task 5 guarded-map test).
4. Sender and receiver being the same number must not produce a link or a duplicate message (Task 6 test).
5. Garbage tokens (wrong length, path tricks) must be rejected with 404 before any DB access, with the same JSON shape as an unknown token (Task 2 and Task 4 tests).

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/migrations/20261006010000_add_order_track_link/migration.sql`, `schema.prisma` | New table |
| `backend/src/services/receiverTrackSettings.js` | Flag + map config |
| `backend/src/services/trackLinkService.js` | Create/rotate/find links, build URL |
| `backend/src/services/liveDriverPositions.js` | In-memory last ping per driver |
| `backend/src/sockets/trackingSocket.js` (modify) | Feed the store on every ping |
| `backend/src/services/trackEtaService.js` | Cached ETA + route |
| `backend/src/services/trackSnapshotService.js` | Builds the JSON the page polls, privacy rules |
| `backend/src/controllers/trackController.js`, `trackPage.js` | API handler, page handler, HTML |
| `backend/src/routes/trackRoutes.js`, `app.js` (modify) | Wiring + rate limits |
| `backend/src/services/receiverTrackMessage.js` | WhatsApp "track" line + phone-change sync |
| `backend/src/whatsapp/notifications.js`, `handlers/customerHandler.js` (modify) | Messages carry the link |
| `backend/src/services/receiverPayService.js`, `controllers/adminOrderController.js` (modify) | Phone change keeps the link in step |
| `frontend/src/pages/Settings.jsx` (modify) | Admin toggle |

---

### Task 1: Table, settings and map config

**Files:**
- Create: `backend/prisma/migrations/20261006010000_add_order_track_link/migration.sql`
- Modify: `backend/prisma/schema.prisma` (append model), `backend/.env.example`
- Create: `backend/src/services/receiverTrackSettings.js`
- Test: `backend/src/services/__tests__/receiverTrackSettings.test.js`

**Interfaces:**
- Produces: `isTrackingEnabled(): Promise<boolean>`, `getMapConfig(env = process.env): { tileUrl: string|null, attribution: string }`, `KEYS.enabled`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/__tests__/receiverTrackSettings.test.js
jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const prisma = require("../../config/db");
const s = require("../receiverTrackSettings");

const row = (v) => [{ setting_key: "receiver_tracking_enabled", setting_value: v }];

describe("isTrackingEnabled", () => {
  beforeEach(() => jest.clearAllMocks());
  it("is ON when the row is missing or empty", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await s.isTrackingEnabled()).toBe(true);
    prisma.app_settings.findMany.mockResolvedValue(row(""));
    expect(await s.isTrackingEnabled()).toBe(true);
  });
  it("is ON for 1/true", async () => {
    prisma.app_settings.findMany.mockResolvedValue(row("1"));
    expect(await s.isTrackingEnabled()).toBe(true);
    prisma.app_settings.findMany.mockResolvedValue(row("true"));
    expect(await s.isTrackingEnabled()).toBe(true);
  });
  it.each(["0", "false", "OFF", " no "])("is OFF for %p", async (v) => {
    prisma.app_settings.findMany.mockResolvedValue(row(v));
    expect(await s.isTrackingEnabled()).toBe(false);
  });
  it("fails closed when the setting cannot be read", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    expect(await s.isTrackingEnabled()).toBe(false);
  });
});

describe("getMapConfig", () => {
  it("has no tiles without a key", () => {
    expect(s.getMapConfig({})).toMatchObject({ tileUrl: null });
  });
  it("builds the MapTiler raster URL with the default style", () => {
    const c = s.getMapConfig({ MAPTILER_KEY: "abcdEFGH1234" });
    expect(c.tileUrl).toBe("https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abcdEFGH1234");
    expect(c.attribution).toContain("MapTiler");
    expect(c.attribution).toContain("OpenStreetMap");
  });
  it("uses a valid custom style, ignores an invalid one", () => {
    expect(s.getMapConfig({ MAPTILER_KEY: "abcdEFGH1234", MAPTILER_STYLE: "basic-v2" }).tileUrl).toContain("/maps/basic-v2/");
    expect(s.getMapConfig({ MAPTILER_KEY: "abcdEFGH1234", MAPTILER_STYLE: "../x" }).tileUrl).toContain("/maps/streets-v2/");
  });
  it("rejects a key with unsafe characters", () => {
    expect(s.getMapConfig({ MAPTILER_KEY: 'ab"><script>' }).tileUrl).toBeNull();
    expect(s.getMapConfig({ MAPTILER_KEY: "short" }).tileUrl).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/receiverTrackSettings.test.js`
Expected: FAIL, "Cannot find module '../receiverTrackSettings'".

- [ ] **Step 3: Implement the settings module**

```js
// backend/src/services/receiverTrackSettings.js
const prisma = require("../config/db");
const logger = require("../utils/logger");

const KEYS = Object.freeze({ enabled: "receiver_tracking_enabled" });
const OFF = new Set(["0", "false", "off", "no"]);
const KEY_SHAPE = /^[A-Za-z0-9_-]{8,64}$/;
const STYLE_SHAPE = /^[a-z0-9-]{1,40}$/;
const ATTRIBUTION =
  '<a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener">&copy; MapTiler</a> ' +
  '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';

// Default ON when the row is missing or empty (the admin Settings page shows it as enabled);
// fail closed when the setting cannot be read, so a broken read never starts sending links.
async function isTrackingEnabled() {
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: [KEYS.enabled] } } });
    const value = rows && rows[0] ? String(rows[0].setting_value ?? "").trim().toLowerCase() : "";
    if (value === "") return true;
    return !OFF.has(value);
  } catch (err) {
    logger.error("isTrackingEnabled: failed to read settings, treating tracking as disabled:", err);
    return false;
  }
}

// The key ships inside the page (it is a public, domain-restricted MapTiler key), so both values
// are shape-checked before they are put into a URL.
function getMapConfig(env = process.env) {
  const key = String(env.MAPTILER_KEY || "").trim();
  if (!KEY_SHAPE.test(key)) return { tileUrl: null, attribution: "" };
  const rawStyle = String(env.MAPTILER_STYLE || "").trim();
  const style = STYLE_SHAPE.test(rawStyle) ? rawStyle : "streets-v2";
  return { tileUrl: `https://api.maptiler.com/maps/${style}/{z}/{x}/{y}.png?key=${key}`, attribution: ATTRIBUTION };
}

module.exports = { KEYS, isTrackingEnabled, getMapConfig };
```

- [ ] **Step 4: Add the migration, the Prisma model and the env docs**

`migration.sql`:

```sql
-- Receiver live tracking (spec 2026-10-06). Apply on prod BEFORE deploying the backend.
CREATE TABLE `order_track_link` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `token` CHAR(43) NOT NULL,
  `receiver_phone` VARCHAR(15) NOT NULL,
  `created_at` DATETIME(0) NOT NULL,
  `last_viewed_at` DATETIME(0) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_order_track_link_order` (`order_id`),
  UNIQUE INDEX `uq_order_track_link_token` (`token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

Append to `schema.prisma`:

```prisma
model order_track_link {
  id             Int       @id @default(autoincrement())
  order_id       Int       @unique(map: "uq_order_track_link_order")
  token          String    @unique(map: "uq_order_track_link_token") @db.Char(43)
  receiver_phone String    @db.VarChar(15)
  created_at     DateTime  @db.DateTime(0)
  last_viewed_at DateTime? @db.DateTime(0)
}
```

Append to `backend/.env.example`:

```
# Receiver live tracking page (/track/<token>). PUBLIC_BASE_URL (above) builds the link.
# Public MapTiler key for the map tiles; restrict it to the production domain in the MapTiler dashboard.
# Without it the page still works, just without the map.
# MAPTILER_KEY=your-maptiler-key
# MAPTILER_STYLE=streets-v2
```

- [ ] **Step 5: Validate the schema and run the tests**

Run: `cd backend && npx prisma validate && npx prisma generate && npx jest src/services/__tests__/receiverTrackSettings.test.js`
Expected: schema valid, client generated, all settings tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/prisma backend/src/services/receiverTrackSettings.js backend/src/services/__tests__/receiverTrackSettings.test.js backend/.env.example
git commit -m "feat(receiver-tracking): track link table, settings flag and map config

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Track link service

**Files:**
- Create: `backend/src/services/trackLinkService.js`
- Test: `backend/src/services/__tests__/trackLinkService.test.js`

**Interfaces:**
- Consumes: `prisma.order_track_link` (Task 1), `normalizeToLast10Digits` from `../utils/phone`.
- Produces: `isTokenShape(token): boolean`, `getOrCreate(orderId: number, rawPhone: string): Promise<row|null>` (rotates the token when the phone differs), `findByToken(token): Promise<row|null>`, `buildLink(token): string|null`, `touchViewed(id): Promise<void>` (never throws). Row fields: `id, order_id, token, receiver_phone, created_at, last_viewed_at`.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/__tests__/trackLinkService.test.js
jest.mock("../../config/db", () => ({
  order_track_link: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
}));
const prisma = require("../../config/db");
const svc = require("../trackLinkService");

const TOKEN = "t".repeat(43);
const row = (o = {}) => ({ id: 1, order_id: 50, token: TOKEN, receiver_phone: "9876543210", created_at: new Date(), ...o });

beforeEach(() => {
  jest.clearAllMocks();
  process.env.PUBLIC_BASE_URL = "https://api.example.com/";
});

describe("isTokenShape", () => {
  it("accepts 43 base64url chars only", () => {
    expect(svc.isTokenShape(TOKEN)).toBe(true);
    for (const bad of ["", "abc", "../etc/passwd", "t".repeat(42), "t".repeat(44), "t".repeat(42) + "!", null, undefined]) {
      expect(svc.isTokenShape(bad)).toBe(false);
    }
  });
});

describe("getOrCreate", () => {
  it("creates a link with a fresh 43-char token and the normalised phone", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(null);
    prisma.order_track_link.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    const out = await svc.getOrCreate(50, "+91 98765 43210");
    expect(out.receiver_phone).toBe("9876543210");
    expect(svc.isTokenShape(out.token)).toBe(true);
    expect(prisma.order_track_link.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order_id: 50, receiver_phone: "9876543210", created_at: expect.any(Date) }),
    });
  });
  it("is idempotent for the same phone", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(row());
    const out = await svc.getOrCreate(50, "9876543210");
    expect(out.token).toBe(TOKEN);
    expect(prisma.order_track_link.create).not.toHaveBeenCalled();
    expect(prisma.order_track_link.update).not.toHaveBeenCalled();
  });
  it("rotates the token when the phone changed, so the old link dies", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(row());
    prisma.order_track_link.update.mockImplementation(({ data }) => Promise.resolve(row(data)));
    const out = await svc.getOrCreate(50, "9000000000");
    expect(out.receiver_phone).toBe("9000000000");
    expect(out.token).not.toBe(TOKEN);
    expect(prisma.order_track_link.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { token: expect.any(String), receiver_phone: "9000000000" },
    });
  });
  it("returns null for a missing or short phone without touching the DB", async () => {
    expect(await svc.getOrCreate(50, "")).toBeNull();
    expect(await svc.getOrCreate(50, "12345")).toBeNull();
    expect(prisma.order_track_link.findUnique).not.toHaveBeenCalled();
  });
  it("recovers from losing a create race", async () => {
    prisma.order_track_link.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(row());
    prisma.order_track_link.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect((await svc.getOrCreate(50, "9876543210")).token).toBe(TOKEN);
  });
  it("rethrows other create errors", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(null);
    prisma.order_track_link.create.mockRejectedValue(new Error("boom"));
    await expect(svc.getOrCreate(50, "9876543210")).rejects.toThrow("boom");
  });
});

describe("findByToken", () => {
  it("does not query for a malformed token", async () => {
    expect(await svc.findByToken("nope")).toBeNull();
    expect(prisma.order_track_link.findUnique).not.toHaveBeenCalled();
  });
  it("looks a well-formed token up", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(row());
    expect((await svc.findByToken(TOKEN)).order_id).toBe(50);
    expect(prisma.order_track_link.findUnique).toHaveBeenCalledWith({ where: { token: TOKEN } });
  });
});

describe("buildLink / touchViewed", () => {
  it("joins PUBLIC_BASE_URL without a double slash", () => {
    expect(svc.buildLink(TOKEN)).toBe(`https://api.example.com/track/${TOKEN}`);
  });
  it("is null when PUBLIC_BASE_URL is not configured", () => {
    delete process.env.PUBLIC_BASE_URL;
    expect(svc.buildLink(TOKEN)).toBeNull();
  });
  it("touchViewed never throws", async () => {
    prisma.order_track_link.update.mockRejectedValue(new Error("db"));
    await expect(svc.touchViewed(1)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/trackLinkService.test.js`
Expected: FAIL, "Cannot find module '../trackLinkService'".

- [ ] **Step 3: Implement**

```js
// backend/src/services/trackLinkService.js
const crypto = require("crypto");
const prisma = require("../config/db");
const { normalizeToLast10Digits } = require("../utils/phone");

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const newToken = () => crypto.randomBytes(32).toString("base64url");
const isTokenShape = (token) => TOKEN_SHAPE.test(String(token || ""));

// One link per order, valid for the order's current drop contact. A different phone rotates the
// token on the same row, so the previous number's link stops working.
async function getOrCreate(orderId, rawPhone) {
  const phone = normalizeToLast10Digits(rawPhone);
  if (phone.length !== 10) return null;
  const existing = await prisma.order_track_link.findUnique({ where: { order_id: orderId } });
  if (existing && existing.receiver_phone === phone) return existing;
  if (existing) {
    return prisma.order_track_link.update({ where: { id: existing.id }, data: { token: newToken(), receiver_phone: phone } });
  }
  try {
    return await prisma.order_track_link.create({
      data: { order_id: orderId, token: newToken(), receiver_phone: phone, created_at: new Date() },
    });
  } catch (err) {
    if (err && err.code === "P2002") return prisma.order_track_link.findUnique({ where: { order_id: orderId } });
    throw err;
  }
}

async function findByToken(token) {
  if (!isTokenShape(token)) return null;
  return prisma.order_track_link.findUnique({ where: { token } });
}

function buildLink(token) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return base ? `${base}/track/${token}` : null;
}

async function touchViewed(id) {
  try {
    await prisma.order_track_link.update({ where: { id }, data: { last_viewed_at: new Date() } });
  } catch (_) {
    // a view counter must never fail a request
  }
}

module.exports = { isTokenShape, getOrCreate, findByToken, buildLink, touchViewed };
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/trackLinkService.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/trackLinkService.js backend/src/services/__tests__/trackLinkService.test.js
git commit -m "feat(receiver-tracking): track link service (create, rotate, find)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Live position store and ETA/route service

**Files:**
- Create: `backend/src/services/liveDriverPositions.js`, `backend/src/services/trackEtaService.js`
- Modify: `backend/src/sockets/trackingSocket.js`
- Test: `backend/src/services/__tests__/liveDriverPositions.test.js`, `backend/src/services/__tests__/trackEtaService.test.js`, `backend/src/sockets/__tests__/trackingSocketLive.test.js`

**Interfaces:**
- Consumes: `fetchGoogleDrive(origin, destination, { fetchImpl, apiKey })` and `estimateDrive(origin, destination)` from `pickupEtaService` (both exported already; points are `{lat, lng}`), `haversineKm(lat1, lng1, lat2, lng2)` from `../utils/geoDistance`.
- Produces: `liveDriverPositions.record(riderId, lat, lng, heading, now?)`, `.get(riderId): {lat,lng,heading,at}|null`, `._clear()`; `trackEtaService.getEta(orderId, from, to, { now?, fetchImpl? }): Promise<{minutes:number, distance_km:number, updated_at:string}>`, `.getRoute(orderId, from, to, { now?, fetchImpl? }): Promise<Array<[lat,lng]>>`, `.clearOrder(orderId)`, `.simplify(points, max?)`, `._reset()`.

- [ ] **Step 1: Write the failing tests**

```js
// backend/src/services/__tests__/liveDriverPositions.test.js
const store = require("../liveDriverPositions");

beforeEach(() => store._clear());

it("returns the latest ping per driver", () => {
  store.record(7, 22.7, 75.8, 90, 1000);
  store.record(7, 22.8, 75.9, 180, 2000);
  expect(store.get(7)).toEqual({ lat: 22.8, lng: 75.9, heading: 180, at: 2000 });
  expect(store.get("7")).not.toBeNull();
});
it("returns null for an unknown driver", () => {
  expect(store.get(99)).toBeNull();
});
```

```js
// backend/src/services/__tests__/trackEtaService.test.js
jest.mock("../../config/db", () => ({}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
const svc = require("../trackEtaService");

const FROM = { lat: 22.7, lng: 75.8 };
const TO = { lat: 22.75, lng: 75.85 };
const googleOk = (seconds = 600, meters = 4200) =>
  jest.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ duration: `${seconds}s`, distanceMeters: meters }] }) });

beforeEach(() => {
  svc._reset();
  process.env.GOOGLE_MAPS_API_KEY = "test-key";
});
afterAll(() => delete process.env.GOOGLE_MAPS_API_KEY);

describe("getEta", () => {
  it("returns minutes and distance from Google", async () => {
    const eta = await svc.getEta(1, FROM, TO, { now: 1000, fetchImpl: googleOk() });
    expect(eta).toMatchObject({ minutes: 10, distance_km: 4.2 });
    expect(new Date(eta.updated_at).getTime()).toBe(1000);
  });
  it("reuses the cache for 60 s", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getEta(1, { lat: 22.9, lng: 75.9 }, TO, { now: 59000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("between 60 s and 120 s reuses only if the driver moved less than 150 m", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getEta(1, { lat: 22.701, lng: 75.8 }, TO, { now: 90000, fetchImpl: f }); // ~111 m
    expect(f).toHaveBeenCalledTimes(1);
    await svc.getEta(1, { lat: 22.702, lng: 75.8 }, TO, { now: 91000, fetchImpl: f }); // ~222 m from the cached point
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("recomputes after 120 s even if the driver did not move", async () => {
    const f = googleOk();
    await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getEta(1, FROM, TO, { now: 121000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("makes one Google call for concurrent requests", async () => {
    const f = googleOk();
    const [a, b] = await Promise.all([svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f }), svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f })]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });
  it("falls back to a straight-line estimate when Google fails", async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const eta = await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    expect(eta.minutes).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(eta.distance_km)).toBe(true);
  });
  it("falls back without calling Google when there is no API key", async () => {
    delete process.env.GOOGLE_MAPS_API_KEY;
    const f = jest.fn();
    const eta = await svc.getEta(1, FROM, TO, { now: 0, fetchImpl: f });
    expect(f).not.toHaveBeenCalled();
    expect(eta.minutes).toBeGreaterThanOrEqual(1);
  });
});

describe("getRoute", () => {
  const routeOk = (coords) => jest.fn().mockResolvedValue({ ok: true, json: async () => ({ routes: [{ polyline: { geoJsonLinestring: { coordinates: coords } } }] }) });
  it("returns [lat,lng] pairs (GeoJSON is lng,lat)", async () => {
    const r = await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: routeOk([[75.8, 22.7], [75.85, 22.75]]) });
    expect(r).toEqual([[22.7, 75.8], [22.75, 75.85]]);
  });
  it("caches the route for the order", async () => {
    const f = routeOk([[75.8, 22.7], [75.85, 22.75]]);
    await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f });
    await svc.getRoute(1, FROM, TO, { now: 60000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("falls back to a straight line when Google fails and retries after 2 minutes", async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await svc.getRoute(1, FROM, TO, { now: 0, fetchImpl: f })).toEqual([[22.7, 75.8], [22.75, 75.85]]);
    await svc.getRoute(1, FROM, TO, { now: 60000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(1);
    await svc.getRoute(1, FROM, TO, { now: 130000, fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("simplify", () => {
  it("keeps short lines and thins long ones to at most 150 points, keeping both ends", () => {
    const pts = Array.from({ length: 1000 }, (_, i) => [i, i]);
    const out = svc.simplify(pts);
    expect(out.length).toBeLessThanOrEqual(150);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([999, 999]);
    expect(svc.simplify([[1, 1], [2, 2]])).toHaveLength(2);
  });
});
```

```js
// backend/src/sockets/__tests__/trackingSocketLive.test.js
jest.mock("../../config/db", () => ({ tbl_rider: { update: jest.fn().mockResolvedValue({}) } }));
jest.mock("../adminSocket", () => ({ notifyLiveDriverPing: jest.fn() }));
jest.mock("../../services/dutyTrackingService", () => ({ recordDutyLocationPing: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const store = require("../../services/liveDriverPositions");
const { registerTrackingHandlers } = require("../trackingSocket");

function ping(payload) {
  let handler;
  const socket = { on: (name, fn) => { if (name === "driver:location_ping") handler = fn; }, data: {} };
  const io = { to: () => ({ emit: jest.fn() }) };
  registerTrackingHandlers(io, socket);
  handler(payload);
}

beforeEach(() => store._clear());

it("keeps every valid ping in the live store, not just the throttled DB write", () => {
  ping({ rider_id: 7, order_id: 1, lat: 22.7, lng: 75.8, heading: 45 });
  expect(store.get(7)).toMatchObject({ lat: 22.7, lng: 75.8, heading: 45 });
});
it("ignores an invalid ping", () => {
  ping({ rider_id: 7, lat: "x", lng: 75.8 });
  expect(store.get(7)).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd backend && npx jest src/services/__tests__/liveDriverPositions.test.js src/services/__tests__/trackEtaService.test.js src/sockets/__tests__/trackingSocketLive.test.js`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement the store and hook it into the socket handler**

```js
// backend/src/services/liveDriverPositions.js
// Last location ping per driver, kept in memory so the public tracking page can read a fresh
// position without a DB write per ping (tbl_rider is only written every few seconds). Single Node
// process: with several processes a page would see only its own process's pings and fall back to
// the DB value, which is acceptable.
const MAX_ENTRIES = 5000;
const MAX_AGE_MS = 60 * 60 * 1000;
const positions = new Map();

function record(riderId, lat, lng, heading, now = Date.now()) {
  positions.set(Number(riderId), { lat, lng, heading, at: now });
  if (positions.size > MAX_ENTRIES) {
    for (const [id, p] of positions) if (now - p.at > MAX_AGE_MS) positions.delete(id);
  }
}

const get = (riderId) => positions.get(Number(riderId)) || null;
const _clear = () => positions.clear();

module.exports = { record, get, _clear };
```

In `trackingSocket.js` add `const livePositions = require("../services/liveDriverPositions");` next to the other requires, and right after the `if (!Number.isFinite(parsedLat) ... ) { return; }` validation block, before `if (order_id) {`:

```js
    livePositions.record(riderId, parsedLat, parsedLng, parsedHeading);
```

- [ ] **Step 4: Implement the ETA/route service**

```js
// backend/src/services/trackEtaService.js
const logger = require("../utils/logger");
const { haversineKm } = require("../utils/geoDistance");
const { fetchGoogleDrive, estimateDrive } = require("./pickupEtaService");

const ETA_FRESH_MS = 60 * 1000;
const ETA_MAX_REUSE_MS = 2 * 60 * 1000;
const ETA_MOVE_M = 150;
const ROUTE_TTL_MS = 30 * 60 * 1000;
const ROUTE_FALLBACK_TTL_MS = 2 * 60 * 1000;
const MAX_ROUTE_POINTS = 150;
const GOOGLE_TIMEOUT_MS = 4000;

const etaCache = new Map(); // orderId -> { from, at, value }
const etaInflight = new Map();
const routeCache = new Map(); // orderId -> { at, ttl, points }
const routeInflight = new Map();

function _reset() {
  etaCache.clear(); etaInflight.clear(); routeCache.clear(); routeInflight.clear();
}
function clearOrder(orderId) {
  etaCache.delete(orderId); routeCache.delete(orderId);
}

const toEta = (drive, now) => ({
  minutes: Math.max(1, Math.ceil(drive.seconds / 60)),
  distance_km: Math.round(drive.meters / 100) / 10,
  updated_at: new Date(now).toISOString(),
});

// Driver -> drop ETA. Cached per order so a busy page never turns into one Google call per poll.
async function getEta(orderId, from, to, { now = Date.now(), fetchImpl } = {}) {
  const hit = etaCache.get(orderId);
  if (hit) {
    const age = now - hit.at;
    const movedM = haversineKm(hit.from.lat, hit.from.lng, from.lat, from.lng) * 1000;
    if (age < ETA_FRESH_MS || (age < ETA_MAX_REUSE_MS && movedM < ETA_MOVE_M)) return hit.value;
  }
  if (etaInflight.has(orderId)) return etaInflight.get(orderId);
  const pending = (async () => {
    const drive = (await fetchGoogleDrive(from, to, { fetchImpl })) || estimateDrive(from, to);
    const value = toEta(drive, now);
    etaCache.set(orderId, { from, at: now, value });
    return value;
  })().finally(() => etaInflight.delete(orderId));
  etaInflight.set(orderId, pending);
  return pending;
}

function simplify(points, max = MAX_ROUTE_POINTS) {
  if (points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

async function fetchGoogleRoute(origin, destination, { fetchImpl = fetch, apiKey = process.env.GOOGLE_MAPS_API_KEY } = {}) {
  if (!apiKey) return null;
  try {
    const response = await fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.polyline.geoJsonLinestring" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        polylineEncoding: "GEO_JSON_LINESTRING",
        polylineQuality: "OVERVIEW",
      }),
    });
    if (!response.ok) {
      logger.warn(`trackEtaService: Google Routes responded ${response.status}`);
      return null;
    }
    const data = await response.json();
    const coords = data?.routes?.[0]?.polyline?.geoJsonLinestring?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const points = coords.map((c) => [Number(c[1]), Number(c[0])]).filter(([la, lo]) => Number.isFinite(la) && Number.isFinite(lo));
    return points.length >= 2 ? points : null;
  } catch (err) {
    logger.warn(`trackEtaService: Google Routes call failed (${err.message})`);
    return null;
  }
}

// Pickup -> drop line for the map; the same for the whole trip, so it is cached per order.
async function getRoute(orderId, from, to, { now = Date.now(), fetchImpl } = {}) {
  const hit = routeCache.get(orderId);
  if (hit && now - hit.at < hit.ttl) return hit.points;
  if (routeInflight.has(orderId)) return routeInflight.get(orderId);
  const pending = (async () => {
    const google = await fetchGoogleRoute(from, to, fetchImpl ? { fetchImpl } : {});
    const points = google ? simplify(google) : [[from.lat, from.lng], [to.lat, to.lng]];
    routeCache.set(orderId, { at: now, ttl: google ? ROUTE_TTL_MS : ROUTE_FALLBACK_TTL_MS, points });
    return points;
  })().finally(() => routeInflight.delete(orderId));
  routeInflight.set(orderId, pending);
  return pending;
}

module.exports = { getEta, getRoute, clearOrder, simplify, _reset };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && npx jest src/services/__tests__/liveDriverPositions.test.js src/services/__tests__/trackEtaService.test.js src/sockets/__tests__/trackingSocketLive.test.js`
Expected: PASS. Also run `npx jest src/sockets` to confirm no existing socket test broke.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/liveDriverPositions.js backend/src/services/trackEtaService.js backend/src/sockets/trackingSocket.js backend/src/services/__tests__ backend/src/sockets/__tests__
git commit -m "feat(receiver-tracking): live driver position store and cached ETA/route

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Snapshot builder, API controller and routes

**Files:**
- Create: `backend/src/services/trackSnapshotService.js`, `backend/src/controllers/trackController.js`, `backend/src/routes/trackRoutes.js`
- Modify: `backend/src/app.js`
- Test: `backend/src/services/__tests__/trackSnapshotService.test.js`, `backend/src/controllers/__tests__/trackController.test.js`

**Interfaces:**
- Consumes: Task 1 `isTrackingEnabled`; Task 2 `findByToken`, `isTokenShape`, `touchViewed`; Task 3 `liveDriverPositions.get`, `trackEtaService.getEta/getRoute/clearOrder`; Task 5 `renderPage(config)` from `trackPage.js` (the controller's `page` handler needs it, so this task creates a minimal `trackPage.js` stub exporting `renderPage` that returns a string; Task 5 replaces its body).
- Produces: `buildSnapshot(link, { now? }): Promise<object>` with the JSON from the spec (`state` is one of `active|delivered|cancelled|expired|invalid`), controller `{ snapshot, page }`, routers `{ pageRouter, apiRouter }`.

Snapshot shape (exact):

```
active:    { state, order_id, step, driver:{first_name,vehicle_no,phone}|null, eta|null, position|null, route|null,
             pickup|null, drop|null, delivered_at:null, poll_ms:5000 }
delivered: { state, order_id, step:5, delivered_at:<iso +05:30>|null, poll_ms:15000 }
cancelled: { state, order_id, poll_ms:15000 }       expired/invalid: { state, poll_ms:15000 }
position = { lat, lng, heading, updated_at:<iso>, stale:boolean };  pickup/drop = { lat, lng, address }
```

- [ ] **Step 1: Write the failing snapshot tests**

```js
// backend/src/services/__tests__/trackSnapshotService.test.js
jest.mock("../../config/db", () => ({
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  pkg_order_wait_timer: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverTrackSettings", () => ({ isTrackingEnabled: jest.fn() }));
jest.mock("../trackEtaService", () => ({ getEta: jest.fn(), getRoute: jest.fn(), clearOrder: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../receiverTrackSettings");
const eta = require("../trackEtaService");
const live = require("../liveDriverPositions");
const { buildSnapshot } = require("../trackSnapshotService");

const NOW = Date.UTC(2026, 9, 6, 10, 0, 0);
const link = { id: 1, order_id: 50, receiver_phone: "9876543210" };
const order = (o = {}) => ({
  id: 50, rid: 9, order_status: 3, o_status: "On_Route", dmobile: "98765 43210",
  plat: "22.70", plong: "75.80", dlat: "22.80", dlong: "75.90",
  paddress: "P".repeat(100), daddress: "Drop address", drop_time: null, ddate: null, ...o,
});
const rider = (o = {}) => ({ first_name: "Suresh Kumar", vehicle_no: "MP09AB1234", fmobile: "9109114515", rlats: "22.71", rlongs: "75.81", rloc_updated_at: new Date(NOW - 10000), ...o });

beforeEach(() => {
  jest.clearAllMocks();
  live._clear();
  settings.isTrackingEnabled.mockResolvedValue(true);
  prisma.pkg_order.findUnique.mockResolvedValue(order());
  prisma.tbl_rider.findUnique.mockResolvedValue(rider());
  prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(null);
  eta.getEta.mockResolvedValue({ minutes: 12, distance_km: 4.2, updated_at: "x" });
  eta.getRoute.mockResolvedValue([[22.7, 75.8], [22.8, 75.9]]);
});

describe("states", () => {
  it("is expired when the feature is switched off", async () => {
    settings.isTrackingEnabled.mockResolvedValue(false);
    expect(await buildSnapshot(link, { now: NOW })).toEqual({ state: "expired", poll_ms: 15000 });
    expect(prisma.pkg_order.findUnique).not.toHaveBeenCalled();
  });
  it("is invalid for a missing order or when the drop contact no longer matches the link", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(null);
    expect((await buildSnapshot(link, { now: NOW })).state).toBe("invalid");
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9000000000" }));
    expect((await buildSnapshot(link, { now: NOW })).state).toBe("invalid");
  });
  it("is cancelled for a cancelled order and releases the caches", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 4, o_status: "Cancelled" }));
    expect(await buildSnapshot(link, { now: NOW })).toEqual({ state: "cancelled", order_id: 50, poll_ms: 15000 });
    expect(eta.clearOrder).toHaveBeenCalledWith(50);
  });
  it("is delivered with the IST delivery time, with no position, for 24 hours", async () => {
    // drop_time holds IST wall-clock: 15:00 IST = 09:30 UTC
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed", drop_time: new Date("2026-10-06T15:00:00Z") }));
    const s = await buildSnapshot(link, { now: Date.UTC(2026, 9, 7, 8, 0, 0) }); // 22.5 h later
    expect(s).toEqual({ state: "delivered", order_id: 50, step: 5, delivered_at: "2026-10-06T15:00:00.000+05:30", poll_ms: 15000 });
  });
  it("is expired 24 hours after delivery", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed", drop_time: new Date("2026-10-06T15:00:00Z") }));
    expect((await buildSnapshot(link, { now: Date.UTC(2026, 9, 7, 10, 0, 0) })).state).toBe("expired");
  });
  it("a completed order with no delivery time is delivered with delivered_at null", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed" }));
    expect(await buildSnapshot(link, { now: NOW })).toMatchObject({ state: "delivered", delivered_at: null });
  });
});

describe("privacy: nothing live before pickup", () => {
  for (const status of [0, 1, 2]) {
    it(`order_status ${status}: no position, route, coordinates or ETA`, async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: status, o_status: "Processing" }));
      live.record(9, 22.71, 75.81, 90, NOW - 1000);
      const s = await buildSnapshot(link, { now: NOW });
      expect(s).toMatchObject({ state: "active", position: null, route: null, pickup: null, drop: null, eta: null });
      expect(eta.getEta).not.toHaveBeenCalled();
      expect(eta.getRoute).not.toHaveBeenCalled();
      expect(JSON.stringify(s)).not.toContain("22.7");
    });
  }
  it("never returns the OTP, booker, fare or payment data", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ otp: 7788, uid: 5, total_dcharge: 450, pmobile: "9811111111" }));
    const text = JSON.stringify(await buildSnapshot(link, { now: NOW }));
    for (const secret of ["7788", "450", "9811111111", "uid", "otp", "total_dcharge"]) expect(text).not.toContain(secret);
  });
});

describe("active steps and driver", () => {
  it("maps order_status to the step, and arrival at drop to step 4", async () => {
    for (const [status, timer, step] of [[0, null, 0], [1, null, 1], [2, null, 2], [3, null, 3], [3, { drop_wait_start: new Date() }, 4]]) {
      prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: status }));
      prisma.pkg_order_wait_timer.findUnique.mockResolvedValue(timer);
      expect((await buildSnapshot(link, { now: NOW })).step).toBe(step);
    }
  });
  it("shows the driver's first name, vehicle and phone", async () => {
    expect((await buildSnapshot(link, { now: NOW })).driver).toEqual({ first_name: "Suresh", vehicle_no: "MP09AB1234", phone: "9109114515" });
  });
  it("has no driver before assignment", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ rid: 0, order_status: 0 }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.driver).toBeNull();
    expect(prisma.tbl_rider.findUnique).not.toHaveBeenCalled();
  });
});

describe("on the way (order_status 3)", () => {
  it("returns pickup/drop, the route, and a live position with an ETA to the drop", async () => {
    live.record(9, 22.75, 75.85, 120, NOW - 3000);
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toEqual({ lat: 22.75, lng: 75.85, heading: 120, updated_at: new Date(NOW - 3000).toISOString(), stale: false });
    expect(s.pickup).toEqual({ lat: 22.7, lng: 75.8, address: "P".repeat(80) });
    expect(s.drop).toEqual({ lat: 22.8, lng: 75.9, address: "Drop address" });
    expect(s.route).toEqual([[22.7, 75.8], [22.8, 75.9]]);
    expect(s.eta).toMatchObject({ minutes: 12 });
    expect(eta.getEta).toHaveBeenCalledWith(50, { lat: 22.75, lng: 75.85 }, { lat: 22.8, lng: 75.9 });
    expect(s.poll_ms).toBe(5000);
  });
  it("falls back to the database position when there is no live ping", async () => {
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toMatchObject({ lat: 22.71, lng: 75.81, stale: false });
  });
  it("marks a position older than 2 minutes as stale and does not compute an ETA from it", async () => {
    live.record(9, 22.75, 75.85, 0, NOW - 3 * 60 * 1000);
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position.stale).toBe(true);
    expect(s.eta).toBeNull();
  });
  it("has a null position when the driver never reported one", async () => {
    prisma.tbl_rider.findUnique.mockResolvedValue(rider({ rlats: null, rlongs: null, rloc_updated_at: null }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s.position).toBeNull();
    expect(s.eta).toBeNull();
    expect(s.route).not.toBeNull();
  });
  it("does not crash on blank or non-numeric order coordinates", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ plat: "", plong: "75.8", dlat: "0", dlong: "0" }));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s).toMatchObject({ state: "active", pickup: null, drop: null, route: null, eta: null });
  });
  it("ETA and route failures only blank those fields", async () => {
    live.record(9, 22.75, 75.85, 0, NOW - 1000);
    eta.getEta.mockRejectedValue(new Error("google"));
    eta.getRoute.mockRejectedValue(new Error("google"));
    const s = await buildSnapshot(link, { now: NOW });
    expect(s).toMatchObject({ state: "active", eta: null, route: null });
    expect(s.position).not.toBeNull();
  });
  it("no ETA once the driver is at the drop (step 4)", async () => {
    live.record(9, 22.8, 75.9, 0, NOW - 1000);
    prisma.pkg_order_wait_timer.findUnique.mockResolvedValue({ drop_wait_start: new Date() });
    expect((await buildSnapshot(link, { now: NOW })).eta).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/trackSnapshotService.test.js`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the snapshot service**

```js
// backend/src/services/trackSnapshotService.js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { normalizeToLast10Digits } = require("../utils/phone");
const { RIDER_LOCATION_FRESHNESS_MS } = require("../config/constants");
const settings = require("./receiverTrackSettings");
const livePositions = require("./liveDriverPositions");
const etaService = require("./trackEtaService");

const POLL_ACTIVE_MS = 5000;
const POLL_IDLE_MS = 15000;
const EXPIRE_AFTER_DELIVERY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const short = (s) => (s ? String(s).slice(0, 80) : null);
const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || null;

function toPoint(lat, lng) {
  // Number("") is 0, so a blank column must be rejected before the numeric check.
  if (String(lat ?? "").trim() === "" || String(lng ?? "").trim() === "") return null;
  const a = Number(lat);
  const b = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) return null;
  return { lat: a, lng: b };
}

async function safe(label, fn) {
  try {
    return await fn();
  } catch (err) {
    logger.warn(`trackSnapshot: ${label} failed: ${err && err.message}`);
    return null;
  }
}

// Last known position: the live ping first, then the throttled DB copy. Position is `stale` after 2 minutes.
function currentPosition(riderId, rider, now) {
  const live = livePositions.get(riderId);
  let lat; let lng; let heading; let at;
  if (live) {
    ({ lat, lng, heading, at } = live);
  } else {
    const p = toPoint(rider && rider.rlats, rider && rider.rlongs);
    if (!p) return null;
    lat = p.lat; lng = p.lng; heading = 0;
    at = rider.rloc_updated_at ? new Date(rider.rloc_updated_at).getTime() : null;
  }
  return {
    lat, lng, heading: Number.isFinite(heading) ? heading : 0,
    updated_at: at ? new Date(at).toISOString() : null,
    stale: at === null || now - at > RIDER_LOCATION_FRESHNESS_MS,
  };
}

async function buildSnapshot(link, { now = Date.now() } = {}) {
  if (!(await settings.isTrackingEnabled())) return { state: "expired", poll_ms: POLL_IDLE_MS };
  const order = await prisma.pkg_order.findUnique({
    where: { id: link.order_id },
    select: {
      id: true, rid: true, order_status: true, o_status: true, dmobile: true,
      plat: true, plong: true, dlat: true, dlong: true, paddress: true, daddress: true, drop_time: true, ddate: true,
    },
  });
  // The link belongs to the order's current drop contact; a changed number kills the old link.
  if (!order || normalizeToLast10Digits(order.dmobile) !== link.receiver_phone) return { state: "invalid", poll_ms: POLL_IDLE_MS };

  const status = Number(order.order_status);
  if (status === 4 || order.o_status === "Cancelled") {
    etaService.clearOrder(order.id);
    return { state: "cancelled", order_id: order.id, poll_ms: POLL_IDLE_MS };
  }
  if (status === 5 || order.o_status === "Completed") {
    etaService.clearOrder(order.id);
    // drop_time / ddate hold IST wall-clock values (see driverOrderHistoryController).
    const doneAt = order.drop_time || order.ddate;
    if (doneAt && now > new Date(doneAt).getTime() - IST_OFFSET_MS + EXPIRE_AFTER_DELIVERY_MS) {
      return { state: "expired", poll_ms: POLL_IDLE_MS };
    }
    return {
      state: "delivered", order_id: order.id, step: 5,
      delivered_at: doneAt ? new Date(doneAt).toISOString().replace("Z", "+05:30") : null,
      poll_ms: POLL_IDLE_MS,
    };
  }

  const hasDriver = Number(order.rid) > 0;
  const [rider, timer] = await Promise.all([
    hasDriver
      ? prisma.tbl_rider.findUnique({ where: { id: order.rid }, select: { first_name: true, vehicle_no: true, fmobile: true, rlats: true, rlongs: true, rloc_updated_at: true } })
      : null,
    hasDriver
      ? prisma.pkg_order_wait_timer.findUnique({ where: { order_id_rid: { order_id: order.id, rid: order.rid } }, select: { drop_wait_start: true } })
      : null,
  ]);

  const atDrop = status === 3 && Boolean(timer && timer.drop_wait_start);
  const step = status < 1 ? 0 : status === 1 ? 1 : status === 2 ? 2 : atDrop ? 4 : 3;

  let position = null; let eta = null; let route = null; let pickup = null; let drop = null;
  if (status === 3) {
    const pickupPt = toPoint(order.plat, order.plong);
    const dropPt = toPoint(order.dlat, order.dlong);
    if (pickupPt) pickup = { ...pickupPt, address: short(order.paddress) };
    if (dropPt) drop = { ...dropPt, address: short(order.daddress) };
    position = currentPosition(order.rid, rider, now);
    if (position && !position.stale && !atDrop && dropPt) {
      eta = await safe("eta", () => etaService.getEta(order.id, { lat: position.lat, lng: position.lng }, dropPt));
    }
    if (pickupPt && dropPt) route = await safe("route", () => etaService.getRoute(order.id, pickupPt, dropPt));
  }

  return {
    state: "active", order_id: order.id, step,
    driver: rider ? { first_name: firstName(rider.first_name), vehicle_no: rider.vehicle_no || null, phone: rider.fmobile || null } : null,
    eta, position, route, pickup, drop, delivered_at: null, poll_ms: POLL_ACTIVE_MS,
  };
}

module.exports = { buildSnapshot };
```

- [ ] **Step 4: Run to verify the snapshot tests pass**

Run: `cd backend && npx jest src/services/__tests__/trackSnapshotService.test.js`
Expected: PASS. If the "never returns the OTP..." test fails because a key name (for example "uid") appears in a non-secret field, fix the snapshot output, not the test.

- [ ] **Step 5: Write the failing controller and route tests**

```js
// backend/src/controllers/__tests__/trackController.test.js
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/trackLinkService", () => ({
  isTokenShape: jest.requireActual("../../services/trackLinkService").isTokenShape,
  findByToken: jest.fn(), touchViewed: jest.fn(),
}));
jest.mock("../../services/trackSnapshotService", () => ({ buildSnapshot: jest.fn() }));
jest.mock("../../services/receiverTrackSettings", () => ({ getMapConfig: jest.fn(() => ({ tileUrl: "https://t/{z}/{x}/{y}.png?key=abc12345", attribution: "a" })) }));
jest.mock("../../config/db", () => ({}));

const links = require("../../services/trackLinkService");
const { buildSnapshot } = require("../../services/trackSnapshotService");
const c = require("../trackController");

const TOKEN = "t".repeat(43);
const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() });
beforeEach(() => jest.clearAllMocks());

describe("snapshot", () => {
  it("rejects a malformed token with the invalid shape and never touches the DB", async () => {
    const r = res();
    await c.snapshot({ params: { token: "../etc/passwd" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ state: "invalid", poll_ms: 15000 });
    expect(links.findByToken).not.toHaveBeenCalled();
  });
  it("unknown token -> 404 with the same shape", async () => {
    links.findByToken.mockResolvedValue(null);
    const r = res();
    await c.snapshot({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ state: "invalid", poll_ms: 15000 });
  });
  it("returns the snapshot, no-store, and records the view", async () => {
    links.findByToken.mockResolvedValue({ id: 3, order_id: 50 });
    buildSnapshot.mockResolvedValue({ state: "active", step: 3 });
    const r = res();
    await c.snapshot({ params: { token: TOKEN } }, r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }));
    expect(r.json).toHaveBeenCalledWith({ state: "active", step: 3 });
    expect(links.touchViewed).toHaveBeenCalledWith(3);
  });
  it("a builder failure is a 500 with state error", async () => {
    links.findByToken.mockResolvedValue({ id: 3, order_id: 50 });
    buildSnapshot.mockRejectedValue(new Error("boom"));
    const r = res();
    await c.snapshot({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(r.json).toHaveBeenCalledWith({ state: "error", poll_ms: 15000 });
  });
});

describe("page", () => {
  it("serves HTML with the privacy headers", () => {
    const r = res();
    c.page({ params: { token: TOKEN } }, r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" }));
    expect(r.send).toHaveBeenCalledWith(expect.stringContaining("<!doctype html>"));
  });
  it("404s a malformed token", () => {
    const r = res();
    c.page({ params: { token: "x" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
  });
});
```

```js
// backend/src/controllers/__tests__/trackRoutes.test.js
jest.mock("../trackController", () => ({ snapshot: jest.fn(), page: jest.fn() }));
const { pageRouter, apiRouter } = require("../../routes/trackRoutes");

const paths = (router) => router.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path} x${l.route.stack.length}`);

it("serves the page and the API on /:token, each behind a rate limiter", () => {
  expect(paths(pageRouter)).toEqual(["get /:token x2"]);
  expect(paths(apiRouter)).toEqual(["get /:token x2"]);
});
```

- [ ] **Step 6: Implement the controller, routes, a page stub and the app wiring**

```js
// backend/src/controllers/trackController.js
const logger = require("../utils/logger");
const trackLinkService = require("../services/trackLinkService");
const { buildSnapshot } = require("../services/trackSnapshotService");
const { getMapConfig } = require("../services/receiverTrackSettings");
const { renderPage } = require("./trackPage");

const INVALID = { state: "invalid", poll_ms: 15000 };
const API_HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

async function snapshot(req, res) {
  res.set(API_HEADERS);
  const { token } = req.params;
  if (!trackLinkService.isTokenShape(token)) return res.status(404).json(INVALID);
  try {
    const link = await trackLinkService.findByToken(token);
    if (!link) return res.status(404).json(INVALID);
    trackLinkService.touchViewed(link.id);
    return res.json(await buildSnapshot(link));
  } catch (err) {
    logger.error("track snapshot failed:", err);
    return res.status(500).json({ state: "error", poll_ms: 15000 });
  }
}

function page(req, res) {
  if (!trackLinkService.isTokenShape(req.params.token)) return res.status(404).json(INVALID);
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
  return res.send(renderPage(getMapConfig()));
}

module.exports = { snapshot, page };
```

```js
// backend/src/routes/trackRoutes.js
const express = require("express");
const { createIpRateLimiter } = require("../middleware/ipRateLimiter");
const controller = require("../controllers/trackController");

const pageRouter = express.Router();
pageRouter.get("/:token", createIpRateLimiter({ name: "track-page", windowMs: 60000, max: 60 }), controller.page);

const apiRouter = express.Router();
apiRouter.get("/:token", createIpRateLimiter({ name: "track-api", windowMs: 60000, max: 120 }), controller.snapshot);

module.exports = { pageRouter, apiRouter };
```

Temporary stub, replaced in Task 5:

```js
// backend/src/controllers/trackPage.js
function renderPage() {
  return "<!doctype html><html><body>tracking</body></html>";
}
module.exports = { renderPage };
```

In `backend/src/app.js`, next to the other route requires and mounts:

```js
const { pageRouter: trackPage, apiRouter: trackApi } = require("./routes/trackRoutes");
```
```js
app.use("/track", trackPage);
app.use("/api/track", trackApi);
```

- [ ] **Step 7: Run the tests**

Run: `cd backend && npx jest src/controllers/__tests__/trackController.test.js src/controllers/__tests__/trackRoutes.test.js src/services/__tests__/trackSnapshotService.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/trackSnapshotService.js backend/src/controllers/trackController.js backend/src/controllers/trackPage.js backend/src/routes/trackRoutes.js backend/src/app.js backend/src/services/__tests__/trackSnapshotService.test.js backend/src/controllers/__tests__/trackController.test.js backend/src/controllers/__tests__/trackRoutes.test.js
git commit -m "feat(receiver-tracking): snapshot API with privacy rules, controller and routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The tracking page

**Files:**
- Modify (replace the stub): `backend/src/controllers/trackPage.js`
- Test: `backend/src/controllers/__tests__/trackPage.test.js`

**Interfaces:**
- Consumes: `getMapConfig()` output `{ tileUrl: string|null, attribution: string }` passed to `renderPage`; the snapshot JSON of Task 4.
- Produces: `renderPage(config): string` (a complete HTML document).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/trackPage.test.js
const { renderPage } = require("../trackPage");

const cfg = { tileUrl: "https://api.maptiler.com/maps/streets-v2/{z}/{x}/{y}.png?key=abcd1234", attribution: "<a>x</a>" };

describe("renderPage", () => {
  it("is a complete mobile document that is not indexed", () => {
    const html = renderPage(cfg);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('name="viewport"');
    expect(html).toContain('name="robots" content="noindex"');
  });
  it("loads Leaflet 1.9.4 from cdnjs with the verified SRI hashes", () => {
    const html = renderPage(cfg);
    expect(html).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js");
    expect(html).toContain("sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=");
    expect(html).toContain("https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css");
    expect(html).toContain("sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=");
  });
  it("injects the config as inert JSON, escaping anything that could close the script tag", () => {
    const html = renderPage({ tileUrl: null, attribution: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script");
    const m = html.match(/<script type="application\/json" id="cfg">([\s\S]*?)<\/script>/);
    expect(JSON.parse(m[1]).attribution).toBe("</script><script>alert(1)</script>");
  });
  it("never writes data into the page with innerHTML", () => {
    expect(renderPage(cfg)).not.toMatch(/innerHTML/);
  });
  it("keeps working without the map library or tiles", () => {
    const html = renderPage({ tileUrl: null, attribution: "" });
    expect(html).toMatch(/window\.L\b/);
    expect(html).toContain("CONFIG.tileUrl");
  });
  it("reads the token from the URL path and polls only the track API", () => {
    const html = renderPage(cfg);
    expect(html).toContain('"/api/track/"');
    expect(html).toContain("document.hidden");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/trackPage.test.js`
Expected: FAIL (the stub has none of this).

- [ ] **Step 3: Implement the page**

Replace `backend/src/controllers/trackPage.js` with:

```js
// backend/src/controllers/trackPage.js
// Public receiver tracking page. One inline HTML document, no build step (same approach as
// receiverPayPage.js). All dynamic text is set with textContent; the only HTML strings below are
// static literals. The map is a progressive enhancement: without Leaflet or tiles the timeline, ETA
// and driver card still work.
const TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Shifter Online - Track delivery</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous">
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1b1f24; --muted:#5f6b7a; --accent:#0a7d4f; --warn:#b26a00; --line:#e3e6ea; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111418; --card:#1a1f26; --text:#eceff3; --muted:#9aa5b1; --accent:#3ecf8e; --warn:#ffb74d; --line:#2a313a; } }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.45 system-ui, sans-serif; }
  main { max-width:520px; margin:0 auto; padding:12px 12px 24px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-bottom:10px; }
  h1 { font-size:18px; margin:0; } .muted { color:var(--muted); font-size:14px; }
  #status { font-size:20px; font-weight:700; margin:2px 0; }
  #eta { font-size:15px; color:var(--accent); font-weight:600; min-height:1.2em; }
  #offline, #stale { color:var(--warn); font-size:13px; min-height:1.1em; }
  #map { height:48vh; min-height:260px; border-radius:12px; border:1px solid var(--line); margin-bottom:10px; }
  ol { list-style:none; margin:8px 0 0; padding:0; }
  li { position:relative; padding:6px 0 6px 28px; color:var(--muted); }
  li::before { content:""; position:absolute; left:6px; top:11px; width:12px; height:12px; border-radius:50%; border:2px solid var(--line); background:var(--card); }
  li.done { color:var(--text); } li.done::before { background:var(--accent); border-color:var(--accent); }
  li.current { color:var(--text); font-weight:700; } li.current::before { border-color:var(--accent); box-shadow:0 0 0 4px rgba(10,125,79,.2); }
  .driver { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .driver b { display:block; } a.call { background:var(--accent); color:#fff; text-decoration:none; padding:10px 16px; border-radius:10px; font-weight:600; white-space:nowrap; }
  .pin { width:14px; height:14px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 0 1px rgba(0,0,0,.4); }
  .pin.p { background:#1a73e8; } .pin.d { background:#d93025; }
  .car { width:34px; height:34px; } .car > div { width:34px; height:34px; transition:transform .3s linear; }
  .car svg { width:34px; height:34px; filter:drop-shadow(0 1px 2px rgba(0,0,0,.5)); } .car.stale svg { opacity:.45; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Shifter Online</h1>
    <div class="muted" id="order"></div>
    <div id="status">Loading...</div>
    <div id="eta"></div>
    <div id="stale"></div>
    <div id="offline"></div>
  </div>
  <div id="map" hidden></div>
  <div class="card" id="driverCard" hidden>
    <div class="driver">
      <div><b id="driverName"></b><span class="muted" id="driverVehicle"></span></div>
      <a class="call" id="call" href="#">Call driver</a>
    </div>
  </div>
  <div class="card" id="addrCard" hidden>
    <div class="muted">Pickup</div><div id="pickupAddr"></div>
    <div class="muted" style="margin-top:8px">Drop</div><div id="dropAddr"></div>
  </div>
  <div class="card"><ol id="steps"></ol></div>
</main>
<script type="application/json" id="cfg">__CONFIG__</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
(function () {
  var CONFIG = JSON.parse(document.getElementById("cfg").textContent);
  var token = location.pathname.split("/").filter(Boolean).pop();
  var api = "/api/track/" + encodeURIComponent(token);
  var $ = function (id) { return document.getElementById(id); };
  var STEPS = [["assigned", "Driver assigned"], ["reached_pickup", "Reached pickup"], ["on_the_way", "On the way"], ["reached_drop", "Reached drop"], ["delivered", "Delivered"]];
  var HEADLINES = { 0: "Looking for a driver", 1: "Driver is heading to the pickup point", 2: "Driver reached the pickup point", 3: "Your parcel is on the way", 4: "Driver has reached your location", 5: "Delivered" };
  var CAR_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2 L20 21 L12 17 L4 21 Z" fill="#0a7d4f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  var map = null, driverMarker = null, pickupMarker = null, dropMarker = null, routeLine = null, fitted = false;
  var timer = null, pollMs = 5000, failures = 0, anim = null, lastKey = "";

  function setText(id, text) { $(id).textContent = text || ""; }
  function terminal(state) { return state === "delivered" || state === "cancelled" || state === "expired" || state === "invalid"; }

  function renderSteps(step) {
    var ol = $("steps"); ol.textContent = "";
    for (var i = 0; i < STEPS.length; i++) {
      var li = document.createElement("li");
      var n = i + 1;
      li.textContent = STEPS[i][1];
      if (n < step || (n === step && step === 5)) li.className = "done";
      else if (n === step) li.className = "current";
      ol.appendChild(li);
    }
  }

  function fmtDelivered(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return "Delivered on " + d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function ensureMap() {
    if (map) return true;
    if (!window.L || !CONFIG.tileUrl) return false;
    try {
      $("map").hidden = false;
      map = L.map("map", { zoomControl: true, attributionControl: true }).setView([20.5937, 78.9629], 5);
      L.tileLayer(CONFIG.tileUrl, { maxZoom: 19, attribution: CONFIG.attribution }).addTo(map);
      return true;
    } catch (e) { map = null; $("map").hidden = true; return false; }
  }

  function pinIcon(cls) { return L.divIcon({ className: "", html: '<div class="pin ' + cls + '"></div>', iconSize: [14, 14], iconAnchor: [7, 7] }); }
  function carIcon() { return L.divIcon({ className: "car", html: "<div>" + CAR_SVG + "</div>", iconSize: [34, 34], iconAnchor: [17, 17] }); }

  function moveDriver(pos) {
    var to = L.latLng(pos.lat, pos.lng);
    if (!driverMarker) { driverMarker = L.marker(to, { icon: carIcon(), interactive: false }).addTo(map); }
    var el = driverMarker.getElement();
    if (el) {
      if (pos.stale) el.classList.add("stale"); else el.classList.remove("stale");
      var inner = el.firstChild;
      if (inner && inner.style) inner.style.transform = "rotate(" + (Number(pos.heading) || 0) + "deg)";
    }
    var from = driverMarker.getLatLng();
    if (anim) cancelAnimationFrame(anim);
    var start = null, dur = Math.min(pollMs, 4000);
    function frame(ts) {
      if (start === null) start = ts;
      var t = Math.min(1, (ts - start) / dur);
      driverMarker.setLatLng([from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t]);
      if (t < 1) anim = requestAnimationFrame(frame);
    }
    anim = requestAnimationFrame(frame);
  }

  function drawMap(s) {
    if (!(s.pickup || s.drop || s.position)) return;
    if (!ensureMap()) return;
    var pts = [];
    if (s.route && s.route.length > 1) {
      var key = s.route.length + ":" + s.route[0] + ":" + s.route[s.route.length - 1];
      if (key !== lastKey) { if (routeLine) map.removeLayer(routeLine); routeLine = L.polyline(s.route, { color: "#1a73e8", weight: 5, opacity: 0.8 }).addTo(map); lastKey = key; }
      pts = pts.concat(s.route);
    }
    if (s.pickup && !pickupMarker) pickupMarker = L.marker([s.pickup.lat, s.pickup.lng], { icon: pinIcon("p"), interactive: false }).addTo(map);
    if (s.drop && !dropMarker) dropMarker = L.marker([s.drop.lat, s.drop.lng], { icon: pinIcon("d"), interactive: false }).addTo(map);
    if (s.pickup) pts.push([s.pickup.lat, s.pickup.lng]);
    if (s.drop) pts.push([s.drop.lat, s.drop.lng]);
    if (s.position) { moveDriver(s.position); pts.push([s.position.lat, s.position.lng]); }
    if (!fitted && pts.length) { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 16 }); fitted = true; }
  }

  function render(s) {
    setText("order", s.order_id ? "Order #" + s.order_id : "");
    $("driverCard").hidden = true; $("addrCard").hidden = true;
    setText("eta", ""); setText("stale", "");
    if (s.state === "invalid" || s.state === "expired" || s.state === "cancelled") {
      var msg = s.state === "cancelled" ? "This order was cancelled" : s.state === "expired" ? "This tracking link has expired" : "This tracking link is no longer valid";
      setText("status", msg); $("steps").textContent = ""; if (map) $("map").hidden = true; return;
    }
    if (s.state === "delivered") {
      setText("status", "Delivered"); setText("eta", fmtDelivered(s.delivered_at)); renderSteps(5); if (map) $("map").hidden = true; return;
    }
    if (s.state !== "active") { return; }
    var step = s.step || 0;
    setText("status", HEADLINES[step] || "Tracking");
    renderSteps(step);
    if (s.eta) setText("eta", "Arriving in ~" + s.eta.minutes + " min" + (s.eta.distance_km != null ? " \\u00B7 " + s.eta.distance_km + " km away" : ""));
    if (s.position && s.position.stale) setText("stale", "Waiting for the driver's location");
    if (s.driver && s.driver.first_name) {
      $("driverCard").hidden = false;
      setText("driverName", s.driver.first_name);
      setText("driverVehicle", s.driver.vehicle_no ? " \\u00B7 " + s.driver.vehicle_no : "");
      var phone = String(s.driver.phone || "").replace(/[^0-9+]/g, "");
      if (phone) { $("call").href = "tel:" + phone; $("call").hidden = false; } else { $("call").hidden = true; }
    }
    if (s.pickup || s.drop) {
      $("addrCard").hidden = false;
      setText("pickupAddr", s.pickup ? s.pickup.address : ""); setText("dropAddr", s.drop ? s.drop.address : "");
    }
    drawMap(s);
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(load, pollMs); }

  function load() {
    if (document.hidden) { schedule(); return; }
    fetch(api, { cache: "no-store" })
      .then(function (r) { return r.json().then(function (body) { return { status: r.status, body: body }; }); })
      .then(function (x) {
        failures = 0; setText("offline", "");
        var s = x.body || {};
        if (s.state === "error") { throw new Error("server"); }
        render(s);
        pollMs = s.poll_ms || 5000;
        if (!terminal(s.state)) schedule();
      })
      .catch(function () {
        failures += 1; setText("offline", "Connection problem - retrying...");
        pollMs = Math.min(30000, 5000 * Math.pow(2, Math.min(failures, 3)));
        schedule();
      });
  }

  document.addEventListener("visibilitychange", function () { if (!document.hidden) { clearTimeout(timer); load(); } });
  load();
})();
</script>
</body>
</html>`;

function renderPage(config) {
  const safe = JSON.stringify({
    tileUrl: (config && config.tileUrl) || null,
    attribution: (config && config.attribution) || "",
  }).replace(/</g, "\\u003c");
  return TEMPLATE.replace("__CONFIG__", () => safe);
}

module.exports = { renderPage };
```

Note for the implementer: the template literal contains `\\u00B7` (an escaped `\u00B7` inside a JS template string that becomes the literal `\u00B7` in the page script, which the browser turns into a middle dot). Do not "simplify" the double backslash.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/trackPage.test.js src/controllers/__tests__/trackController.test.js`
Expected: PASS.

- [ ] **Step 5: Syntax-check the page script**

Run:

```bash
cd backend && node -e "const {renderPage}=require('./src/controllers/trackPage');const h=renderPage({tileUrl:null,attribution:''});const m=h.match(/<script>([\s\S]*?)<\/script>/);new Function(m[1]);console.log('page script parses', m[1].length)"
```

Expected: `page script parses <n>`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/trackPage.js backend/src/controllers/__tests__/trackPage.test.js
git commit -m "feat(receiver-tracking): public tracking page with Leaflet map, ETA and timeline

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: WhatsApp messages and phone-change sync

**Files:**
- Create: `backend/src/services/receiverTrackMessage.js`
- Modify: `backend/src/whatsapp/notifications.js`, `backend/src/whatsapp/handlers/customerHandler.js`, `backend/src/services/receiverPayService.js`, `backend/src/controllers/adminOrderController.js`
- Test: `backend/src/services/__tests__/receiverTrackMessage.test.js`, `backend/src/whatsapp/__tests__/receiverTrackNotifications.test.js`; extend `backend/src/services/__tests__/receiverPayChangePhone.test.js` and `backend/src/controllers/__tests__/adminOrderController.receiverPhone.test.js`

**Interfaces:**
- Consumes: Task 1 `isTrackingEnabled`; Task 2 `getOrCreate`, `buildLink`.
- Produces: `receiverTrackMessage.trackLine(order, receiverPhone): Promise<string>` (`"📍 *Live track karein*: <url>\n\n"` or `""`), `receiverTrackMessage.syncReceiverPhone(orderId, rawPhone): Promise<{ rotated: boolean }>` (never throws).

- [ ] **Step 1: Write the failing tests for the message module**

```js
// backend/src/services/__tests__/receiverTrackMessage.test.js
jest.mock("../../config/db", () => ({
  order_track_link: { findUnique: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverTrackSettings", () => ({ isTrackingEnabled: jest.fn() }));
jest.mock("../trackLinkService", () => ({ getOrCreate: jest.fn(), buildLink: jest.fn() }));
jest.mock("../../whatsapp/notifications", () => ({ sendWhatsAppNotification: jest.fn() }));

const prisma = require("../../config/db");
const settings = require("../receiverTrackSettings");
const links = require("../trackLinkService");
const { sendWhatsAppNotification } = require("../../whatsapp/notifications");
const { trackLine, syncReceiverPhone } = require("../receiverTrackMessage");

beforeEach(() => {
  jest.clearAllMocks();
  settings.isTrackingEnabled.mockResolvedValue(true);
  links.getOrCreate.mockResolvedValue({ token: "tok" });
  links.buildLink.mockReturnValue("https://api.example.com/track/tok");
  sendWhatsAppNotification.mockResolvedValue(true);
});

describe("trackLine", () => {
  it("returns the link line when the driver is assigned and tracking is on", async () => {
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("📍 *Live track karein*: https://api.example.com/track/tok\n\n");
    expect(links.getOrCreate).toHaveBeenCalledWith(50, "9876543210");
  });
  it("is empty without a receiver phone or before a driver is assigned", async () => {
    expect(await trackLine({ id: 50, rid: 9 }, "")).toBe("");
    expect(await trackLine({ id: 50, rid: 0 }, "9876543210")).toBe("");
    expect(links.getOrCreate).not.toHaveBeenCalled();
  });
  it("is empty when tracking is off or the link cannot be built", async () => {
    settings.isTrackingEnabled.mockResolvedValue(false);
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("");
    settings.isTrackingEnabled.mockResolvedValue(true);
    links.buildLink.mockReturnValue(null);
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("");
  });
  it("is empty (never throws) when anything fails", async () => {
    links.getOrCreate.mockRejectedValue(new Error("db"));
    expect(await trackLine({ id: 50, rid: 9 }, "9876543210")).toBe("");
  });
});

describe("syncReceiverPhone", () => {
  it("does nothing when the order has no link yet (it is created at assignment with the then-current number)", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue(null);
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: false });
    expect(links.getOrCreate).not.toHaveBeenCalled();
  });
  it("does nothing when the number did not change", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue({ receiver_phone: "9000000000" });
    expect(await syncReceiverPhone(50, "+91 90000 00000")).toEqual({ rotated: false });
    expect(links.getOrCreate).not.toHaveBeenCalled();
  });
  it("rotates the link and sends the new one to the new number while the delivery is in progress", async () => {
    prisma.order_track_link.findUnique.mockResolvedValue({ receiver_phone: "9876543210" });
    prisma.pkg_order.findUnique.mockResolvedValue({ rid: 9, order_status: 3 });
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: true });
    expect(links.getOrCreate).toHaveBeenCalledWith(50, "9000000000");
    expect(sendWhatsAppNotification).toHaveBeenCalledWith("9000000000", expect.stringContaining("https://api.example.com/track/tok"));
  });
  it.each([[0, 0], [9, 5], [9, 4]])("rotates but sends nothing when rid=%p order_status=%p", async (rid, order_status) => {
    prisma.order_track_link.findUnique.mockResolvedValue({ receiver_phone: "9876543210" });
    prisma.pkg_order.findUnique.mockResolvedValue({ rid, order_status });
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: true });
    expect(sendWhatsAppNotification).not.toHaveBeenCalled();
  });
  it("never throws", async () => {
    prisma.order_track_link.findUnique.mockRejectedValue(new Error("db"));
    expect(await syncReceiverPhone(50, "9000000000")).toEqual({ rotated: false });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/receiverTrackMessage.test.js`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement the message module**

```js
// backend/src/services/receiverTrackMessage.js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { normalizeToLast10Digits } = require("../utils/phone");
const settings = require("./receiverTrackSettings");
const trackLinkService = require("./trackLinkService");

// "Track live" line for the receiver's WhatsApp messages. Empty (so the message goes out exactly as
// before) when tracking is off, no driver is assigned yet, PUBLIC_BASE_URL is missing, or anything fails.
async function trackLine(order, receiverPhone) {
  try {
    if (!receiverPhone || !(Number(order && order.rid) > 0)) return "";
    if (!(await settings.isTrackingEnabled())) return "";
    const link = await trackLinkService.getOrCreate(order.id, receiverPhone);
    const url = link ? trackLinkService.buildLink(link.token) : null;
    return url ? `📍 *Live track karein*: ${url}\n\n` : "";
  } catch (err) {
    logger.warn(`receiverTrack.trackLine failed for order ${order && order.id}: ${err && err.message}`);
    return "";
  }
}

// The drop contact of an order changed. If the order already has a link, rotate it to the new number
// (the old number's link then answers "invalid") and, while the delivery is in progress, send the new
// number its link. Never throws: it runs next to an order edit that must not fail because of this.
async function syncReceiverPhone(orderId, rawPhone) {
  try {
    const phone = normalizeToLast10Digits(rawPhone);
    if (phone.length !== 10) return { rotated: false };
    const existing = await prisma.order_track_link.findUnique({ where: { order_id: orderId } });
    if (!existing || existing.receiver_phone === phone) return { rotated: false };
    const link = await trackLinkService.getOrCreate(orderId, phone);
    const order = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { rid: true, order_status: true } });
    const inProgress = order && Number(order.rid) > 0 && [1, 2, 3].includes(Number(order.order_status));
    const url = link ? trackLinkService.buildLink(link.token) : null;
    if (inProgress && url && (await settings.isTrackingEnabled())) {
      // Lazy require: whatsapp/notifications pulls in the WhatsApp client.
      const { sendWhatsAppNotification } = require("../whatsapp/notifications");
      await sendWhatsAppNotification(
        phone,
        `Hello! 👋\nOrder *#${orderId}* ki delivery aapke liye hai. Parcel live track karne ke liye link:\n${url}\n\n— *Team Shifter Online*\n📞 Customer Care: 9109114515`
      );
    }
    return { rotated: true };
  } catch (err) {
    logger.warn(`receiverTrack.syncReceiverPhone failed for order ${orderId}: ${err && err.message}`);
    return { rotated: false };
  }
}

module.exports = { trackLine, syncReceiverPhone };
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/receiverTrackMessage.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing notification tests**

Read `backend/src/whatsapp/__tests__/orderTrackingAndNotification.test.js` first; it spies on the real `prisma` models and uses `notifications.setWhatsAppClient(mockClient)`. Create:

```js
// backend/src/whatsapp/__tests__/receiverTrackNotifications.test.js
jest.mock("../../services/receiverTrackMessage", () => ({ trackLine: jest.fn(), syncReceiverPhone: jest.fn() }));

const notifications = require("../notifications");
const { handleTrackingQuery } = require("../handlers/customerHandler");
const prisma = require("../../config/db");
const { trackLine } = require("../../services/receiverTrackMessage");

const LINE = "📍 *Live track karein*: https://api.example.com/track/tok\n\n";
let sent;
const client = {
  onWhatsApp: jest.fn().mockImplementation((p) => Promise.resolve([{ jid: `${p}@s.whatsapp.net` }])),
  sendMessage: jest.fn().mockImplementation((jid, msg) => { sent.push({ jid, text: msg.text }); return Promise.resolve(true); }),
};
let oid = 7770; // the milestone de-duplication cache is per order id, so every test uses its own order
const order = (o = {}) => ({
  id: oid, uid: 301, rid: 701, order_status: 3, o_status: "On_Route", category: 1,
  pmobile: "9811111111", dmobile: "9822222222", pick_name: "Amit", drop_name: "Rahul",
  paddress: "Vijay Nagar", daddress: "Bhawarkua", total_dcharge: 350, otp: 4321, ...o,
});
const to = (digits) => sent.find((m) => m.jid.includes(digits));

beforeEach(() => {
  oid += 1;
  sent = [];
  notifications.setWhatsAppClient(client);
  trackLine.mockResolvedValue(LINE);
  jest.spyOn(prisma.pkg_order, "findUnique").mockResolvedValue(order());
  jest.spyOn(prisma.tbl_user, "findUnique").mockResolvedValue({ id: 301, name: "Amit", mobile: "9811111111" });
  jest.spyOn(prisma.tbl_rider, "findUnique").mockResolvedValue({ id: 701, first_name: "Suresh", last_name: "Patel", fmobile: "9109114515", vehicle_no: "MP09CD5678" });
  jest.spyOn(prisma.pkg_category, "findUnique").mockResolvedValue({ title: "Tata Ace" });
  jest.spyOn(prisma.pkg_order_stops, "findMany").mockResolvedValue([]);
});
afterEach(() => jest.restoreAllMocks());

describe("receiver tracking link in the receiver's messages only", () => {
  it("driver assigned: the receiver gets a new message with the link, the sender's message is unchanged", async () => {
    await notifications.notifyDriverAssigned(oid);
    expect(sent).toHaveLength(2);
    expect(to("9822222222").text).toContain(LINE.trim());
    expect(to("9822222222").text).toContain("Suresh Patel");
    expect(to("9811111111").text).not.toContain("Live track");
  });
  it("driver assigned: no extra message when there is no link (flag off, no base URL, error)", async () => {
    trackLine.mockResolvedValue("");
    await notifications.notifyDriverAssigned(oid);
    expect(sent).toHaveLength(1);
    expect(to("9811111111")).toBeDefined();
  });
  it("reached pickup, trip started and reached drop: link only for the receiver", async () => {
    for (const fn of ["notifyDriverArrived", "notifyTripStarted", "notifyDriverArrivedDrop"]) {
      sent = [];
      await notifications[fn](oid);
      expect(to("9822222222").text).toContain(LINE.trim());
      expect(to("9811111111").text).not.toContain("Live track");
    }
  });
  it("delivery complete carries no tracking link", async () => {
    await notifications.notifyTripCompleted(oid);
    for (const m of sent) expect(m.text).not.toContain("Live track");
  });
  it("same number for sender and receiver: no link and no duplicate message", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ dmobile: "9811111111" }));
    await notifications.notifyDriverAssigned(oid);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain("Live track");
  });
});

describe("Track <id> reply", () => {
  it("includes the link for the receiver's number only, never for the sender", async () => {
    expect(await handleTrackingQuery(String(oid), "9822222222")).toContain(LINE.trim());
    expect(await handleTrackingQuery(String(oid), "9811111111")).not.toContain("Live track");
  });
  it("adds no link once the order is delivered or cancelled", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue(order({ order_status: 5, o_status: "Completed" }));
    expect(await handleTrackingQuery(String(oid), "9822222222")).not.toContain("Live track");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && npx jest src/whatsapp/__tests__/receiverTrackNotifications.test.js`
Expected: FAIL (no link in any message yet).

- [ ] **Step 7: Wire the link into the notifications and the Track reply**

In `backend/src/whatsapp/notifications.js` add near the top requires: `const { trackLine } = require("../services/receiverTrackMessage");`

1. `notifyDriverArrived`: after the destructuring, add `const trackLineText = receiverPhone && receiverPhone !== senderPhone ? await trackLine(order, receiverPhone) : "";` and, in `receiverMsg`, insert `${trackLineText}` directly before the line `Live status ke liye chat me *Track ${order.id}* likhein.\n\n`. (Template literal pieces are concatenated with `+`; add `trackLineText +` before that string.)
2. `notifyTripStarted`: turn `const msg = ...` into `const buildMsg = (extra) => ...` with `extra +` inserted before the `Live status check karne ke liye ...` piece; then `const senderMsg = buildMsg("");` and `const receiverMsg = buildMsg(receiverPhone && receiverPhone !== senderPhone ? await trackLine(order, receiverPhone) : "");`. Send `senderMsg` to the sender and `receiverMsg` to the receiver (replace the two `msg` usages).
3. `notifyDriverArrivedDrop`: same `buildMsg(extra)` change with `extra +` inserted before the `— *Team Shifter Online*` footer piece. The receiver is sent first in this function; use the receiver variant for the receiver, the plain one for the sender. Compute the extra with the same `receiverPhone !== senderPhone` rule.
4. `notifyDriverAssigned`: replace `const { order, rider, senderPhone } = data; if (!rider || !senderPhone) return false;` with `const { order, rider, senderPhone, receiverPhone, receiverName } = data; if (!rider) return false;`. Wrap the existing sender send in `if (senderPhone && !wasMilestoneSent(order.id, "assigned", senderPhone)) {...}`. After it add:

```js
  const receiverLine = receiverPhone && receiverPhone !== senderPhone ? await trackLine(order, receiverPhone) : "";
  if (receiverLine && !wasMilestoneSent(order.id, "assigned", receiverPhone)) {
    markMilestoneSent(order.id, "assigned", receiverPhone);
    await sendWhatsAppNotification(
      receiverPhone,
      `Hello! 👋\n` +
        `🛵 *Aapke liye driver assign ho gaya hai!*\n\n` +
        `📦 *Order ID*: #${order.id}\n` +
        `*Driver*: ${riderName} ${riderVehicle}\n` +
        `📱 *Phone*: ${riderPhone}\n` +
        `🎯 *Drop*: ${order.daddress || "N/A"}\n` +
        `👤 *Receiver*: ${receiverName}\n\n` +
        `Parcel pickup hone ke baad aap driver ko live map par dekh sakenge.\n` +
        receiverLine +
        `— *Team Shifter Online*\n` +
        `📞 Customer Care: 9109114515`
    );
  }
```

In `backend/src/whatsapp/handlers/customerHandler.js` `handleTrackingQuery`: add `const { trackLine } = require("../../services/receiverTrackMessage");` at the top, and just before `reply += \`\n📞 Customer Care: 9109114515\`;` add:

```js
    const isReceiverParty = senderClean === normalizePhone10(order.dmobile) && senderClean !== normalizePhone10(order.pmobile);
    if (isReceiverParty && Number(order.order_status) < 4) {
      reply += `\n${await trackLine(order, normalizePhone10(order.dmobile))}`.replace(/\n+$/, "\n");
    }
```

(`order_status < 4` keeps the link off Completed(5) and Cancelled(4) orders. `trackLine` returns `""` when unavailable, which leaves the reply unchanged apart from one newline that the replace trims.)

- [ ] **Step 8: Run the whatsapp tests**

Run: `cd backend && npx jest src/whatsapp`
Expected: PASS, including the pre-existing `orderTrackingAndNotification.test.js` (those use the real, unspied `trackLine`, which returns `""` because `isTrackingEnabled` cannot read the unavailable test DB and fails closed, so their messages are unchanged).

- [ ] **Step 9: Keep the link in step with phone changes (tests first)**

Append to `backend/src/services/__tests__/receiverPayChangePhone.test.js` (add `jest.mock("../receiverTrackMessage", () => ({ syncReceiverPhone: jest.fn().mockResolvedValue({ rotated: false }) }));` at the top with the other mocks, and `const trackMsg = require("../receiverTrackMessage");` next to the other requires):

```js
describe("receiverPayService.changeReceiverPhone keeps the tracking link in step", () => {
  it("rotates the tracking link to the new number after saving it", async () => {
    await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "98765 43210" });
    expect(trackMsg.syncReceiverPhone).toHaveBeenCalledWith(50, "9876543210");
  });
  it("does nothing for the tracking link when the number did not change", async () => {
    await svc.changeReceiverPhone({ orderId: 50, uid: 7, phone: "98765 00000" });
    expect(trackMsg.syncReceiverPhone).not.toHaveBeenCalled();
  });
});
```

Append to `backend/src/controllers/__tests__/adminOrderController.receiverPhone.test.js` (add `jest.mock("../../services/receiverTrackMessage", () => ({ syncReceiverPhone: jest.fn().mockResolvedValue({ rotated: false }) }));` with the other mocks and `const trackMsg = require("../../services/receiverTrackMessage");`):

```js
describe("adminOrderController.update - tracking link", () => {
  it("rotates the tracking link even when the order has no receiver-pays row", async () => {
    receiverPayService.changeReceiverPhone.mockRejectedValue(new receiverPayService.ReceiverPayError("NOT_ACTIVE", "nope"));
    await update(req({ dmobile: "98765 43210" }), res());
    expect(trackMsg.syncReceiverPhone).toHaveBeenCalledWith(50, "98765 43210");
  });
  it("is not touched by other edits", async () => {
    await update(req({ paddress: "x" }), res());
    expect(trackMsg.syncReceiverPhone).not.toHaveBeenCalled();
  });
});
```

Run: `cd backend && npx jest src/services/__tests__/receiverPayChangePhone.test.js src/controllers/__tests__/adminOrderController.receiverPhone.test.js`
Expected: FAIL (`syncReceiverPhone` never called).

- [ ] **Step 10: Implement the hooks**

In `receiverPayService.js` add `const receiverTrackMessage = require("./receiverTrackMessage");` with the other requires, and in `changeReceiverPhone`, right after the `await prisma.$transaction([...]);` line (before the `if (!pending) return ...` line), add:

```js
  await receiverTrackMessage.syncReceiverPhone(orderId, normalized);
```

In `adminOrderController.js` add `const receiverTrackMessage = require("../services/receiverTrackMessage");` with the requires, and inside the existing `if (data.dmobile !== undefined) {` block, after the `changeReceiverPhone(...).catch(...)` call, add:

```js
      await receiverTrackMessage.syncReceiverPhone(id, data.dmobile);
```

(`syncReceiverPhone` never throws and is a no-op when the number is unchanged, so running it after `changeReceiverPhone` is safe.)

- [ ] **Step 11: Run the whole backend suite**

Run: `cd backend && npx jest`
Expected: all PASS except the pre-existing `aadharPdfVerify` failures.

- [ ] **Step 12: Commit**

```bash
git add backend/src
git commit -m "feat(receiver-tracking): WhatsApp messages carry the live link; phone changes rotate it

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Admin toggle, docs and QA checklist

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`, `docs/superpowers/specs/2026-10-06-receiver-live-tracking-design.md`
- Create: `docs/superpowers/plans/2026-10-06-receiver-live-tracking-qa.md`
- Modify (memory): `C:\Users\alkvi\.claude\projects\c--Users-alkvi-OneDrive-Desktop-Shifter-Online\memory\` (new `receiver_live_tracking.md` + index line)

**Interfaces:**
- Consumes: settings key `receiver_tracking_enabled` (Task 1).

- [ ] **Step 1: Add the admin switch**

In `frontend/src/pages/Settings.jsx`, add `'receiver_tracking_enabled',` to the flags key list right after `'receiver_pay_link_ttl_hours',`, and add this section directly after the closing `</Section>` of "Receiver Pays" (copy the exact `Section`, `Label` and select styling used there):

```jsx
        <Section title="Receiver Live Tracking">
          <div>
            <Label htmlFor="flag-receiver_tracking_enabled">Live Tracking Link (receiver_tracking_enabled)</Label>
            <select
              id="flag-receiver_tracking_enabled"
              className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
              value={flags.receiver_tracking_enabled ?? '1'}
              onChange={(e) => setFlags((f) => ({ ...f, receiver_tracking_enabled: e.target.value }))}
            >
              <option value="1">Enabled (1 - the drop contact gets a WhatsApp live tracking link)</option>
              <option value="0">Disabled (0 - no links are sent and existing links stop working)</option>
            </select>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Needs <code>PUBLIC_BASE_URL</code> on the server and, for the map, <code>MAPTILER_KEY</code>. Without the key the page still shows status and ETA, just no map.
            </p>
          </div>
        </Section>
```

Run: `cd frontend && npm run build` (the admin `npm run lint` is broken at baseline, so use the build as the check).
Expected: build succeeds.

- [ ] **Step 2: Update the spec for the deviations**

In `docs/superpowers/specs/2026-10-06-receiver-live-tracking-design.md`: replace the timeline row text with the 5 steps and "no per-step times except delivery", replace the `order_track_link` column list and the "Lifecycle" bullet with the derived-expiry rule, replace "decoded server side" with the GeoJSON encoding, and add the "assigned message to the receiver is new" note. Keep it short; the plan header lists exactly what changed.

- [ ] **Step 3: Write the QA checklist** at `docs/superpowers/plans/2026-10-06-receiver-live-tracking-qa.md`

```markdown
# Receiver live tracking - manual QA

Prerequisites: dev backend with migration `20261006010000_add_order_track_link` applied (`npx prisma generate` run), `PUBLIC_BASE_URL`, `MAPTILER_KEY` set (key restricted to the domain), WhatsApp connected, `receiver_tracking_enabled` = 1, a driver account on a phone, a receiver phone with WhatsApp.

| # | Check | Expected |
|---|---|---|
| 1 | Book an order with a drop contact, driver accepts | Receiver gets a "driver assigned" WhatsApp with a Live track link; sender's messages unchanged |
| 2 | Open the link before pickup | Status "Driver is heading to the pickup point", driver card with Call button, timeline step 1, no map, no addresses |
| 3 | Driver reaches pickup, enters OTP | Step 3 "Your parcel is on the way"; map appears with pickup/drop pins, route line, moving driver marker, ETA and km |
| 4 | Watch the marker | Moves smoothly, rotates with heading; ETA refreshes about every minute, not every 5 s |
| 5 | Turn the driver's GPS off for 3 minutes | Marker greys out, "Waiting for the driver's location", ETA disappears; recovers when GPS returns |
| 6 | Driver reaches the drop | Step 4 "Driver has reached your location", no ETA |
| 7 | Complete the delivery | Page shows Delivered with the right IST time, map gone; link still opens for 24 h, then says expired |
| 8 | Cancel an order with a link | Page says the order was cancelled |
| 9 | Admin edits the order's drop contact | Old link says "no longer valid"; new number receives a new link (only while in progress) |
| 10 | Receiver-pays order: change the receiver number from the customer app | Both the pay link and the tracking link move to the new number |
| 11 | Same number for sender and receiver | No tracking link, no duplicate message |
| 12 | `receiver_tracking_enabled` = 0 | No links in new messages; an existing link says expired |
| 13 | Unset `MAPTILER_KEY` | Page works, no map |
| 14 | Block `unpkg`/`cdnjs` on the phone or use airplane mode mid-trip | Status, ETA and driver card still work; "Connection problem - retrying..." shows and clears |
| 15 | Open `/track/garbage` and `/api/track/garbage` | 404, no stack traces |
| 16 | View page source / network | No pickup OTP, booker details or fare anywhere in the API responses |
| 17 | `cd backend && npx jest` | All pass except the pre-existing `aadharPdfVerify` |

## Result log

- Not run on a device yet.
```

- [ ] **Step 4: Save a memory note** `receiver_live_tracking.md` (type project): feature summary, decisions not obvious from the code (plain-text token, polling not sockets, Leaflet + MapTiler, privacy rule "live position only at order_status 3", the deviations list, prod needs migration `20261006010000_add_order_track_link` and `MAPTILER_KEY`), and one index line in `MEMORY.md`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Settings.jsx docs/superpowers
git commit -m "feat(receiver-tracking): admin toggle, spec update and QA checklist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-review (against the spec)

- Spec "What the receiver sees": timeline, driver card, ETA, map, stale state, end states, no-map degradation: Task 5 (page) and Task 4 (data). ✓
- Map provider (Leaflet + MapTiler, config-driven, restricted key): Task 1, Task 5. ✓
- Link and token (one per order, lazy at assignment, repeated, phone-change rotation, 24 h expiry, cancel): Task 2, Task 4 (derived expiry), Task 6. ✓ (deviation 1 explains no stored expiry)
- Privacy rules (status 3 only, no OTP/booker/fare, no-store headers, 80-char addresses): Task 4 tests and controller headers. ✓
- API shape and `poll_ms`: Task 4. ✓
- Backend pieces 1-8: link service (2), snapshot (4), live positions (3), ETA (3), routes/page/controller (4, 5), WhatsApp (6), settings/env (1, 7), migration (1). ✓
- Failure behaviour (flag off, Google/position missing, builder error, WhatsApp down): Task 4 tests, Task 6 `trackLine` never throws. ✓
- Testing section: each task carries its tests; manual QA in Task 7. ✓
- Type consistency: `getOrCreate(orderId, rawPhone)`, `findByToken`, `buildLink`, `touchViewed`, `isTokenShape`, `getEta/getRoute/clearOrder`, `buildSnapshot(link, {now})`, `trackLine(order, phone)`, `syncReceiverPhone(orderId, rawPhone)` are used with identical names and argument orders in every task that consumes them. ✓
- Placeholder scan: none; the notifications edit in Task 6 Step 7 describes exact insertion points with code for the new pieces because those functions are long existing templates.

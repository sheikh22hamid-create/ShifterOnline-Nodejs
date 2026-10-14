# Booking Guarantee Driver-Cancel Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an assigned driver cancels before pickup on a Booking Guarantee order, put the order back in the held state, reopen the same guarantee case with its original deadline, restart auto-search and re-queue the case; per-city switch, default OFF.

**Architecture:** One new service (`guaranteeRecoveryService.js`) owns eligibility, the reopen transaction and the post-commit restart. Two existing cancel paths call it behind a fail-closed pre-check (`tripLifecycle.driverCancel`, `cancelRequestService.approve`); any failure falls through to today's terminal behaviour. `bookingGuaranteeService` gains an extracted `announceOpened`, a dispatch stop after expiry and an idempotent advance refund in `finishExpiry`. The switch lives in the existing city queue settings.

**Tech Stack:** Node/Express, Prisma + MySQL (hand-applied SQL migration), Jest (unit with mocks + real-MySQL suites), React/Vite admin panel.

**Spec:** `docs/superpowers/specs/2026-10-14-guarantee-driver-cancel-recovery-design.md` (read it first). Builds on `docs/superpowers/specs/2026-10-14-guarantee-executive-queue-design.md` and `docs/superpowers/plans/2026-10-14-guarantee-executive-queue.md`.

## Global Constraints

- `deadline_at` and `opened_at` of a case are **never written** by recovery code. Only `status`, `closed_at`, `resolved_by_admin_id` and the queue-period columns are.
- Recovery applies only when ALL hold: city switch on, `guarantee_enabled` on, case `status='resolved_assigned'` with `deadline_at > now`, order `order_status` in (0,1,2), rider is the assigned `rid`.
- Any recovery failure falls back to today's terminal path unchanged. With the switch OFF the new code is never entered beyond one fail-closed settings read.
- Customer cancel, admin cancel, `cancelOverduePickup`, `cancelExpiredAdvancePayment` and status-3 cancels are NOT touched.
- Compensation, idempotency keys (`booking_guarantee_credit:<order>`, `driver_cancel_fee:*`, `driver_cancel_comp:*`, `advance_apply:*`), referral lock and wallet code are untouched. Recovery does not refund or reset the advance (matches `cancelRequestService.approve`).
- A migration is applied by hand per database then `prisma migrate resolve --applied`. Never `migrate deploy` or `migrate reset`. Never run anything against dev or prod databases from tests; real-MySQL tests run only against a database whose name ends in `_test`.
- **A skipped test does not pass the gate.** Every real-MySQL suite must run (0 skipped) before the work is called done.
- Never use `2>NUL` in bash (creates a stray file). Do not print DB credentials.
- No production changes, no pilot enabling, no deploy without the owner's explicit approval.

## Review Focus

- Driver cancels twice (socket retry / double tap): second call must be a no-op (idempotent), never a second fee or a second reopen. (Task 2 concurrency test, Task 4 unit test.)
- Cancel arrives after the original deadline: must be the old terminal cancel, no reopen, no compensation. (Task 2.)
- A recovered order whose deadline later passes with no driver: compensation exactly once, the prepaid fare, referral points and wallet advance refunded once, order cancelled, running auto-search stopped. (Task 3 and Task 6.)
- The cancelling driver must not be offered the order again. (Task 4: request row `"10"`.)
- Recovery step fails midway (DB error, hook throws): order and case must be exactly as before, then the terminal cancel runs. (Task 2 rollback test, Task 4 fallthrough test.)
- Switch OFF, guarantee OFF or settings unreadable: behaviour identical to today. (Task 2, Task 4.)

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/prisma/migrations/20261014020000_add_guarantee_recover_on_cancel/migration.sql` (new) | One additive column. |
| `backend/prisma/schema.prisma` (modify) | `city_order_settings.guarantee_recover_on_cancel`. |
| `backend/src/services/guaranteeQueueRules.js`, `guaranteeQueueSettings.js` (modify) | Setting parse/validate/save. |
| `backend/src/controllers/guaranteeQueueController.js` (modify) | API field `guarantee_recover_on_cancel`. |
| `backend/src/services/guaranteeRecoveryService.js` (new) | Eligibility, reopen transaction, post-commit restart, deadline clamp. |
| `backend/src/services/bookingGuaranteeService.js` (modify) | Extract `announceOpened`; stop dispatch after expiry; refund wallet advance in `finishExpiry`. |
| `backend/src/services/tripLifecycle.js` (modify) | Extract `applyDriverCancelFee`; recovery pre-step in `driverCancel`. |
| `backend/src/services/cancelRequestService.js` (modify) | Reopen the case in `approve`. |
| `backend/src/sockets/orderSocket.js`, `controllers/orderController.js` (modify) | Driver-facing message for a recovered cancel. |
| `frontend/src/utils/guaranteeQueueForms.js`, `frontend/src/pages/GuaranteeWorkload.jsx` (modify) | The city toggle. |
| Tests | see each task |

Test commands (cwd `backend`):
- Unit: `npx jest <path>`
- Real MySQL: `powershell -NoProfile -File "C:\Users\alkvi\AppData\Local\Temp\claude\c--Users-alkvi-OneDrive-Desktop-Shifter-Online\af970e8b-b096-486c-83dc-02db1015e302\scratchpad\run-on-testdb.ps1" -- npx jest <path>` (the script prints the sanitized target and refuses anything not `_test` / not `127.0.0.1:3399`).

---

### Task 0: Branch and test database

**Files:** none (environment).

- [ ] **Step 1: Create the branch from main**

```bash
git checkout main && git pull --ff-only origin main && git checkout -b feature/guarantee-driver-cancel-recovery
```
Expected: branch created at the current `main` commit. Do not touch the three unrelated working-tree changes (`build.gradle`, `pubspec.yaml`, backup `.zip`).

- [ ] **Step 2: Start the throwaway MySQL (it is currently stopped)**

The datadir already exists at `<scratchpad>\mysql-test-data` (root, no password). Start it detached, bound to localhost only:

```powershell
$sp = "C:\Users\alkvi\AppData\Local\Temp\claude\c--Users-alkvi-OneDrive-Desktop-Shifter-Online\af970e8b-b096-486c-83dc-02db1015e302\scratchpad"
Start-Process -WindowStyle Hidden -FilePath "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" -ArgumentList "--no-defaults","--datadir=$sp\mysql-test-data","--port=3399","--bind-address=127.0.0.1","--mysqlx=OFF","--console"
```
Verify: `& "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -h127.0.0.1 -P3399 -uroot -e "SELECT VERSION(); SHOW DATABASES LIKE 'shifter_guarantee_test';"` shows 8.0.x and the `_test` database. If the datadir is missing or corrupt, STOP and tell the owner; do not point tests at any other database.

- [ ] **Step 3: Baseline the real-MySQL suites**

Run (cwd `backend`): the run-on-testdb.ps1 command with `npx jest src/services/__tests__/guaranteeQueueEngine.mysql.test.js`.
Expected: PASS, 0 skipped. This proves the harness works before any change.

---

### Task 1: City switch (migration, schema, settings, API, admin form)

**Files:**
- Create: `backend/prisma/migrations/20261014020000_add_guarantee_recover_on_cancel/migration.sql`
- Modify: `backend/prisma/schema.prisma` (model `city_order_settings`)
- Modify: `backend/src/services/guaranteeQueueRules.js`, `backend/src/services/guaranteeQueueSettings.js`, `backend/src/controllers/guaranteeQueueController.js`
- Modify: `frontend/src/utils/guaranteeQueueForms.js`, `frontend/src/pages/GuaranteeWorkload.jsx`
- Test: `backend/src/services/__tests__/guaranteeQueueRules.test.js`, `guaranteeQueueSettings.test.js`, `backend/src/controllers/__tests__/guaranteeQueueController.test.js`

**Interfaces:**
- Produces: queue settings object gains `recoverOnDriverCancel: boolean` (default `false`); API field `guarantee_recover_on_cancel`; column `city_order_settings.guarantee_recover_on_cancel TINYINT(1) NOT NULL DEFAULT 0`.

- [ ] **Step 1: Write the failing rules tests**

Append to `guaranteeQueueRules.test.js` (inside the existing file, new describe):

```js
describe("recoverOnDriverCancel setting", () => {
  it("defaults to OFF and reads the column", () => {
    expect(rules.DEFAULTS.recoverOnDriverCancel).toBe(false);
    expect(rules.normalizeQueueRow(null).recoverOnDriverCancel).toBe(false);
    expect(rules.normalizeQueueRow({ guarantee_recover_on_cancel: 1 }).recoverOnDriverCancel).toBe(true);
    expect(rules.normalizeQueueRow({ guarantee_recover_on_cancel: 0 }).recoverOnDriverCancel).toBe(false);
  });
  it("validates input as a boolean and returns it only when sent", () => {
    expect(rules.validateQueueInput({ recoverOnDriverCancel: true })).toEqual({ recoverOnDriverCancel: true });
    expect(rules.validateQueueInput({ recoverOnDriverCancel: "false" })).toEqual({ recoverOnDriverCancel: false });
    expect(rules.validateQueueInput({})).toEqual({});
  });
});
```
(Use whatever the file already names the module import; it is `rules` in neighbouring tests — check the top of the file and match it.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/services/__tests__/guaranteeQueueRules.test.js`
Expected: FAIL (`recoverOnDriverCancel` undefined).

- [ ] **Step 3: Implement rules, settings and migration**

In `guaranteeQueueRules.js`:
- `DEFAULTS`: add `recoverOnDriverCancel: false,` after `execQueueEnabled`.
- `normalizeQueueRow` return object: add `recoverOnDriverCancel: Boolean(row.guarantee_recover_on_cancel),`.
- `validateQueueInput`: after the `execQueueEnabled` line add
  `if (input.recoverOnDriverCancel !== undefined) out.recoverOnDriverCancel = toBool(input.recoverOnDriverCancel);`

In `guaranteeQueueSettings.js` `COLUMN`: add `recoverOnDriverCancel: "guarantee_recover_on_cancel",`.

Migration file:

```sql
-- Booking Guarantee: recover an order when its assigned driver cancels before pickup (spec 2026-10-14).
-- Per-city switch, OFF by default. Apply by hand on EVERY database BEFORE deploying the backend, then
-- `prisma migrate resolve --applied 20261014020000_add_guarantee_recover_on_cancel`.
ALTER TABLE `city_order_settings`
  ADD COLUMN `guarantee_recover_on_cancel` TINYINT(1) NOT NULL DEFAULT 0;
```

In `schema.prisma` model `city_order_settings`, add next to `exec_queue_enabled`:
`guarantee_recover_on_cancel Boolean @default(false)`.

Then `npx prisma generate` (cwd `backend`) and apply to the TEST database only:
`powershell -File <scratchpad>\run-on-testdb.ps1 -- npx prisma db push --skip-generate` (script prints the target first; confirm it says `shifter_guarantee_test`).

- [ ] **Step 4: Controller + tests**

In `guaranteeQueueController.js`:
- `settingsToApi`: add `guarantee_recover_on_cancel: s.recoverOnDriverCancel,`
- `saveSettings` input object: add `recoverOnDriverCancel: b.guarantee_recover_on_cancel,`

Update `guaranteeQueueController.test.js` test "saveSettings maps snake_case input...": the mocked save result gains `recoverOnDriverCancel: true`, the request body gains `guarantee_recover_on_cancel: true`, the expected `input` gains `recoverOnDriverCancel: true`, and the response assertion gains `guarantee_recover_on_cancel: true`. Add to `guaranteeQueueSettings.test.js` inside the `saveQueueSettings` describe:

```js
  it("persists the recovery switch as guarantee_recover_on_cancel", async () => {
    prisma.tbl_city.findUnique.mockResolvedValue({ id: 3 });
    prisma.city_order_settings.findUnique.mockResolvedValue({ exec_queue_enabled: 0, exec_default_capacity: 5, reminder_pct: 50, escalate_pct: 75 });
    prisma.city_order_settings.upsert.mockResolvedValue({});
    await settings.saveQueueSettings({ cityId: 3, input: { recoverOnDriverCancel: true }, adminId: 12 });
    const arg = prisma.city_order_settings.upsert.mock.calls[0][0];
    expect(arg.update).toMatchObject({ guarantee_recover_on_cancel: true, updated_by: 12 });
    expect(arg.update).not.toHaveProperty("exec_queue_enabled");
  });
```

- [ ] **Step 5: Frontend toggle**

`guaranteeQueueForms.js`: in `buildSettingsBody` body object add `guarantee_recover_on_cancel: Boolean(s.guarantee_recover_on_cancel),`. (`validateSettings` needs no change: it is a checkbox.)

`GuaranteeWorkload.jsx`: in `settingsToForm` add `guarantee_recover_on_cancel: Boolean(d?.guarantee_recover_on_cancel),`; directly under the existing "Executive queue active" `<label>` add:

```jsx
            <label className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--ink)' }}>
              <input type="checkbox" disabled={busy} checked={form.guarantee_recover_on_cancel} onChange={setField('guarantee_recover_on_cancel')} />
              Recover orders when an assigned driver cancels before pickup (OFF keeps today's behaviour: the cancel is final)
            </label>
```
`setField` is the existing helper that handles checkboxes for `exec_queue_enabled`; confirm it reads `e.target.checked` for `type="checkbox"` and, if it special-cases the key name, extend it to this key.

- [ ] **Step 6: Run tests and build**

Run: `npx jest src/services/__tests__/guaranteeQueueRules.test.js src/services/__tests__/guaranteeQueueSettings.test.js src/controllers/__tests__/guaranteeQueueController.test.js` → all PASS.
Run (cwd `frontend`): `npm run build` → success.

- [ ] **Step 7: Commit**

```bash
git add backend/prisma backend/src/services/guaranteeQueueRules.js backend/src/services/guaranteeQueueSettings.js backend/src/controllers/guaranteeQueueController.js backend/src/services/__tests__/guaranteeQueueRules.test.js backend/src/services/__tests__/guaranteeQueueSettings.test.js backend/src/controllers/__tests__/guaranteeQueueController.test.js frontend/src/utils/guaranteeQueueForms.js frontend/src/pages/GuaranteeWorkload.jsx docs/superpowers/specs/2026-10-14-guarantee-driver-cancel-recovery-design.md docs/superpowers/plans/2026-10-14-guarantee-driver-cancel-recovery.md
git commit -m "feat(booking-guarantee): city switch for driver-cancel recovery (default OFF)"
```

---

### Task 2: Recovery service (eligibility, reopen transaction, post-commit)

**Files:**
- Create: `backend/src/services/guaranteeRecoveryService.js`
- Modify: `backend/src/services/__tests__/helpers/mysqlTestDb.js`
- Test: `backend/src/services/__tests__/guaranteeRecoveryService.test.js` (unit), `backend/src/services/__tests__/guaranteeRecovery.mysql.test.js` (real MySQL)

**Interfaces:**
- Consumes: `guaranteeQueueSettings.getQueueSettings(cityId)` (`recoverOnDriverCancel`), `orderSearchSettings.getCitySettings(cityId)` (`guaranteeEnabled`, `driverSearchSeconds`), `guaranteeQueueService.endActiveAssignment(caseId, endReason, client)`, `orderSearchRules.isSystem2Order/searchDeadline`, `bookingGuaranteeService.announceOpened(row, cityId)` (Task 3).
- Produces:
  - `recoveryCityFor(orderId) -> Promise<number|null>` (never throws).
  - `reopenAfterDriverCancel({ orderId, riderId, cityId, inTx }) -> Promise<{ reopened: true, caseRow, order } | { reopened: false, reason }>`; `inTx(tx, orderRow)` runs inside the transaction after the order is reset; if it throws everything rolls back.
  - `reopenAfterApprovedCancel({ orderId, riderId, cityId }) -> Promise<{ reopened: true, caseRow } | { reopened: false, reason }>` (case only; the order was already un-assigned by the caller).
  - `afterReopen({ orderId, caseRow, cityId }) -> Promise<void>` (never throws): System 2 deadline clamp, customer event, `startDispatch`, `announceOpened`.
  - `clampSearchDeadline(deadline: Date, caseDeadline: Date|string) -> Date`.

- [ ] **Step 1: Extend the test helper**

Append to `helpers/mysqlTestDb.js` (before `module.exports`, and add the new names to the export list):

```js
// Inserts a row into any table, filling every NOT NULL column that has no default with a type-appropriate dummy,
// so the helper keeps working when the schema gains required columns. `overrides` win.
async function insertRow(prisma, table, overrides = {}) {
  const cols = await prisma.$queryRawUnsafe(
    "SELECT column_name AS name, data_type AS type, column_type AS ctype FROM information_schema.columns " +
    "WHERE table_schema = DATABASE() AND table_name = ? AND is_nullable = 'NO' AND column_default IS NULL AND extra NOT LIKE '%auto_increment%'",
    table
  );
  const values = {};
  for (const { name, type, ctype } of cols) {
    if (["int", "bigint", "smallint", "tinyint", "mediumint", "decimal", "float", "double"].includes(type)) values[name] = 0;
    else if (["datetime", "timestamp", "date"].includes(type)) values[name] = new Date();
    else if (type === "enum") values[name] = (/'([^']*)'/.exec(ctype) || [])[1];
    else values[name] = "x";
  }
  Object.assign(values, overrides);
  const names = Object.keys(values);
  await prisma.$executeRawUnsafe(
    `INSERT INTO \`${table}\` (${names.map((n) => `\`${n}\``).join(",")}) VALUES (${names.map(() => "?").join(",")})`,
    ...names.map((n) => values[n])
  );
  const [{ id }] = await prisma.$queryRawUnsafe("SELECT LAST_INSERT_ID() AS id");
  return Number(id);
}

const makeOrder = (prisma, o = {}) =>
  insertRow(prisma, "pkg_order", { uid: 1, rid: 11, order_status: 1, o_status: "Processing", city_id: 3, ...o });
const makeUser = (prisma, o = {}) => insertRow(prisma, "tbl_user", { wallet: 0, ...o });

/** A guarantee case already closed by an assignment (what driver accept / admin assign leaves behind). */
const makeAssignedCase = (prisma, orderId, cityId, o = {}) =>
  prisma.booking_guarantee_case.create({
    data: {
      order_id: orderId, uid: 1, status: "resolved_assigned", selected_package_ids: "[1]", compensation_amount: 100,
      opened_at: new Date(Date.now() - 5 * 60 * 1000), deadline_at: new Date(Date.now() + 10 * 60 * 1000), closed_at: new Date(),
      city_id: cityId, queue_state: "assigned", owner_admin_id: 777, owner_assigned_at: new Date(), reminded_at: new Date(), ...o,
    },
  });

const resetOrders = async (prisma) => {
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of ["pkg_order", "tbl_user", "tbl_wallet_history", "tbl_order_requests", "order_status_history", "driver_trip_progress"]) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE \`${t}\``);
  }
  await prisma.$executeRawUnsafe("SET FOREIGN_KEY_CHECKS = 1");
};
```
Export: `insertRow, makeOrder, makeUser, makeAssignedCase, resetOrders`.

- [ ] **Step 2: Write the failing unit tests**

Create `guaranteeRecoveryService.test.js`:

```js
jest.mock("../../config/db", () => ({ pkg_order: { findUnique: jest.fn(), update: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock("../guaranteeQueueSettings", () => ({ getQueueSettings: jest.fn() }));
jest.mock("../orderSearchSettings", () => ({ getCitySettings: jest.fn() }));
jest.mock("../guaranteeQueueService", () => ({ endActiveAssignment: jest.fn() }));
jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../bookingGuaranteeService", () => ({ announceOpened: jest.fn().mockResolvedValue(undefined) }));

const prisma = require("../../config/db");
const queueSettings = require("../guaranteeQueueSettings");
const orderSearchSettings = require("../orderSearchSettings");
const dispatchManager = require("../dispatchManager");
const bookingGuarantee = require("../bookingGuaranteeService");
const svc = require("../guaranteeRecoveryService");

beforeEach(() => {
  jest.clearAllMocks();
  prisma.pkg_order.findUnique.mockResolvedValue({ city_id: 3 });
  queueSettings.getQueueSettings.mockResolvedValue({ recoverOnDriverCancel: true });
  orderSearchSettings.getCitySettings.mockResolvedValue({ guaranteeEnabled: true, driverSearchSeconds: 60 });
});

describe("recoveryCityFor", () => {
  it("returns the city only when the order has one, the switch is on and the guarantee is on", async () => {
    expect(await svc.recoveryCityFor(50)).toBe(3);
  });
  it.each([
    ["no city on the order", () => prisma.pkg_order.findUnique.mockResolvedValue({ city_id: null })],
    ["order not found", () => prisma.pkg_order.findUnique.mockResolvedValue(null)],
    ["switch OFF", () => queueSettings.getQueueSettings.mockResolvedValue({ recoverOnDriverCancel: false })],
    ["guarantee OFF", () => orderSearchSettings.getCitySettings.mockResolvedValue({ guaranteeEnabled: false })],
    ["order read fails", () => prisma.pkg_order.findUnique.mockRejectedValue(new Error("db down"))],
    ["settings read fails", () => queueSettings.getQueueSettings.mockRejectedValue(new Error("db down"))],
  ])("returns null (fail closed) for %s", async (_label, arrange) => {
    arrange();
    expect(await svc.recoveryCityFor(50)).toBeNull();
  });
});

describe("clampSearchDeadline", () => {
  it("never lets a search outlive the case", () => {
    const caseDeadline = new Date("2026-10-14T10:00:00Z");
    expect(svc.clampSearchDeadline(new Date("2026-10-14T10:05:00Z"), caseDeadline).getTime()).toBe(caseDeadline.getTime());
    const earlier = new Date("2026-10-14T09:59:00Z");
    expect(svc.clampSearchDeadline(earlier, caseDeadline).getTime()).toBe(earlier.getTime());
    expect(svc.clampSearchDeadline(earlier, "2026-10-14T10:00:00Z").getTime()).toBe(earlier.getTime());
  });
});

describe("afterReopen", () => {
  const caseRow = { id: 1, order_id: 50, uid: 7, deadline_at: new Date(Date.now() + 5 * 60 * 1000) };
  it("tells the customer, restarts auto-search and announces the reopened case", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, city_id: 3, search_system: 1 });
    await svc.afterReopen({ orderId: 50, caseRow, cityId: 3 });
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:driver_unassigned", { order_id: "50" });
    expect(dispatchManager.startDispatch).toHaveBeenCalledWith(expect.objectContaining({ id: 50 }), null);
    expect(bookingGuarantee.announceOpened).toHaveBeenCalledWith(caseRow, 3);
    expect(prisma.pkg_order.update).not.toHaveBeenCalled(); // System 1 has no search deadline
  });
  it("System 2: the new search deadline is clamped to the case deadline", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, city_id: 3, search_system: 2 });
    orderSearchSettings.getCitySettings.mockResolvedValue({ guaranteeEnabled: true, driverSearchSeconds: 3600 });
    await svc.afterReopen({ orderId: 50, caseRow, cityId: 3 });
    const written = prisma.pkg_order.update.mock.calls[0][0].data.search_deadline_at;
    expect(written.getTime()).toBe(new Date(caseRow.deadline_at).getTime());
  });
  it("never throws, even if dispatch or the announcement fail", async () => {
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, city_id: 3, search_system: 1 });
    dispatchManager.startDispatch.mockRejectedValue(new Error("boom"));
    bookingGuarantee.announceOpened.mockRejectedValue(new Error("boom"));
    await expect(svc.afterReopen({ orderId: 50, caseRow, cityId: 3 })).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx jest src/services/__tests__/guaranteeRecoveryService.test.js` → FAIL (module not found).

- [ ] **Step 4: Implement the service**

Create `guaranteeRecoveryService.js`:

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const queueSettings = require("./guaranteeQueueSettings");
const orderSearchSettings = require("./orderSearchSettings");
const orderSearchRules = require("./orderSearchRules");
const guaranteeQueue = require("./guaranteeQueueService");

// Booking Guarantee driver-cancel recovery (spec 2026-10-14). dispatchManager and bookingGuaranteeService both
// require modules that reach back here, so they are required lazily (same reason bookingGuaranteeService does).
const dispatchManager = () => require("./dispatchManager");
const bookingGuarantee = () => require("./bookingGuaranteeService");

// An assigned order that has not been picked up yet: Pending (0), Processing (1), Pickup (2).
const PRE_PICKUP_STATUS = new Set([0, 1, 2]);
const PRE_PICKUP_O_STATUS = new Set(["pending", "processing", "pickup"]);

class NotReopenable extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

/**
 * The order's city when recovery may be attempted, else null. Fail closed: a missing city, a switch that is off,
 * the guarantee being off or ANY read error means "do not recover", so the caller takes today's terminal path.
 * Read BEFORE any transaction (settings use the global client).
 */
async function recoveryCityFor(orderId) {
  try {
    const order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) }, select: { city_id: true } });
    const cityId = Number(order?.city_id);
    if (!Number.isInteger(cityId) || cityId <= 0) return null;
    const queue = await queueSettings.getQueueSettings(cityId);
    if (!queue.recoverOnDriverCancel) return null;
    const city = await orderSearchSettings.getCitySettings(cityId);
    return city.guaranteeEnabled ? cityId : null;
  } catch (err) {
    logger.warn(`guaranteeRecovery.recoveryCityFor: order ${orderId} not eligible (${err.message})`);
    return null;
  }
}

const clampSearchDeadline = (deadline, caseDeadline) =>
  new Date(Math.min(new Date(deadline).getTime(), new Date(caseDeadline).getTime()));

/**
 * Reopens the case inside the caller's transaction (compare-and-swap on status and deadline). deadline_at and
 * opened_at are never written. Throws NotReopenable (rolling the transaction back) when the case cannot reopen.
 */
async function reopenCase(tx, { orderId, cityId, source, riderId }) {
  const swapped = await tx.booking_guarantee_case.updateMany({
    where: { order_id: orderId, status: "resolved_assigned", deadline_at: { gt: new Date() } },
    data: {
      status: "open", closed_at: null, resolved_by_admin_id: null,
      owner_admin_id: null, owner_assigned_at: null, queue_state: null, unassigned_reason: null,
      first_action_at: null, last_action_at: null, reminded_at: null, escalated_at: null, last_alerted_at: null,
    },
  });
  if (swapped.count !== 1) throw new NotReopenable("case_not_reopenable");
  const caseRow = await tx.booking_guarantee_case.findUnique({ where: { order_id: orderId } });
  if (!caseRow || Number(caseRow.city_id) !== Number(cityId)) throw new NotReopenable("city_mismatch");
  // The ownership period normally ended when the case closed; end a leftover one so the queue can assign again.
  await guaranteeQueue.endActiveAssignment(caseRow.id, "resolved", tx);
  await tx.booking_guarantee_audit.create({
    data: {
      case_id: caseRow.id, order_id: orderId, event: "reopened_after_driver_cancel", admin_id: null,
      meta: JSON.stringify({
        rider_id: riderId, source,
        remaining_seconds: Math.max(0, Math.round((new Date(caseRow.deadline_at).getTime() - Date.now()) / 1000)),
      }),
    },
  });
  return caseRow;
}

/**
 * The driver cancelled an assigned order: ONE transaction that locks the order, reopens the case, returns the order
 * to the held state (rid 0, Pending) and runs `inTx(tx, order)` for the caller's driver-side effects. Any failure
 * (ineligible, a thrown error, a lost race) rolls everything back and returns { reopened: false }; it never throws.
 */
async function reopenAfterDriverCancel({ orderId, riderId, cityId, inTx = null }) {
  orderId = Number(orderId);
  riderId = Number(riderId);
  try {
    return await prisma.$transaction(async (tx) => {
      const order = (await tx.$queryRaw`
        SELECT id, uid, rid, order_status, o_status, delivery_type FROM pkg_order WHERE id = ${orderId} FOR UPDATE`)[0];
      if (!order || Number(order.rid) !== riderId) throw new NotReopenable("not_assigned_driver");
      if (!PRE_PICKUP_STATUS.has(Number(order.order_status))
        || !PRE_PICKUP_O_STATUS.has(String(order.o_status || "").trim().toLowerCase())) {
        throw new NotReopenable("not_before_pickup");
      }
      const caseRow = await reopenCase(tx, { orderId, cityId, source: "driver_cancel", riderId });
      const moved = await tx.$executeRaw`
        UPDATE pkg_order SET rid = 0, order_status = 0, o_status = 'Pending', accept_time = NULL
        WHERE id = ${orderId} AND rid = ${riderId} AND o_status NOT IN ('Completed', 'Cancelled')`;
      if (moved !== 1) throw new NotReopenable("order_changed");
      if (inTx) await inTx(tx, order);
      return { reopened: true, caseRow, order };
    });
  } catch (err) {
    if (!(err instanceof NotReopenable)) logger.error(`guaranteeRecovery: order ${orderId} not recovered, taking the normal cancel path:`, err);
    return { reopened: false, reason: err instanceof NotReopenable ? err.reason : "error" };
  }
}

/** Case-only variant for cancelRequestService.approve, which already un-assigned the order itself. Never throws. */
async function reopenAfterApprovedCancel({ orderId, riderId, cityId }) {
  orderId = Number(orderId);
  try {
    return await prisma.$transaction(async (tx) => {
      const caseRow = await reopenCase(tx, { orderId, cityId, source: "admin_approved_cancel", riderId: Number(riderId) });
      return { reopened: true, caseRow };
    });
  } catch (err) {
    if (!(err instanceof NotReopenable)) logger.error(`guaranteeRecovery: order ${orderId} case not reopened after approved cancel:`, err);
    return { reopened: false, reason: err instanceof NotReopenable ? err.reason : "error" };
  }
}

/**
 * After the reopen commits: shorten a System 2 search to the case deadline, tell the customer, restart auto-search
 * (the cancelling driver is excluded via their "10" request row) and announce the case to admins / the executive
 * queue. Every step is best-effort and logged; the reopen already stands.
 */
async function afterReopen({ orderId, caseRow, cityId }) {
  let order = null;
  try {
    order = await prisma.pkg_order.findUnique({ where: { id: Number(orderId) } });
  } catch (err) {
    logger.error(`guaranteeRecovery.afterReopen: order ${orderId} unreadable:`, err);
  }
  if (order) {
    if (orderSearchRules.isSystem2Order(order)) {
      try {
        const city = await orderSearchSettings.getCitySettings(cityId);
        const deadline = clampSearchDeadline(orderSearchRules.searchDeadline(new Date(), city.driverSearchSeconds), caseRow.deadline_at);
        await prisma.pkg_order.update({ where: { id: Number(orderId) }, data: { search_deadline_at: deadline } });
        order = { ...order, search_deadline_at: deadline };
      } catch (err) {
        logger.error(`guaranteeRecovery.afterReopen: search window for order ${orderId} not set:`, err);
      }
    }
    try {
      dispatchManager().emitCustomerEvent(order.uid, "order:driver_unassigned", { order_id: String(orderId) });
    } catch (err) {
      logger.error(`guaranteeRecovery.afterReopen: customer event for order ${orderId} failed:`, err);
    }
    try {
      await dispatchManager().startDispatch(order, null);
    } catch (err) {
      logger.error(`guaranteeRecovery.afterReopen: auto-search for order ${orderId} not restarted:`, err);
    }
  }
  try {
    await bookingGuarantee().announceOpened(caseRow, cityId);
  } catch (err) {
    logger.error(`guaranteeRecovery.afterReopen: announce for order ${orderId} failed:`, err);
  }
}

module.exports = {
  recoveryCityFor, reopenAfterDriverCancel, reopenAfterApprovedCancel, afterReopen, clampSearchDeadline,
};
```

- [ ] **Step 5: Run unit tests**

Run: `npx jest src/services/__tests__/guaranteeRecoveryService.test.js` → all PASS.

- [ ] **Step 6: Write the real-MySQL tests**

Create `guaranteeRecovery.mysql.test.js`:

```js
const { enabled, describeMysql, resetDb, resetOrders, makeOrder, makeAssignedCase, events } = require("./helpers/mysqlTestDb");

jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined), stopDispatch: jest.fn() }));
jest.mock("../bookingGuaranteeService", () => ({ announceOpened: jest.fn().mockResolvedValue(undefined) }));

const prisma = enabled ? require("../../config/db") : null;
const svc = enabled ? require("../guaranteeRecoveryService") : null;
const CITY = 3;

describeMysql("guaranteeRecoveryService (real MySQL)", () => {
  beforeEach(async () => { await resetDb(prisma); await resetOrders(prisma); });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  const orderRow = (id) => prisma.$queryRawUnsafe("SELECT id, rid, order_status, o_status FROM pkg_order WHERE id = ?", id).then((r) => r[0]);
  const caseOf = (orderId) => prisma.booking_guarantee_case.findUnique({ where: { order_id: orderId } });

  it("reopens the SAME case with the ORIGINAL deadline and returns the order to the held state", async () => {
    const orderId = await makeOrder(prisma);
    const before = await makeAssignedCase(prisma, orderId, CITY);
    const hook = jest.fn();
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY, inTx: hook });
    expect(out.reopened).toBe(true);
    expect(hook).toHaveBeenCalledTimes(1);
    const after = await caseOf(orderId);
    expect(after).toMatchObject({ id: before.id, status: "open", closed_at: null, owner_admin_id: null, queue_state: null, reminded_at: null, resolved_by_admin_id: null });
    expect(after.deadline_at.getTime()).toBe(before.deadline_at.getTime());
    expect(after.opened_at.getTime()).toBe(before.opened_at.getTime());
    expect(await orderRow(orderId)).toMatchObject({ rid: 0, order_status: 0, o_status: "Pending" });
    expect(await events(prisma, before.id)).toContain("reopened_after_driver_cancel");
  });

  it("is a no-op when the original deadline has already passed (terminal cancel stays)", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY, { deadline_at: new Date(Date.now() - 1000) });
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    expect(out).toMatchObject({ reopened: false, reason: "case_not_reopenable" });
    expect(await orderRow(orderId)).toMatchObject({ rid: 11, order_status: 1, o_status: "Processing" });
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
  });

  it.each([
    ["on route (status 3)", { order_status: 3, o_status: "On Route" }],
    ["another rider's order", { rid: 12 }],
  ])("does nothing for %s", async (_label, orderOverrides) => {
    const orderId = await makeOrder(prisma, orderOverrides);
    await makeAssignedCase(prisma, orderId, CITY);
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    expect(out.reopened).toBe(false);
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
    expect((await orderRow(orderId)).order_status).toBe(orderOverrides.order_status ?? 1);
  });

  it.each([["open"], ["cancelled"], ["expired_compensated"]])("does nothing when the case is already %s", async (status) => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY, { status });
    expect((await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY })).reopened).toBe(false);
    expect((await caseOf(orderId)).status).toBe(status);
    expect(await orderRow(orderId)).toMatchObject({ rid: 11, o_status: "Processing" });
  });

  it("does nothing when the case belongs to another city", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, 9);
    expect(await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY })).toMatchObject({ reopened: false, reason: "city_mismatch" });
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
  });

  it("rolls EVERYTHING back when the caller's hook throws", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY);
    const out = await svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY, inTx: async () => { throw new Error("fee failed"); } });
    expect(out).toMatchObject({ reopened: false, reason: "error" });
    expect((await caseOf(orderId)).status).toBe("resolved_assigned");
    expect(await orderRow(orderId)).toMatchObject({ rid: 11, order_status: 1, o_status: "Processing" });
  });

  it("two concurrent cancels reopen exactly once (the second sees an unassigned order)", async () => {
    const orderId = await makeOrder(prisma);
    await makeAssignedCase(prisma, orderId, CITY);
    const results = await Promise.all([
      svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY }),
      svc.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY }),
    ]);
    expect(results.filter((r) => r.reopened)).toHaveLength(1);
    const auditCount = (await events(prisma, (await caseOf(orderId)).id)).filter((e) => e === "reopened_after_driver_cancel").length;
    expect(auditCount).toBe(1);
  });

  it("case-only reopen (approved cancel) keeps the original deadline and ignores a passed one", async () => {
    const orderId = await makeOrder(prisma, { rid: 0, order_status: 0, o_status: "Pending" });
    const before = await makeAssignedCase(prisma, orderId, CITY);
    const out = await svc.reopenAfterApprovedCancel({ orderId, riderId: 11, cityId: CITY });
    expect(out.reopened).toBe(true);
    expect((await caseOf(orderId)).deadline_at.getTime()).toBe(before.deadline_at.getTime());

    const lateOrder = await makeOrder(prisma, { rid: 0, order_status: 0, o_status: "Pending" });
    await makeAssignedCase(prisma, lateOrder, CITY, { deadline_at: new Date(Date.now() - 1000) });
    expect((await svc.reopenAfterApprovedCancel({ orderId: lateOrder, riderId: 11, cityId: CITY })).reopened).toBe(false);
  });
});
```

- [ ] **Step 7: Run the real-MySQL suite**

Run (real MySQL command) with `npx jest src/services/__tests__/guaranteeRecovery.mysql.test.js`.
Expected: all PASS and **0 skipped**. If `pkg_order`/`tbl_user` inserts fail, read the error: `insertRow` only fills required columns; fix the helper, not the schema. If a test fails because the row-lock expectation is wrong, investigate the service, do not weaken the test.

- [ ] **Step 8: Commit**

```bash
git add backend/src/services/guaranteeRecoveryService.js backend/src/services/__tests__/guaranteeRecoveryService.test.js backend/src/services/__tests__/guaranteeRecovery.mysql.test.js backend/src/services/__tests__/helpers/mysqlTestDb.js
git commit -m "feat(booking-guarantee): recovery service (reopen case, hold order, restart search)"
```

---

### Task 3: bookingGuaranteeService hooks (announceOpened, stop dispatch on expiry, advance refund)

**Files:**
- Modify: `backend/src/services/bookingGuaranteeService.js`
- Test: `backend/src/services/__tests__/bookingGuaranteeService.test.js`

**Interfaces:**
- Produces: `announceOpened(row, cityId) -> Promise<void>` (exported; never throws): admin alert + `admin_alerted` audit, customer `order:guarantee_pending`, executive-queue `onCaseOpened`. `expireCase` now also calls `dispatchManager().stopDispatch(orderId, "guarantee_expired")` after a successful expiry; `finishExpiry` also calls `walletAdvance.refundWalletAdvanceIfAny(order.id)`.

- [ ] **Step 1: Write the failing tests**

In `bookingGuaranteeService.test.js` add to the top mocks: `jest.mock("../walletAdvanceService", () => ({ refundWalletAdvanceIfAny: jest.fn().mockResolvedValue(0) }));` and change the dispatchManager mock to `jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), stopDispatch: jest.fn() }));`; add `const walletAdvance = require("../walletAdvanceService");`. Add a `guaranteeQueue`/`queueSettings` mock only if the file does not already mock them (check: `openForExhaustedOrder` tests already pass through `onCaseOpened`, so they are mocked or inert; reuse whatever the file does). Add:

```js
describe("announceOpened", () => {
  it("alerts admins, tells the customer and audits admin_alerted, from the case row alone", async () => {
    await svc.announceOpened(caseRow({ deadline_at: new Date("2026-10-07T10:00:00Z") }), 3);
    expect(adminSocket.notifyDispatchAlert).toHaveBeenCalledWith(500, 3, svc.ALERT_MESSAGE, expect.objectContaining({
      kind: "booking_guarantee", amount: 100, deadline_at: "2026-10-07T10:00:00.000Z",
    }));
    expect(dispatchManager.emitCustomerEvent).toHaveBeenCalledWith(7, "order:guarantee_pending", expect.objectContaining({ order_id: "500", amount: 100 }));
    expect(auditEvents()).toEqual(["admin_alerted"]);
  });
  it("never throws when the alert fails", async () => {
    adminSocket.notifyDispatchAlert.mockImplementationOnce(() => { throw new Error("socket down"); });
    await expect(svc.announceOpened(caseRow(), 3)).resolves.toBeUndefined();
  });
});

describe("expiry of a recovered order", () => {
  it("stops a still-running auto-search after a successful expiry", async () => {
    // Reuse the happy-path arrangement of the first expireCase test in this file (same mocks, same row), then:
    expect(await svc.expireCase(1)).toBe(true);
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(500, "guarantee_expired");
  });
  it("does not stop dispatch when another worker already expired the case", async () => {
    expect(await svc.expireCase(1)).toBe(false);
    expect(dispatchManager.stopDispatch).not.toHaveBeenCalled();
  });
  it("refunds a wallet-paid advance as part of the expiry refunds (idempotent helper)", async () => {
    expect(await svc.expireCase(1)).toBe(true);
    expect(walletAdvance.refundWalletAdvanceIfAny).toHaveBeenCalledWith(500);
  });
});
```
The three `expireCase` tests in the last describe must copy the exact mock arrangement of the existing "expireCase" happy-path test (lines ~132-150: `$transaction`, `booking_guarantee_case.updateMany/findUnique`, `pkg_order.updateMany`, `tbl_user`, `tbl_wallet_history`, `pkg_order.findUnique`). Read that test and paste its arrangement into each of the first and third tests; for the second, copy the arrangement of the existing test where `updateMany` returns `{ count: 0 }` (returns `false`).

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/services/__tests__/bookingGuaranteeService.test.js` → the new tests FAIL (`announceOpened` undefined, `stopDispatch`/`refundWalletAdvanceIfAny` not called).

- [ ] **Step 3: Implement**

In `bookingGuaranteeService.js`:
- Add `const walletAdvance = require("./walletAdvanceService");` with the other requires.
- Replace the block in `openForExhaustedOrder` from `// Tells the admin UI whether this city's executive queue owns the case ...` through the `onCaseOpened` try/catch (the code from `const queueOn = ...` to the end of the `guaranteeQueue.onCaseOpened` try/catch, just before `return true;`) with `await announceOpened(row, order.city_id);` and add above `openForExhaustedOrder`:

```js
/**
 * Announces an OPEN case: admin alert (flagged when the city's executive queue owns it), customer notice and the
 * executive-queue hook. Used when a case opens and when driver-cancel recovery reopens it. Best-effort, never throws.
 */
async function announceOpened(row, cityId) {
  const amount = Number(row.compensation_amount) || 0;
  const deadline = new Date(row.deadline_at);
  // Tells the admin UI whether this city's executive queue owns the case (executives then skip the broadcast banner).
  const queueOn = (await queueSettings.getQueueSettings(cityId)).execQueueEnabled;
  try {
    adminSocket.notifyDispatchAlert(row.order_id, cityId, ALERT_MESSAGE, {
      kind: "booking_guarantee", amount, deadline_at: deadline.toISOString(), queue: queueOn,
    });
    await writeAudit(prisma, row, "admin_alerted");
  } catch (err) {
    logger.error(`bookingGuarantee: admin alert failed for order ${row.order_id}:`, err);
  }
  try {
    dispatchManager().emitCustomerEvent(row.uid, "order:guarantee_pending", {
      order_id: String(row.order_id), amount, deadline_at: deadline.toISOString(),
    });
  } catch (err) {
    logger.error(`bookingGuarantee: customer notify failed for order ${row.order_id}:`, err);
  }
  try {
    await guaranteeQueue.onCaseOpened(row, cityId);
  } catch (err) {
    logger.error(`bookingGuarantee: executive queue hook failed for order ${row.order_id}:`, err);
  }
}
```
Wrap the `queueSettings.getQueueSettings` read so a failure cannot throw: it already fails closed internally (returns defaults), so no extra try is needed.
- In `finishExpiry`, after `await walletPrepayment.refundIfWalletPaid(order, { note: "no driver found" });` add `await walletAdvance.refundWalletAdvanceIfAny(order.id);`.
- In `expireCase`, after `await endOwnership(claimed.row, STATUS.EXPIRED);` add:

```js
  // A recovered order may still have an auto-search running; the order is cancelled now, so stop it.
  try {
    dispatchManager().stopDispatch(claimed.row.order_id, "guarantee_expired");
  } catch (err) {
    logger.error(`bookingGuarantee: stopping search for order ${claimed.row.order_id} failed:`, err);
  }
```
- Export `announceOpened` in `module.exports`.

- [ ] **Step 4: Run tests**

Run: `npx jest src/services/__tests__/bookingGuaranteeService.test.js src/services/__tests__/bookingGuaranteeCity.test.js src/services/__tests__/guaranteeQueueHooks.test.js` → all PASS (the extraction must not change any existing assertion).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bookingGuaranteeService.js backend/src/services/__tests__/bookingGuaranteeService.test.js
git commit -m "feat(booking-guarantee): announceOpened, stop search and refund wallet advance on expiry"
```

---

### Task 4: driverCancel recovery pre-step

**Files:**
- Modify: `backend/src/services/tripLifecycle.js` (`driverCancel` ~L1445, new helpers)
- Modify: `backend/src/sockets/orderSocket.js` (~L134), `backend/src/controllers/orderController.js` (~L1302)
- Test: `backend/src/services/__tests__/tripLifecycle.test.js`

**Interfaces:**
- Consumes: `guaranteeRecoveryService.recoveryCityFor`, `.reopenAfterDriverCancel({ orderId, riderId, cityId, inTx })`, `.afterReopen`.
- Produces: `driverCancel` may return `{ success: true, recovered: true, order, refund_amount: 0, refund_status: "order_reopened" }`; `applyDriverCancelFee(tx, { order, orderId, riderId, walletNotifications })` (module-internal).

- [ ] **Step 1: Write the failing tests**

At the top of `tripLifecycle.test.js`, add to the `config/db` mock object `driver_trip_progress: { findUnique: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() }` (replace the existing `driver_trip_progress` entry), and add after the `bookingGuaranteeService` mock:

```js
jest.mock("../guaranteeRecoveryService", () => ({
  recoveryCityFor: jest.fn().mockResolvedValue(null),
  reopenAfterDriverCancel: jest.fn(),
  afterReopen: jest.fn().mockResolvedValue(undefined),
}));
```
and `const recovery = require("../guaranteeRecoveryService");` with the other requires. Add inside `describe("tripLifecycle.driverCancel", ...)` (its `beforeEach` already sets `$transaction`, `$queryRaw`, etc.; add `recovery.recoveryCityFor.mockResolvedValue(null);` to that `beforeEach` so each test starts switched off):

```js
  describe("guarantee recovery", () => {
    const caseRow = { id: 1, order_id: 297, deadline_at: new Date(Date.now() + 600000) };

    it("switch off: terminal cancel exactly as before, recovery never attempted", async () => {
      const result = await tripLifecycle.driverCancel(297, 11, "breakdown");
      expect(recovery.reopenAfterDriverCancel).not.toHaveBeenCalled();
      expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "driver_cancelled");
      expect(result.recovered).toBeUndefined();
    });

    it("eligible: reopens instead of cancelling (no terminal cancel, no refunds, no stopDispatch)", async () => {
      const { refundIfWalletPaid } = require("../walletPrepaymentRefund");
      recovery.recoveryCityFor.mockResolvedValue(3);
      recovery.reopenAfterDriverCancel.mockResolvedValue({ reopened: true, caseRow, order: { id: 297, uid: 7, rid: 11, order_status: 1, delivery_type: 6 } });

      const result = await tripLifecycle.driverCancel(297, 11, "breakdown");

      expect(result).toMatchObject({ success: true, recovered: true, refund_amount: 0, refund_status: "order_reopened" });
      expect(recovery.reopenAfterDriverCancel).toHaveBeenCalledWith(expect.objectContaining({ orderId: 297, riderId: 11, cityId: 3, inTx: expect.any(Function) }));
      expect(recovery.afterReopen).toHaveBeenCalledWith({ orderId: 297, caseRow, cityId: 3 });
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
      expect(refundIfWalletPaid).not.toHaveBeenCalled();
      expect(dispatchManager.stopDispatch).not.toHaveBeenCalled();
    });

    it("recovery declined (deadline passed, wrong stage...): falls through to the unchanged terminal cancel", async () => {
      recovery.recoveryCityFor.mockResolvedValue(3);
      recovery.reopenAfterDriverCancel.mockResolvedValue({ reopened: false, reason: "case_not_reopenable" });
      const result = await tripLifecycle.driverCancel(297, 11, "breakdown");
      expect(result.recovered).toBeUndefined();
      expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(297, "driver_cancelled");
      expect(recovery.afterReopen).not.toHaveBeenCalled();
    });

    it("automated cancels (requireOrderStatus) never attempt recovery", async () => {
      recovery.recoveryCityFor.mockResolvedValue(3);
      await tripLifecycle.driverCancel(297, 11, "auto", { requireOrderStatus: 1 });
      expect(recovery.recoveryCityFor).not.toHaveBeenCalled();
    });

    it("the in-transaction hook penalises the driver once, blocks re-offers and clears trip progress", async () => {
      recovery.recoveryCityFor.mockResolvedValue(3);
      recovery.reopenAfterDriverCancel.mockResolvedValue({ reopened: true, caseRow, order: {} });
      pricingEngine.getPackageById.mockResolvedValue({ cancellation_charge_driver: 50, driver_cancel_user_earning: 20 });
      prisma.tbl_rider.update.mockResolvedValue({});
      await tripLifecycle.driverCancel(297, 11, "breakdown");

      const { inTx } = recovery.reopenAfterDriverCancel.mock.calls[0][0];
      await inTx(prisma, { id: 297, uid: 7, rid: 11, order_status: 1, delivery_type: 6 });

      expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 11 }, data: { wallet_balance: { decrement: 50 } } });
      expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payment_id: "driver_cancel_fee:297:11", type: "debit" }) }));
      expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payment_id: "driver_cancel_comp:297:11", type: "credit" }) }));
      expect(prisma.tbl_order_requests.updateMany).toHaveBeenCalledWith({ where: { order_id: 297, rider_id: 11, status: { in: ["sent", "accepted"] } }, data: { status: "10" } });
      expect(prisma.driver_trip_progress.deleteMany).toHaveBeenCalledWith({ where: { order_id: 297 } });
      expect(prisma.order_status_history.create).toHaveBeenCalledWith({ data: expect.objectContaining({ order_id: 297, rider_id: 11, status: "Driver Cancelled" }) });
    });

    it("the hook charges no fee for a still-pending order (same rule as the terminal path)", async () => {
      recovery.recoveryCityFor.mockResolvedValue(3);
      recovery.reopenAfterDriverCancel.mockResolvedValue({ reopened: true, caseRow, order: {} });
      pricingEngine.getPackageById.mockResolvedValue({ cancellation_charge_driver: 50, driver_cancel_user_earning: 20 });
      await tripLifecycle.driverCancel(297, 11, "x");
      const { inTx } = recovery.reopenAfterDriverCancel.mock.calls[0][0];
      await inTx(prisma, { id: 297, uid: 7, rid: 11, order_status: 0, delivery_type: 6 });
      expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/services/__tests__/tripLifecycle.test.js -t "driverCancel"` → the new tests FAIL (`recoveryCityFor` never called / helper missing). The pre-existing driverCancel tests must still PASS: if any now fails because of the new mock, fix the mock, not the assertion.

- [ ] **Step 3: Extract the fee helper (behaviour-preserving)**

In `tripLifecycle.js`, immediately above `async function driverCancel`, add:

```js
/**
 * The driver's cancellation fee and the customer's `driver_cancel_user_earning` credit, each behind its own
 * idempotency key. Runs inside the caller's transaction; shared by the terminal cancel and guarantee recovery.
 */
async function applyDriverCancelFee(tx, { order, orderId, riderId, walletNotifications }) {
  if (!order.delivery_type) return;
  const pkg = await pricingEngine.getPackageById(order.delivery_type);
  const driverFee = Number(pkg?.cancellation_charge_driver) || 0;
  if (driverFee > 0) {
    const driverFeeKey = `driver_cancel_fee:${orderId}:${riderId}`;
    const alreadyDebited = await tx.tbl_wallet_history.findFirst({
      where: { payment_id: driverFeeKey, type: "debit", wallet_type: "driver" },
    });
    if (!alreadyDebited) {
      const feeRemark = `Cancellation fee for cancelling order #${orderId}`;
      await tx.tbl_rider.update({
        where: { id: Number(riderId) },
        data: { wallet_balance: { decrement: driverFee } },
      });
      await tx.tbl_wallet_history.create({
        data: {
          user_id: Number(riderId),
          amount: driverFee,
          type: "debit",
          wallet_type: "driver",
          order_id: orderId,
          payment_id: driverFeeKey,
          remark: feeRemark,
          created_at: istNow(),
        },
      });
      walletNotifications.push({ riderId: Number(riderId), type: "debit", amount: driverFee, remark: feeRemark });

      const userComp = Number(pkg?.driver_cancel_user_earning) || 0;
      if (userComp > 0) {
        await tx.tbl_user.update({
          where: { id: Number(order.uid) },
          data: { wallet: { increment: userComp } },
        });
        await tx.tbl_wallet_history.create({
          data: {
            user_id: Number(order.uid),
            amount: userComp,
            type: "credit",
            wallet_type: "user",
            order_id: orderId,
            payment_id: `driver_cancel_comp:${orderId}:${riderId}`,
            remark: `Compensation for driver cancelling order #${orderId}`,
            created_at: istNow(),
          },
        });
      }
    }
  }
}
```
Then in `driverCancel` replace the whole block `if (order.delivery_type && !isPending) { ... }` (the `const pkg = ...` through the closing brace after the `userComp` credit, about L1543-1592) with:

```js
    if (!isPending) await applyDriverCancelFee(tx, { order, orderId, riderId, walletNotifications });
```
Run `npx jest src/services/__tests__/tripLifecycle.test.js` — every pre-existing test (including "debits driver fee and credits customer compensation") must still PASS before continuing.

- [ ] **Step 4: Add the recovery pre-step**

Above `driverCancel` add:

```js
/**
 * Booking Guarantee recovery (spec 2026-10-14): a guarantee order whose assigned driver cancels before pickup goes
 * back to the held state under the SAME case and original deadline, instead of being cancelled. Returns the
 * driverCancel result, or null to take the normal terminal path (switch off, ineligible, or any failure).
 */
async function recoverGuaranteeOrder(orderId, riderId, reason) {
  const recovery = require("./guaranteeRecoveryService");
  const cityId = await recovery.recoveryCityFor(orderId);
  if (cityId === null) return null;

  const walletNotifications = [];
  const outcome = await recovery.reopenAfterDriverCancel({
    orderId, riderId, cityId,
    inTx: async (tx, order) => {
      if (Number(order.order_status) !== 0) await applyDriverCancelFee(tx, { order, orderId, riderId, walletNotifications });
      // Marked as a reject so the cascade never offers this order to the same driver again.
      await tx.tbl_order_requests.updateMany({
        where: { order_id: orderId, rider_id: riderId, status: { in: ["sent", "accepted"] } },
        data: { status: "10" },
      });
      await tx.driver_trip_progress.deleteMany({ where: { order_id: orderId } });
      await tx.order_status_history.create({
        data: { order_id: orderId, rider_id: riderId, status: "Driver Cancelled", remark: reason || "No reason provided", created_at: new Date() },
      });
    },
  });
  if (!outcome.reopened) return null;

  for (const n of walletNotifications) {
    walletNotifier
      .notifyDriverWalletTransaction(n.riderId, { type: n.type, amount: n.amount, remark: n.remark })
      .catch((err) => logger.error(`driverCancel: wallet notify failed for rider ${n.riderId}:`, err));
  }
  await recovery.afterReopen({ orderId, caseRow: outcome.caseRow, cityId });
  return {
    success: true,
    recovered: true,
    order: { ...outcome.order, rid: 0, order_status: 0, o_status: "Pending" },
    refund_amount: 0,
    refund_status: "order_reopened",
  };
}
```
In `driverCancel`, right after the existing `if (opts.requireOrderStatus == null) { ... gate ... }` block add:

```js
  if (opts.requireOrderStatus == null) {
    const recovered = await recoverGuaranteeOrder(orderId, riderId, reason);
    if (recovered) return recovered;
  }
```

- [ ] **Step 5: Driver-facing messages**

`orderSocket.js` handler `order:driver_cancel`: change the ack message to
`msg: result.success ? (result.recovered ? "Ride cancelled. The order is being offered to other drivers." : "Ride cancelled and advance refunded") : result.msg,`.
`orderController.driverCancel` success response: `message: result.recovered ? "Ride cancelled. The order is being offered to other drivers." : "Ride cancelled and advance refunded where applicable",`.

- [ ] **Step 6: Run tests**

Run: `npx jest src/services/__tests__/tripLifecycle.test.js` → all PASS (the whole file, not only the new tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/tripLifecycle.js backend/src/services/__tests__/tripLifecycle.test.js backend/src/sockets/orderSocket.js backend/src/controllers/orderController.js
git commit -m "feat(booking-guarantee): reopen the case when an assigned driver cancels before pickup"
```

---

### Task 5: Approved Free/Daily cancel reopens the case

**Files:**
- Modify: `backend/src/services/cancelRequestService.js` (`approve`)
- Test: `backend/src/services/__tests__/cancelRequestService.test.js`

**Interfaces:**
- Consumes: `recoveryCityFor`, `reopenAfterApprovedCancel`, `clampSearchDeadline`, `bookingGuaranteeService.announceOpened`.

- [ ] **Step 1: Write the failing tests**

In `cancelRequestService.test.js` add to the mocks:

```js
jest.mock("../guaranteeRecoveryService", () => ({
  recoveryCityFor: jest.fn().mockResolvedValue(null),
  reopenAfterApprovedCancel: jest.fn(),
  clampSearchDeadline: jest.requireActual("../guaranteeRecoveryService").clampSearchDeadline,
}));
jest.mock("../bookingGuaranteeService", () => ({ announceOpened: jest.fn().mockResolvedValue(undefined) }));
```
(`requireActual` loads the real module, which requires `../config/db` etc.; those are mocked at the top of this file, so it loads safely. If loading the real module fails, replace the property with an inline `(d, c) => new Date(Math.min(new Date(d).getTime(), new Date(c).getTime()))`.) Add requires `const recovery = require("../guaranteeRecoveryService"); const bookingGuarantee = require("../bookingGuaranteeService");` and in the `approve` describe add:

```js
  describe("guarantee recovery", () => {
    const caseRow = { id: 1, order_id: 50, deadline_at: new Date(Date.now() + 5 * 60 * 1000) };

    it("switch off: behaves exactly as before (no case touched)", async () => {
      await svc.approve({ requestId: 12, adminId: 1 });
      expect(recovery.reopenAfterApprovedCancel).not.toHaveBeenCalled();
      expect(bookingGuarantee.announceOpened).not.toHaveBeenCalled();
    });

    it("eligible: reopens the case and announces it after dispatch restarts", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, rid: 0, order_status: 0, city_id: 3, allowed_delivery_types: "[6]" });
      recovery.recoveryCityFor.mockResolvedValue(3);
      recovery.reopenAfterApprovedCancel.mockResolvedValue({ reopened: true, caseRow });
      const res = await svc.approve({ requestId: 12, adminId: 1 });
      expect(res.ok).toBe(true);
      expect(recovery.reopenAfterApprovedCancel).toHaveBeenCalledWith({ orderId: 50, riderId: 9, cityId: 3 });
      expect(dispatchManager.startDispatch).toHaveBeenCalled();
      expect(bookingGuarantee.announceOpened).toHaveBeenCalledWith(caseRow, 3);
    });

    it("System 2: the refreshed search window never outlives the case deadline", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, rid: 0, order_status: 0, city_id: 3, search_system: 2, allowed_delivery_types: "[6]" });
      orderSearchSettings.getCitySettings.mockResolvedValue({ driverSearchSeconds: 3600 });
      recovery.recoveryCityFor.mockResolvedValue(3);
      recovery.reopenAfterApprovedCancel.mockResolvedValue({ reopened: true, caseRow });
      await svc.approve({ requestId: 12, adminId: 1 });
      const written = prisma.pkg_order.update.mock.calls.find(([a]) => a.data.search_deadline_at)[0].data.search_deadline_at;
      expect(written.getTime()).toBe(new Date(caseRow.deadline_at).getTime());
    });

    it("a recovery failure never blocks the approval", async () => {
      recovery.recoveryCityFor.mockRejectedValue(new Error("boom"));
      const res = await svc.approve({ requestId: 12, adminId: 1 });
      expect(res.ok).toBe(true);
      expect(dispatchManager.startDispatch).toHaveBeenCalled();
    });
  });
```
(If `isSystem2Order` needs `search_system: 2` to equal `SYSTEM.VEHICLE_FIRST`, confirm that constant is `2` in `orderSearchRules.js` and adjust the literal if it differs.)

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/services/__tests__/cancelRequestService.test.js` → new tests FAIL.

- [ ] **Step 3: Implement**

In `cancelRequestService.js` `approve`, immediately after `dispatchManager.emitCustomerEvent(order?.uid, "order:driver_unassigned", ...)` and before `const nextStage = ...` insert:

```js
  // Booking Guarantee recovery (spec 2026-10-14): the order is back to Pending, so a guarantee order goes back
  // under its case (original deadline). Fail closed: any problem leaves today's behaviour.
  let reopened = null;
  try {
    const recovery = require("./guaranteeRecoveryService");
    const cityId = await recovery.recoveryCityFor(orderId);
    if (cityId !== null) {
      const out = await recovery.reopenAfterApprovedCancel({ orderId, riderId, cityId });
      if (out.reopened) reopened = { caseRow: out.caseRow, cityId };
    }
  } catch (err) {
    logger.error(`cancelRequestService.approve: guarantee recovery failed for order ${orderId}:`, err);
  }
```
Inside the existing System 2 block, replace `const deadline = orderSearchRules.searchDeadline(new Date(), city.driverSearchSeconds);` with:

```js
      let deadline = orderSearchRules.searchDeadline(new Date(), city.driverSearchSeconds);
      // A reopened guarantee case keeps its original deadline: the search must not outlive it.
      if (reopened) deadline = require("./guaranteeRecoveryService").clampSearchDeadline(deadline, reopened.caseRow.deadline_at);
```
After `await dispatchManager.startDispatch(order, null, { stage: nextStage, earlierStageRiderIds });` add:

```js
  if (reopened) {
    try {
      await require("./bookingGuaranteeService").announceOpened(reopened.caseRow, reopened.cityId);
    } catch (err) {
      logger.error(`cancelRequestService.approve: announcing reopened case for order ${orderId} failed:`, err);
    }
  }
```

- [ ] **Step 4: Run tests**

Run: `npx jest src/services/__tests__/cancelRequestService.test.js` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/cancelRequestService.js backend/src/services/__tests__/cancelRequestService.test.js
git commit -m "feat(booking-guarantee): approved Free/Daily cancel reopens the guarantee case"
```

---

### Task 6: End-to-end money and race tests, regression gate, docs

**Files:**
- Test: `backend/src/services/__tests__/guaranteeRecoveryFlow.mysql.test.js`
- Modify: `docs/superpowers/specs/2026-10-14-guarantee-executive-queue-design.md` (Section 12 note), memory file `guarantee_executive_queue.md`

- [ ] **Step 1: Write the real-MySQL flow tests**

```js
const { enabled, describeMysql, resetDb, resetOrders, makeOrder, makeUser, makeAssignedCase } = require("./helpers/mysqlTestDb");

jest.mock("../dispatchManager", () => ({ emitCustomerEvent: jest.fn(), startDispatch: jest.fn().mockResolvedValue(undefined), stopDispatch: jest.fn() }));
jest.mock("../pushNotifier", () => ({ notifyCustomerNoDriverFound: jest.fn().mockResolvedValue({ sent: true }) }));
jest.mock("../walletNotifier", () => ({ notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyDispatchAlert: jest.fn(), notifyOrderStatusUpdate: jest.fn() }));

const prisma = enabled ? require("../../config/db") : null;
const recovery = enabled ? require("../guaranteeRecoveryService") : null;
const guarantee = enabled ? require("../bookingGuaranteeService") : null;
const dispatchManager = enabled ? require("../dispatchManager") : null;
const CITY = 3;

describeMysql("driver-cancel recovery, end to end (real MySQL)", () => {
  beforeEach(async () => { await resetDb(prisma); await resetOrders(prisma); jest.clearAllMocks(); });
  afterAll(async () => { if (prisma) await prisma.$disconnect(); });

  const wallet = async (uid) => Number((await prisma.tbl_user.findUnique({ where: { id: uid }, select: { wallet: true } })).wallet);
  const credits = (orderId) => prisma.tbl_wallet_history.count({ where: { order_id: orderId, payment_id: `booking_guarantee_credit:${orderId}` } });
  const orderRow = (id) => prisma.$queryRawUnsafe("SELECT rid, order_status, o_status FROM pkg_order WHERE id = ?", id).then((r) => r[0]);

  it("cancel -> reopen -> deadline passes: compensation is paid exactly once, order cancelled, search stopped", async () => {
    const uid = await makeUser(prisma);
    const orderId = await makeOrder(prisma, { uid });
    const c = await makeAssignedCase(prisma, orderId, CITY, { uid, deadline_at: new Date(Date.now() + 2000) });

    expect((await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY })).reopened).toBe(true);
    await new Promise((r) => setTimeout(r, 2200));
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { deadline_at: new Date(Date.now() - 1000) } }); // deadline_at only moved EARLIER by the test

    expect(await guarantee.expireCase(c.id)).toBe(true);
    expect(await guarantee.expireCase(c.id)).toBe(false); // sweeper retry is a no-op
    expect(await wallet(uid)).toBe(100);
    expect(await credits(orderId)).toBe(1);
    expect(await orderRow(orderId)).toMatchObject({ order_status: 4, o_status: "Cancelled" });
    expect(dispatchManager.stopDispatch).toHaveBeenCalledWith(orderId, "guarantee_expired");
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("expired_compensated");
  });

  it("cancel -> reopen -> another driver assigned: the case closes again with no compensation, and a second cancel can reopen it", async () => {
    const orderId = await makeOrder(prisma);
    const c = await makeAssignedCase(prisma, orderId, CITY);
    await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    await prisma.$executeRawUnsafe("UPDATE pkg_order SET rid = 12, order_status = 1, o_status = 'Processing' WHERE id = ?", orderId);
    expect(await guarantee.closeOnAssign(orderId, null, "driver_assigned")).toBe(true);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("resolved_assigned");

    expect((await recovery.reopenAfterDriverCancel({ orderId, riderId: 12, cityId: CITY })).reopened).toBe(true);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("open");
  });

  it("customer cancel after a reopen closes the case without compensation", async () => {
    const uid = await makeUser(prisma);
    const orderId = await makeOrder(prisma, { uid });
    const c = await makeAssignedCase(prisma, orderId, CITY, { uid });
    await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    expect(await guarantee.closeOnCancel(orderId, "customer_cancelled")).toBe(true);
    expect((await prisma.booking_guarantee_case.findUnique({ where: { id: c.id } })).status).toBe("cancelled");
    expect(await credits(orderId)).toBe(0);
    expect(await wallet(uid)).toBe(0);
  });

  it("a cancel racing the expiry sweep never double-pays and never leaves an assigned order with an expired case", async () => {
    const uid = await makeUser(prisma);
    const orderId = await makeOrder(prisma, { uid });
    const c = await makeAssignedCase(prisma, orderId, CITY, { uid });
    await recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY });
    await prisma.booking_guarantee_case.update({ where: { id: c.id }, data: { deadline_at: new Date(Date.now() - 1000) } });

    const results = await Promise.all([
      guarantee.expireCase(c.id),
      guarantee.expireCase(c.id),
      recovery.reopenAfterDriverCancel({ orderId, riderId: 11, cityId: CITY }),
    ]);
    expect(results.slice(0, 2).filter(Boolean)).toHaveLength(1);
    expect(results[2].reopened).toBe(false);
    expect(await credits(orderId)).toBe(1);
    expect(await wallet(uid)).toBe(100);
  });
});
```
(The test moves `deadline_at` only to simulate time passing; production code never writes it. If `tbl_user.wallet` or `tbl_wallet_history.order_id` column names differ from the Prisma schema, use the Prisma model names from `schema.prisma`; the expireCase code under test uses the same names.)

- [ ] **Step 2: Run the real-MySQL suites**

Run each with the run-on-testdb.ps1 command: `guaranteeRecovery.mysql.test.js`, `guaranteeRecoveryFlow.mysql.test.js`, plus the five existing `guaranteeQueue*.mysql.test.js` suites. Expected: all PASS, **0 skipped**.

- [ ] **Step 3: Full regression**

Run (cwd `backend`, real MySQL command) `npx jest`: expect only the known unrelated `aadharPdfVerify` failures (2 tests, pre-existing); report passed/failed/skipped counts exactly. Run (cwd `frontend`) `npm run build` → success. `npm run lint` is broken at baseline (ESLint config crash) and is reported as blocked, not passed.

- [ ] **Step 4: Docs and memory**

- In `2026-10-14-guarantee-executive-queue-design.md` Section 12 add after the decision bullet: `*Update 2026-10-14:* implemented by the follow-up spec `2026-10-14-guarantee-driver-cancel-recovery-design.md` (per-city switch, default OFF).` and fix the stale sentence about `cancelRequestService` being terminal (approve re-dispatches).
- Update the memory note `guarantee_executive_queue.md` with the new feature status, the migration `20261014020000` (unapplied anywhere until deployed) and the known residual about carried-forward `payment_status`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/__tests__/guaranteeRecoveryFlow.mysql.test.js docs/superpowers/specs/2026-10-14-guarantee-executive-queue-design.md
git commit -m "test(booking-guarantee): end-to-end recovery money and race tests; docs"
```

---

## After the code (needs the owner's explicit approval, NOT part of the tasks above)

1. Push `feature/guarantee-driver-cancel-recovery` (non-main) for review.
2. Dev server only: verify `DATABASE_URL` is `shifteronlinedev`, back it up, hand-apply `20261014020000`, `migrate resolve --applied`, fast-forward the dev checkout, `npm ci --omit=dev`, `prisma generate`, restart `shifter-backend-dev`. The switch stays OFF.
3. Dev smoke with the switch ON for ONE test city only: cancel -> reopen -> reassign; cancel -> expiry -> compensation once; **complete a recovered order and read the wallet ledger** (the known `payment_status` carry-over residual); check both apps' screens during a reopen (`order:driver_unassigned` then `order:guarantee_pending`); then switch OFF.
4. Production: needs the migrations first (and a backup); nothing without explicit approval.

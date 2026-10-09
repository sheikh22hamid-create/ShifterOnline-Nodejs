# Receiver Pays (backend) Implementation Plan

> **Status & corrections (reviewed 2026-10-07): BUILT.** Implementation record - kept for history. Where it differs from the code, the code and the master document win. Current code-verified description: [Master Document section 5.2](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a booker choose that the drop-side receiver pays the fare (plus a booker-set commission) through a no-app WhatsApp web pay link, with the booker's advance held as a refundable deposit.

**Architecture:** Extends the existing payment-settlement system (`order_settlement`, `settlementService`). A new `order_receiver_pay` table holds booking-time intent and the pay-link token. Completion creates the settlement in *receiver mode* (`payer = 'receiver'`); the receiver's Razorpay payment (or the driver's cash "Received") applies the existing driver wallet effect plus booker wallet credits in one locked transaction. Decline / take-over converts the settlement back to normal customer mode.

**Tech Stack:** Node 18+, Express 5, Prisma 6 (MySQL, hand-applied SQL), Jest 30, Razorpay (REST via `utils/razorpayOrders.js` / `razorpayVerify.js`), Baileys WhatsApp (`whatsapp/notifications.js`).

**Spec:** [docs/superpowers/specs/2026-10-05-receiver-pays-design.md](../specs/2026-10-05-receiver-pays-design.md)

**Scope of this plan:** backend only (everything under `backend/`). The customer app (`ShifterOnline/`), driver app (`ShifterDriver/`) and admin-panel UI changes in the spec are separate plans; this plan ships the APIs they will call.

## Global Constraints

- Feature is dark by default: `receiver_pay_enabled` off; it also requires `settlement_enabled` on. With either off, every existing path behaves exactly as today.
- Receiver pays only on **cash** orders (`p_method_id` 2 or 0, or `trans_id` starting `cash`), and only for regular drivers (Monthly / Daily Driver trips fall back to normal mode).
- Commission base = amount the receiver pays after coupon/referral points (`amount = finalTotal - coupon - points`); `markup = round2(amount * percent / 100)`, capped by `receiver_commission_max_amount` when > 0. Percent is locked at booking, amount computed at completion.
- Advance is always paid by the booker (unchanged). In receiver mode it is **held** (the existing `advance_apply:<orderId>` customer-wallet debit still runs) and refunded as `receiver_advance_refund:<settlementId>` only when the receiver actually pays.
- Cash receiver: markup is zeroed, only the advance refund is credited.
- Booker commission credit key prefix: `receiver_markup_credit:` and remark `Receiver commission for order #<id>`.
- Reversal of booker credits is capped at the wallet's available balance; shortfall stored in `order_settlement.reversal_shortfall`. Wallet never goes negative.
- Customer wallet is spend-only: `POST /wallet/withdraw` rejects `wallet_type` other than `"driver"`.
- Pay token: 32 random bytes (`base64url`), only the SHA-256 hex stored; TTL default 24 h; resend cooldown 60 s; max 10 sends per order.
- Public routes: `GET /pay/:token`, `GET|POST /api/pay/:token[...]`. Token is the only auth. Per-IP rate limit via existing `middleware/rateLimiter.js`.
- New customer/driver endpoints follow the existing convention (`uid` / `rider_id` in the body, always HTTP 200 with `ResponseCode`/`Result`/`code`).
- DB changes are hand-applied SQL under `backend/prisma/migrations/<timestamp>_<name>/migration.sql` plus Prisma models; prod needs the SQL run before deploy.
- Tests: `cd backend && npx jest <path>`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Deviations from the spec (decided while grounding the plan in the code)

1. **No WhatsApp `PAY` / `NO` reply keywords.** The WhatsApp bot already treats `no` as the global `CANCEL_RESET` intent (`whatsapp/client.js` `detectGlobalIntent`), so a bare `NO` would collide. Decline is on the pay page, by the driver ("Receiver refused") or by the booker ("I'll pay myself"). Resend link is driver + booker only (no admin resend, no WhatsApp keyword).
2. **Extra column `order_settlement.receiver_credited`** (TINYINT) so admin reversal knows whether booker credits were applied.
3. **Public base URL** comes from the existing env var `PUBLIC_BASE_URL` (already used by `orderInvoiceController`).

## Review Focus

1. Receiver double-taps Pay / retries verify with the same `payment_id` -> second call is a no-op (`alreadyDone`), no second credit. (Task 7)
2. Driver taps "Received" while the receiver's payment is mid-flight -> exactly one wins, the loser is reconciled via the existing `PAID_BUT_STATE_CHANGED` event, no double wallet effect. (Task 7)
3. Advance = 0 (no-advance plan / wallet-paid) or advance larger than the amount -> no refund rows for 0, refund equals what `advance_apply` actually debited, nothing negative. (Tasks 5, 6)
4. Garbage, expired, reused or foreign token -> neutral JSON/HTML state, never a 500, never another order's data, no booker phone number in the payload. (Task 8)
5. Decline races with ride completion (decline lands just before/after the settlement row is created) -> the order ends in normal customer mode with the advance netted, not stuck in receiver mode. (Task 7)

---

## File Structure

**Create**
- `backend/prisma/migrations/20261005010000_add_receiver_pay/migration.sql` - columns + `order_receiver_pay` table.
- `backend/src/services/receiverPaySettings.js` - admin settings (`app_settings` keys), fail-closed.
- `backend/src/services/receiverPayCalc.js` - pure money/percent helpers.
- `backend/src/services/receiverPayToken.js` - token mint/hash.
- `backend/src/services/receiverPayService.js` - booking validation, row lifecycle, pay-link issue + WhatsApp message.
- `backend/src/services/receiverWalletCredits.js` - booker wallet credit/reversal inside a settlement transaction.
- `backend/src/services/receiverSettlementService.js` - receiver payment + decline/convert transitions, public state.
- `backend/src/controllers/receiverPayController.js` - public token endpoints + HTML page.
- `backend/src/controllers/receiverPayPage.js` - the static pay-page HTML string.
- `backend/src/routes/receiverPayRoutes.js` - `/pay` and `/api/pay` routers.
- Tests mirroring each of the above under `__tests__/`.

**Modify**
- `backend/prisma/schema.prisma` - `order_settlement` columns, new `order_receiver_pay` model.
- `backend/src/controllers/customerWalletController.js` - spend-only guard in `withdrawWallet`.
- `backend/src/controllers/orderController.js` - booking fields, validation, row creation, response flag.
- `backend/src/whatsapp/notifications.js` - payer line in the booked message to the receiver.
- `backend/src/services/settlementService.js` - receiver-mode creation, `publicView`, cash-received/admin-resolve hooks, booker-path guards, customer notification in `runTransition`.
- `backend/src/services/tripLifecycle.js` - receiver-mode settlement at completion + link issue.
- `backend/src/controllers/settlementController.js` and `backend/src/routes/orderRoutes.js`, `riderRoutes.js` - take-over, receiver-refused, resend-link, config endpoint.
- `backend/src/controllers/adminSettlementController.js` and `adminRoutes.js` - list fields, convert-to-customer.
- `backend/src/app.js` - mount public routers.

---

### Task 1: Schema migration and Prisma models

**Files:**
- Create: `backend/prisma/migrations/20261005010000_add_receiver_pay/migration.sql`
- Modify: `backend/prisma/schema.prisma` (model `order_settlement` ~L1879; add model after `order_settlement_event`)

**Interfaces:**
- Produces: Prisma models `order_receiver_pay` (fields below) and new `order_settlement` fields `payer`, `receiver_markup`, `advance_held`, `reversal_shortfall`, `receiver_credited`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Receiver pays (spec 2026-10-05). Apply on prod BEFORE deploying the backend.
ALTER TABLE `order_settlement`
  ADD COLUMN `payer` VARCHAR(10) NOT NULL DEFAULT 'customer',
  ADD COLUMN `receiver_markup` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `advance_held` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `reversal_shortfall` DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN `receiver_credited` TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE `order_receiver_pay` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `order_id` INT NOT NULL,
  `uid` INT NOT NULL,
  `receiver_phone` VARCHAR(15) NOT NULL,
  `receiver_name` VARCHAR(100) NULL,
  `commission_percent` DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  `status` VARCHAR(10) NOT NULL DEFAULT 'active',
  `token_hash` CHAR(64) NULL,
  `token_expires_at` DATETIME(0) NULL,
  `razorpay_order_id` VARCHAR(64) NULL,
  `declined_by` VARCHAR(10) NULL,
  `declined_at` DATETIME(0) NULL,
  `link_sent_at` DATETIME(0) NULL,
  `link_send_count` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(0) NOT NULL,
  `updated_at` DATETIME(0) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `uq_order_receiver_pay_order` (`order_id`),
  UNIQUE INDEX `uq_order_receiver_pay_token` (`token_hash`),
  INDEX `idx_order_receiver_pay_uid` (`uid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

- [ ] **Step 2: Add the Prisma fields and model**

In `model order_settlement`, add above the `events` relation line:

```prisma
  payer               String    @default("customer") @db.VarChar(10)
  receiver_markup     Decimal   @default(0.00) @db.Decimal(10, 2)
  advance_held        Decimal   @default(0.00) @db.Decimal(10, 2)
  reversal_shortfall  Decimal   @default(0.00) @db.Decimal(10, 2)
  receiver_credited   Boolean   @default(false)
```

After `model order_settlement_event { ... }` add:

```prisma
model order_receiver_pay {
  id                 Int       @id @default(autoincrement())
  order_id           Int       @unique(map: "uq_order_receiver_pay_order")
  uid                Int
  receiver_phone     String    @db.VarChar(15)
  receiver_name      String?   @db.VarChar(100)
  commission_percent Decimal   @default(0.00) @db.Decimal(5, 2)
  status             String    @default("active") @db.VarChar(10)
  token_hash         String?   @unique(map: "uq_order_receiver_pay_token") @db.Char(64)
  token_expires_at   DateTime? @db.DateTime(0)
  razorpay_order_id  String?   @db.VarChar(64)
  declined_by        String?   @db.VarChar(10)
  declined_at        DateTime? @db.DateTime(0)
  link_sent_at       DateTime? @db.DateTime(0)
  link_send_count    Int       @default(0)
  created_at         DateTime  @db.DateTime(0)
  updated_at         DateTime  @db.DateTime(0)

  @@index([uid], map: "idx_order_receiver_pay_uid")
}
```

- [ ] **Step 3: Validate the schema and apply the SQL to the dev DB**

Run (from `backend/`):
```bash
npx prisma validate
npx prisma db execute --file prisma/migrations/20261005010000_add_receiver_pay/migration.sql --schema prisma/schema.prisma
npx prisma generate
```
Expected: `The schema at prisma/schema.prisma is valid`, `Script executed successfully.`, `Generated Prisma Client`. (`.env` is the DEV database; prod runs the SQL by hand before deploy.)

- [ ] **Step 4: Smoke-check the generated client**

Run: `node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.order_receiver_pay.count().then(c=>{console.log('rows',c);return p.\$disconnect()})"`
Expected: prints `rows 0`.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20261005010000_add_receiver_pay/migration.sql
git commit -m "feat(receiver-pay): add order_receiver_pay table and settlement receiver columns

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Settings, calc and token primitives

**Files:**
- Create: `backend/src/services/receiverPaySettings.js`, `backend/src/services/receiverPayCalc.js`, `backend/src/services/receiverPayToken.js`
- Test: `backend/src/services/__tests__/receiverPaySettings.test.js`, `receiverPayCalc.test.js`, `receiverPayToken.test.js`

**Interfaces:**
- Produces:
  - `receiverPaySettings.getReceiverPaySettings(): Promise<{ enabled: boolean, maxPercent: number, maxAmount: number, linkTtlHours: number }>` (fail-closed to defaults)
  - `receiverPaySettings.isReceiverPayAvailable(): Promise<boolean>` (receiver-pay enabled AND settlement enabled)
  - `receiverPaySettings.KEYS`, `DEFAULTS`
  - `receiverPayCalc.computeMarkup(amountDue, percent, maxAmount = 0): number`
  - `receiverPayCalc.receiverPayable(amountDue, markup): number`
  - `receiverPayCalc.parseCommissionPercent(raw, maxPercent): { ok: true, value: number } | { ok: false, msg: string }`
  - `receiverPayCalc.round2(n): number`
  - `receiverPayToken.mintToken(): { token: string, hash: string }`, `receiverPayToken.hashToken(token: string): string`

- [ ] **Step 1: Write the failing tests**

`receiverPayCalc.test.js`:
```js
const { computeMarkup, receiverPayable, parseCommissionPercent, round2 } = require("../receiverPayCalc");

describe("receiverPayCalc", () => {
  it("computes markup on the amount the receiver pays", () => {
    expect(computeMarkup(90, 3)).toBe(2.7);
    expect(computeMarkup(99, 3)).toBe(2.97);
  });
  it("rounds to paise", () => expect(computeMarkup(33.33, 3)).toBe(1));
  it("0% or a missing percent gives 0", () => {
    expect(computeMarkup(90, 0)).toBe(0);
    expect(computeMarkup(90, undefined)).toBe(0);
  });
  it("applies the rupee cap when the cap is positive", () => {
    expect(computeMarkup(1000, 5, 20)).toBe(20);
    expect(computeMarkup(100, 5, 20)).toBe(5);
    expect(computeMarkup(1000, 5, 0)).toBe(50);
  });
  it("receiverPayable adds the markup", () => expect(receiverPayable(90, 2.7)).toBe(92.7));
  it("round2 handles float residue", () => expect(round2(0.1 + 0.2)).toBe(0.3));

  describe("parseCommissionPercent", () => {
    it("treats empty as 0", () => {
      expect(parseCommissionPercent(undefined, 5)).toEqual({ ok: true, value: 0 });
      expect(parseCommissionPercent("", 5)).toEqual({ ok: true, value: 0 });
    });
    it("accepts 0..max", () => {
      expect(parseCommissionPercent("3", 5)).toEqual({ ok: true, value: 3 });
      expect(parseCommissionPercent(5, 5)).toEqual({ ok: true, value: 5 });
    });
    it("rejects above max, negative and non-numeric", () => {
      expect(parseCommissionPercent(5.01, 5).ok).toBe(false);
      expect(parseCommissionPercent(-1, 5).ok).toBe(false);
      expect(parseCommissionPercent("abc", 5).ok).toBe(false);
    });
  });
});
```

`receiverPayToken.test.js`:
```js
const { mintToken, hashToken } = require("../receiverPayToken");

describe("receiverPayToken", () => {
  it("mints a url-safe token and its sha256 hash", () => {
    const { token, hash } = mintToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toBe(hash);
  });
  it("never repeats", () => expect(mintToken().token).not.toBe(mintToken().token));
});
```

`receiverPaySettings.test.js`:
```js
jest.mock("../../config/db", () => ({ app_settings: { findMany: jest.fn() } }));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../settlementSettings", () => ({ isSettlementEnabled: jest.fn() }));

const prisma = require("../../config/db");
const settlementSettings = require("../settlementSettings");
const { getReceiverPaySettings, isReceiverPayAvailable, DEFAULTS } = require("../receiverPaySettings");

const rows = (o) => Object.entries(o).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));

describe("receiverPaySettings", () => {
  beforeEach(() => jest.clearAllMocks());

  it("defaults: off, 5%, no rupee cap, 24h", async () => {
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await getReceiverPaySettings()).toEqual({ enabled: false, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });
    expect(DEFAULTS.enabled).toBe(false);
  });
  it("reads configured values", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      receiver_pay_enabled: "1", receiver_commission_max_percent: "10", receiver_commission_max_amount: "50", receiver_pay_link_ttl_hours: "12",
    }));
    expect(await getReceiverPaySettings()).toEqual({ enabled: true, maxPercent: 10, maxAmount: 50, linkTtlHours: 12 });
  });
  it("falls back per key on bad values (a 0 rupee cap stays valid = no cap)", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({
      receiver_pay_enabled: "yes", receiver_commission_max_percent: "-3", receiver_commission_max_amount: "0", receiver_pay_link_ttl_hours: "abc",
    }));
    expect(await getReceiverPaySettings()).toEqual({ enabled: true, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });
  });
  it("fails closed when the DB read throws", async () => {
    prisma.app_settings.findMany.mockRejectedValue(new Error("db down"));
    expect((await getReceiverPaySettings()).enabled).toBe(false);
  });
  it("available only when both receiver-pay and settlement are on", async () => {
    prisma.app_settings.findMany.mockResolvedValue(rows({ receiver_pay_enabled: "1" }));
    settlementSettings.isSettlementEnabled.mockResolvedValue(false);
    expect(await isReceiverPayAvailable()).toBe(false);
    settlementSettings.isSettlementEnabled.mockResolvedValue(true);
    expect(await isReceiverPayAvailable()).toBe(true);
    prisma.app_settings.findMany.mockResolvedValue([]);
    expect(await isReceiverPayAvailable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd backend && npx jest src/services/__tests__/receiverPayCalc.test.js src/services/__tests__/receiverPayToken.test.js src/services/__tests__/receiverPaySettings.test.js`
Expected: FAIL, `Cannot find module '../receiverPayCalc'` (and the other two).

- [ ] **Step 3: Implement**

`receiverPayCalc.js`:
```js
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Commission the receiver pays on top of the amount due. Base is the amount the
// receiver actually pays (fare after coupon / referral points), so it is never
// larger than what they are already being asked for.
function computeMarkup(amountDue, percent, maxAmount = 0) {
  const raw = round2(((Number(amountDue) || 0) * (Number(percent) || 0)) / 100);
  const cap = Number(maxAmount) || 0;
  return cap > 0 ? Math.min(raw, round2(cap)) : raw;
}

function receiverPayable(amountDue, markup) {
  return round2((Number(amountDue) || 0) + (Number(markup) || 0));
}

function parseCommissionPercent(raw, maxPercent) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: 0 };
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return { ok: false, msg: "Commission percent must be a number, 0 or more." };
  if (n > Number(maxPercent)) return { ok: false, msg: `Commission cannot be more than ${maxPercent}%.` };
  return { ok: true, value: round2(n) };
}

module.exports = { round2, computeMarkup, receiverPayable, parseCommissionPercent };
```

`receiverPayToken.js`:
```js
const crypto = require("crypto");

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

// Only the hash is ever stored; the raw token exists in the WhatsApp message.
function mintToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

module.exports = { mintToken, hashToken };
```

`receiverPaySettings.js`:
```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settlementSettings = require("./settlementSettings");

// Admin-editable through the existing Settings page `flags` (app_settings), same
// pattern as settlementSettings.js.
const KEYS = Object.freeze({
  enabled: "receiver_pay_enabled",
  maxPercent: "receiver_commission_max_percent",
  maxAmount: "receiver_commission_max_amount",
  linkTtlHours: "receiver_pay_link_ttl_hours",
});
const DEFAULTS = Object.freeze({ enabled: false, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());
function toNonNegative(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function toPositive(v, fallback) {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function getReceiverPaySettings() {
  try {
    const rows = await prisma.app_settings.findMany({ where: { setting_key: { in: Object.values(KEYS) } } });
    const byKey = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
      enabled: toBool(byKey.get(KEYS.enabled)),
      maxPercent: toNonNegative(byKey.get(KEYS.maxPercent), DEFAULTS.maxPercent),
      maxAmount: toNonNegative(byKey.get(KEYS.maxAmount), DEFAULTS.maxAmount),
      linkTtlHours: toPositive(byKey.get(KEYS.linkTtlHours), DEFAULTS.linkTtlHours),
    };
  } catch (err) {
    // Fail closed: an unreadable switch must never turn the feature ON.
    logger.error("getReceiverPaySettings: failed to read settings, treating feature as disabled:", err);
    return { ...DEFAULTS };
  }
}

// Receiver pay rides on the settlement flow, so both switches must be on.
async function isReceiverPayAvailable() {
  const s = await getReceiverPaySettings();
  if (!s.enabled) return false;
  return settlementSettings.isSettlementEnabled();
}

module.exports = { KEYS, DEFAULTS, getReceiverPaySettings, isReceiverPayAvailable };
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd backend && npx jest src/services/__tests__/receiverPayCalc.test.js src/services/__tests__/receiverPayToken.test.js src/services/__tests__/receiverPaySettings.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/receiverPaySettings.js backend/src/services/receiverPayCalc.js backend/src/services/receiverPayToken.js backend/src/services/__tests__/receiverPaySettings.test.js backend/src/services/__tests__/receiverPayCalc.test.js backend/src/services/__tests__/receiverPayToken.test.js
git commit -m "feat(receiver-pay): settings, markup calc and pay-token primitives

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Customer wallet stays spend-only

**Files:**
- Modify: `backend/src/controllers/customerWalletController.js:524-531` (`withdrawWallet`)
- Test: `backend/src/controllers/__tests__/customerWalletWithdraw.test.js`

**Interfaces:**
- Produces: `withdrawWallet` rejects any request whose `wallet_type` is not `"driver"` (missing counts as `"user"`) with `ResponseCode: "403"`.

- [ ] **Step 1: Write the failing test**

```js
jest.mock("../../config/db", () => ({
  tbl_user: { findFirst: jest.fn() },
  tbl_rider: { findFirst: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/walletNotifier", () => ({}));
jest.mock("../../services/driverWalletSettings", () => ({}));
jest.mock("../../utils/razorpayVerify", () => ({}));

const prisma = require("../../config/db");
const { withdrawWallet } = require("../customerWalletController");

const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });

describe("withdrawWallet - customer wallet is spend-only", () => {
  beforeEach(() => jest.clearAllMocks());

  it("rejects an explicit customer withdrawal and never touches the account", async () => {
    const r = res();
    await withdrawWallet({ body: { mobile: "9999999999", amount: 50, wallet_type: "user" } }, r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "403", Result: "false" }));
    expect(prisma.tbl_user.findFirst).not.toHaveBeenCalled();
  });

  it("rejects when wallet_type is omitted (it defaults to the customer wallet)", async () => {
    const r = res();
    await withdrawWallet({ body: { mobile: "9999999999", amount: 50 } }, r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "403" }));
    expect(prisma.tbl_user.findFirst).not.toHaveBeenCalled();
  });

  it("still lets the driver path through to its own account lookup", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue(null);
    const r = res();
    await withdrawWallet({ body: { mobile: "9999999999", amount: 50, wallet_type: "driver" } }, r);
    expect(prisma.tbl_rider.findFirst).toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "401" }));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/customerWalletWithdraw.test.js`
Expected: FAIL (the customer cases are not rejected: `tbl_user.findFirst` is called).

- [ ] **Step 3: Implement the guard**

In `withdrawWallet`, directly after the `Missing Data` check (the line returning `ResponseMsg: "Missing Data"`), add:

```js
    // Customer wallets are spend-only (rides and wallet-paid bookings). The customer
    // app has no withdraw option; this stops the raw endpoint from being used as one.
    if (walletType !== "driver") {
      return res.status(200).json({
        ResponseCode: "403",
        Result: "false",
        ResponseMsg: "Wallet balance can only be used for rides and cannot be withdrawn.",
      });
    }
```

- [ ] **Step 4: Run to verify it passes, plus the neighbouring wallet suites**

Run: `cd backend && npx jest src/controllers/__tests__/customerWalletWithdraw.test.js src/controllers/__tests__/driverWalletFlows.test.js src/controllers/__tests__/securityFixes.test.js`
Expected: PASS. If a neighbouring test sends a customer withdrawal and expects success, update that test to expect the 403 (customer withdrawal is now intentionally removed).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/customerWalletController.js backend/src/controllers/__tests__/customerWalletWithdraw.test.js
git commit -m "fix(wallet): keep customer wallet spend-only by rejecting customer withdrawals

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Booking - validation, row creation, config, booked-message line

**Files:**
- Create: `backend/src/services/receiverPayService.js` (booking part; later tasks extend it)
- Modify: `backend/src/controllers/orderController.js` (`createOrderCore` ~L245-262 and ~L529, `createOrder` ~L661-718)
- Modify: `backend/src/whatsapp/notifications.js` (`notifyOrderBooked`, receiver message ~L182-194)
- Test: `backend/src/services/__tests__/receiverPayService.test.js`, `backend/src/controllers/__tests__/orderController.receiverPay.test.js`

**Interfaces:**
- Consumes: `receiverPaySettings.isReceiverPayAvailable/getReceiverPaySettings`, `receiverPayCalc.parseCommissionPercent`, `utils/phone.normalizeToLast10Digits`.
- Produces (in `receiverPayService.js`):
  - `class ReceiverPayError extends Error { code }`
  - `validateBooking({ receiverPays, commissionPercent, dmobile, pMethodId, transactionId }): Promise<{ ok: true, value: null | { phone: string, percent: number } } | { ok: false, code: 'RECEIVER_PAY_UNAVAILABLE' | 'VALIDATION', msg: string }>`
  - `createForOrder({ orderId, uid, phone, name, percent }): Promise<row>`
  - `getActiveForOrder(orderId): Promise<row | null>` (status `active` only)
  - `close(orderId, reason): Promise<void>` (active -> `closed`)
  - `getConfig(): Promise<{ enabled: boolean, max_percent: number, max_amount: number }>`
- `createOrderCore` accepts `receiverPays`, `receiverCommissionPercent`; on success `order.receiver_pay` is `true` only if the row was created. `createOrder` reads `receiver_pays`, `receiver_commission_percent` from the body, maps `RECEIVER_PAY_UNAVAILABLE` to HTTP 400, and returns `receiver_pay` in the 200 body.

- [ ] **Step 1: Write the failing service test**

`receiverPayService.test.js`:
```js
jest.mock("../../config/db", () => ({
  order_receiver_pay: { create: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../receiverPaySettings", () => ({
  isReceiverPayAvailable: jest.fn(),
  getReceiverPaySettings: jest.fn(),
}));

const prisma = require("../../config/db");
const settings = require("../receiverPaySettings");
const svc = require("../receiverPayService");

const ok = { receiverPays: true, commissionPercent: 3, dmobile: "98765 43210", pMethodId: 2, transactionId: "" };

beforeEach(() => {
  jest.clearAllMocks();
  settings.isReceiverPayAvailable.mockResolvedValue(true);
  settings.getReceiverPaySettings.mockResolvedValue({ enabled: true, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 });
});

describe("receiverPayService.validateBooking", () => {
  it("is a no-op when receiver pays is not requested", async () => {
    expect(await svc.validateBooking({ ...ok, receiverPays: false })).toEqual({ ok: true, value: null });
    expect(settings.isReceiverPayAvailable).not.toHaveBeenCalled();
  });
  it("accepts a cash order, normalises the phone and keeps the percent", async () => {
    expect(await svc.validateBooking(ok)).toEqual({ ok: true, value: { phone: "9876543210", percent: 3 } });
  });
  it("accepts a cash order identified by transaction id", async () => {
    const r = await svc.validateBooking({ ...ok, pMethodId: 5, transactionId: "cash_payment" });
    expect(r.ok).toBe(true);
  });
  it("rejects when the feature is unavailable", async () => {
    settings.isReceiverPayAvailable.mockResolvedValue(false);
    expect(await svc.validateBooking(ok)).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
  });
  it("rejects non-cash orders", async () => {
    expect(await svc.validateBooking({ ...ok, pMethodId: 5, transactionId: "pay_abc" })).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
  });
  it("rejects wallet-paid orders", async () => {
    expect(await svc.validateBooking({ ...ok, pMethodId: -2, transactionId: "wallet_1" })).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
  });
  it("rejects a missing or short receiver number", async () => {
    expect(await svc.validateBooking({ ...ok, dmobile: "" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await svc.validateBooking({ ...ok, dmobile: "12345" })).toMatchObject({ ok: false, code: "VALIDATION" });
  });
  it("rejects a percent above the admin maximum", async () => {
    expect(await svc.validateBooking({ ...ok, commissionPercent: 6 })).toMatchObject({ ok: false, code: "VALIDATION" });
  });
});

describe("receiverPayService.createForOrder / getActiveForOrder / close / getConfig", () => {
  it("creates an active row with the locked percent", async () => {
    prisma.order_receiver_pay.create.mockImplementation(({ data }) => Promise.resolve({ id: 1, ...data }));
    const row = await svc.createForOrder({ orderId: 77, uid: 5, phone: "9876543210", name: "Ramesh", percent: 3 });
    expect(prisma.order_receiver_pay.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ order_id: 77, uid: 5, receiver_phone: "9876543210", receiver_name: "Ramesh", commission_percent: 3, status: "active" }),
    });
    expect(row.id).toBe(1);
  });
  it("getActiveForOrder only returns active rows", async () => {
    prisma.order_receiver_pay.findFirst.mockResolvedValue({ id: 1 });
    await svc.getActiveForOrder(77);
    expect(prisma.order_receiver_pay.findFirst).toHaveBeenCalledWith({ where: { order_id: 77, status: "active" } });
  });
  it("close only moves an active row", async () => {
    prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
    await svc.close(77, "not_applicable");
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({
      where: { order_id: 77, status: "active" },
      data: expect.objectContaining({ status: "closed" }),
    });
  });
  it("getConfig exposes the booker-facing limits", async () => {
    settings.getReceiverPaySettings.mockResolvedValue({ enabled: true, maxPercent: 10, maxAmount: 50, linkTtlHours: 24 });
    expect(await svc.getConfig()).toEqual({ enabled: true, max_percent: 10, max_amount: 50 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/receiverPayService.test.js`
Expected: FAIL, `Cannot find module '../receiverPayService'`.

- [ ] **Step 3: Implement the booking part of the service**

`receiverPayService.js`:
```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("./receiverPaySettings");
const { parseCommissionPercent } = require("./receiverPayCalc");
const { normalizeToLast10Digits } = require("../utils/phone");

class ReceiverPayError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ReceiverPayError";
    this.code = code;
  }
}

const bookingFail = (code, msg) => ({ ok: false, code, msg });

// Same cash test tripLifecycle uses when it decides a settlement is due.
function isCashBooking(pMethodId, transactionId) {
  return Number(pMethodId) === 2 || Number(pMethodId) === 0 || String(transactionId || "").toLowerCase().startsWith("cash");
}

async function validateBooking({ receiverPays, commissionPercent, dmobile, pMethodId, transactionId }) {
  if (!receiverPays) return { ok: true, value: null };
  if (!(await settings.isReceiverPayAvailable())) {
    return bookingFail("RECEIVER_PAY_UNAVAILABLE", "Receiver pays is not available right now.");
  }
  if (!isCashBooking(pMethodId, transactionId)) {
    return bookingFail("RECEIVER_PAY_UNAVAILABLE", "Receiver pays works only with cash orders.");
  }
  const phone = normalizeToLast10Digits(dmobile);
  if (!phone || phone.length !== 10) {
    return bookingFail("VALIDATION", "A valid 10-digit receiver mobile number is required.");
  }
  const { maxPercent } = await settings.getReceiverPaySettings();
  const pct = parseCommissionPercent(commissionPercent, maxPercent);
  if (!pct.ok) return bookingFail("VALIDATION", pct.msg);
  return { ok: true, value: { phone, percent: pct.value } };
}

async function createForOrder({ orderId, uid, phone, name, percent }) {
  const now = new Date();
  return prisma.order_receiver_pay.create({
    data: {
      order_id: orderId,
      uid,
      receiver_phone: phone,
      receiver_name: name ? String(name).slice(0, 100) : null,
      commission_percent: percent,
      status: "active",
      created_at: now,
      updated_at: now,
    },
  });
}

function getActiveForOrder(orderId) {
  return prisma.order_receiver_pay.findFirst({ where: { order_id: orderId, status: "active" } });
}

// Receiver mode turned out not to apply (Monthly/Daily driver, nothing due, settlement
// creation failed): the order proceeds as a normal customer-paid ride.
async function close(orderId, reason) {
  const res = await prisma.order_receiver_pay.updateMany({
    where: { order_id: orderId, status: "active" },
    data: { status: "closed", updated_at: new Date() },
  });
  if (res.count) logger.info(`receiverPay: order ${orderId} closed (${reason})`);
}

async function getConfig() {
  const s = await settings.getReceiverPaySettings();
  const available = await settings.isReceiverPayAvailable();
  return { enabled: available, max_percent: s.maxPercent, max_amount: s.maxAmount };
}

module.exports = { ReceiverPayError, isCashBooking, validateBooking, createForOrder, getActiveForOrder, close, getConfig };
```

Note: `getConfig` test above expects `enabled: true` with `isReceiverPayAvailable` mocked true in `beforeEach`, which matches.

- [ ] **Step 4: Run to verify the service test passes**

Run: `cd backend && npx jest src/services/__tests__/receiverPayService.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing order-controller test**

`orderController.receiverPay.test.js` (header copied from `orderController.test.js`, plus the new service mock):
```js
jest.mock("../../config/db", () => ({
  pkg_order_wait_timer: { findUnique: jest.fn().mockResolvedValue(null) },
  driver_trip_progress: { findUnique: jest.fn().mockResolvedValue(null) },
  order_settlement: { findUnique: jest.fn().mockResolvedValue(null) },
  tbl_package: { findMany: jest.fn() },
  tbl_goods_type: { findFirst: jest.fn() },
  tbl_user: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  tbl_rider: { findUnique: jest.fn() },
  tbl_referral_setting: { findFirst: jest.fn() },
  tbl_referral_point_log: { create: jest.fn() },
  pkg_order: { create: jest.fn(), findFirst: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $transaction: jest.fn(),
}));
jest.mock("../../services/pricingEngine", () => ({
  priceForPackage: jest.fn(),
  getActivePlanDiscount: jest.fn().mockResolvedValue(null),
  getActiveCustomerPlan: jest.fn().mockResolvedValue(null),
  getSlabPricingConfig: jest.fn().mockResolvedValue({ slabRates: {}, modelMultipliers: null }),
  findVehicleSlabConfig: jest.fn().mockReturnValue(null),
  getBodyTypeCharge: jest.fn().mockResolvedValue(0),
  getCoveredBodyCharge: jest.fn().mockResolvedValue(0),
}));
jest.mock("../../services/dispatchManager", () => ({ startDispatch: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../../sockets/adminSocket", () => ({ notifyNewOrder: jest.fn() }));
jest.mock("../../utils/geoDistance", () => ({ getRoadDistanceKm: jest.fn() }));
jest.mock("../../services/orderDestinationService", () => ({ previewDestinationChange: jest.fn(), confirmDestinationChange: jest.fn() }));
jest.mock("../../services/orderPickupService", () => ({ previewPickupChange: jest.fn(), confirmPickupChange: jest.fn() }));
jest.mock("../../services/orderStopsService", () => ({ previewAddStop: jest.fn(), confirmAddStop: jest.fn() }));
jest.mock("../../services/receiverPayService", () => ({ validateBooking: jest.fn(), createForOrder: jest.fn() }));

const prisma = require("../../config/db");
const pricingEngine = require("../../services/pricingEngine");
const receiverPayService = require("../../services/receiverPayService");
const { getRoadDistanceKm } = require("../../utils/geoDistance");
const { createOrderCore, createOrder } = require("../orderController");

const input = {
  uid: 1, category: "Bike", deliveryTypeIds: [6], bookingType: 1, plat: 28.7, plong: 77.1,
  paddress: "A", pickName: "P", pmobile: "999", pickType: "", dlat: 28.8, dlong: 77.2, daddress: "B",
  dropName: "Ramesh", dmobile: "9876543210", dropType: "", packageWeight: "2 Kg", packageCost: 100,
  description: "", pMethodId: 2, transactionId: "", extraMileCharge: 0, couId: 0, couAmt: 0,
  radiusKm: 10, cityId: 2,
};

beforeEach(() => {
  jest.clearAllMocks();
  getRoadDistanceKm.mockResolvedValue({ distanceKm: 5 });
  prisma.tbl_package.findMany.mockResolvedValue([{ id: 6, per_km_charge: 10, sort_order: 1 }]);
  prisma.tbl_user.findUnique.mockResolvedValue({ city_id: 2 });
  pricingEngine.priceForPackage.mockReturnValue({ fare: 50, driverEarning: 40, commission: 5 });
  prisma.pkg_order.create.mockResolvedValue({ id: 777, booking_type: 1 });
  receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: null });
  receiverPayService.createForOrder.mockResolvedValue({ id: 1 });
});

describe("createOrderCore - receiver pays", () => {
  it("refuses the booking when receiver-pay validation fails and creates nothing", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE", msg: "Receiver pays is not available right now." });
    const result = await createOrderCore({ ...input, receiverPays: true, receiverCommissionPercent: 3 });
    expect(result).toMatchObject({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE" });
    expect(prisma.pkg_order.create).not.toHaveBeenCalled();
  });

  it("creates the receiver row with the locked percent and flags the order", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: { phone: "9876543210", percent: 3 } });
    const result = await createOrderCore({ ...input, receiverPays: true, receiverCommissionPercent: 3 });
    expect(receiverPayService.createForOrder).toHaveBeenCalledWith({ orderId: 777, uid: 1, phone: "9876543210", name: "Ramesh", percent: 3 });
    expect(result.order.receiver_pay).toBe(true);
  });

  it("does not touch the receiver service state when not requested", async () => {
    const result = await createOrderCore({ ...input });
    expect(receiverPayService.createForOrder).not.toHaveBeenCalled();
    expect(result.order.receiver_pay).toBeFalsy();
  });

  it("still books the ride (flag false) when the receiver row cannot be written", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: { phone: "9876543210", percent: 3 } });
    receiverPayService.createForOrder.mockRejectedValue(new Error("db down"));
    const result = await createOrderCore({ ...input, receiverPays: true, receiverCommissionPercent: 3 });
    expect(result.ok).toBe(true);
    expect(result.order.receiver_pay).toBe(false);
  });
});

describe("createOrder HTTP handler - receiver pays", () => {
  const body = {
    uid: 1, category: "Bike", delivery_type: [6], booking_type: 1, plat: 28.7, plong: 77.1, paddress: "A",
    pick_name: "P", pmobile: "999", pick_type: "", dlat: 28.8, dlong: 77.2, daddress: "B", drop_name: "Ramesh",
    dmobile: "9876543210", drop_type: "", package_weight: "2 Kg", package_cost: 100, description: "",
    p_method_id: 2, transaction_id: "", extra_mile_charge: 0, cou_id: 0, cou_amt: 0, radius_km: 10, city_id: 2,
  };
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() });

  it("passes the body fields through and returns receiver_pay true", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: true, value: { phone: "9876543210", percent: 3 } });
    const r = res();
    await createOrder({ body: { ...body, receiver_pays: true, receiver_commission_percent: 3 } }, r);
    expect(receiverPayService.validateBooking).toHaveBeenCalledWith(
      expect.objectContaining({ receiverPays: true, commissionPercent: 3, dmobile: "9876543210", pMethodId: 2 })
    );
    expect(r.status).toHaveBeenCalledWith(200);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ order_id: 777, receiver_pay: true }));
  });

  it("maps RECEIVER_PAY_UNAVAILABLE to HTTP 400", async () => {
    receiverPayService.validateBooking.mockResolvedValue({ ok: false, code: "RECEIVER_PAY_UNAVAILABLE", msg: "nope" });
    const r = res();
    await createOrder({ body: { ...body, receiver_pays: true } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/orderController.receiverPay.test.js`
Expected: FAIL (`validateBooking` never called / `receiver_pay` undefined).

- [ ] **Step 7: Wire `orderController.js`**

1. Next to the existing requires add: `const receiverPayService = require("../services/receiverPayService");`
2. In the `createOrderCore({ ... })` destructured params add `receiverPays = false, receiverCommissionPercent,` (after `goodsTypeOther`).
3. Right after the `SETTLEMENT_PENDING` block (after its closing `}` at ~L269) add:
```js
  const receiverPayCheck = await receiverPayService.validateBooking({
    receiverPays, commissionPercent: receiverCommissionPercent, dmobile, pMethodId, transactionId,
  });
  if (!receiverPayCheck.ok) return receiverPayCheck;
```
4. After the stops block (`order.stops = validStops.map(...)` at ~L556) add:
```js
  // Receiver-pay intent row. Never allowed to fail an already-created booking: without it the
  // ride simply runs as a normal customer-paid order and the app is told via receiver_pay=false.
  order.receiver_pay = false;
  if (receiverPayCheck.value) {
    try {
      await receiverPayService.createForOrder({
        orderId: order.id, uid: Number(uid), phone: receiverPayCheck.value.phone, name: dropName, percent: receiverPayCheck.value.percent,
      });
      order.receiver_pay = true;
    } catch (err) {
      logger.error(`createOrderCore: receiver-pay row failed for order ${order.id}:`, err);
    }
  }
```
5. In `createOrder`: add `receiver_pays, receiver_commission_percent,` to the `req.body` destructuring; pass `receiverPays: Boolean(receiver_pays), receiverCommissionPercent: receiver_commission_percent,` into the `createOrderCore({...})` call; add before the `SETTLEMENT_PENDING` mapping:
```js
    if (!result.ok && result.code === "RECEIVER_PAY_UNAVAILABLE") {
      return res.status(400).json({ ResponseCode: "400", Result: "false", code: "RECEIVER_PAY_UNAVAILABLE", ResponseMsg: result.msg });
    }
```
and add `receiver_pay: Boolean(order.receiver_pay),` to the 200 JSON (next to `covered_charge`).

- [ ] **Step 8: Add the receiver line to the booked WhatsApp message**

In `notifications.js` `notifyOrderBooked`, after `const { order, categoryTitle, ... } = data;` add:
```js
  let receiverPayLine = "";
  try {
    const rp = await prisma.order_receiver_pay.findFirst({ where: { order_id: order.id, status: "active" } });
    if (rp) {
      receiverPayLine =
        `💳 *${senderName}* ne aapko payment karne wala (payer) chuna hai. ` +
        `Delivery ke baad aapko ek secure payment link bheja jayega, usme app ki zaroorat nahi hai. ` +
        `Agar aap pay nahi karna chahte, to link me *Decline* dabayein.\n\n`;
    }
  } catch (err) {
    logger.warn(`notifyOrderBooked: receiver-pay lookup failed for order ${order.id}: ${err.message}`);
  }
```
and in `receiverMsg` put `receiverPayLine +` immediately before the `Parcel live status check karne ke liye ...` line. (`prisma` and `logger` are already required in this file; confirm with `grep -n "require" backend/src/whatsapp/notifications.js` and add them if missing.)

- [ ] **Step 9: Add the booker config endpoint**

In `settlementController.js` add (the file already exports the controller object):
```js
const receiverPayService = require("../services/receiverPayService");

const receiverPayConfig = async (req, res) => {
  try {
    return ok(res, { config: await receiverPayService.getConfig() });
  } catch (err) {
    return handleError(res, err, "receiverPayConfig");
  }
};
```
export it, and in `orderRoutes.js` add `router.get("/receiver-pay/config", settlementController.receiverPayConfig);` next to the other `/settlement/*` routes.

- [ ] **Step 10: Run the affected suites**

Run: `cd backend && npx jest src/controllers/__tests__/orderController.receiverPay.test.js src/controllers/__tests__/orderController.test.js src/services/__tests__/receiverPayService.test.js src/whatsapp`
Expected: PASS. If a WhatsApp notification test mocks `config/db` without `order_receiver_pay`, add `order_receiver_pay: { findFirst: jest.fn().mockResolvedValue(null) }` to that mock (the lookup is wrapped in try/catch, so a missing model only logs a warning).

- [ ] **Step 11: Commit**

```bash
git add backend/src/services/receiverPayService.js backend/src/services/__tests__/receiverPayService.test.js backend/src/controllers/orderController.js backend/src/controllers/__tests__/orderController.receiverPay.test.js backend/src/whatsapp/notifications.js backend/src/controllers/settlementController.js backend/src/routes/orderRoutes.js
git commit -m "feat(receiver-pay): booking fields, validation, receiver row and config endpoint

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Settlement receiver mode and booker wallet credits

**Files:**
- Create: `backend/src/services/receiverWalletCredits.js`
- Modify: `backend/src/services/settlementService.js` (`publicView` L49-64, `runTransition` L196-209, `createForCompletedOrder` L211-248, `markCashReceived` L269-288, `chooseDriverPayment` L292-305, `adminResolve` L340-365, `createOnlineOrder` L367-400, `settleOnline` L402-461)
- Test: `backend/src/services/__tests__/receiverWalletCredits.test.js`, `backend/src/services/__tests__/settlementReceiverMode.test.js`

**Interfaces:**
- Produces (`receiverWalletCredits.js`), all taking the Prisma transaction client `tx` and the *locked settlement row* `s`:
  - `applyReceiverCredits(tx, s, { includeMarkup: boolean, notifications: Array }): Promise<{ advance: number, markup: number }>`
  - `reverseReceiverCredits(tx, s, { notifications }): Promise<{ shortfall: number }>`
  - `markReceiverRow(tx, orderId, status: 'paid' | 'closed'): Promise<void>` (only moves an `active` row)
  - `adminOutcomePatch(tx, s, outcome, { notifications }): Promise<object>` - fields to merge into the settlement update (`{}` for non-receiver settlements)
- `settlementService.createForCompletedOrder` gains optional `receiver: { markup: number, advanceHeld: number }`; when present the row is created with `payer: 'receiver'`, `receiver_markup`, `advance_held`.
- `publicView` adds `payer`, `receiver_markup`, `advance_held`, `receiver_pay_total`.
- Notification entries pushed in transactions may now be `{ userId, type, amount, remark }`; `runTransition` sends them via `walletNotifier.notifyCustomerWalletTransaction(userId, { type, amount, remark })`.
- New error code `RECEIVER_MODE` (`SettlementError`) when the booker tries `chooseDriverPayment` / `createOnlineOrder` / `settleOnline` on a receiver-mode settlement.

- [ ] **Step 1: Write the failing wallet-credits test**

`receiverWalletCredits.test.js`:
```js
jest.mock("../../utils/istTime", () => ({ istNow: () => new Date("2026-10-05T10:00:00Z") }));

const credits = require("../receiverWalletCredits");

function makeTx({ wallet = 100, duplicates = [] } = {}) {
  const tx = {
    tbl_wallet_history: {
      findFirst: jest.fn(({ where }) => Promise.resolve(duplicates.includes(where.payment_id) ? { id: 1 } : null)),
      create: jest.fn().mockResolvedValue({}),
    },
    tbl_user: { update: jest.fn().mockResolvedValue({}), findUnique: jest.fn().mockResolvedValue({ wallet }) },
    order_receiver_pay: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  return tx;
}
const s = (o = {}) => ({
  id: 4, order_id: 50, uid: 7, payer: "receiver", amount_due: 90, prepaid_amount: 10,
  advance_held: 20, receiver_markup: 2.7, receiver_credited: false, reversal_shortfall: 0, effect_seq: 1, ...o,
});

describe("applyReceiverCredits", () => {
  it("credits the advance refund and the commission (online)", async () => {
    const tx = makeTx(); const notifications = [];
    const out = await credits.applyReceiverCredits(tx, s(), { includeMarkup: true, notifications });
    expect(out).toEqual({ advance: 20, markup: 2.7 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    const keys = tx.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id);
    expect(keys).toEqual(["receiver_advance_refund:4", "receiver_markup_credit:4"]);
    expect(tx.tbl_wallet_history.create.mock.calls[1][0].data).toMatchObject({
      type: "credit", wallet_type: "user", user_id: 7, order_id: 50, remark: "Receiver commission for order #50",
    });
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({ userId: 7, type: "credit", amount: 20 });
  });
  it("cash: credits only the advance refund", async () => {
    const tx = makeTx(); const notifications = [];
    const out = await credits.applyReceiverCredits(tx, s(), { includeMarkup: false, notifications });
    expect(out).toEqual({ advance: 20, markup: 0 });
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
  });
  it("advance 0 (no-advance plan / wallet-paid) writes no refund row", async () => {
    const tx = makeTx();
    await credits.applyReceiverCredits(tx, s({ advance_held: 0 }), { includeMarkup: true, notifications: [] });
    const keys = tx.tbl_wallet_history.create.mock.calls.map(([a]) => a.data.payment_id);
    expect(keys).toEqual(["receiver_markup_credit:4"]);
  });
  it("is idempotent: an existing key is skipped", async () => {
    const tx = makeTx({ duplicates: ["receiver_advance_refund:4", "receiver_markup_credit:4"] });
    await credits.applyReceiverCredits(tx, s(), { includeMarkup: true, notifications: [] });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
});

describe("reverseReceiverCredits", () => {
  it("debits what was credited when the wallet still has it", async () => {
    const tx = makeTx({ wallet: 100 });
    const out = await credits.reverseReceiverCredits(tx, s(), { notifications: [] });
    expect(out).toEqual({ shortfall: 0 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 20 } } });
  });
  it("never drives the wallet negative: caps at the balance and reports the shortfall", async () => {
    const tx = makeTx({ wallet: 5 });
    const out = await credits.reverseReceiverCredits(tx, s({ advance_held: 20, receiver_markup: 0 }), { notifications: [] });
    expect(out).toEqual({ shortfall: 15 });
    expect(tx.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { decrement: 5 } } });
  });
  it("an empty wallet debits nothing and reports the full shortfall", async () => {
    const tx = makeTx({ wallet: 0 });
    const out = await credits.reverseReceiverCredits(tx, s({ advance_held: 20, receiver_markup: 0 }), { notifications: [] });
    expect(out).toEqual({ shortfall: 20 });
    expect(tx.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("adminOutcomePatch", () => {
  it("is a no-op for a normal (customer) settlement", async () => {
    expect(await credits.adminOutcomePatch(makeTx(), s({ payer: "customer" }), "paid_online", { notifications: [] })).toEqual({});
  });
  it("paid_online credits advance + commission and marks credited", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "paid_online", { notifications: [] });
    expect(patch).toEqual({ receiver_credited: true });
    expect(tx.order_receiver_pay.updateMany).toHaveBeenCalledWith({ where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "paid" }) });
  });
  it("cash_received credits the advance only and zeroes the markup", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "cash_received", { notifications: [] });
    expect(patch).toEqual({ receiver_credited: true, receiver_markup: 0 });
    expect(tx.tbl_wallet_history.create).toHaveBeenCalledTimes(1);
  });
  it("does not credit twice when already credited", async () => {
    const tx = makeTx();
    expect(await credits.adminOutcomePatch(tx, s({ receiver_credited: true }), "paid_online", { notifications: [] })).toEqual({});
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
  it("waived converts to customer mode: advance consumed against the amount, nothing credited", async () => {
    const tx = makeTx();
    const patch = await credits.adminOutcomePatch(tx, s(), "waived", { notifications: [] });
    expect(patch).toEqual({
      payer: "customer", amount_due: 70, prepaid_amount: 30, receiver_markup: 0, receiver_credited: false, reversal_shortfall: 0,
    });
    expect(tx.tbl_wallet_history.create).not.toHaveBeenCalled();
  });
  it("waived after a credited payment reverses the credits and records the shortfall", async () => {
    const tx = makeTx({ wallet: 0 });
    const patch = await credits.adminOutcomePatch(tx, s({ receiver_credited: true, receiver_markup: 0 }), "customer_owes", { notifications: [] });
    expect(patch).toMatchObject({ payer: "customer", receiver_credited: false, reversal_shortfall: 20 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/receiverWalletCredits.test.js`
Expected: FAIL, `Cannot find module '../receiverWalletCredits'`.

- [ ] **Step 3: Implement `receiverWalletCredits.js`**

```js
const { istNow } = require("../utils/istTime");

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// All helpers run inside a settlement transaction (`tx`) with the settlement row already
// locked FOR UPDATE; the find-then-create idempotency below is only safe under that lock.

async function creditBooker(tx, { uid, orderId, amount, key, remark, notifications }) {
  const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
  if (duplicate) return false;
  await tx.tbl_user.update({ where: { id: uid }, data: { wallet: { increment: amount } } });
  await tx.tbl_wallet_history.create({
    data: { user_id: uid, amount, type: "credit", remark, wallet_type: "user", order_id: orderId, payment_id: key, created_at: istNow() },
  });
  notifications.push({ userId: uid, type: "credit", amount, remark });
  return true;
}

// Debits at most the wallet's available balance (it must never go negative) and returns the
// part that could not be taken back.
async function debitBookerCapped(tx, { uid, orderId, amount, key, remark, notifications }) {
  const duplicate = await tx.tbl_wallet_history.findFirst({ where: { payment_id: key, wallet_type: "user" } });
  if (duplicate) return 0;
  const user = await tx.tbl_user.findUnique({ where: { id: uid }, select: { wallet: true } });
  const available = Math.max(0, round2(user?.wallet));
  const debit = Math.min(available, round2(amount));
  if (debit > 0) {
    await tx.tbl_user.update({ where: { id: uid }, data: { wallet: { decrement: debit } } });
    await tx.tbl_wallet_history.create({
      data: { user_id: uid, amount: debit, type: "debit", remark, wallet_type: "user", order_id: orderId, payment_id: key, created_at: istNow() },
    });
    notifications.push({ userId: uid, type: "debit", amount: debit, remark });
  }
  return round2(amount - debit);
}

async function applyReceiverCredits(tx, s, { includeMarkup, notifications }) {
  const advance = round2(s.advance_held);
  const markup = includeMarkup ? round2(s.receiver_markup) : 0;
  if (advance > 0) {
    await creditBooker(tx, {
      uid: s.uid, orderId: s.order_id, amount: advance, key: `receiver_advance_refund:${s.id}`,
      remark: `Advance refunded - receiver paid for order #${s.order_id}`, notifications,
    });
  }
  if (markup > 0) {
    await creditBooker(tx, {
      uid: s.uid, orderId: s.order_id, amount: markup, key: `receiver_markup_credit:${s.id}`,
      remark: `Receiver commission for order #${s.order_id}`, notifications,
    });
  }
  return { advance, markup };
}

async function reverseReceiverCredits(tx, s, { notifications }) {
  let shortfall = 0;
  const advance = round2(s.advance_held);
  const markup = round2(s.receiver_markup);
  if (advance > 0) {
    shortfall += await debitBookerCapped(tx, {
      uid: s.uid, orderId: s.order_id, amount: advance, key: `receiver_advance_refund_rev:${s.id}:${s.effect_seq}`,
      remark: `Reversal: advance refund for order #${s.order_id}`, notifications,
    });
  }
  if (markup > 0) {
    shortfall += await debitBookerCapped(tx, {
      uid: s.uid, orderId: s.order_id, amount: markup, key: `receiver_markup_credit_rev:${s.id}:${s.effect_seq}`,
      remark: `Reversal: receiver commission for order #${s.order_id}`, notifications,
    });
  }
  return { shortfall: round2(shortfall) };
}

async function markReceiverRow(tx, orderId, status) {
  await tx.order_receiver_pay.updateMany({
    where: { order_id: orderId, status: "active" },
    data: { status, updated_at: new Date() },
  });
}

// Extra settlement fields an admin outcome implies for a receiver-mode settlement.
//  - cash_received / paid_online: the receiver did pay, so credit the booker (once).
//  - waived / customer_owes: the receiver did not pay, so the advance is consumed against the
//    fare and the settlement becomes a normal customer one (any earlier credits are reversed,
//    capped at the available balance; the uncollected part is recorded as reversal_shortfall).
async function adminOutcomePatch(tx, s, outcome, { notifications }) {
  if (s.payer !== "receiver") return {};
  if (outcome === "cash_received" || outcome === "paid_online") {
    if (s.receiver_credited) return {};
    await applyReceiverCredits(tx, s, { includeMarkup: outcome === "paid_online", notifications });
    await markReceiverRow(tx, s.order_id, "paid");
    return { receiver_credited: true, ...(outcome === "cash_received" ? { receiver_markup: 0 } : {}) };
  }
  let shortfall = 0;
  if (s.receiver_credited) ({ shortfall } = await reverseReceiverCredits(tx, s, { notifications }));
  await markReceiverRow(tx, s.order_id, "closed");
  const advance = round2(s.advance_held);
  return {
    payer: "customer",
    amount_due: round2(Math.max(0, Number(s.amount_due) - advance)),
    prepaid_amount: round2(Number(s.prepaid_amount) + advance),
    receiver_markup: 0,
    receiver_credited: false,
    reversal_shortfall: round2(Number(s.reversal_shortfall || 0) + shortfall),
  };
}

module.exports = { applyReceiverCredits, reverseReceiverCredits, markReceiverRow, adminOutcomePatch };
```

- [ ] **Step 4: Run to verify the credits test passes**

Run: `cd backend && npx jest src/services/__tests__/receiverWalletCredits.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing settlement receiver-mode test**

`settlementReceiverMode.test.js`:
```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn(), findFirst: jest.fn(), findMany: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  order_receiver_pay: { updateMany: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  tbl_rider: { update: jest.fn() },
  tbl_user: { update: jest.fn(), findUnique: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({
  notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined),
  notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: jest.fn() }) }) }));

const prisma = require("../../config/db");
const walletNotifier = require("../walletNotifier");
const svc = require("../settlementService");

const row = (o = {}) => ({
  id: 4, order_id: 50, uid: 7, rid: 9, amount_due: 90, fare: 100, commission_amount: 10, per_trip_charge: 0,
  prepaid_amount: 10, status: "pending", method: null, wallet_effect: "none", effect_seq: 0,
  payer: "receiver", receiver_markup: 2.7, advance_held: 20, receiver_credited: false, reversal_shortfall: 0,
  pending_since: new Date("2026-10-05T10:00:00Z"), created_at: new Date(), updated_at: new Date(), ...o,
});

function setup(current) {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: current.id }]);
  prisma.order_settlement.findUnique.mockResolvedValue(current);
  prisma.order_settlement.update.mockImplementation(({ data }) => Promise.resolve({ ...current, ...data }));
  prisma.order_settlement_event.create.mockResolvedValue({});
  prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
  prisma.tbl_user.update.mockResolvedValue({});
  prisma.tbl_user.findUnique.mockResolvedValue({ wallet: 100 });
}

describe("createForCompletedOrder - receiver mode", () => {
  const payload = { orderId: 50, uid: 7, riderId: 9, amountDue: 90, fare: 100, commissionAmount: 10, perTripCharge: 0, prepaidAmount: 10 };
  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    prisma.order_settlement.create.mockImplementation(({ data }) => Promise.resolve({ id: 3, ...data }));
    prisma.order_settlement_event.create.mockResolvedValue({});
  });
  it("stores payer, markup and the held advance", async () => {
    await svc.createForCompletedOrder({ ...payload, receiver: { markup: 2.7, advanceHeld: 20 } });
    expect(prisma.order_settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payer: "receiver", receiver_markup: 2.7, advance_held: 20, amount_due: 90, prepaid_amount: 10 }),
    });
  });
  it("normal mode keeps payer=customer and zero receiver fields", async () => {
    await svc.createForCompletedOrder(payload);
    expect(prisma.order_settlement.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ payer: "customer", receiver_markup: 0, advance_held: 0 }),
    });
  });
});

describe("publicView", () => {
  it("exposes what the receiver owes in total", () => {
    const v = svc.publicView(row());
    expect(v).toMatchObject({ payer: "receiver", receiver_markup: 2.7, advance_held: 20, receiver_pay_total: 92.7 });
  });
  it("customer mode total equals amount_due", () => {
    expect(svc.publicView(row({ payer: "customer", receiver_markup: 0, advance_held: 0 })).receiver_pay_total).toBe(90);
  });
});

describe("markCashReceived - receiver mode", () => {
  it("refunds the advance to the booker, zeroes the markup and marks the receiver row paid", async () => {
    setup(row());
    const { settlement } = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(settlement.status).toBe("cash_received");
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_user.update).not.toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: expect.objectContaining({ receiver_credited: true, receiver_markup: 0, status: "cash_received" }),
    });
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({ where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "paid" }) });
    expect(walletNotifier.notifyCustomerWalletTransaction).toHaveBeenCalledWith(7, expect.objectContaining({ type: "credit", amount: 20 }));
  });
  it("a normal customer settlement is untouched (no booker wallet writes)", async () => {
    setup(row({ payer: "customer", receiver_markup: 0, advance_held: 0 }));
    await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.order_receiver_pay.updateMany).not.toHaveBeenCalled();
  });
  it("tapping Received twice does not credit twice", async () => {
    setup(row({ status: "cash_received", receiver_credited: true }));
    const out = await svc.markCashReceived({ orderId: 50, riderId: 9 });
    expect(out.alreadyDone).toBe(true);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
});

describe("adminResolve - receiver mode", () => {
  it("paid_online credits the booker once", async () => {
    setup(row());
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "paid_online", note: "verified" });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
  });
  it("waived converts to customer mode with the advance netted and no booker credit", async () => {
    setup(row());
    await svc.adminResolve({ settlementId: 4, adminId: 1, outcome: "waived", note: "goodwill" });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 4 }, data: expect.objectContaining({ payer: "customer", amount_due: 70, prepaid_amount: 30, receiver_markup: 0, status: "waived" }),
    });
  });
});

describe("booker cannot pay itself while the receiver is the payer", () => {
  it("chooseDriverPayment is refused with RECEIVER_MODE", async () => {
    setup(row());
    await expect(svc.chooseDriverPayment({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "RECEIVER_MODE" });
  });
  it("createOnlineOrder is refused with RECEIVER_MODE", async () => {
    setup(row());
    await expect(svc.createOnlineOrder({ orderId: 50, uid: 7 })).rejects.toMatchObject({ code: "RECEIVER_MODE" });
  });
  it("settleOnline is refused with RECEIVER_MODE", async () => {
    setup(row());
    await expect(svc.settleOnline({ orderId: 50, uid: 7, paymentId: "p", razorpayOrderId: "o", signature: "s" })).rejects.toMatchObject({ code: "RECEIVER_MODE" });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/settlementReceiverMode.test.js`
Expected: FAIL (payer fields not stored, no booker credits, no `RECEIVER_MODE`).

- [ ] **Step 7: Modify `settlementService.js`**

1. Add near the top requires: `const receiverWalletCredits = require("./receiverWalletCredits");`
2. Add after `stateMessage`:
```js
function assertCustomerPaysItself(s) {
  if (s.payer === "receiver") {
    throw new SettlementError("RECEIVER_MODE", "The receiver is paying for this order. Take over the payment first.");
  }
}
```
3. In `publicView` add before the closing `};`:
```js
    payer: s.payer || "customer",
    receiver_markup: Number(s.receiver_markup || 0),
    advance_held: Number(s.advance_held || 0),
    receiver_pay_total: round2(Number(s.amount_due) + (s.payer === "receiver" ? Number(s.receiver_markup || 0) : 0)),
```
4. In `runTransition`'s notification loop, replace the body of the `try` with:
```js
      const send = n.userId
        ? walletNotifier.notifyCustomerWalletTransaction(n.userId, { type: n.type, amount: n.amount, remark: n.remark })
        : walletNotifier.notifyDriverWalletTransaction(n.riderId, { type: n.type, amount: n.amount, remark: n.remark });
      Promise.resolve(send).catch((err) => logger.error(`settlement wallet notify failed for ${n.userId ? `user ${n.userId}` : `rider ${n.riderId}`}:`, err));
```
(keep the surrounding `try { ... } catch (err) { logger.error(...) }`).
5. `createForCompletedOrder`: add `receiver = null` to the destructured params; add to the `create` data: `payer: receiver ? "receiver" : "customer", receiver_markup: receiver ? round2(receiver.markup) : 0, advance_held: receiver ? round2(receiver.advanceHeld) : 0,`; change the event note to `receiver ? "Ride completed; awaiting receiver payment" : "Ride completed; awaiting payment"`.
6. `markCashReceived`: after `const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, EFFECT.CASH); notifications.push(...n);` add:
```js
    const receiverPatch = {};
    if (s.payer === "receiver") {
      await receiverWalletCredits.applyReceiverCredits(tx, s, { includeMarkup: false, notifications });
      await receiverWalletCredits.markReceiverRow(tx, s.order_id, "paid");
      Object.assign(receiverPatch, { receiver_credited: true, receiver_markup: 0 });
    }
```
and spread `...receiverPatch,` into that update's `data`.
7. `chooseDriverPayment`: after `assertParty(s, "customer", uid);` add `assertCustomerPaysItself(s);`. `createOnlineOrder`: after `assertParty(s, "customer", uid);` add `assertCustomerPaysItself(s);`. `settleOnline`: after `assertParty(pre, "customer", uid);` add `assertCustomerPaysItself(pre);` (the `alreadyDone` early-return on `PAID_ONLINE` stays below it only if the settlement is customer mode; receiver-mode settlements never reach it).
8. `adminResolve`: after `if (s.status === outcome) return { settlement: s, alreadyDone: true };` and before `changeWalletEffect`, add:
```js
    const receiverPatch = await receiverWalletCredits.adminOutcomePatch(tx, s, outcome, { notifications });
```
and spread `...receiverPatch,` into the `update` data **after** the other fields so `amount_due` / `prepaid_amount` overrides apply. Important: pass the *patched* row to the driver-effect calculation: change the effect call to
```js
    const effectRow = { ...s, ...receiverPatch };
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, effectRow, OUTCOME_EFFECT[outcome]);
```
(`effectOps` reads `prepaid_amount`, so a converted settlement must use the advance-netted prepaid).

- [ ] **Step 8: Run to verify the new and existing settlement suites pass**

Run: `cd backend && npx jest src/services/__tests__/settlementReceiverMode.test.js src/services/__tests__/receiverWalletCredits.test.js src/services/__tests__/settlementService.test.js src/controllers/__tests__/settlementController.test.js src/controllers/__tests__/adminSettlementController.test.js`
Expected: PASS. If an existing `publicView` assertion uses exact `toEqual`, add the four new fields (`payer: "customer"`, `receiver_markup: 0`, `advance_held: 0`, `receiver_pay_total: <amount_due>`) to its expectation. If the existing `settlementService.test.js` walletNotifier mock lacks `notifyCustomerWalletTransaction`, add it as `jest.fn().mockResolvedValue(undefined)`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/receiverWalletCredits.js backend/src/services/settlementService.js backend/src/services/__tests__/receiverWalletCredits.test.js backend/src/services/__tests__/settlementReceiverMode.test.js backend/src/services/__tests__/settlementService.test.js
git commit -m "feat(receiver-pay): receiver-mode settlements and booker wallet credits

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Completion hook and pay-link issue

**Files:**
- Modify: `backend/src/services/receiverPayService.js` (add `buildPayLink`, `buildLinkMessage`, `issueLink`)
- Modify: `backend/src/services/tripLifecycle.js` (requires near L20-21; settlement block L626-668)
- Test: extend `backend/src/services/__tests__/receiverPayService.test.js`; extend `backend/src/services/__tests__/tripLifecycleSettlement.test.js`

**Interfaces:**
- Consumes: `receiverPayToken.mintToken`, `receiverPayCalc.receiverPayable/computeMarkup`, `receiverPaySettings.getReceiverPaySettings`, `notifications.sendWhatsAppNotification` (lazy-required), `ReceiverPayError`.
- Produces:
  - `receiverPayService.issueLink({ orderId, resend = false }): Promise<{ sent: boolean, link: string }>`; throws `ReceiverPayError` with code `NOT_ACTIVE | NOT_PAYABLE | NOT_CONFIGURED | TOO_SOON | LINK_LIMIT`. Every call mints a fresh token, so an older link stops working.
  - `receiverPayService.buildPayLink(token): string` = `${PUBLIC_BASE_URL}/pay/${token}`.
  - At completion `tripLifecycle` passes `receiver: { markup, advanceHeld }` to `createForCompletedOrder` only in receiver mode (key omitted otherwise).

- [ ] **Step 1: Write the failing `issueLink` tests**

Append to `receiverPayService.test.js` (extend the db mock with `order_settlement: { findUnique: jest.fn() }` and `order_receiver_pay.update: jest.fn()`; add `jest.mock("../../whatsapp/notifications", () => ({ sendWhatsAppNotification: jest.fn() }));` at the top):

```js
const notifications = require("../../whatsapp/notifications");

describe("receiverPayService.issueLink", () => {
  const rpRow = (o = {}) => ({ id: 1, order_id: 77, status: "active", receiver_phone: "9876543210", link_sent_at: null, link_send_count: 0, ...o });
  const settlementRow = (o = {}) => ({ id: 4, order_id: 77, payer: "receiver", status: "pending", amount_due: 90, receiver_markup: 2.7, ...o });

  beforeEach(() => {
    process.env.PUBLIC_BASE_URL = "https://api.example.test";
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow());
    prisma.order_settlement.findUnique.mockResolvedValue(settlementRow());
    prisma.order_receiver_pay.update.mockResolvedValue({});
    notifications.sendWhatsAppNotification.mockResolvedValue(true);
  });
  afterAll(() => { delete process.env.PUBLIC_BASE_URL; });

  it("stores only the token hash + expiry, WhatsApps the link with the exact breakup", async () => {
    const { sent, link } = await svc.issueLink({ orderId: 77 });
    const token = link.replace("https://api.example.test/pay/", "");
    const data = prisma.order_receiver_pay.update.mock.calls[0][0].data;
    expect(data.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.token_hash).not.toContain(token);
    expect(data.token_expires_at.getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    expect(data.link_send_count).toEqual({ increment: 1 });
    const [phone, text] = notifications.sendWhatsAppNotification.mock.calls[0];
    expect(phone).toBe("9876543210");
    expect(text).toContain("92.70");
    expect(text).toContain(link);
    expect(sent).toBe(true);
  });
  it("reports sent=false (but still returns the link) when WhatsApp is not ready", async () => {
    notifications.sendWhatsAppNotification.mockResolvedValue(false);
    const out = await svc.issueLink({ orderId: 77 });
    expect(out.sent).toBe(false);
    expect(out.link).toContain("/pay/");
  });
  it("refuses when the receiver row is not active", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ status: "declined" }));
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_ACTIVE" });
  });
  it("refuses when the settlement is not a pending receiver settlement", async () => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlementRow({ status: "paid_online" }));
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
    prisma.order_settlement.findUnique.mockResolvedValue(settlementRow({ payer: "customer" }));
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_PAYABLE" });
  });
  it("refuses when PUBLIC_BASE_URL is not configured", async () => {
    delete process.env.PUBLIC_BASE_URL;
    await expect(svc.issueLink({ orderId: 77 })).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
  it("resend is rate limited to once a minute and capped at 10", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ link_sent_at: new Date(Date.now() - 10 * 1000), link_send_count: 1 }));
    await expect(svc.issueLink({ orderId: 77, resend: true })).rejects.toMatchObject({ code: "TOO_SOON" });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ link_sent_at: new Date(Date.now() - 120 * 1000), link_send_count: 10 }));
    await expect(svc.issueLink({ orderId: 77, resend: true })).rejects.toMatchObject({ code: "LINK_LIMIT" });
    prisma.order_receiver_pay.findUnique.mockResolvedValue(rpRow({ link_sent_at: new Date(Date.now() - 120 * 1000), link_send_count: 1 }));
    await expect(svc.issueLink({ orderId: 77, resend: true })).resolves.toMatchObject({ sent: true });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/receiverPayService.test.js`
Expected: FAIL (`svc.issueLink is not a function`).

- [ ] **Step 3: Implement link issue**

In `receiverPayService.js` add requires `const { mintToken } = require("./receiverPayToken");` and `const { receiverPayable } = require("./receiverPayCalc");` (extend the existing calc import), then:

```js
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_LINK_SENDS = 10;

function buildPayLink(token) {
  const base = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  return `${base}/pay/${token}`;
}

function buildLinkMessage({ orderId, amountDue, markup, total, link }) {
  const money = (n) => Number(n).toFixed(2);
  const breakup = markup > 0
    ? `Fare (discount ke baad): ₹${money(amountDue)}\nService fee: ₹${money(markup)}\n*Total: ₹${money(total)}*`
    : `*Total: ₹${money(total)}*`;
  return (
    `Hello! 👋\n` +
    `Order *#${orderId}* ki delivery complete ho gayi hai. Is order ka payment aapko karna hai. 💳\n\n` +
    `${breakup}\n\n` +
    `Secure payment link (app ki zaroorat nahi):\n${link}\n\n` +
    `Agar aap pay nahi karna chahte, to link me *Decline* dabayein.\n\n` +
    `— *Team Shifter Online*\n📞 Customer Care: 9109114515`
  );
}

// Mints a fresh token on every call, so a resend invalidates the previous link.
async function issueLink({ orderId, resend = false }) {
  const row = await prisma.order_receiver_pay.findUnique({ where: { order_id: orderId } });
  if (!row || row.status !== "active") throw new ReceiverPayError("NOT_ACTIVE", "Receiver payment is not active for this order.");
  const settlement = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!settlement || settlement.payer !== "receiver" || settlement.status !== "pending") {
    throw new ReceiverPayError("NOT_PAYABLE", "There is nothing for the receiver to pay on this order.");
  }
  if (!process.env.PUBLIC_BASE_URL) {
    logger.error("receiverPay.issueLink: PUBLIC_BASE_URL is not configured; cannot build a pay link.");
    throw new ReceiverPayError("NOT_CONFIGURED", "Payment link is not available right now.");
  }
  const now = new Date();
  if (resend) {
    if (row.link_send_count >= MAX_LINK_SENDS) throw new ReceiverPayError("LINK_LIMIT", "The link was already sent too many times.");
    if (row.link_sent_at && now.getTime() - new Date(row.link_sent_at).getTime() < RESEND_COOLDOWN_MS) {
      throw new ReceiverPayError("TOO_SOON", "Please wait a minute before sending the link again.");
    }
  }
  const { linkTtlHours } = await settings.getReceiverPaySettings();
  const { token, hash } = mintToken();
  await prisma.order_receiver_pay.update({
    where: { id: row.id },
    data: {
      token_hash: hash,
      token_expires_at: new Date(now.getTime() + linkTtlHours * 3600 * 1000),
      link_sent_at: now,
      link_send_count: { increment: 1 },
      updated_at: now,
    },
  });
  const link = buildPayLink(token);
  const total = receiverPayable(settlement.amount_due, settlement.receiver_markup);
  // Lazy require: whatsapp/notifications pulls in the WhatsApp client; keep it out of module load.
  const { sendWhatsAppNotification } = require("../whatsapp/notifications");
  const sent = await sendWhatsAppNotification(
    row.receiver_phone,
    buildLinkMessage({ orderId, amountDue: Number(settlement.amount_due), markup: Number(settlement.receiver_markup), total, link })
  );
  if (!sent) logger.warn(`receiverPay.issueLink: WhatsApp not delivered for order ${orderId}; link must be resent or shared.`);
  return { sent: Boolean(sent), link };
}
```
and add `buildPayLink, buildLinkMessage, issueLink` to `module.exports`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/receiverPayService.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing completion-hook tests**

In `tripLifecycleSettlement.test.js`: add these mocks next to the other `jest.mock` calls (before the `require`s):
```js
jest.mock("../receiverPayService", () => ({ getActiveForOrder: jest.fn().mockResolvedValue(null), issueLink: jest.fn().mockResolvedValue({ sent: true }), close: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../receiverPaySettings", () => ({ getReceiverPaySettings: jest.fn().mockResolvedValue({ enabled: true, maxPercent: 5, maxAmount: 0, linkTtlHours: 24 }) }));
```
add `const receiverPayService = require("../receiverPayService");` after the other requires, reset in `beforeEach`: `receiverPayService.getActiveForOrder.mockResolvedValue(null);`, and append inside the `describe`:

```js
  describe("receiver mode", () => {
    const rpRow = { id: 3, order_id: 297, commission_percent: "3.00", status: "active" };

    it("does not net the advance, passes markup + held advance, keeps the advance debit, and issues the link", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order({ referral_points_amount: 10, cou_amt: 5 }));
      prisma.$queryRaw.mockResolvedValue([{ advance_payment: 15 }]);
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountDue: 85, prepaidAmount: 15, receiver: { markup: 2.55, advanceHeld: 15 } })
      );
      expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { wallet: { decrement: 15 } } });
      expect(receiverPayService.issueLink).toHaveBeenCalledWith({ orderId: 297 });
    });

    it("advance 0: held advance is 0 and the full amount is due", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountDue: 100, prepaidAmount: 0, receiver: { markup: 3, advanceHeld: 0 } })
      );
    });

    it("advance larger than the amount: the held advance is only what was actually applied", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      prisma.$queryRaw.mockResolvedValue([{ advance_payment: 150 }]);
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).toHaveBeenCalledWith(
        expect.objectContaining({ amountDue: 100, receiver: expect.objectContaining({ advanceHeld: 100 }) })
      );
    });

    it("a normal ride never carries a receiver key", async () => {
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder.mock.calls[0][0]).not.toHaveProperty("receiver");
      expect(receiverPayService.issueLink).not.toHaveBeenCalled();
    });

    it("Monthly Driver: receiver row is closed and the ride runs the normal way", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.tbl_rider.findUnique.mockResolvedValue({ id: 1, monthly_plan: 1 });
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      await tripLifecycle.updateStatus(297, 1, "complete");
      expect(settlementService.createForCompletedOrder).not.toHaveBeenCalled();
      expect(receiverPayService.close).toHaveBeenCalledWith(297, "not_applicable");
    });

    it("settlement creation failure closes the receiver row and falls back to the legacy path", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      settlementService.createForCompletedOrder.mockRejectedValue(new Error("db down"));
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toEqual({ success: true, order_status: 5, o_status: "Completed" });
      expect(receiverPayService.close).toHaveBeenCalledWith(297, "not_applicable");
    });

    it("a link failure never fails the completed ride", async () => {
      receiverPayService.getActiveForOrder.mockResolvedValue(rpRow);
      receiverPayService.issueLink.mockRejectedValue(new Error("whatsapp down"));
      prisma.pkg_order.findUnique.mockResolvedValue(order());
      const result = await tripLifecycle.updateStatus(297, 1, "complete");
      expect(result).toMatchObject({ success: true, settlement_pending: true });
    });
  });
```
(Check: `commission_percent: "3.00"` -> `Number("3.00")` = 3. For the first test `85 * 3 / 100 = 2.55`. For the 150-advance case `advanceApplied = min(150, 100 - 0) = 100`.)

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycleSettlement.test.js`
Expected: FAIL in the new `receiver mode` tests; the existing tests still pass.

- [ ] **Step 7: Implement the hook in `tripLifecycle.js`**

1. Next to the existing `settlementService` require add:
```js
const receiverPayService = require("./receiverPayService");
const receiverPaySettings = require("./receiverPaySettings");
const receiverPayCalc = require("./receiverPayCalc");
```
2. Replace the block from `const settlementAmountDue = ...` through the closing of the `if (!isMonthlyDriver && ... ) { ... }` settlement block (current L635-668) with:

```js
    // Receiver-pay (spec 2026-10-05): when the booker chose that the receiver pays, the advance is
    // a held deposit (still debited from the booker wallet below via advance_apply), so the amount
    // due is NOT netted by it. A missing/failed lookup just means a normal ride.
    const receiverPayRow = isCashOrder
      ? await receiverPayService.getActiveForOrder(orderId).catch(() => null)
      : null;
    const receiverAmountDue = receiverPayRow ? round2(finalTotal - nonAdvancePrepaid) : 0;
    const useReceiverMode = Boolean(receiverPayRow) && receiverAmountDue > 0;
    const settlementAmountDue = useReceiverMode ? receiverAmountDue : (isCashOrder ? round2(finalTotal - prepaidTotal) : 0);
    let settlementCreated = false;
    if (!isMonthlyDriver && !isDailyDriverExempt && isCashOrder && settlementAmountDue > 0
        && (await settlementSettings.isSettlementEnabled())) {
      try {
        let receiver;
        if (useReceiverMode) {
          const { maxAmount } = await receiverPaySettings.getReceiverPaySettings();
          receiver = {
            markup: receiverPayCalc.computeMarkup(receiverAmountDue, Number(receiverPayRow.commission_percent), maxAmount),
            advanceHeld: advanceApplied,
          };
        }
        await settlementService.createForCompletedOrder({
          orderId,
          uid: order.uid,
          riderId,
          cityId: order.city_id,
          amountDue: settlementAmountDue,
          fare: finalTotal,
          commissionAmount: pricingEngine.commissionAmount(finalTotal, effectiveCommissionPercent),
          perTripCharge: driverBenefit?.benefit > 0 ? Number(driverBenefit.perTripCharge) || 0 : 0,
          prepaidAmount: useReceiverMode ? nonAdvancePrepaid : prepaidTotal,
          ...(useReceiverMode ? { receiver } : {}),
        });
        settlementCreated = true;
      } catch (err) {
        // The transaction may have committed even though the client saw an error; falling back
        // to the legacy debit then would let a later "Received" debit commission a second time.
        let committed = null;
        try {
          committed = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
        } catch (checkErr) {
          logger.error(`updateStatus: settlement existence re-check failed for order ${orderId}:`, checkErr);
        }
        if (committed) {
          settlementCreated = true;
          logger.warn(`updateStatus: settlement creation reported an error for order ${orderId} but the row exists; skipping legacy commission flow:`, err);
        } else {
          logger.error(`updateStatus: settlement creation failed for order ${orderId}, using legacy commission flow:`, err);
        }
      }
    }

    if (receiverPayRow) {
      if (useReceiverMode && settlementCreated) {
        // The WhatsApp link is best-effort: the driver / booker can resend it, and a failure here
        // must never fail a completed ride.
        await receiverPayService.issueLink({ orderId }).catch((err) =>
          logger.error(`updateStatus: receiver pay link failed for order ${orderId}:`, err)
        );
      } else {
        await receiverPayService.close(orderId, "not_applicable").catch((err) =>
          logger.error(`updateStatus: closing receiver pay for order ${orderId} failed:`, err)
        );
      }
    }
```
(`round2`, `nonAdvancePrepaid`, `advanceApplied`, `prepaidTotal` are the existing locals defined just above this block.)

- [ ] **Step 8: Run to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/tripLifecycleSettlement.test.js src/services/__tests__/receiverPayService.test.js src/services/__tests__/tripLifecycle.test.js src/services/__tests__/paymentCompletionMatrix.test.js`
Expected: PASS (every pre-existing assertion on `createForCompletedOrder` still matches because the `receiver` key is omitted in normal mode).

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/receiverPayService.js backend/src/services/tripLifecycle.js backend/src/services/__tests__/receiverPayService.test.js backend/src/services/__tests__/tripLifecycleSettlement.test.js
git commit -m "feat(receiver-pay): create receiver-mode settlement at completion and send the pay link

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Receiver payment and decline/convert transitions

**Files:**
- Create: `backend/src/services/receiverSettlementService.js`
- Test: `backend/src/services/__tests__/receiverSettlementService.test.js`

**Interfaces:**
- Consumes: from `settlementService`: `STATUS, EFFECT, SettlementError, round2, stateMessage, changeWalletEffect, lockByOrderId, logEvent, runTransition, assertParty`; `receiverWalletCredits.applyReceiverCredits/markReceiverRow`; `receiverPayToken.hashToken`; `receiverPayCalc.receiverPayable`; `createRazorpayOrder`, `verifyRazorpayPayment`.
- Produces:
  - `getPublicState(token): Promise<{ state: 'payable'|'paid'|'closed'|'expired', order_id?, amount_due?, markup?, total?, driver_first_name?, booker_first_name?, pickup?, drop? }>`; throws `SettlementError('INVALID_LINK')` for an unknown token.
  - `createOrderByToken(token): Promise<{ razorpay_order_id, amount_paise, currency, key_id }>`
  - `settleByReceiver({ token, paymentId, razorpayOrderId, signature }): Promise<{ settlement, alreadyDone? }>`
  - `declineReceiverPay({ orderId, actor: 'receiver'|'driver'|'booker'|'admin', actorId = null }): Promise<{ phase: 'before_completion' | 'converted' | 'already_normal', settlement? }>`
  - `declineByToken(token): same as declineReceiverPay with actor 'receiver'`

- [ ] **Step 1: Write the failing tests**

`receiverSettlementService.test.js`:
```js
jest.mock("../../config/db", () => ({
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  order_settlement: { findUnique: jest.fn(), update: jest.fn() },
  order_settlement_event: { create: jest.fn() },
  order_receiver_pay: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  pkg_order: { findUnique: jest.fn() },
  tbl_rider: { findUnique: jest.fn(), update: jest.fn() },
  tbl_user: { findUnique: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { findFirst: jest.fn(), create: jest.fn() },
  app_settings: { findMany: jest.fn() },
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));
jest.mock("../../utils/razorpayOrders", () => ({ createRazorpayOrder: jest.fn() }));
jest.mock("../walletNotifier", () => ({
  notifyDriverWalletTransaction: jest.fn().mockResolvedValue(undefined),
  notifyCustomerWalletTransaction: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../sockets/socketServer", () => ({ getIO: () => ({ to: () => ({ emit: jest.fn() }) }) }));

const prisma = require("../../config/db");
const { verifyRazorpayPayment } = require("../../utils/razorpayVerify");
const { createRazorpayOrder } = require("../../utils/razorpayOrders");
const { hashToken } = require("../receiverPayToken");
const svc = require("../receiverSettlementService");

const TOKEN = "t".repeat(43);
const settlement = (o = {}) => ({
  id: 4, order_id: 50, uid: 7, rid: 9, amount_due: 90, fare: 100, commission_amount: 10, per_trip_charge: 0, prepaid_amount: 10,
  status: "pending", method: null, wallet_effect: "none", effect_seq: 0, payer: "receiver", receiver_markup: 2.7, advance_held: 20,
  receiver_credited: false, reversal_shortfall: 0, razorpay_payment_id: null, ...o,
});
const rp = (o = {}) => ({
  id: 3, order_id: 50, uid: 7, status: "active", token_hash: hashToken(TOKEN),
  token_expires_at: new Date(Date.now() + 3600 * 1000), razorpay_order_id: null, ...o,
});

let current;
function setup({ s = settlement(), r = rp() } = {}) {
  jest.clearAllMocks();
  current = s;
  prisma.$transaction.mockImplementation((cb) => cb(prisma));
  prisma.$queryRaw.mockResolvedValue([{ id: s.id }]);
  prisma.order_settlement.findUnique.mockImplementation(() => Promise.resolve(current));
  prisma.order_settlement.update.mockImplementation(({ data }) => { current = { ...current, ...data }; return Promise.resolve(current); });
  prisma.order_settlement_event.create.mockResolvedValue({});
  prisma.order_receiver_pay.findUnique.mockResolvedValue(r);
  prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
  prisma.order_receiver_pay.update.mockResolvedValue({});
  prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, uid: 7, rid: 9, paddress: "Pickup road", daddress: "Drop road" });
  prisma.tbl_rider.findUnique.mockResolvedValue({ first_name: "Suresh" });
  prisma.tbl_user.findUnique.mockResolvedValue({ name: "Anita Sharma", wallet: 100 });
  prisma.tbl_user.update.mockResolvedValue({});
  prisma.tbl_rider.update.mockResolvedValue({});
  prisma.tbl_wallet_history.findFirst.mockResolvedValue(null);
  prisma.tbl_wallet_history.create.mockResolvedValue({});
  verifyRazorpayPayment.mockResolvedValue({ ok: true });
}

describe("getPublicState", () => {
  it("payable: returns the breakup and no booker phone", async () => {
    setup();
    const s = await svc.getPublicState(TOKEN);
    expect(s).toEqual({
      state: "payable", order_id: 50, amount_due: 90, markup: 2.7, total: 92.7,
      driver_first_name: "Suresh", booker_first_name: "Anita", pickup: "Pickup road", drop: "Drop road",
    });
    expect(JSON.stringify(s)).not.toMatch(/mobile|phone/i);
  });
  it("unknown token -> INVALID_LINK", async () => {
    setup();
    prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
    await expect(svc.getPublicState("x".repeat(43))).rejects.toMatchObject({ code: "INVALID_LINK" });
  });
  it("expired token -> neutral expired state without order data", async () => {
    setup({ r: rp({ token_expires_at: new Date(Date.now() - 1000) }) });
    expect(await svc.getPublicState(TOKEN)).toEqual({ state: "expired" });
  });
  it("paid -> paid state; declined/closed/converted -> closed state", async () => {
    setup({ r: rp({ status: "paid" }) });
    expect((await svc.getPublicState(TOKEN)).state).toBe("paid");
    setup({ r: rp({ status: "declined" }) });
    expect(await svc.getPublicState(TOKEN)).toEqual({ state: "closed" });
    setup({ s: settlement({ payer: "customer" }) });
    expect(await svc.getPublicState(TOKEN)).toEqual({ state: "closed" });
  });
});

describe("createOrderByToken", () => {
  it("creates a Razorpay order for amount_due + markup and stores it", async () => {
    setup();
    createRazorpayOrder.mockResolvedValue({ ok: true, id: "order_R1", amountPaise: 9270, currency: "INR" });
    prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 1 });
    process.env.RAZORPAY_KEY_ID = "rzp_test";
    const out = await svc.createOrderByToken(TOKEN);
    expect(createRazorpayOrder).toHaveBeenCalledWith({ amountRupees: 92.7, receipt: "rpay_50" });
    expect(out).toEqual({ razorpay_order_id: "order_R1", amount_paise: 9270, currency: "INR", key_id: "rzp_test" });
  });
  it("reuses an existing Razorpay order", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R0" }) });
    const out = await svc.createOrderByToken(TOKEN);
    expect(createRazorpayOrder).not.toHaveBeenCalled();
    expect(out.razorpay_order_id).toBe("order_R0");
    expect(out.amount_paise).toBe(9270);
  });
  it("refuses when the link is no longer payable", async () => {
    setup({ s: settlement({ status: "cash_received" }) });
    await expect(svc.createOrderByToken(TOKEN)).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

describe("settleByReceiver", () => {
  const pay = { token: TOKEN, paymentId: "pay_1", razorpayOrderId: "order_R1", signature: "sig" };

  it("verifies the exact total, credits the driver (online) and the booker, and marks everything paid", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    const { settlement: out } = await svc.settleByReceiver(pay);
    expect(verifyRazorpayPayment).toHaveBeenCalledWith({ paymentId: "pay_1", orderId: "order_R1", signature: "sig", expectedAmountRupees: 92.7 });
    expect(out).toMatchObject({ status: "paid_online", method: "online", wallet_effect: "online", confirmed_by: "receiver_online", receiver_credited: true });
    // driver online effect: fare 100 - commission 10
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 90 } } });
    // booker: advance refund + commission
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 20 } } });
    expect(prisma.tbl_user.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet: { increment: 2.7 } } });
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({ where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "paid" }) });
  });
  it("a repeat of the same payment id is a no-op (no second credit)", async () => {
    setup({ s: settlement({ status: "paid_online", razorpay_payment_id: "pay_1" }), r: rp({ status: "paid", razorpay_order_id: "order_R1" }) });
    const out = await svc.settleByReceiver(pay);
    expect(out.alreadyDone).toBe(true);
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
  it("a payment for a different Razorpay order is rejected", async () => {
    setup({ r: rp({ razorpay_order_id: "order_OTHER" }) });
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAYMENT_MISMATCH" });
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
  });
  it("a failed verification leaves the settlement pending and moves no money", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment Verification Failed!" });
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAYMENT_VERIFICATION_FAILED" });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
  });
  it("driver confirmed cash while the receiver was paying: no double effect, flagged for reconciliation", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1" }) });
    // the pre-check sees pending, but once the lock is taken the settlement is already cash_received
    prisma.order_settlement.findUnique
      .mockResolvedValueOnce(settlement())
      .mockResolvedValue(settlement({ status: "cash_received", receiver_credited: true }));
    prisma.$queryRaw.mockResolvedValue([{ id: 4 }]);
    await expect(svc.settleByReceiver(pay)).rejects.toMatchObject({ code: "PAID_BUT_STATE_CHANGED" });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(prisma.order_settlement_event.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ note: expect.stringContaining("needs manual reconciliation") }),
    });
  });
  it("accepts a verification that arrives just after link expiry when the Razorpay order matches", async () => {
    setup({ r: rp({ razorpay_order_id: "order_R1", token_expires_at: new Date(Date.now() - 1000) }) });
    const out = await svc.settleByReceiver(pay);
    expect(out.settlement.status).toBe("paid_online");
  });
});

describe("declineReceiverPay", () => {
  it("before completion (no settlement yet): just marks the row declined", async () => {
    setup();
    prisma.order_settlement.findUnique.mockResolvedValue(null);
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "booker", actorId: 7 });
    expect(out.phase).toBe("before_completion");
    expect(prisma.order_receiver_pay.updateMany).toHaveBeenCalledWith({
      where: { order_id: 50, status: "active" }, data: expect.objectContaining({ status: "declined", declined_by: "booker" }),
    });
  });
  it("after completion: converts to customer mode with the advance netted off", async () => {
    setup();
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 9 });
    expect(out.phase).toBe("converted");
    expect(prisma.order_settlement.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: expect.objectContaining({ payer: "customer", amount_due: 70, prepaid_amount: 30, receiver_markup: 0, razorpay_order_id: null }),
    });
    expect(prisma.tbl_user.update).not.toHaveBeenCalled();
  });
  it("conversion also works when the decline landed just before the settlement row existed (row already declined)", async () => {
    setup({ r: rp({ status: "declined" }) });
    prisma.order_receiver_pay.updateMany.mockResolvedValue({ count: 0 });
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "receiver" });
    expect(out.phase).toBe("converted");
  });
  it("advance covers the whole amount: settles immediately like a fully prepaid cash order", async () => {
    setup({ s: settlement({ amount_due: 20, advance_held: 20, prepaid_amount: 0, receiver_markup: 0.6 }) });
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "booker", actorId: 7 });
    expect(out.settlement).toMatchObject({ status: "cash_received", amount_due: 0, confirmed_by: "system" });
    // cash effect: prepaid 20 > commission 10 -> driver is owed the 10 leftover
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { wallet_balance: { increment: 10 } } });
  });
  it("is a no-op on an already-normal settlement", async () => {
    setup({ s: settlement({ payer: "customer" }) });
    const out = await svc.declineReceiverPay({ orderId: 50, actor: "receiver" });
    expect(out.phase).toBe("already_normal");
    expect(prisma.order_settlement.update).not.toHaveBeenCalled();
  });
  it("refuses once the settlement is no longer pending", async () => {
    setup({ s: settlement({ status: "cash_received" }) });
    await expect(svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 9 })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
  it("a driver or booker who is not on the order is forbidden", async () => {
    setup();
    await expect(svc.declineReceiverPay({ orderId: 50, actor: "driver", actorId: 999 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(svc.declineReceiverPay({ orderId: 50, actor: "booker", actorId: 999 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/receiverSettlementService.test.js`
Expected: FAIL, `Cannot find module '../receiverSettlementService'`.

- [ ] **Step 3: Implement `receiverSettlementService.js`**

```js
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { verifyRazorpayPayment } = require("../utils/razorpayVerify");
const { createRazorpayOrder } = require("../utils/razorpayOrders");
const settlementService = require("./settlementService");
const receiverWalletCredits = require("./receiverWalletCredits");
const { hashToken } = require("./receiverPayToken");
const { receiverPayable } = require("./receiverPayCalc");

const { STATUS, EFFECT, SettlementError, round2, stateMessage, changeWalletEffect, lockByOrderId, logEvent, runTransition } = settlementService;

const firstName = (full) => String(full || "").trim().split(/\s+/)[0] || null;
const shorten = (s) => (s ? String(s).slice(0, 80) : null);

async function findRowByToken(token) {
  const row = await prisma.order_receiver_pay.findUnique({ where: { token_hash: hashToken(token) } });
  if (!row) throw new SettlementError("INVALID_LINK", "This payment link is not valid.");
  return row;
}

const isExpired = (row) => !row.token_expires_at || new Date(row.token_expires_at).getTime() < Date.now();

// A pending receiver-mode settlement behind an active, unexpired link.
async function loadPayable(token, { allowExpired = false } = {}) {
  const row = await findRowByToken(token);
  if (row.status !== "active") throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
  if (!allowExpired && isExpired(row)) throw new SettlementError("LINK_EXPIRED", "This payment link has expired.");
  const s = await prisma.order_settlement.findUnique({ where: { order_id: row.order_id } });
  if (!s || s.payer !== "receiver") throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
  return { row, s };
}

async function getPublicState(token) {
  const row = await findRowByToken(token);
  const s = await prisma.order_settlement.findUnique({ where: { order_id: row.order_id } });
  if (row.status === "paid") return { state: "paid" };
  if (row.status !== "active" || !s || s.payer !== "receiver" || s.status !== STATUS.PENDING) return { state: "closed" };
  if (isExpired(row)) return { state: "expired" };
  const [order, rider, booker] = await Promise.all([
    prisma.pkg_order.findUnique({ where: { id: row.order_id }, select: { id: true, rid: true, uid: true, paddress: true, daddress: true } }),
    prisma.tbl_rider.findUnique({ where: { id: s.rid }, select: { first_name: true } }),
    prisma.tbl_user.findUnique({ where: { id: s.uid }, select: { name: true } }),
  ]);
  return {
    state: "payable",
    order_id: row.order_id,
    amount_due: Number(s.amount_due),
    markup: Number(s.receiver_markup),
    total: receiverPayable(s.amount_due, s.receiver_markup),
    driver_first_name: firstName(rider?.first_name),
    booker_first_name: firstName(booker?.name),
    pickup: shorten(order?.paddress),
    drop: shorten(order?.daddress),
  };
}

async function createOrderByToken(token) {
  const { row, s } = await loadPayable(token);
  if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
  const total = receiverPayable(s.amount_due, s.receiver_markup);
  let razorpayOrderId = row.razorpay_order_id;
  let amountPaise = Math.round(total * 100);
  // amount_due and receiver_markup are immutable while payer = receiver, so a stored Razorpay
  // order always matches the amount and can be reused.
  if (!razorpayOrderId) {
    const created = await createRazorpayOrder({ amountRupees: total, receipt: `rpay_${row.order_id}` });
    if (!created.ok) throw new SettlementError("GATEWAY_ERROR", created.reason);
    const won = await prisma.order_receiver_pay.updateMany({
      where: { id: row.id, status: "active", razorpay_order_id: null },
      data: { razorpay_order_id: created.id, updated_at: new Date() },
    });
    if (won.count === 1) {
      razorpayOrderId = created.id;
      amountPaise = created.amountPaise;
    } else {
      const current = await prisma.order_receiver_pay.findUnique({ where: { id: row.id } });
      if (!current || current.status !== "active" || !current.razorpay_order_id) {
        throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
      }
      razorpayOrderId = current.razorpay_order_id;
    }
  }
  return { razorpay_order_id: razorpayOrderId, amount_paise: amountPaise, currency: "INR", key_id: process.env.RAZORPAY_KEY_ID };
}

async function settleByReceiver({ token, paymentId, razorpayOrderId, signature }) {
  const row = await findRowByToken(token);
  const pre = await prisma.order_settlement.findUnique({ where: { order_id: row.order_id } });
  if (!pre || pre.payer !== "receiver") throw new SettlementError("INVALID_STATE", "This payment link is no longer active.");
  if (pre.status === STATUS.PAID_ONLINE && pre.razorpay_payment_id === paymentId) return { settlement: pre, alreadyDone: true };
  if (pre.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(pre.status));
  // The payment must belong to the Razorpay order created for THIS link.
  if (!row.razorpay_order_id || row.razorpay_order_id !== razorpayOrderId) {
    throw new SettlementError("PAYMENT_MISMATCH", "This payment does not belong to this order.");
  }
  const verification = await verifyRazorpayPayment({
    paymentId, orderId: razorpayOrderId, signature, expectedAmountRupees: receiverPayable(pre.amount_due, pre.receiver_markup),
  });
  if (!verification.ok) throw new SettlementError("PAYMENT_VERIFICATION_FAILED", verification.reason);

  try {
    return await runTransition(async (tx, notifications) => {
      const s = await lockByOrderId(tx, row.order_id);
      if (s.status === STATUS.PAID_ONLINE && s.razorpay_payment_id === paymentId) return { settlement: s, alreadyDone: true };
      if (s.payer !== "receiver" || s.status !== STATUS.PENDING) {
        throw Object.assign(new SettlementError("INVALID_STATE", stateMessage(s.status)), { currentStatus: s.status });
      }
      const { effectSeq, notifications: n } = await changeWalletEffect(tx, s, EFFECT.ONLINE);
      notifications.push(...n);
      await receiverWalletCredits.applyReceiverCredits(tx, s, { includeMarkup: true, notifications });
      await receiverWalletCredits.markReceiverRow(tx, s.order_id, "paid");
      const now = new Date();
      const updated = await tx.order_settlement.update({
        where: { id: s.id },
        data: {
          status: STATUS.PAID_ONLINE, method: "online", wallet_effect: EFFECT.ONLINE, effect_seq: effectSeq,
          razorpay_payment_id: paymentId, confirmed_by: "receiver_online", confirmed_at: now, receiver_credited: true, updated_at: now,
        },
      });
      await logEvent(tx, s, { actor: "receiver", from: s.status, to: STATUS.PAID_ONLINE, note: `Razorpay payment ${paymentId}` });
      return { settlement: updated };
    });
  } catch (err) {
    // The payment was verified, so a state rejection here means money was captured but not recorded.
    if (err instanceof SettlementError && err.code === "INVALID_STATE" && err.currentStatus) {
      const note = `Razorpay payment ${paymentId} was captured and verified but the settlement was already ${err.currentStatus}; needs manual reconciliation`;
      logger.error(`settleByReceiver: ${note} (order ${row.order_id})`);
      try {
        await prisma.order_settlement_event.create({
          data: { settlement_id: pre.id, actor: "receiver", actor_id: null, from_status: err.currentStatus, to_status: err.currentStatus, note, created_at: new Date() },
        });
      } catch (evErr) {
        logger.error(`settleByReceiver: failed to record reconciliation event for payment ${paymentId}:`, evErr);
      }
      throw new SettlementError("PAID_BUT_STATE_CHANGED", "Your payment was received but this order was already settled. Support will reconcile it.");
    }
    throw err;
  }
}

async function authorizeActor(orderId, actor, actorId) {
  if (actor === "receiver" || actor === "admin") return;
  const order = await prisma.pkg_order.findUnique({ where: { id: orderId }, select: { uid: true, rid: true } });
  if (!order) throw new SettlementError("NOT_FOUND", "No order found.");
  if (actor === "booker" && Number(order.uid) !== Number(actorId)) throw new SettlementError("FORBIDDEN", "This order belongs to another customer.");
  if (actor === "driver" && Number(order.rid) !== Number(actorId)) throw new SettlementError("FORBIDDEN", "This order belongs to another driver.");
}

// Receiver / driver / booker / admin stops the receiver paying. Before completion it only marks the
// intent declined; after completion it converts the pending settlement to normal customer mode
// (the held advance is netted off the amount due, no markup). Running the row update FIRST and the
// conversion SECOND makes a decline that races completion converge either way.
async function declineReceiverPay({ orderId, actor, actorId = null }) {
  await authorizeActor(orderId, actor, actorId);
  const now = new Date();
  await prisma.order_receiver_pay.updateMany({
    where: { order_id: orderId, status: "active" },
    data: { status: "declined", declined_by: actor, declined_at: now, updated_at: now },
  });
  const existing = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  if (!existing) return { phase: "before_completion" };
  if (existing.payer !== "receiver") return { phase: "already_normal", settlement: existing };

  const result = await runTransition(async (tx, notifications) => {
    const s = await lockByOrderId(tx, orderId);
    if (s.payer !== "receiver") return { settlement: s, alreadyDone: true };
    if (s.status !== STATUS.PENDING) throw new SettlementError("INVALID_STATE", stateMessage(s.status));
    const advance = round2(s.advance_held);
    const newDue = round2(Math.max(0, Number(s.amount_due) - advance));
    const base = {
      payer: "customer", amount_due: newDue, prepaid_amount: round2(Number(s.prepaid_amount) + advance),
      receiver_markup: 0, razorpay_order_id: null, customer_choice: null, updated_at: new Date(),
    };
    const note = `Receiver payment declined by ${actor}; switched to customer payment`;
    if (newDue > 0) {
      const updated = await tx.order_settlement.update({ where: { id: s.id }, data: base });
      await logEvent(tx, s, { actor: actor === "booker" ? "customer" : actor, actorId, from: s.status, to: s.status, note });
      return { settlement: updated };
    }
    // The held advance covers everything still due: settle like a fully prepaid cash order.
    const { effectSeq, notifications: n } = await changeWalletEffect(tx, { ...s, ...base }, EFFECT.CASH);
    notifications.push(...n);
    const updated = await tx.order_settlement.update({
      where: { id: s.id },
      data: {
        ...base, status: STATUS.CASH_RECEIVED, method: null, wallet_effect: EFFECT.CASH, effect_seq: effectSeq,
        confirmed_by: "system", confirmed_at: new Date(),
      },
    });
    await logEvent(tx, s, { actor: actor === "booker" ? "customer" : actor, actorId, from: s.status, to: STATUS.CASH_RECEIVED, note: `${note}; the advance covered the amount due` });
    return { settlement: updated };
  });
  return { phase: result.alreadyDone ? "already_normal" : "converted", settlement: result.settlement };
}

const declineByToken = async (token) => {
  const row = await findRowByToken(token);
  return declineReceiverPay({ orderId: row.order_id, actor: "receiver" });
};

module.exports = { getPublicState, createOrderByToken, settleByReceiver, declineReceiverPay, declineByToken };
```

Notes for the implementer: the `declineReceiverPay` "advance covers everything" test passes `amount_due: 20, advance_held: 20, prepaid_amount: 0` with commission 10, so after conversion `prepaid_amount = 20` and `effectOps('cash')` credits the driver `20 - 10 = 10`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/receiverSettlementService.test.js`
Expected: PASS. If a test about the `PAID_BUT_STATE_CHANGED` mock sequence fails, adjust only the mock ordering in the test (the first `findUnique` is the pre-check, later ones come after the lock), not the service.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/receiverSettlementService.js backend/src/services/__tests__/receiverSettlementService.test.js
git commit -m "feat(receiver-pay): receiver payment, decline and convert-to-customer transitions

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Public pay API, HTML page and routes

**Files:**
- Create: `backend/src/controllers/receiverPayPage.js`, `backend/src/controllers/receiverPayController.js`, `backend/src/routes/receiverPayRoutes.js`
- Modify: `backend/src/app.js` (require + mount, near L57-65)
- Test: `backend/src/controllers/__tests__/receiverPayController.test.js`

**Interfaces:**
- Consumes: `receiverSettlementService.{getPublicState, createOrderByToken, settleByReceiver, declineByToken}`, `settlementService.SettlementError`, `middleware/rateLimiter`.
- Produces: routers `{ pageRouter, apiRouter }`; HTTP:
  - `GET /pay/:token` -> HTML (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`).
  - `GET /api/pay/:token` -> `{ success: true, state, ... }`
  - `POST /api/pay/:token/order` -> `{ success: true, razorpay_order_id, amount_paise, currency, key_id }`
  - `POST /api/pay/:token/verify` body `{ razorpay_payment_id, razorpay_order_id, razorpay_signature }` -> `{ success: true, state: 'paid' }`
  - `POST /api/pay/:token/decline` -> `{ success: true, state: 'closed' }`
  - Errors: `{ success: false, code, message }` with HTTP 400 (`SettlementError`), 404 (malformed token / `INVALID_LINK`), 500 (anything else, no detail).

- [ ] **Step 1: Write the failing controller test**

```js
jest.mock("../../utils/logger", () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));
jest.mock("../../services/receiverSettlementService", () => ({
  getPublicState: jest.fn(), createOrderByToken: jest.fn(), settleByReceiver: jest.fn(), declineByToken: jest.fn(),
}));

const svc = require("../../services/receiverSettlementService");
const { SettlementError } = require("../../services/settlementService");
const c = require("../receiverPayController");

const TOKEN = "t".repeat(43);
const res = () => { const r = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), send: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis() }; return r; };

beforeEach(() => jest.clearAllMocks());

describe("receiverPayController", () => {
  it("rejects a malformed token with 404 before touching the service", async () => {
    const r = res();
    await c.state({ params: { token: "../etc/passwd" } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(svc.getPublicState).not.toHaveBeenCalled();
  });
  it("state: returns the public state", async () => {
    svc.getPublicState.mockResolvedValue({ state: "payable", total: 92.7 });
    const r = res();
    await c.state({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "payable", total: 92.7 });
  });
  it("unknown token -> 404 with a neutral message", async () => {
    svc.getPublicState.mockRejectedValue(new SettlementError("INVALID_LINK", "This payment link is not valid."));
    const r = res();
    await c.state({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(404);
    expect(r.json).toHaveBeenCalledWith({ success: false, code: "INVALID_LINK", message: "This payment link is not valid." });
  });
  it("order: returns the Razorpay order", async () => {
    svc.createOrderByToken.mockResolvedValue({ razorpay_order_id: "order_1", amount_paise: 9270, currency: "INR", key_id: "k" });
    const r = res();
    await c.createOrder({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, razorpay_order_id: "order_1", amount_paise: 9270, currency: "INR", key_id: "k" });
  });
  it("verify: requires all three Razorpay fields", async () => {
    const r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(svc.settleByReceiver).not.toHaveBeenCalled();
  });
  it("verify: settles and reports paid", async () => {
    svc.settleByReceiver.mockResolvedValue({ settlement: {} });
    const r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p", razorpay_order_id: "o", razorpay_signature: "s" } }, r);
    expect(svc.settleByReceiver).toHaveBeenCalledWith({ token: TOKEN, paymentId: "p", razorpayOrderId: "o", signature: "s" });
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "paid" });
  });
  it("service business errors become 400 with their code", async () => {
    svc.settleByReceiver.mockRejectedValue(new SettlementError("PAYMENT_VERIFICATION_FAILED", "Payment Verification Failed!"));
    const r = res();
    await c.verify({ params: { token: TOKEN }, body: { razorpay_payment_id: "p", razorpay_order_id: "o", razorpay_signature: "s" } }, r);
    expect(r.status).toHaveBeenCalledWith(400);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ success: false, code: "PAYMENT_VERIFICATION_FAILED" }));
  });
  it("unexpected errors become a generic 500 with no detail", async () => {
    svc.declineByToken.mockRejectedValue(new Error("secret db detail"));
    const r = res();
    await c.decline({ params: { token: TOKEN } }, r);
    expect(r.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(r.json.mock.calls[0][0])).not.toContain("secret");
  });
  it("decline: reports closed", async () => {
    svc.declineByToken.mockResolvedValue({ phase: "converted" });
    const r = res();
    await c.decline({ params: { token: TOKEN } }, r);
    expect(r.json).toHaveBeenCalledWith({ success: true, state: "closed" });
  });
  it("page: serves HTML with no-store / no-referrer / noindex headers, and 404 for a malformed token", async () => {
    const r = res();
    c.page({ params: { token: TOKEN } }, r);
    expect(r.set).toHaveBeenCalledWith(expect.objectContaining({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" }));
    expect(r.send).toHaveBeenCalledWith(expect.stringContaining("<!doctype html>"));
    const bad = res();
    c.page({ params: { token: "x" } }, bad);
    expect(bad.status).toHaveBeenCalledWith(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/receiverPayController.test.js`
Expected: FAIL, `Cannot find module '../receiverPayController'`.

- [ ] **Step 3: Implement the controller, page and routes**

`receiverPayController.js`:
```js
const logger = require("../utils/logger");
const receiverSettlementService = require("../services/receiverSettlementService");
const { SettlementError } = require("../services/settlementService");
const { PAGE_HTML } = require("./receiverPayPage");

// Tokens are 32 random bytes, base64url (43 chars). Anything else never reaches the DB.
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const notFound = (res) => res.status(404).json({ success: false, code: "INVALID_LINK", message: "This payment link is not valid." });

function handleError(res, err, label) {
  if (err instanceof SettlementError) {
    const status = err.code === "INVALID_LINK" ? 404 : 400;
    return res.status(status).json({ success: false, code: err.code, message: err.message });
  }
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
}

function guarded(label, run) {
  return async (req, res) => {
    const { token } = req.params;
    if (!TOKEN_SHAPE.test(String(token || ""))) return notFound(res);
    try {
      return await run(token, req, res);
    } catch (err) {
      return handleError(res, err, label);
    }
  };
}

const state = guarded("receiverPay state", async (token, req, res) =>
  res.json({ success: true, ...(await receiverSettlementService.getPublicState(token)) }));

const createOrder = guarded("receiverPay createOrder", async (token, req, res) =>
  res.json({ success: true, ...(await receiverSettlementService.createOrderByToken(token)) }));

const verify = guarded("receiverPay verify", async (token, req, res) => {
  const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return res.status(400).json({ success: false, code: "VALIDATION", message: "Payment details are missing." });
  }
  await receiverSettlementService.settleByReceiver({
    token, paymentId: razorpay_payment_id, razorpayOrderId: razorpay_order_id, signature: razorpay_signature,
  });
  return res.json({ success: true, state: "paid" });
});

const decline = guarded("receiverPay decline", async (token, req, res) => {
  await receiverSettlementService.declineByToken(token);
  return res.json({ success: true, state: "closed" });
});

function page(req, res) {
  if (!TOKEN_SHAPE.test(String(req.params.token || ""))) return notFound(res);
  res.set({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" });
  return res.send(PAGE_HTML);
}

module.exports = { state, createOrder, verify, decline, page };
```

`receiverPayPage.js` (static page; all dynamic values are inserted with `textContent`, never `innerHTML`):
```js
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Shifter Online - Payment</title>
<style>
  :root { color-scheme: light dark; --bg:#f6f7f9; --card:#fff; --text:#1b1f24; --muted:#5f6b7a; --accent:#0a7d4f; --danger:#b3261e; --line:#e3e6ea; }
  @media (prefers-color-scheme: dark) { :root { --bg:#111418; --card:#1a1f26; --text:#eceff3; --muted:#9aa5b1; --accent:#3ecf8e; --danger:#ff8a80; --line:#2a313a; } }
  body { margin:0; background:var(--bg); color:var(--text); font:16px/1.5 system-ui, sans-serif; }
  main { max-width:420px; margin:0 auto; padding:24px 16px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:20px; }
  h1 { font-size:20px; margin:0 0 4px; } .muted { color:var(--muted); font-size:14px; }
  dl { margin:16px 0; } dl div { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--line); }
  dt { color:var(--muted); } dd { margin:0; font-weight:600; text-align:right; }
  .total dd, .total dt { font-size:18px; color:var(--text); }
  button { width:100%; padding:14px; border-radius:10px; border:0; font-size:16px; font-weight:600; cursor:pointer; margin-top:10px; }
  #pay { background:var(--accent); color:#fff; } #decline { background:transparent; color:var(--danger); border:1px solid var(--line); }
  button:disabled { opacity:.6; cursor:default; } #msg { margin-top:12px; min-height:1.4em; }
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>Shifter Online</h1>
    <p class="muted" id="sub">Loading...</p>
    <dl id="breakup" hidden></dl>
    <button id="pay" hidden>Pay now</button>
    <button id="decline" hidden>Decline</button>
    <p id="msg" role="status"></p>
  </div>
</main>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
(function () {
  var token = location.pathname.split("/").filter(Boolean).pop();
  var api = "/api/pay/" + encodeURIComponent(token);
  var $ = function (id) { return document.getElementById(id); };
  var money = function (n) { return "\\u20B9" + Number(n).toFixed(2); };
  function say(t) { $("msg").textContent = t || ""; }
  function row(label, value, cls) {
    var d = document.createElement("div"); if (cls) d.className = cls;
    var dt = document.createElement("dt"); dt.textContent = label;
    var dd = document.createElement("dd"); dd.textContent = value;
    d.appendChild(dt); d.appendChild(dd); return d;
  }
  function show(s) {
    $("pay").hidden = $("decline").hidden = $("breakup").hidden = true;
    if (s.state === "payable") {
      $("sub").textContent = "Order #" + s.order_id + (s.booker_first_name ? " - booked by " + s.booker_first_name : "");
      var b = $("breakup"); b.textContent = "";
      if (s.driver_first_name) b.appendChild(row("Driver", s.driver_first_name));
      if (s.pickup) b.appendChild(row("Pickup", s.pickup));
      if (s.drop) b.appendChild(row("Drop", s.drop));
      b.appendChild(row("Fare", money(s.amount_due)));
      if (s.markup > 0) b.appendChild(row("Service fee", money(s.markup)));
      b.appendChild(row("Total", money(s.total), "total"));
      b.hidden = false; $("pay").hidden = false; $("decline").hidden = false;
      $("pay").disabled = $("decline").disabled = false; say("");
    } else if (s.state === "paid") { $("sub").textContent = "Payment received. Thank you!"; say("");
    } else if (s.state === "expired") { $("sub").textContent = "This payment link has expired."; say("Please ask the sender or driver to resend it.");
    } else { $("sub").textContent = "No payment is needed for this order."; say(""); }
  }
  function post(path) { return fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(function (r) { return r.json(); }); }
  function load() { return fetch(api).then(function (r) { return r.json(); }).then(function (s) { if (!s.success) { $("sub").textContent = "This payment link is not valid."; return; } show(s); }).catch(function () { say("Could not load. Check your connection."); }); }

  $("pay").addEventListener("click", function () {
    $("pay").disabled = $("decline").disabled = true; say("Starting payment...");
    post("/order").then(function (o) {
      if (!o.success) { say(o.message || "Could not start payment."); $("pay").disabled = $("decline").disabled = false; return; }
      var rz = new Razorpay({
        key: o.key_id, order_id: o.razorpay_order_id, amount: o.amount_paise, currency: o.currency, name: "Shifter Online",
        handler: function (resp) {
          say("Confirming payment...");
          fetch(api + "/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            razorpay_payment_id: resp.razorpay_payment_id, razorpay_order_id: resp.razorpay_order_id, razorpay_signature: resp.razorpay_signature }) })
            .then(function (r) { return r.json(); })
            .then(function (v) { if (v.success) { show({ state: "paid" }); } else { say(v.message || "Could not confirm payment. If money was deducted it will be reconciled."); } });
        },
        modal: { ondismiss: function () { $("pay").disabled = $("decline").disabled = false; say(""); } }
      });
      rz.open();
    }).catch(function () { say("Could not start payment."); $("pay").disabled = $("decline").disabled = false; });
  });
  $("decline").addEventListener("click", function () {
    if (!confirm("Decline paying for this order? The sender will be asked to pay instead.")) return;
    $("pay").disabled = $("decline").disabled = true;
    post("/decline").then(function (d) { if (d.success) { show({ state: "closed" }); say("You declined. The sender will be notified."); } else { say(d.message || "Could not decline."); $("pay").disabled = $("decline").disabled = false; } });
  });
  load();
})();
</script>
</body>
</html>`;

module.exports = { PAGE_HTML };
```

**Known trade-off (Subresource Integrity):** the page loads `https://checkout.razorpay.com/v1/checkout.js` without an `integrity=` attribute on purpose. Razorpay serves that file as a rolling, versionless script and documents loading it directly from their CDN; a pinned SHA-384 hash would break checkout the next time they ship. Mitigations already in the design: the amount is verified server-side against Razorpay's API (`verifyRazorpayPayment`), the page uses only `textContent`, and responses are `no-store` / `no-referrer`.

`receiverPayRoutes.js`:
```js
const express = require("express");
const rateLimiter = require("../middleware/rateLimiter");
const controller = require("../controllers/receiverPayController");

const pageRouter = express.Router();
pageRouter.get("/:token", rateLimiter({ windowMs: 60 * 1000, max: 60 }), controller.page);

const apiRouter = express.Router();
apiRouter.use(rateLimiter({ windowMs: 60 * 1000, max: 30 }));
apiRouter.get("/:token", controller.state);
apiRouter.post("/:token/order", controller.createOrder);
apiRouter.post("/:token/verify", controller.verify);
apiRouter.post("/:token/decline", controller.decline);

module.exports = { pageRouter, apiRouter };
```

In `app.js`: add `const { pageRouter: receiverPayPage, apiRouter: receiverPayApi } = require("./routes/receiverPayRoutes");` with the other route requires, and mount `app.use("/pay", receiverPayPage); app.use("/api/pay", receiverPayApi);` next to the `/api/order` mounts.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/receiverPayController.test.js`
Expected: PASS.

- [ ] **Step 5: Smoke-test the real server routes**

Run (from `backend/`):
```bash
node -e "const app=require('./src/app');const http=require('http');const s=http.createServer(app).listen(0,async()=>{const p=s.address().port;const a=await fetch('http://127.0.0.1:'+p+'/pay/short');const b=await fetch('http://127.0.0.1:'+p+'/pay/'+'a'.repeat(43));console.log('malformed',a.status,'wellformed',b.status,b.headers.get('cache-control'));s.close()})"
```
Expected: `malformed 404 wellformed 200 no-store` (the page itself is static; the API reports an invalid link).

- [ ] **Step 6: Commit**

```bash
git add backend/src/controllers/receiverPayController.js backend/src/controllers/receiverPayPage.js backend/src/routes/receiverPayRoutes.js backend/src/app.js backend/src/controllers/__tests__/receiverPayController.test.js
git commit -m "feat(receiver-pay): public pay page, token API and routes

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Booker and driver endpoints (take over, receiver refused, resend link)

**Files:**
- Modify: `backend/src/controllers/settlementController.js`, `backend/src/routes/orderRoutes.js`, `backend/src/routes/riderRoutes.js`
- Test: extend `backend/src/controllers/__tests__/settlementController.test.js`

**Interfaces:**
- Consumes: `receiverSettlementService.declineReceiverPay`, `receiverPayService.issueLink`, `ReceiverPayError`, `settlementService.publicView`.
- Produces (same envelope as the other settlement endpoints: HTTP 200, `ResponseCode`, `Result`, `code`):
  - `POST /api/order/settlement/take-over` `{ uid, order_id }` -> `{ phase, settlement? }`
  - `POST /api/order/settlement/resend-link` `{ uid, order_id }` -> `{ sent, link }`
  - `POST /api/rider/settlement/receiver-refused` (and `/rider/...`) `{ rider_id, order_id }` -> `{ phase, settlement? }`
  - `POST /api/rider/settlement/resend-link` `{ rider_id, order_id }` -> `{ sent, link }`

- [ ] **Step 1: Write the failing tests**

Open `settlementController.test.js`, reuse its existing mock block for `../../services/settlementService`, and add (adapting the mock factory names to that file's existing `jest.mock` for `settlementService`; keep its `SettlementError` class):

```js
jest.mock("../../services/receiverSettlementService", () => ({ declineReceiverPay: jest.fn() }));
jest.mock("../../services/receiverPayService", () => {
  class ReceiverPayError extends Error { constructor(code, message) { super(message); this.code = code; } }
  return { ReceiverPayError, issueLink: jest.fn(), getConfig: jest.fn() };
});
```
```js
const receiverSettlementService = require("../../services/receiverSettlementService");
const receiverPayService = require("../../services/receiverPayService");

describe("receiver-pay endpoints", () => {
  const res = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() });
  beforeEach(() => jest.clearAllMocks());

  it("customerTakeOver declines as the booker", async () => {
    receiverSettlementService.declineReceiverPay.mockResolvedValue({ phase: "converted", settlement: { id: 1, order_id: 50, status: "pending", amount_due: 70 } });
    const r = res();
    await controller.customerTakeOver({ body: { uid: 7, order_id: 50 } }, r);
    expect(receiverSettlementService.declineReceiverPay).toHaveBeenCalledWith({ orderId: 50, actor: "booker", actorId: 7 });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", phase: "converted" }));
  });
  it("driverReceiverRefused declines as the driver", async () => {
    receiverSettlementService.declineReceiverPay.mockResolvedValue({ phase: "converted", settlement: { id: 1, order_id: 50, status: "pending", amount_due: 70 } });
    const r = res();
    await controller.driverReceiverRefused({ body: { rider_id: 9, order_id: 50 } }, r);
    expect(receiverSettlementService.declineReceiverPay).toHaveBeenCalledWith({ orderId: 50, actor: "driver", actorId: 9 });
  });
  it("a forbidden party gets a failure envelope, not a 500", async () => {
    const { SettlementError } = require("../../services/settlementService");
    receiverSettlementService.declineReceiverPay.mockRejectedValue(new SettlementError("FORBIDDEN", "This order belongs to another driver."));
    const r = res();
    await controller.driverReceiverRefused({ body: { rider_id: 1, order_id: 50 } }, r);
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", code: "FORBIDDEN" }));
  });
  it("resend link (booker) returns sent + link and maps ReceiverPayError codes", async () => {
    receiverPayService.issueLink.mockResolvedValue({ sent: true, link: "https://x/pay/t" });
    const r = res();
    await controller.customerResendLink({ body: { uid: 7, order_id: 50 } }, r);
    expect(receiverPayService.issueLink).toHaveBeenCalledWith({ orderId: 50, resend: true });
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", sent: true, link: "https://x/pay/t" }));

    receiverPayService.issueLink.mockRejectedValue(new receiverPayService.ReceiverPayError("TOO_SOON", "Please wait a minute before sending the link again."));
    const r2 = res();
    await controller.customerResendLink({ body: { uid: 7, order_id: 50 } }, r2);
    expect(r2.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", code: "TOO_SOON" }));
  });
  it("resend link is refused for someone else's order", async () => {
    const prisma = require("../../config/db");
    // ownership is checked through the settlement row before any link is minted
    prisma.order_settlement.findUnique.mockResolvedValue({ order_id: 50, uid: 7, rid: 9 });
    const r = res();
    await controller.driverResendLink({ body: { rider_id: 999, order_id: 50 } }, r);
    expect(receiverPayService.issueLink).not.toHaveBeenCalled();
    expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false", code: "FORBIDDEN" }));
  });
});
```
(If `settlementController.test.js` does not already mock `../../config/db` with `order_settlement.findUnique`, add `jest.mock("../../config/db", () => ({ order_settlement: { findUnique: jest.fn() } }));` at its top.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/settlementController.test.js`
Expected: FAIL (`controller.customerTakeOver is not a function`).

- [ ] **Step 3: Implement**

In `settlementController.js` add requires and handlers:

```js
const prisma = require("../config/db");
const receiverSettlementService = require("../services/receiverSettlementService");
const receiverPayService = require("../services/receiverPayService");
const { ReceiverPayError } = receiverPayService;
```
Extend `handleError`:
```js
  if (err instanceof ReceiverPayError) return fail(res, err.code, err.message);
```
Add:
```js
const declineResult = (res, result) =>
  ok(res, { phase: result.phase, settlement: result.settlement ? settlementService.publicView(result.settlement) : null }, "Receiver payment cancelled");

const customerTakeOver = customerAction("settlement customerTakeOver", async ({ res, uid, orderId }) =>
  declineResult(res, await receiverSettlementService.declineReceiverPay({ orderId, actor: "booker", actorId: uid })));

const driverReceiverRefused = driverAction("settlement driverReceiverRefused", async ({ res, riderId, orderId }) =>
  declineResult(res, await receiverSettlementService.declineReceiverPay({ orderId, actor: "driver", actorId: riderId })));

// Ownership is checked against the settlement row before a (fresh) pay token is minted.
async function assertOrderParty(orderId, party, id) {
  const s = await prisma.order_settlement.findUnique({ where: { order_id: orderId } });
  settlementService.assertParty(s, party, id);
}

const customerResendLink = customerAction("settlement customerResendLink", async ({ res, uid, orderId }) => {
  await assertOrderParty(orderId, "customer", uid);
  const { sent, link } = await receiverPayService.issueLink({ orderId, resend: true });
  return ok(res, { sent, link }, sent ? "Payment link sent to the receiver" : "Link created; WhatsApp could not deliver it, share it manually");
});

const driverResendLink = driverAction("settlement driverResendLink", async ({ res, riderId, orderId }) => {
  await assertOrderParty(orderId, "driver", riderId);
  const { sent, link } = await receiverPayService.issueLink({ orderId, resend: true });
  return ok(res, { sent, link }, sent ? "Payment link sent to the receiver" : "Link created; WhatsApp could not deliver it, share it manually");
});
```
Add `customerTakeOver, customerResendLink, driverReceiverRefused, driverResendLink` to `module.exports`.

Routes: in `orderRoutes.js` after the `/settlement/dispute` line add
```js
router.post("/settlement/take-over", settlementController.customerTakeOver);
router.post("/settlement/resend-link", settlementController.customerResendLink);
```
and in `riderRoutes.js` after `/settlement/pending`
```js
router.post("/settlement/receiver-refused", settlementController.driverReceiverRefused);
router.post("/settlement/resend-link", settlementController.driverResendLink);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/settlementController.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/settlementController.js backend/src/routes/orderRoutes.js backend/src/routes/riderRoutes.js backend/src/controllers/__tests__/settlementController.test.js
git commit -m "feat(receiver-pay): booker take-over, driver receiver-refused and resend-link endpoints

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Admin visibility and convert-to-customer

**Files:**
- Modify: `backend/src/controllers/adminSettlementController.js` (`list` data map ~L81-92; new `convertToCustomer`; export), `backend/src/routes/adminRoutes.js` (~L201)
- Test: extend `backend/src/controllers/__tests__/adminSettlementController.test.js`

**Interfaces:**
- Consumes: `receiverSettlementService.declineReceiverPay`.
- Produces: list rows gain `payer`, `receiver_markup`, `advance_held`, `reversal_shortfall`; `POST /api/v1/admin/settlements/:id/convert-to-customer` -> `{ success: true, data: { phase, settlement } }` (the `detail` endpoint already returns the whole settlement row, so the new columns appear there automatically).

- [ ] **Step 1: Write the failing tests**

Add to `adminSettlementController.test.js` (follow its existing mock style for `prisma.order_settlement.findMany/count`, users and riders, and add `jest.mock("../../services/receiverSettlementService", () => ({ declineReceiverPay: jest.fn() }));`):

```js
it("list exposes the receiver-pay fields", async () => {
  // reuse this file's helper that seeds findMany with one settlement row
  const row = { id: 4, order_id: 50, uid: 7, rid: 9, city_id: 1, status: "pending", amount_due: 90, fare: 100, method: null,
    pending_since: new Date(), escalated_at: null, dispute_reason: null, dispute_raised_by: null,
    payer: "receiver", receiver_markup: 2.7, advance_held: 20, reversal_shortfall: 0 };
  prisma.order_settlement.findMany.mockResolvedValue([row]);
  prisma.order_settlement.count.mockResolvedValue(1);
  prisma.tbl_user.findMany.mockResolvedValue([]);
  prisma.tbl_rider.findMany.mockResolvedValue([]);
  const r = mockRes();
  await controller.list({ query: {}, scopedCityId: null }, r);
  expect(r.json.mock.calls[0][0].data[0]).toMatchObject({ payer: "receiver", receiver_markup: 2.7, advance_held: 20, reversal_shortfall: 0 });
});

it("convertToCustomer converts a receiver settlement as admin", async () => {
  prisma.order_settlement.findUnique.mockResolvedValue({ id: 4, order_id: 50, city_id: 1 });
  receiverSettlementService.declineReceiverPay.mockResolvedValue({ phase: "converted", settlement: { id: 4 } });
  const r = mockRes();
  await controller.convertToCustomer({ params: { id: "4" }, user: { id: 1 }, scopedCityId: null }, r);
  expect(receiverSettlementService.declineReceiverPay).toHaveBeenCalledWith({ orderId: 50, actor: "admin", actorId: 1 });
  expect(r.json).toHaveBeenCalledWith({ success: true, data: { phase: "converted", settlement: { id: 4 } } });
});

it("convertToCustomer respects city scope", async () => {
  prisma.order_settlement.findUnique.mockResolvedValue({ id: 4, order_id: 50, city_id: 2 });
  const r = mockRes();
  await controller.convertToCustomer({ params: { id: "4" }, user: { id: 1 }, scopedCityId: 1 }, r);
  expect(r.status).toHaveBeenCalledWith(404);
  expect(receiverSettlementService.declineReceiverPay).not.toHaveBeenCalled();
});
```
(`mockRes` stands for whatever response-mock helper that test file already defines; use its existing name.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/adminSettlementController.test.js`
Expected: FAIL (missing fields / `convertToCustomer` undefined).

- [ ] **Step 3: Implement**

In `adminSettlementController.js`:
1. Add `const receiverSettlementService = require("../services/receiverSettlementService");`
2. In `list`'s `rows.map` object add:
```js
      payer: s.payer || "customer",
      receiver_markup: Number(s.receiver_markup || 0),
      advance_held: Number(s.advance_held || 0),
      reversal_shortfall: Number(s.reversal_shortfall || 0),
```
3. Add:
```js
async function convertToCustomer(req, res) {
  try {
    const id = parseId(req.params.id);
    if (!id) return invalidId(res);
    if (!req.user?.id) return res.status(401).json({ success: false, message: "Unauthorized" });
    const existing = await prisma.order_settlement.findUnique({ where: { id }, select: { id: true, order_id: true, city_id: true } });
    if (!existing || outOfScope(req, existing)) return res.status(404).json(NOT_FOUND_BODY);
    const result = await receiverSettlementService.declineReceiverPay({ orderId: existing.order_id, actor: "admin", actorId: req.user.id });
    return res.status(200).json({ success: true, data: { phase: result.phase, settlement: result.settlement } });
  } catch (err) {
    if (err instanceof SettlementError) {
      return res.status(err.code === "NOT_FOUND" ? 404 : 400).json({ success: false, code: err.code, message: err.message });
    }
    return internalError(res, err, "adminSettlement convertToCustomer");
  }
}
```
and export it: `module.exports = { list, detail, resolve, convertToCustomer };`.
4. In `adminRoutes.js` after the `/settlements/:id/resolve` line add:
```js
router.post("/settlements/:id/convert-to-customer", auth, authorize("superadmin", "admin"), scopeFilter, adminSettlementController.convertToCustomer);
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/adminSettlementController.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/adminSettlementController.js backend/src/routes/adminRoutes.js backend/src/controllers/__tests__/adminSettlementController.test.js
git commit -m "feat(receiver-pay): admin settlement list fields and convert-to-customer action

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Full regression, spec sync and manual QA checklist

**Files:**
- Modify: `docs/superpowers/specs/2026-10-05-receiver-pays-design.md` (sync the three deviations)
- Create: `docs/superpowers/plans/2026-10-05-receiver-pays-qa-checklist.md`

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && npx jest`
Expected: all suites PASS. Triage any failure: a failure in a pre-existing suite means a regression from this work (fix the code), unless it is one of the intentionally changed behaviours (customer withdraw now 403; `publicView` extra fields), in which case update that test's expectation.

- [ ] **Step 2: Sync the spec with the plan's deviations**

In the spec: (a) replace the WhatsApp paragraph that mentions `PAY` / `NO` replies with "the receiver declines on the pay page, the driver with *Receiver refused*, or the booker with *I'll pay myself*; the link is resent by the driver or the booker (no WhatsApp keyword, no admin resend)"; (b) add `receiver_credited` TINYINT(1) default 0 to the `order_settlement` column list; (c) in the Admin section drop "resend the link" and keep "convert to customer mode"; note the base URL comes from `PUBLIC_BASE_URL`.

- [ ] **Step 3: Write the manual QA checklist**

Create `2026-10-05-receiver-pays-qa-checklist.md` with these dev-environment checks (each with expected result):
1. Enable `settlement_enabled` and `receiver_pay_enabled` (+ `PUBLIC_BASE_URL`, Razorpay **test** keys, WhatsApp client connected) in the dev DB/env.
2. Book a cash order with `receiver_pays: true, receiver_commission_percent: 3` -> response `receiver_pay: true`; receiver gets the booked WhatsApp with the payer line.
3. Booking with `receiver_commission_percent` above the admin max -> HTTP 400.
4. Driver accepts, booker pays the advance, ride completes -> settlement row has `payer = receiver`, `advance_held = advance`, markup = 3% of the amount; receiver gets the pay link on WhatsApp with the exact total.
5. Open the link on a phone, pay with a Razorpay test card -> settlement `paid_online` / `confirmed_by = receiver_online`; driver wallet credited `fare - commission`; booker wallet: `+advance` and `+commission` rows (`receiver_advance_refund:<id>`, `receiver_markup_credit:<id>`); link now shows "Payment received".
6. Repeat 4, then driver taps **Received** instead -> advance refund only, markup 0, receiver link shows "No payment is needed".
7. Repeat 4, receiver taps **Decline** -> settlement `payer = customer`, `amount_due = amount - advance`, no booker credit; driver/booker apps receive `settlement:updated`.
8. Repeat 4, driver calls `receiver-refused` -> same as 7. Booker `take-over` before completion -> completion creates a normal settlement.
9. Resend link twice within a minute -> second call `TOO_SOON`; old link stops working after a resend.
10. Admin: list shows payer/markup/advance; `convert-to-customer` works; resolving a receiver-paid settlement to `waived` reverses credits (check `reversal_shortfall` when the booker wallet was emptied first).
11. `POST /wallet/withdraw` with `wallet_type: "user"` -> 403.
12. Feature off (`receiver_pay_enabled` = 0): booking with `receiver_pays: true` -> `RECEIVER_PAY_UNAVAILABLE`; a normal ride is byte-for-byte unchanged.
13. Prod launch gate: run `20261005010000_add_receiver_pay/migration.sql` on prod before deploy; CA signs off on the commission's GST treatment before switching `receiver_pay_enabled` on.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-05-receiver-pays-design.md docs/superpowers/plans/2026-10-05-receiver-pays-qa-checklist.md
git commit -m "docs(receiver-pay): sync spec with plan deviations and add QA checklist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**
- Purpose / decisions table: advance as held deposit (Tasks 5, 6), commission base and caps (Tasks 2, 6), spend-only wallet (Task 3), no-app WhatsApp pay link (Tasks 6, 8), settlement-based architecture (Tasks 5-7), cash receiver markup 0 (Task 5 `markCashReceived`).
- Money model: markup computed at completion from locked percent (Task 6 hook), `prepaid_amount` excludes advance, `advance_apply` unchanged (Task 6 test), booker credits keyed per settlement (Task 5).
- Data model: migration + models (Task 1) incl. `reversal_shortfall`, plus the added `receiver_credited`.
- Lifecycle: booking (Task 4), accept unchanged, completion (Task 6), receiver pays / driver Received (Tasks 5, 7), decline / take-over (Tasks 7, 9).
- Pay page, API, security (token hash, expiry, rate limit, no booker phone) (Task 8); WhatsApp booked line + link message (Tasks 4, 6).
- Fallback cases: decline before/after completion, advance covers all, race with completion, admin reverse with shortfall cap, Monthly/Daily fallback, advance 0 (Tasks 5-7).
- Admin settings (Task 2) and visibility + convert (Task 10). Apps and admin UI are out of scope of this backend plan by design (stated at the top).
- Testing section of the spec: each backend bullet maps to a test in Tasks 2-10; app and device runs are in the QA checklist.

**Placeholder scan:** no TBD/TODO; every code step has code. Two steps tell the implementer to adapt to existing test-file helpers (`mockRes` in Task 10, the `settlementService` mock factory in Task 9) because those files' internals were not copied here; both name exactly what to reuse.

**Type consistency:** `declineReceiverPay` returns `{ phase, settlement }` everywhere (Tasks 7, 9, 10); `issueLink` returns `{ sent, link }` (Tasks 6, 9); `receiver: { markup, advanceHeld }` matches between Task 5 (`createForCompletedOrder`) and Task 6 (hook); `applyReceiverCredits(tx, s, { includeMarkup, notifications })` signature matches its uses in Tasks 5 and 7; error codes (`RECEIVER_MODE`, `INVALID_LINK`, `LINK_EXPIRED`, `PAYMENT_MISMATCH`, `PAID_BUT_STATE_CHANGED`, `TOO_SOON`, `LINK_LIMIT`, `NOT_ACTIVE`, `NOT_PAYABLE`, `NOT_CONFIGURED`) are used consistently.

**Review Focus coverage:** (1) double verify: Task 7 test "repeat of the same payment id"; (2) driver cash vs receiver payment race: Task 7 `PAID_BUT_STATE_CHANGED` test; (3) advance 0 / larger than amount: Task 5 credits test + Task 6 hook tests; (4) bad/expired/foreign token: Task 7 `getPublicState` tests + Task 8 controller tests; (5) decline vs completion race: Task 7 "row already declined" test.

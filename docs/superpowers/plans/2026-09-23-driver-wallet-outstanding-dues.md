# Driver Wallet Withdraw & Outstanding Dues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the driver wallet backend so drivers can no longer self-recharge, withdrawal is an atomic (race-free) immediate debit, a negative balance is tracked as an admin-configurable "outstanding due" that must be cleared via an exact-amount Razorpay payment, and drivers with a negative balance stop receiving new ride offers.

**Architecture:** All changes live in the existing Node/Express + Prisma backend. `customerWalletController.js` (shared customer/driver wallet controller) gets a server-side block on driver recharge, an atomic-transaction rewrite of withdraw, new due-derived fields on `walletHistory`, and two new driver-only endpoints for clearing outstanding dues via Razorpay. A new tiny `driverWalletSettings.js` service reads the admin-configurable max-due-limit from the existing generic `app_settings` key/value store (no schema migration). `dispatchManager.js`'s existing raw-SQL driver-eligibility query gets one new `AND` condition. The old admin-approval withdrawal path is left in place but marked superseded.

**Tech Stack:** Node.js, Express, Prisma (MySQL), Jest for tests, Razorpay REST API (raw `fetch`, no SDK — matches existing convention in this file).

**Spec:** `docs/superpowers/specs/2026-09-23-driver-wallet-outstanding-dues-design.md`

## Global Constraints

- No schema migration: `driver_max_due_limit` is stored as an `app_settings` row (`setting_key`/`setting_value`), default `100` when absent — never add a column to `tbl_rider` or the `setting` singleton for it.
- No real bank/UPI payout automation (RazorpayX) — withdrawal only ever decrements `wallet_balance` + writes a `tbl_wallet_history` row, exactly as `withdrawWallet` does today, just made atomic.
- Every wallet-balance mutation must be paired with a `tbl_wallet_history` row in the same DB transaction — never mutate one without the other.
- Follow the existing "200 always, logical status in the JSON body" HTTP convention used throughout `customerWalletController.js` (`ResponseCode`/`Result` or `Result`/`msg` envelopes) — do not introduce non-2xx statuses into these endpoints.
- Reuse `verifyRazorpayPayment` from `backend/src/utils/razorpayVerify.js` for any new payment-verification code — never re-implement signature/amount checking.
- `driverPayoutController.withdrawRequest` + `payoutController.approve`/`reject` and the `driver_withdraw_requests`/`payout_setting` tables are left in place, unmodified except for one deprecation comment — do not delete routes, controllers, or run a migration against them.
- Match existing test conventions exactly: `jest.mock("../../config/db", () => ({...}))` with only the Prisma models/methods a test file actually uses, `jest.mock("../../utils/logger", ...)`, `jest.mock("../../utils/razorpayVerify", ...)`, and for interactive transactions `prisma.$transaction.mockImplementation((cb) => cb(prisma))` (see `tripLifecycle.test.js:55`).

## Review Focus

- A driver with `wallet_balance` of exactly `0` must be able to neither withdraw (balance not `> 0`) nor "clear outstanding" (nothing to clear) — the mockup's row for balance `= 0` shows Withdraw disabled and Clear Outstanding hidden; confirm both endpoints reject at exactly zero, not just below zero.
- Two concurrent `withdrawWallet` calls for the same driver, each individually valid against the starting balance but not against each other, must result in only one succeeding — this is the whole point of the race fix, not just a happy-path atomic-update test.
- `clearOutstandingDue` must never trust a client-supplied amount — it must credit exactly the amount tied to the Razorpay order it verifies, even if the driver's balance changed (e.g. a commission debit landed) between order creation and payment verification; document what happens in that gap rather than silently over/under crediting.
- `driver_max_due_limit` missing from `app_settings` entirely (never configured by an admin) must fall back to the documented default of `100`, not throw or return `null`/`NaN` into the wallet response.
- The new `dispatchManager` wallet gate must not affect the customer wallet or any other rider field already filtered in that query — a rider with `wallet_balance: null` (never touched) must not be silently excluded; only decide the plan's treatment of `null` explicitly and test it (this codebase defaults `wallet_balance` to `0.00` at the DB level via `@default(0.00)`, so `null` should be treated as within the schema's default and therefore eligible).

---

### Task 1: Driver max-due-limit settings helper

**Files:**
- Create: `backend/src/services/driverWalletSettings.js`
- Test: `backend/src/services/__tests__/driverWalletSettings.test.js`

**Interfaces:**
- Produces: `getDriverMaxDueLimit(): Promise<number>` — reads the `app_settings` row with `setting_key: "driver_max_due_limit"`, returns its numeric value, or `100` if the row is absent/empty/non-numeric. Later tasks (`walletHistory`) call this.
- Produces: `DRIVER_MAX_DUE_LIMIT_KEY = "driver_max_due_limit"` (exported constant, so Task 4's tests and any future admin-panel wiring use the same literal instead of a second hardcoded string).

- [ ] **Step 1: Write the failing test**

```js
// backend/src/services/__tests__/driverWalletSettings.test.js
jest.mock("../../config/db", () => ({
  app_settings: { findFirst: jest.fn() },
}));
const prisma = require("../../config/db");
const { getDriverMaxDueLimit, DRIVER_MAX_DUE_LIMIT_KEY } = require("../driverWalletSettings");

describe("driverWalletSettings.getDriverMaxDueLimit", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the configured numeric value", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MAX_DUE_LIMIT_KEY, setting_value: "150" });
    expect(await getDriverMaxDueLimit()).toBe(150);
    expect(prisma.app_settings.findFirst).toHaveBeenCalledWith({ where: { setting_key: DRIVER_MAX_DUE_LIMIT_KEY } });
  });

  it("defaults to 100 when no admin setting exists yet", async () => {
    prisma.app_settings.findFirst.mockResolvedValue(null);
    expect(await getDriverMaxDueLimit()).toBe(100);
  });

  it("defaults to 100 when the stored value is empty or non-numeric", async () => {
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MAX_DUE_LIMIT_KEY, setting_value: "" });
    expect(await getDriverMaxDueLimit()).toBe(100);
    prisma.app_settings.findFirst.mockResolvedValue({ setting_key: DRIVER_MAX_DUE_LIMIT_KEY, setting_value: "not-a-number" });
    expect(await getDriverMaxDueLimit()).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/driverWalletSettings.test.js`
Expected: FAIL — `Cannot find module '../driverWalletSettings'`

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/driverWalletSettings.js
const prisma = require("../config/db");

const DRIVER_MAX_DUE_LIMIT_KEY = "driver_max_due_limit";
const DEFAULT_DRIVER_MAX_DUE_LIMIT = 100;

async function getDriverMaxDueLimit() {
  const row = await prisma.app_settings.findFirst({ where: { setting_key: DRIVER_MAX_DUE_LIMIT_KEY } });
  if (!row || row.setting_value === null || row.setting_value === undefined || row.setting_value === "") {
    return DEFAULT_DRIVER_MAX_DUE_LIMIT;
  }
  const parsed = parseFloat(row.setting_value);
  return Number.isNaN(parsed) ? DEFAULT_DRIVER_MAX_DUE_LIMIT : parsed;
}

module.exports = { getDriverMaxDueLimit, DRIVER_MAX_DUE_LIMIT_KEY, DEFAULT_DRIVER_MAX_DUE_LIMIT };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/driverWalletSettings.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/driverWalletSettings.js backend/src/services/__tests__/driverWalletSettings.test.js
git commit -m "feat(wallet): add admin-configurable driver max-due-limit setting"
```

---

### Task 2: Block driver self-recharge server-side

**Files:**
- Modify: `backend/src/controllers/customerWalletController.js:78-90` (`addWallet`)
- Test: `backend/src/controllers/__tests__/driverWalletFlows.test.js` (new file)

**Interfaces:**
- Consumes: nothing new.
- Produces: `addWallet` now returns `{ Result: false, msg: "Drivers cannot add money to their wallet." }` for any request with `wallet_type: "driver"`, before Razorpay verification runs. Customer (`wallet_type: "user"`) behavior is unchanged.

- [ ] **Step 1: Write the failing test**

```js
// backend/src/controllers/__tests__/driverWalletFlows.test.js
jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  tbl_user: { findFirst: jest.fn(), update: jest.fn() },
  tbl_wallet_history: { create: jest.fn(), findFirst: jest.fn() },
  app_settings: { findFirst: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({ error: jest.fn() }));
jest.mock("../../utils/razorpayVerify", () => ({ verifyRazorpayPayment: jest.fn() }));

const prisma = require("../../config/db");
const { verifyRazorpayPayment } = require("../../utils/razorpayVerify");

function mockRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
}

describe("customerWalletController.addWallet driver block", () => {
  const { addWallet } = require("../customerWalletController");
  const driverBody = {
    mobile: "9999999999",
    amount: 100,
    wallet_type: "driver",
    razorpay_payment_id: "pay_1",
    razorpay_order_id: "order_1",
    razorpay_signature: "sig_1",
  };

  beforeEach(() => jest.clearAllMocks());

  it("refuses a driver recharge before verifying the payment with Razorpay", async () => {
    const res = mockRes();
    await addWallet({ body: driverBody }, res);
    expect(verifyRazorpayPayment).not.toHaveBeenCalled();
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, msg: "Drivers cannot add money to their wallet." }));
  });

  it("still allows a customer recharge", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 15, wallet: 50 });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    prisma.tbl_user.update.mockResolvedValue({ wallet: 150 });
    const res = mockRes();
    await addWallet({ body: { ...driverBody, wallet_type: "user" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js`
Expected: FAIL on the first test — `verifyRazorpayPayment` was called (driver block doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `backend/src/controllers/customerWalletController.js`, inside `addWallet`, right after the existing missing-parameters check (currently ending at line 90 `if (!mobile || ...) { return fail(res, "Missing Parameters"); }`), add:

```js
    if (walletType === "driver") {
      return fail(res, "Drivers cannot add money to their wallet.");
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js`
Expected: PASS (2 tests)

Also run the pre-existing regression suite to confirm the customer path (`wallet_type: "user"`) is untouched:

Run: `cd backend && npx jest src/controllers/__tests__/securityFixes.test.js`
Expected: PASS (no changes to any addWallet "user" assertions)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/customerWalletController.js backend/src/controllers/__tests__/driverWalletFlows.test.js
git commit -m "fix(wallet): block driver self-recharge server-side, not just in the app UI"
```

---

### Task 3: Fix the withdraw race condition and enforce due-aware rejection

**Files:**
- Modify: `backend/src/controllers/customerWalletController.js:213-251` (`withdrawWallet`)
- Test: `backend/src/controllers/__tests__/driverWalletFlows.test.js` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces: `withdrawWallet` now (a) rejects when `walletType === "driver"` and current balance `<= 0`, (b) performs the debit + ledger insert atomically via `prisma.$transaction(async (tx) => {...})` using a conditional `updateMany` guard (`where: { id, wallet_balance: { gte: amount } }`), so two concurrent calls for the same balance can't both succeed, (c) returns `{ ResponseCode: "402", ... }` "Insufficient Balance!" when the conditional update matches zero rows.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/controllers/__tests__/driverWalletFlows.test.js`:

```js
describe("customerWalletController.withdrawWallet", () => {
  const { withdrawWallet } = require("../customerWalletController");
  const driverBody = { mobile: "9999999999", amount: 100, wallet_type: "driver" };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((cb) => cb(prisma));
  });

  it("rejects a driver withdraw when balance is exactly 0", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "0.00" });
    const res = mockRes();
    await withdrawWallet({ body: driverBody }, res);
    expect(prisma.tbl_rider.updateMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("rejects a driver withdraw when balance is already negative", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-20.00" });
    const res = mockRes();
    await withdrawWallet({ body: driverBody }, res);
    expect(prisma.tbl_rider.updateMany).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("debits atomically and writes the ledger row in the same transaction", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "500.00" });
    prisma.tbl_rider.updateMany.mockResolvedValue({ count: 1 });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    const res = mockRes();
    await withdrawWallet({ body: driverBody }, res);
    expect(prisma.tbl_rider.updateMany).toHaveBeenCalledWith({
      where: { id: 7, wallet_balance: { gte: 100 } },
      data: { wallet_balance: { decrement: 100 } },
    });
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ user_id: 7, amount: 100, type: "debit" }) })
    );
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true" }));
  });

  it("reports insufficient balance instead of over-withdrawing when a concurrent request already spent the balance", async () => {
    // Simulates two concurrent withdraw calls both reading wallet_balance=100
    // before either commits: the first's transaction wins the atomic
    // updateMany; this second call's updateMany then matches 0 rows because
    // the WHERE's wallet_balance >= amount no longer holds against the
    // already-decremented row.
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "100.00" });
    prisma.tbl_rider.updateMany.mockResolvedValue({ count: 0 });
    const res = mockRes();
    await withdrawWallet({ body: { ...driverBody, amount: 100 } }, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ResponseCode: "402", Result: "false" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js -t withdrawWallet`
Expected: FAIL — current implementation calls `tbl_rider.update` (not `updateMany`) and never checks `balance <= 0` for drivers, so several assertions mismatch.

- [ ] **Step 3: Write minimal implementation**

Replace `withdrawWallet` in `backend/src/controllers/customerWalletController.js` (lines 213-251) with:

```js
// --- withdraw_wallet.php ---
async function withdrawWallet(req, res) {
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || "");
    const amount = Number(b.amount || 0);
    const walletType = b.wallet_type || "user";
    const remark = b.remark || "Wallet Withdraw";
    if (!mobile || !amount || !walletType) return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Missing Data" });

    const account =
      walletType === "user"
        ? await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile) } })
        : await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!account) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Mobile Not Found!" });
    }

    const currentBalance = Number(walletType === "user" ? account.wallet : account.wallet_balance || 0);
    if (walletType === "driver" && currentBalance <= 0) {
      return res.status(200).json({ ResponseCode: "403", Result: "false", ResponseMsg: "No withdrawable balance. Clear your outstanding dues first." });
    }
    if (currentBalance < amount) {
      return res.status(200).json({ ResponseCode: "402", Result: "false", ResponseMsg: "Insufficient Balance!" });
    }

    // Atomic conditional debit: the WHERE clause re-checks the balance at
    // commit time instead of trusting the currentBalance read above, so two
    // concurrent withdraw calls for the same driver can no longer both pass
    // (see customerWalletController.withdrawWallet race - fixed 2026-09-23).
    const model = walletType === "user" ? "tbl_user" : "tbl_rider";
    const balanceField = walletType === "user" ? "wallet" : "wallet_balance";

    let debited = false;
    await prisma.$transaction(async (tx) => {
      const result = await tx[model].updateMany({
        where: { id: account.id, [balanceField]: { gte: amount } },
        data: { [balanceField]: { decrement: amount } },
      });
      if (result.count === 0) return;
      debited = true;
      await tx.tbl_wallet_history.create({
        data: { user_id: account.id, mobile, amount, type: "debit", remark, wallet_type: walletType, created_at: new Date() },
      });
    });

    if (!debited) {
      return res.status(200).json({ ResponseCode: "402", Result: "false", ResponseMsg: "Insufficient Balance!" });
    }

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Withdraw Successful!", NewBalance: currentBalance - amount });
  } catch (err) {
    logger.error("customerWalletController.withdrawWallet failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}
```

Note: `NewBalance` in the response is derived from the pre-transaction `currentBalance - amount`, which is correct because we only reach that line when `debited === true`, meaning the atomic `updateMany` matched (i.e. no concurrent debit happened in between) — the arithmetic and the DB state agree in that branch.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js`
Expected: PASS (all `withdrawWallet` tests plus Task 2's `addWallet` tests)

Run: `cd backend && npx jest src/controllers/__tests__/securityFixes.test.js src/controllers/__tests__/driverWalletSummary.test.js`
Expected: PASS — confirms the customer withdraw path and `walletHistory` are unaffected.

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/customerWalletController.js backend/src/controllers/__tests__/driverWalletFlows.test.js
git commit -m "fix(wallet): make withdraw atomic to close a concurrent double-withdraw race"
```

---

### Task 4: Expose outstanding-due fields on walletHistory (driver branch)

**Files:**
- Modify: `backend/src/controllers/customerWalletController.js:152-210` (`walletHistory`)
- Test: `backend/src/controllers/__tests__/driverWalletFlows.test.js` (append)

**Interfaces:**
- Consumes: `getDriverMaxDueLimit()` from `../../services/driverWalletSettings` (Task 1).
- Produces: for `wallet_type: "driver"` requests, `walletHistory`'s response gains `outstanding_due` (string, 2dp), `max_due_limit` (number), `can_withdraw` (boolean), `can_clear_due` (boolean), `due_limit_reached` (boolean). Customer (`wallet_type: "user"`) response shape is unchanged.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/controllers/__tests__/driverWalletFlows.test.js`:

```js
jest.mock("../../services/driverWalletSettings", () => ({ getDriverMaxDueLimit: jest.fn() }));

describe("customerWalletController.walletHistory outstanding-due fields", () => {
  const { walletHistory } = require("../customerWalletController");
  const { getDriverMaxDueLimit } = require("../../services/driverWalletSettings");

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.tbl_wallet_history.findMany.mockResolvedValue([]);
    getDriverMaxDueLimit.mockResolvedValue(100);
  });

  async function request(riderOverrides) {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "0.00", ...riderOverrides });
    const res = mockRes();
    await walletHistory({ body: { mobile: "9000000000", wallet_type: "driver" } }, res);
    return res.json.mock.calls[0][0];
  }

  it("balance = 0: cannot withdraw, cannot clear due, limit not reached", async () => {
    const result = await request({ wallet_balance: "0.00" });
    expect(result.can_withdraw).toBe(false);
    expect(result.can_clear_due).toBe(false);
    expect(result.outstanding_due).toBe("0.00");
    expect(result.due_limit_reached).toBe(false);
  });

  it("balance = -70 (within limit): cannot withdraw, can clear due, limit not reached", async () => {
    const result = await request({ wallet_balance: "-70.00" });
    expect(result.can_withdraw).toBe(false);
    expect(result.can_clear_due).toBe(true);
    expect(result.outstanding_due).toBe("70.00");
    expect(result.max_due_limit).toBe(100);
    expect(result.due_limit_reached).toBe(false);
  });

  it("balance = -100 (at limit): due_limit_reached is true", async () => {
    const result = await request({ wallet_balance: "-100.00" });
    expect(result.can_clear_due).toBe(true);
    expect(result.due_limit_reached).toBe(true);
  });

  it("balance = 690 (positive): can withdraw, cannot clear due", async () => {
    const result = await request({ wallet_balance: "690.00" });
    expect(result.can_withdraw).toBe(true);
    expect(result.can_clear_due).toBe(false);
    expect(result.outstanding_due).toBe("0.00");
  });

  it("does not add these fields for a customer wallet", async () => {
    prisma.tbl_user.findFirst.mockResolvedValue({ id: 2, wallet: "90.00" });
    const res = mockRes();
    await walletHistory({ body: { mobile: "9000000000", wallet_type: "user" } }, res);
    const result = res.json.mock.calls[0][0];
    expect(result).not.toHaveProperty("outstanding_due");
    expect(result).not.toHaveProperty("can_withdraw");
    expect(getDriverMaxDueLimit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js -t "outstanding-due"`
Expected: FAIL — none of the new fields exist on the response yet.

- [ ] **Step 3: Write minimal implementation**

At the top of `backend/src/controllers/customerWalletController.js`, add the import:

```js
const { getDriverMaxDueLimit } = require("../services/driverWalletSettings");
```

In `walletHistory`, inside the existing `if (walletType === "driver") { ... }` block (lines 181-192 today) that builds `withdrawalSummary`, add the due calculations using the already-computed `wallet` value:

```js
    let withdrawalSummary = {};
    if (walletType === "driver") {
      const [pending, latest, maxDueLimit] = await Promise.all([
        prisma.driver_withdraw_requests.aggregate({ where: { rider_id: userId, status: "pending" }, _sum: { amount: true } }),
        prisma.driver_withdraw_requests.findFirst({ where: { rider_id: userId }, orderBy: { id: "desc" }, select: { id: true, amount: true, status: true, created_at: true } }),
        getDriverMaxDueLimit(),
      ]);
      const pendingAmount = Number(pending._sum.amount || 0);
      const balanceNum = Number(wallet || 0);
      const outstandingDue = Math.max(0, -balanceNum);
      withdrawalSummary = {
        pending_withdrawal_amount: pendingAmount.toFixed(2),
        available_to_withdraw: Math.max(0, balanceNum - pendingAmount).toFixed(2),
        latest_withdrawal: latest ? { id: latest.id, amount: Number(latest.amount || 0).toFixed(2), status: latest.status, created_at: latest.created_at } : null,
        outstanding_due: outstandingDue.toFixed(2),
        max_due_limit: maxDueLimit,
        can_withdraw: balanceNum > 0,
        can_clear_due: balanceNum < 0,
        due_limit_reached: balanceNum <= -maxDueLimit,
      };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js`
Expected: PASS

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletSummary.test.js`
Expected: PASS — the pre-existing pending-withdrawal-reservation tests must keep passing unchanged (that test file mocks `driverWalletSettings`? No — check: since it doesn't mock `../../services/driverWalletSettings`, the real module will run and call the real (mocked-db) `prisma.app_settings.findFirst`, which is undefined on that file's `db` mock. Add `app_settings: { findFirst: jest.fn() }` to that file's existing `jest.mock("../../config/db", ...)` block so the call resolves instead of throwing.

- [ ] **Step 4b: Fix the pre-existing test file's mock to include app_settings**

In `backend/src/controllers/__tests__/driverWalletSummary.test.js`, update the `jest.mock("../../config/db", ...)` call (lines 1-5) to add the new model:

```js
jest.mock("../../config/db", () => ({
  tbl_rider: { findFirst: jest.fn() }, tbl_user: { findFirst: jest.fn() },
  tbl_wallet_history: { findMany: jest.fn() },
  driver_withdraw_requests: { aggregate: jest.fn(), findFirst: jest.fn() },
  app_settings: { findFirst: jest.fn() },
}));
```

Re-run:

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletSummary.test.js`
Expected: PASS (4 tests, unchanged assertions — `getDriverMaxDueLimit` resolves to the default `100` since `app_settings.findFirst` returns `undefined` by default in that file's mocks, which the Task 1 helper already treats as "use the default")

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/customerWalletController.js backend/src/controllers/__tests__/driverWalletFlows.test.js backend/src/controllers/__tests__/driverWalletSummary.test.js
git commit -m "feat(wallet): expose outstanding-due and button-visibility flags on walletHistory"
```

---

### Task 5: "Clear Outstanding" endpoints + routes

**Files:**
- Modify: `backend/src/controllers/customerWalletController.js` (add two functions + update `module.exports`)
- Modify: `backend/src/routes/user.routes.js:32-36`
- Test: `backend/src/controllers/__tests__/driverWalletFlows.test.js` (append)

**Interfaces:**
- Consumes: `verifyRazorpayPayment` from `../utils/razorpayVerify` (existing).
- Produces: `createClearDueOrder(req, res)` — driver-only, computes the due server-side, creates a Razorpay order for exactly that amount, returns `{ ResponseCode, Result, OrderId, amount, currency, due_amount }`. `clearOutstandingDue(req, res)` — verifies the payment against that order, credits `wallet_balance` by the verified amount, writes a `tbl_wallet_history` credit row with `remark: "Outstanding Due Cleared"`, returns `{ Result: true, msg, balance }`. Both added to `module.exports`.
- Routes: `POST /wallet/clear-due/create-order` → `createClearDueOrder`, `POST /wallet/clear-due/verify` → `clearOutstandingDue`, added next to the existing wallet routes in `user.routes.js`.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/controllers/__tests__/driverWalletFlows.test.js`:

```js
describe("customerWalletController.createClearDueOrder", () => {
  const { createClearDueOrder } = require("../customerWalletController");
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RAZORPAY_KEY_ID = "key_id";
    process.env.RAZORPAY_KEY_SECRET = "key_secret";
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("refuses to create an order when there is no outstanding due", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "50.00" });
    const res = mockRes();
    await createClearDueOrder({ body: { mobile: "9000000000" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "false" }));
  });

  it("creates a Razorpay order for exactly the server-computed due amount, ignoring any client-sent amount", async () => {
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "order_due_1", amount: 7000, currency: "INR" }),
    });
    const res = mockRes();
    await createClearDueOrder({ body: { mobile: "9000000000", amount: 999999 } }, res);
    const [, options] = global.fetch.mock.calls[0];
    const sentBody = JSON.parse(options.body);
    expect(sentBody.amount).toBe(7000); // 70.00 rupees in paise, not the client's 999999
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: "true", OrderId: "order_due_1", due_amount: 70 }));
  });
});

describe("customerWalletController.clearOutstandingDue", () => {
  const { clearOutstandingDue } = require("../customerWalletController");
  const body = {
    mobile: "9000000000",
    razorpay_payment_id: "pay_due_1",
    razorpay_order_id: "order_due_1",
    razorpay_signature: "sig_1",
    due_amount: 70,
  };

  beforeEach(() => jest.clearAllMocks());

  it("credits the wallet by exactly the verified due amount once payment is verified", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    prisma.tbl_wallet_history.create.mockResolvedValue({ id: 1 });
    prisma.tbl_rider.update.mockResolvedValue({ wallet_balance: "0.00" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(verifyRazorpayPayment).toHaveBeenCalledWith(expect.objectContaining({ expectedAmountRupees: 70 }));
    expect(prisma.tbl_wallet_history.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 70, type: "credit", remark: "Outstanding Due Cleared", razorpay_payment_id: "pay_due_1" }) })
    );
    expect(prisma.tbl_rider.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { wallet_balance: { increment: 70 } } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: true }));
  });

  it("refuses when Razorpay verification fails", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: false, reason: "Payment Verification Failed!" });
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.tbl_wallet_history.create).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false }));
  });

  it("rejects a replayed payment_id via the existing unique-constraint guard", async () => {
    verifyRazorpayPayment.mockResolvedValue({ ok: true, payment: { status: "captured" } });
    prisma.tbl_rider.findFirst.mockResolvedValue({ id: 7, wallet_balance: "-70.00" });
    const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    prisma.tbl_wallet_history.create.mockRejectedValue(p2002);
    const res = mockRes();
    await clearOutstandingDue({ body }, res);
    expect(prisma.tbl_rider.update).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ Result: false, msg: "This payment has already been credited." }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js -t "ClearDue\|clearOutstandingDue"`
Expected: FAIL — `createClearDueOrder`/`clearOutstandingDue` are not exported yet.

- [ ] **Step 3: Write minimal implementation**

Add to `backend/src/controllers/customerWalletController.js`, after `createRazorpayOrder` and before `addWallet`:

```js
// --- Clear Outstanding Due (driver-only) ---
// The amount is always computed server-side from the driver's current
// wallet_balance, never taken from the client, so a tampered client can't
// request an order for less than the real due or credit more than it paid
// for (see design spec 2026-09-23-driver-wallet-outstanding-dues-design.md).
async function createClearDueOrder(req, res) {
  try {
    const mobile = String(req.body?.mobile || "");
    if (!mobile) return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "Missing Data" });

    const rider = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!rider) return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "No driver found with this mobile number!" });

    const dueAmount = Math.max(0, -Number(rider.wallet_balance || 0));
    if (dueAmount <= 0) {
      return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: "No outstanding dues to clear." });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      logger.error("createClearDueOrder: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.");
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Payment gateway is not configured. Try again later." });
    }

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const resp = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        amount: Math.round(dueAmount * 100),
        currency: "INR",
        receipt: `cleardue_${rider.id}_${Date.now()}`,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      logger.error("createClearDueOrder: Razorpay API error:", data);
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: data?.error?.description || "Failed to create payment order" });
    }

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Order created",
      OrderId: data.id,
      order_id: data.id,
      amount: data.amount,
      currency: data.currency,
      due_amount: dueAmount,
    });
  } catch (err) {
    logger.error("createClearDueOrder failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: "Internal server error" });
  }
}

async function clearOutstandingDue(req, res) {
  try {
    const b = req.body || {};
    const mobile = String(b.mobile || "");
    const dueAmount = Number(b.due_amount || 0);
    const razorpayPaymentId = b.razorpay_payment_id;
    const razorpayOrderId = b.razorpay_order_id;
    const razorpaySignature = b.razorpay_signature;

    if (!mobile || !dueAmount || !razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      return fail(res, "Missing Parameters");
    }

    let verification;
    try {
      verification = await verifyRazorpayPayment({
        paymentId: razorpayPaymentId,
        orderId: razorpayOrderId,
        signature: razorpaySignature,
        expectedAmountRupees: dueAmount,
      });
    } catch (e) {
      logger.error("clearOutstandingDue: RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET not configured.", e);
      return res.status(200).json({ Result: false, msg: "Payment verification is not configured. Try again later." });
    }
    if (!verification.ok) return fail(res, verification.reason);

    const rider = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (!rider) return fail(res, "No driver found with this mobile number!");

    try {
      await prisma.tbl_wallet_history.create({
        data: {
          user_id: rider.id,
          mobile,
          amount: dueAmount,
          type: "credit",
          remark: "Outstanding Due Cleared",
          payment_id: razorpayPaymentId,
          razorpay_payment_id: razorpayPaymentId,
          wallet_type: "driver",
          created_at: new Date(),
        },
      });
    } catch (e) {
      if (e.code === "P2002") return fail(res, "This payment has already been credited.");
      throw e;
    }

    const updated = await prisma.tbl_rider.update({ where: { id: rider.id }, data: { wallet_balance: { increment: dueAmount } } });
    return res.status(200).json({ Result: true, msg: "Outstanding due cleared", balance: Number(updated.wallet_balance) });
  } catch (err) {
    logger.error("customerWalletController.clearOutstandingDue failed:", err);
    return fail(res, "Internal server error");
  }
}
```

Update the `module.exports` at the bottom of the file to:

```js
module.exports = { addWallet, walletHistory, withdrawWallet, createRazorpayOrder, createClearDueOrder, clearOutstandingDue };
```

In `backend/src/routes/user.routes.js`, add two lines after the existing wallet routes (after line 36):

```js
router.post("/wallet/clear-due/create-order", customerWalletController.createClearDueOrder);
router.post("/wallet/clear-due/verify", customerWalletController.clearOutstandingDue);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/driverWalletFlows.test.js`
Expected: PASS (all describe blocks in the file)

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/customerWalletController.js backend/src/routes/user.routes.js backend/src/controllers/__tests__/driverWalletFlows.test.js
git commit -m "feat(wallet): add server-computed clear-outstanding-due Razorpay flow for drivers"
```

---

### Task 6: Gate new-ride assignment on non-negative wallet balance

**Files:**
- Modify: `backend/src/services/dispatchManager.js:133-168` (`selectEligibleDrivers`'s raw-SQL `WHERE` clause)
- Test: `backend/src/services/__tests__/dispatchManager.test.js` (append)

**Interfaces:**
- Consumes: nothing new (reads `tbl_rider.wallet_balance`, already selected implicitly via `r.*`... actually the query selects specific columns, not `r.*` — no new column needs to be added to the `SELECT` list since the condition only needs to appear in `WHERE`).
- Produces: no behavior change to the function's return type; one more exclusion condition in the underlying SQL.

- [ ] **Step 1: Write the failing test**

Append to `backend/src/services/__tests__/dispatchManager.test.js`:

```js
describe("dispatchManager.selectEligibleDrivers wallet-balance gate", () => {
  const { selectEligibleDrivers } = dispatchManager;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$queryRaw.mockResolvedValue([]);
  });

  it("excludes drivers with a negative wallet balance from new-ride offers", async () => {
    const order = { id: 900, uid: 7, plat: "28.7", plong: "77.1", category: "Bike" };
    await selectEligibleDrivers(order, 6, []);
    const [strings] = prisma.$queryRaw.mock.calls[0];
    const sql = strings.join(" ");
    expect(sql).toContain("wallet_balance >= 0");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.test.js -t "wallet-balance gate"`
Expected: FAIL — the current SQL string doesn't contain `wallet_balance >= 0`.

- [ ] **Step 3: Write minimal implementation**

In `backend/src/services/dispatchManager.js`, add one line to the `WHERE` clause of `selectEligibleDrivers` (right after the existing `AND r.id NOT IN (...)` active-trip exclusion block, before the Model-1 suspension condition, i.e. immediately after the closing `)` currently on line 145):

```sql
      AND (r.wallet_balance IS NULL OR r.wallet_balance >= 0)
```

(`IS NULL OR` covers the schema's own `@default(0.00)` for any legacy row where the column was never populated — treated as eligible, matching the plan's Review Focus decision, not silently excluded.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest src/services/__tests__/dispatchManager.test.js`
Expected: PASS (new test plus the full pre-existing suite in this file, confirming the new condition doesn't break any mocked scenario)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/dispatchManager.js backend/src/services/__tests__/dispatchManager.test.js
git commit -m "feat(dispatch): exclude drivers with a negative wallet balance from new-ride offers"
```

---

### Task 7: Deprecate the admin-approval wallet-withdrawal path

**Files:**
- Modify: `backend/src/controllers/driverPayoutController.js:123-124` (comment only, above `withdrawRequest`)

**Interfaces:**
- Consumes: nothing.
- Produces: no behavior change — this task is documentation-only, so it has no new test. The existing test suite must still pass unmodified to prove nothing broke.

- [ ] **Step 1: Update the comment**

Replace the existing comment directly above `async function withdrawRequest(req, res) {` (currently `// --- withdraw_requests.php --- (wallet-balance withdrawal, distinct from the trip-earnings payout above)`) with:

```js
// --- withdraw_requests.php --- (wallet-balance withdrawal, distinct from
// the trip-earnings payout above)
//
// SUPERSEDED as of 2026-09-23 by customerWalletController.withdrawWallet's
// immediate, atomic self-service withdraw (see
// docs/superpowers/specs/2026-09-23-driver-wallet-outstanding-dues-design.md).
// Left in place with its data intact for historical withdrawal records and
// payoutController's admin approve/reject screens - do not build new
// driver-facing withdrawal features on this path.
async function withdrawRequest(req, res) {
```

- [ ] **Step 2: Run the full backend test suite to confirm nothing broke**

Run: `cd backend && npx jest`
Expected: PASS — every existing test, including all tests added in Tasks 1-6.

- [ ] **Step 3: Commit**

```bash
git add backend/src/controllers/driverPayoutController.js
git commit -m "docs(wallet): mark the admin-approval withdrawal path superseded"
```

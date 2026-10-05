# Receiver Pays (admin panel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admins see and control receiver-pays settlements: the four feature settings, the receiver-mode fields in the Settlements list and detail drawer, and the "Convert to customer payment" action.

**Architecture:** Small, additive changes to the existing React admin panel (`frontend/`) plus one additive backend change so the settlement detail endpoint also returns the receiver row (phone, name, link status). No new routes or pages: Settings gets one new section, the Settlements list gets two small badges, the detail drawer gets one new panel component.

**Tech Stack:** React 19, Vite, Tailwind 4 (CSS variables such as `var(--brand)`), axios (`services/api.js`, base `/api/v1/admin`), lucide-react; backend Express/Prisma/Jest.

**Spec:** [docs/superpowers/specs/2026-10-05-receiver-pays-design.md](../specs/2026-10-05-receiver-pays-design.md) (Admin section). Backend that this UI calls is already on `main` (plan `2026-10-05-receiver-pays-backend.md`).

## Global Constraints

- Admin settings keys (stored through the existing Settings page `flags`, no new backend route): `receiver_pay_enabled` (0/1, default 0), `receiver_commission_max_percent` (default 5), `receiver_commission_max_amount` (default 0 = no cap), `receiver_pay_link_ttl_hours` (default 24).
- Receiver-pay needs `settlement_enabled` ON and env `PUBLIC_BASE_URL` set; the commission's GST treatment must be confirmed by the CA before enabling in prod. The Settings section must say so.
- Convert endpoint: `POST /settlements/:id/convert-to-customer` (path is relative to the admin axios base). It returns `{ success, data: { phase, settlement } }`; `phase` is `converted`, `already_normal` or `before_completion`; errors come back as `{ success: false, code, message }` (400/404).
- The detail endpoint must NEVER return `token_hash` (or any token/Razorpay secret) from `order_receiver_pay`.
- `receiver_markup`, `advance_held`, `reversal_shortfall` arrive as numbers in the list and as Prisma Decimal strings in the detail's raw `settlement` row: always wrap in `Number()` before formatting.
- UI conventions: reuse `Badge` tones (`success|info|warning|danger|brand|neutral`), `formatCurrency` / `formatDateTime` from `utils/format`, `useToast`, existing card/label class patterns; dynamic text goes through React (no `dangerouslySetInnerHTML`).
- The frontend has **no test runner** (no vitest/jest in `frontend/package.json`); frontend tasks are verified with `npm run lint` and `npm run build`, plus the manual checks listed in Task 4. Do not add a test framework in this plan.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Legacy/normal settlements (`payer = 'customer'`, or rows from before the migration where the fields are absent/null): the list and drawer must render exactly as before, with no `NaN`, `undefined` or empty panels. (Tasks 2, 3)
2. `receiver_pay` is `null` on the detail response (row missing, DB drift) or the lookup throws: the drawer must still load; the backend must not 500. (Tasks 1, 3)
3. The convert button must only be offered for a `pending` receiver-mode settlement, be disabled while the request runs (double-click), and a failed convert must show the server's message without closing/corrupting the drawer. (Task 3)
4. Settings: saving must persist all four keys through the existing flags save path and they must not also appear in the generic "Other Feature Flags" editor. (Task 2)
5. `token_hash` must not leak through the detail endpoint. (Task 1)

---

## File Structure

**Modify**
- `backend/src/controllers/adminSettlementController.js` - `detail` also returns a safe `receiver_pay` object.
- `backend/src/controllers/__tests__/adminSettlementController.test.js` - tests for it.
- `frontend/src/pages/Settings.jsx` - four keys in `HANDLED_FLAG_KEYS`, new "Receiver Pays" section.
- `frontend/src/pages/Settlements.jsx` - receiver-mode badges in the Amount Due cell.
- `frontend/src/components/settlements/SettlementDetailDrawer.jsx` - render the new panel, convert action, receiver-aware labels and resolve hint.

**Create**
- `frontend/src/components/settlements/ReceiverPayPanel.jsx` - the receiver-mode panel (one responsibility: show receiver details and the convert action UI).

---

### Task 1: Backend - detail returns a safe `receiver_pay`

**Files:**
- Modify: `backend/src/controllers/adminSettlementController.js` (function `detail`)
- Test: `backend/src/controllers/__tests__/adminSettlementController.test.js`

**Interfaces:**
- Produces: `GET /api/v1/admin/settlements/:id` response `data.receiver_pay` is `null` or `{ receiver_phone: string, receiver_name: string|null, commission_percent: number, status: 'active'|'declined'|'paid'|'closed', declined_by: string|null, declined_at: string|null, link_sent_at: string|null, link_send_count: number, token_expires_at: string|null }`.

- [ ] **Step 1: Write the failing tests**

Open the existing test file and reuse its own prisma mock block and response helpers (do not redeclare them). The prisma mock must gain `order_receiver_pay: { findUnique: jest.fn() }` and the file's existing `order_settlement.findUnique`, `order_settlement_event.findMany`, `pkg_order.findUnique` mocks are reused. Add:

```js
describe("adminSettlementController.detail - receiver_pay", () => {
  const settlementRow = { id: 4, order_id: 50, city_id: 1, payer: "receiver", status: "pending" };

  beforeEach(() => {
    prisma.order_settlement.findUnique.mockResolvedValue(settlementRow);
    prisma.order_settlement_event.findMany.mockResolvedValue([]);
    prisma.pkg_order.findUnique.mockResolvedValue({ id: 50, paddress: "A", daddress: "B", d_charge: 100, total_dcharge: 100, commission: 10, o_status: "Completed" });
  });

  it("returns the receiver row without the token hash", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue({
      receiver_phone: "9876543210", receiver_name: "Ramesh", commission_percent: "3.00", status: "active",
      declined_by: null, declined_at: null, link_sent_at: new Date("2026-10-05T10:00:00Z"), link_send_count: 1,
      token_expires_at: new Date("2026-10-06T10:00:00Z"), token_hash: "a".repeat(64), razorpay_order_id: "order_X",
    });
    const r = /* the file's response mock */;
    await controller.detail({ params: { id: "4" }, scopedCityId: null }, r);
    const body = /* the JSON body the file's helper captured */;
    expect(body.data.receiver_pay).toMatchObject({ receiver_phone: "9876543210", receiver_name: "Ramesh", commission_percent: 3, status: "active", link_send_count: 1 });
    expect(JSON.stringify(body)).not.toContain("token_hash");
    expect(JSON.stringify(body)).not.toContain("order_X");
  });

  it("returns receiver_pay: null when there is no row", async () => {
    prisma.order_receiver_pay.findUnique.mockResolvedValue(null);
    /* call detail as above */
    expect(body.data.receiver_pay).toBeNull();
  });

  it("still returns the detail (receiver_pay null) when the receiver lookup throws", async () => {
    prisma.order_receiver_pay.findUnique.mockRejectedValue(new Error("table missing"));
    /* call detail as above */
    expect(body.success).toBe(true);
    expect(body.data.receiver_pay).toBeNull();
  });
});
```
(Replace the `/* ... */` placeholders with that test file's existing response-mock and body-capture helpers; the intent of each assertion above must be kept exactly.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx jest src/controllers/__tests__/adminSettlementController.test.js`
Expected: the three new tests FAIL (`receiver_pay` undefined / `order_receiver_pay` not queried).

- [ ] **Step 3: Implement**

In `detail`, change the `Promise.all` and the response:

```js
    const [events, order, receiverRow] = await Promise.all([
      prisma.order_settlement_event.findMany({ where: { settlement_id: id }, orderBy: { id: "asc" } }),
      prisma.pkg_order.findUnique({ where: { id: settlement.order_id } }),
      // Never select token_hash / razorpay ids here; a missing table (dev/prod schema drift)
      // must not break the drawer.
      prisma.order_receiver_pay
        .findUnique({
          where: { order_id: settlement.order_id },
          select: {
            receiver_phone: true, receiver_name: true, commission_percent: true, status: true, declined_by: true,
            declined_at: true, link_sent_at: true, link_send_count: true, token_expires_at: true,
          },
        })
        .catch(() => null),
    ]);
    const receiver_pay = receiverRow
      ? { ...receiverRow, commission_percent: Number(receiverRow.commission_percent) }
      : null;
```
and add `receiver_pay,` to the `data` object next to `settlement, events, order: ...`.

Important: `.catch(() => null)` only catches an async rejection. If the Prisma model is missing on the client, `prisma.order_receiver_pay` is `undefined` and `.findUnique` throws synchronously inside `Promise.all`'s array literal; wrap that one expression in a small helper so both failure modes yield `null`:
```js
const loadReceiverRow = async (orderId) => {
  try {
    return await prisma.order_receiver_pay.findUnique({ where: { order_id: orderId }, select: { /* same select as above */ } });
  } catch {
    return null;
  }
};
```
and call `loadReceiverRow(settlement.order_id)` in the `Promise.all`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx jest src/controllers/__tests__/adminSettlementController.test.js`
Expected: PASS (all, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add backend/src/controllers/adminSettlementController.js backend/src/controllers/__tests__/adminSettlementController.test.js
git commit -m "feat(receiver-pay): admin settlement detail returns a safe receiver_pay object

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Settings - Receiver Pays section

**Files:**
- Modify: `frontend/src/pages/Settings.jsx` (`HANDLED_FLAG_KEYS` ~L56-96; new `<Section>` right after the "Trip Payment Settlement" section, which ends at the `</Section>` before `<Section title="Vehicle & Body Type Surcharges">`)

**Interfaces:**
- Produces: the four flags `receiver_pay_enabled`, `receiver_commission_max_percent`, `receiver_commission_max_amount`, `receiver_pay_link_ttl_hours` are edited and saved through the page's existing `flags` state and save handler (no handler changes).

- [ ] **Step 1: Hide the keys from the generic flag editor**

Append to `HANDLED_FLAG_KEYS` (after `'settlement_dispute_window_hours',`):

```js
  'receiver_pay_enabled',
  'receiver_commission_max_percent',
  'receiver_commission_max_amount',
  'receiver_pay_link_ttl_hours',
```

- [ ] **Step 2: Add the section**

Insert directly after the closing `</Section>` of "Trip Payment Settlement" (and before the "Vehicle & Body Type Surcharges" section):

```jsx
        <Section title="Receiver Pays">
          <div className="col-span-2 sm:col-span-3">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-[12px] text-amber-700 dark:text-amber-300">
              <div className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle size={15} />
                <span>BEFORE ENABLING</span>
              </div>
              <p className="mt-1">
                Receiver Pays only works while <code>settlement_enabled</code> is ON, the server has <code>PUBLIC_BASE_URL</code> set (used to build the receiver&apos;s WhatsApp pay link), and the
                migration <code>20261005010000_add_receiver_pay</code> is applied. The commission&apos;s GST treatment must be confirmed by your CA before this goes live.
              </p>
            </div>
          </div>
          <div>
            <Label htmlFor="flag-receiver_pay_enabled">Master Switch (receiver_pay_enabled)</Label>
            <select
              id="flag-receiver_pay_enabled"
              className="w-full rounded-lg border px-2.5 py-1.5 text-[13px] outline-none"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--ink)' }}
              value={flags.receiver_pay_enabled ?? '0'}
              onChange={(e) => setFlags((f) => ({ ...f, receiver_pay_enabled: e.target.value }))}
            >
              <option value="0">Disabled (0 - customers cannot choose &quot;Receiver pays&quot;)</option>
              <option value="1">Enabled (1 - customers can let the receiver pay)</option>
            </select>
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              When OFF, every booking and ride behaves exactly as before.
            </p>
          </div>
          <div>
            <Label htmlFor="flag-receiver_commission_max_percent">Max Commission (%)</Label>
            <Input
              id="flag-receiver_commission_max_percent"
              type="number"
              min="0"
              step="0.5"
              placeholder="5"
              value={flags.receiver_commission_max_percent ?? '5'}
              onChange={(e) => setFlags((f) => ({ ...f, receiver_commission_max_percent: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Highest commission the booking customer may add on top of the receiver&apos;s amount (Default: 5).
            </p>
          </div>
          <div>
            <Label htmlFor="flag-receiver_commission_max_amount">Max Commission per Order (₹)</Label>
            <Input
              id="flag-receiver_commission_max_amount"
              type="number"
              min="0"
              placeholder="0"
              value={flags.receiver_commission_max_amount ?? '0'}
              onChange={(e) => setFlags((f) => ({ ...f, receiver_commission_max_amount: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              Rupee cap on the commission of a single order. 0 means no cap (Default: 0).
            </p>
          </div>
          <div>
            <Label htmlFor="flag-receiver_pay_link_ttl_hours">Pay Link Validity (hours)</Label>
            <Input
              id="flag-receiver_pay_link_ttl_hours"
              type="number"
              min="1"
              placeholder="24"
              value={flags.receiver_pay_link_ttl_hours ?? '24'}
              onChange={(e) => setFlags((f) => ({ ...f, receiver_pay_link_ttl_hours: e.target.value }))}
            />
            <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-faint)' }}>
              How long the WhatsApp payment link stays valid after it is sent (Default: 24).
            </p>
          </div>
        </Section>
```

- [ ] **Step 3: Check the save path persists the keys**

Read the page's save handler (it builds the payload from `flags`; around the `if (key in flags)` code near L210). Confirm the four new keys are sent without any special handling. If the handler only sends a hard-coded key list, add the four keys to it and say so in the commit message.

- [ ] **Step 4: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: lint reports no NEW errors for `Settings.jsx` (compare against `git stash`-free baseline by running `npm run lint -- src/pages/Settings.jsx` before your edit if the repo has pre-existing lint noise), and `vite build` completes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "feat(receiver-pay): admin Settings section for the receiver-pays flags

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Settlements list badges, receiver panel and convert action

**Files:**
- Create: `frontend/src/components/settlements/ReceiverPayPanel.jsx`
- Modify: `frontend/src/pages/Settlements.jsx` (the Amount Due `<td>`, ~L239-242)
- Modify: `frontend/src/components/settlements/SettlementDetailDrawer.jsx`

**Interfaces:**
- Consumes: list rows `payer`, `receiver_markup`, `advance_held`, `reversal_shortfall` (numbers); detail `data.settlement` (Prisma row, Decimals as strings, `receiver_credited` boolean), `data.receiver_pay` (Task 1); `POST /settlements/:id/convert-to-customer`.
- Produces: `ReceiverPayPanel({ settlement, receiverPay, onConvert, converting })` where `onConvert: () => Promise<void>`.

- [ ] **Step 1: Create the panel**

`ReceiverPayPanel.jsx`:
```jsx
import { useState } from 'react'
import { Users, Link2 } from 'lucide-react'
import Badge from '../common/Badge'
import { formatCurrency, formatDateTime } from '../../utils/format'

const RP_STATUS_TONE = { active: 'warning', paid: 'success', declined: 'danger', closed: 'neutral' }

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-[12.5px]">
      <span style={{ color: 'var(--ink-faint)' }}>{label}</span>
      <span className="text-right font-medium" style={{ color: 'var(--ink)' }}>{children}</span>
    </div>
  )
}

// Shown only for receiver-mode settlements (payer === 'receiver') or ones that were converted
// (advance_held > 0 / a receiver row exists), so a normal settlement never renders this.
export default function ReceiverPayPanel({ settlement, receiverPay, onConvert, converting }) {
  const [confirming, setConfirming] = useState(false)

  const isReceiver = settlement.payer === 'receiver'
  const hasHistory = Boolean(receiverPay) || Number(settlement.advance_held) > 0
  if (!isReceiver && !hasHistory) return null

  const amountDue = Number(settlement.amount_due) || 0
  const markup = Number(settlement.receiver_markup) || 0
  const advanceHeld = Number(settlement.advance_held) || 0
  const shortfall = Number(settlement.reversal_shortfall) || 0
  const canConvert = isReceiver && settlement.status === 'pending'

  async function handleConvert() {
    await onConvert()
    setConfirming(false)
  }

  return (
    <div className="surface-card rounded-xl p-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-faint)' }}>
          <Users size={13} /> Receiver Pays
        </h3>
        <Badge tone={isReceiver ? 'brand' : 'neutral'}>{isReceiver ? 'Receiver is payer' : 'Converted to customer'}</Badge>
      </div>

      <div className="mt-3 divide-y" style={{ borderColor: 'var(--border)' }}>
        {receiverPay && (
          <>
            <Row label="Receiver">
              {receiverPay.receiver_name || '—'} <span className="font-mono-data">({receiverPay.receiver_phone})</span>
            </Row>
            <Row label="Pay link">
              <span className="inline-flex items-center gap-1">
                <Link2 size={12} />
                <Badge tone={RP_STATUS_TONE[receiverPay.status] || 'neutral'}>{receiverPay.status}</Badge>
              </span>
              <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>
                Sent {receiverPay.link_send_count || 0}×{receiverPay.link_sent_at ? ` · last ${formatDateTime(receiverPay.link_sent_at)}` : ''}
              </div>
            </Row>
            {receiverPay.declined_by && (
              <Row label="Declined by">{receiverPay.declined_by}{receiverPay.declined_at ? ` · ${formatDateTime(receiverPay.declined_at)}` : ''}</Row>
            )}
            <Row label="Commission set by booker">{Number(receiverPay.commission_percent)}%</Row>
          </>
        )}
        {isReceiver && (
          <>
            <Row label="Fare due (after coupon / points)"><span className="font-mono-data">{formatCurrency(amountDue)}</span></Row>
            <Row label="Service fee (booker commission)"><span className="font-mono-data">{formatCurrency(markup)}</span></Row>
            <Row label="Receiver pays in total"><span className="font-mono-data font-bold">{formatCurrency(amountDue + markup)}</span></Row>
          </>
        )}
        <Row label="Booker advance held">
          <span className="font-mono-data">{formatCurrency(advanceHeld)}</span>
        </Row>
        <Row label="Booker wallet credited">{settlement.receiver_credited ? 'Yes (advance refund' + (markup > 0 ? ' + commission)' : ')') : 'No'}</Row>
        {shortfall > 0 && (
          <Row label="Reversal shortfall">
            <span className="font-mono-data font-semibold" style={{ color: 'var(--danger)' }}>{formatCurrency(shortfall)}</span>
            <div className="text-[11px]" style={{ color: 'var(--ink-faint)' }}>Booker had already spent this; resolve as Customer Owes if it must be collected.</div>
          </Row>
        )}
      </div>

      {canConvert && (
        <div className="mt-3">
          {!confirming ? (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="w-full rounded-lg border py-2 text-[12.5px] font-semibold transition-colors hover:bg-[var(--bg)]"
              style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
            >
              Convert to customer payment
            </button>
          ) : (
            <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
              <p className="text-[12px] font-medium" style={{ color: 'var(--ink)' }}>
                Switch this order to normal payment? The receiver&apos;s link is closed, the booker&apos;s advance of {formatCurrency(advanceHeld)} is applied to the fare and the booker (or driver cash) pays the rest.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={converting}
                  onClick={handleConvert}
                  className="flex-1 rounded-lg py-1.5 text-[12px] font-semibold"
                  style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
                >
                  {converting ? 'Converting...' : 'Yes, convert'}
                </button>
                <button
                  type="button"
                  disabled={converting}
                  onClick={() => setConfirming(false)}
                  className="rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                  style={{ borderColor: 'var(--border)', color: 'var(--ink)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Wire it into the drawer**

In `SettlementDetailDrawer.jsx`:
1. `import ReceiverPayPanel from './ReceiverPayPanel'` next to the other imports.
2. Add state `const [converting, setConverting] = useState(false)` with the other state.
3. Add the handler after `handleResolveSubmit`:
```jsx
  async function handleConvert() {
    setConverting(true)
    try {
      const res = await api.post(`/settlements/${settlementId}/convert-to-customer`)
      const phase = res.data?.data?.phase
      toast.success(phase === 'already_normal' ? 'Already a normal customer payment.' : 'Converted to customer payment.')
      if (onResolved) onResolved()
      const fresh = await api.get(`/settlements/${settlementId}`)
      setData(fresh.data.data)
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to convert settlement.')
    } finally {
      setConverting(false)
    }
  }
```
4. Derive `const receiverPay = data?.receiver_pay ?? null` beside `const order = data?.order`.
5. Render the panel directly after the "Top Status & Amount Card" `</div>` (before the "Dispute Notice" block):
```jsx
          <ReceiverPayPanel settlement={settlement} receiverPay={receiverPay} onConvert={handleConvert} converting={converting} />
```
6. In the financial breakdown, make the third label receiver-aware: replace `Prepaid / Advance:` with
```jsx
                <span style={{ color: 'var(--ink-faint)' }}>{settlement.payer === 'receiver' ? 'Prepaid (coupon / points):' : 'Prepaid / Advance:'}</span>
```
7. In the Admin Resolution box, directly under the `<p>` "Select an outcome and enter a mandatory explanation." add:
```jsx
            {settlement.payer === 'receiver' && !isAlreadyResolved && (
              <div className="mt-3 rounded-lg border p-3 text-[12px]" style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--ink-muted)' }}>
                <strong style={{ color: 'var(--ink)' }}>Receiver-paid order:</strong> <em>Cash Received</em> and <em>Paid Online</em> refund the booker&apos;s advance
                (Paid Online also credits the booker&apos;s commission). <em>Waive</em> and <em>Customer Owes</em> convert the order to normal customer payment and the
                advance is consumed against the fare, never refunded.
              </div>
            )}
```

- [ ] **Step 3: List badges**

In `Settlements.jsx`, replace the Amount Due `<td>` content:
```jsx
                      <td className="font-mono-data whitespace-nowrap px-4 py-2.5 font-bold" style={{ color: 'var(--brand)' }}>
                        {formatCurrency(s.amount_due)}
                        {s.payer === 'receiver' && (
                          <div className="mt-0.5 flex flex-col items-start gap-0.5 font-sans text-[11px] font-medium">
                            <Badge tone="brand">Receiver pays</Badge>
                            <span style={{ color: 'var(--ink-faint)' }}>
                              + {formatCurrency(Number(s.receiver_markup) || 0)} fee · advance held {formatCurrency(Number(s.advance_held) || 0)}
                            </span>
                          </div>
                        )}
                        {Number(s.reversal_shortfall) > 0 && (
                          <div className="mt-0.5 font-sans">
                            <Badge tone="danger">Shortfall {formatCurrency(Number(s.reversal_shortfall))}</Badge>
                          </div>
                        )}
                      </td>
```

- [ ] **Step 4: Lint and build**

Run: `cd frontend && npm run lint && npm run build`
Expected: no new lint errors in the three touched files; build completes.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/settlements/ReceiverPayPanel.jsx frontend/src/components/settlements/SettlementDetailDrawer.jsx frontend/src/pages/Settlements.jsx
git commit -m "feat(receiver-pay): admin Settlements list badges, receiver panel and convert action

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verification (manual QA)

**Files:**
- Create: `docs/superpowers/plans/2026-10-05-receiver-pays-admin-qa.md`

Needs the dev DB with the migration applied and the backend running against it (`npm run dev` in `backend/`, `npm run dev` in `frontend/`), logged in as a superadmin.

- [ ] **Step 1: Write the checklist file with these checks and expected results**

1. Settings: the "Receiver Pays" section shows under "Trip Payment Settlement" with defaults (Disabled, 5, 0, 24); change all four, Save, reload: values persist; none of the four keys appears under "Other Feature Flags".
2. Settlements list, normal rows: look identical to before (no badges, no `NaN`).
3. Create a receiver-mode settlement (backend QA checklist item 4): the row shows "Receiver pays" + "+ ₹fee · advance held ₹x"; open it: the Receiver Pays panel shows receiver name/phone, link status `active`, "Sent 1×", commission %, fare due, fee, total, advance held, wallet credited "No".
4. Convert: click "Convert to customer payment" -> confirm: toast "Converted", panel title becomes "Converted to customer", amount due drops by the advance, list row loses the "Receiver pays" badge, the link status shows `declined`, the audit timeline has the "Receiver payment declined by admin" event. Double-click on "Yes, convert" sends only one request.
5. Convert on a settlement that is not pending (e.g. paid): the button is not shown.
6. Drawer on a normal settlement: no Receiver Pays panel; "Prepaid / Advance:" label unchanged.
7. Resolve a receiver-paid settlement as Waived: after the toast the panel reads "Converted to customer", and if the booker had spent the refund, the "Reversal shortfall" row appears and the list shows the red Shortfall badge.
8. Network failure on convert (stop the backend): a red toast with a message, drawer stays usable.
9. Response of `GET /api/v1/admin/settlements/:id` (browser devtools): contains `receiver_pay` and no `token_hash`.

- [ ] **Step 2: Run the checklist on dev and note the result**

Run it; for any failure fix the cause in the relevant task's files and re-verify. Record the date and outcome at the bottom of the file.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-10-05-receiver-pays-admin-qa.md
git commit -m "docs(receiver-pay): admin panel QA checklist

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Admin section):** settings block (Task 2), Settlements page showing payer / markup / advance held (Task 3), convert to customer mode (Task 3), reversal shortfall visible so admins can resolve as `customer_owes` (Tasks 3), detail data needed for the receiver phone/link status (Task 1). "Resend link" for admins was dropped from the spec during the backend build, so it is intentionally absent.

**Placeholders:** Task 1's test code uses `/* ... */` markers only where the existing test file's own helper names must be used (the file was not copied into this plan); each marker names the assertion that must be kept. No TBD/TODO elsewhere.

**Type consistency:** `receiver_pay` fields in Task 1 match what `ReceiverPayPanel` reads (`receiver_name`, `receiver_phone`, `status`, `link_send_count`, `link_sent_at`, `declined_by`, `declined_at`, `commission_percent`); `onConvert`/`converting` props match between panel and drawer; endpoint path and `phase` values match the backend controller.

**Review Focus coverage:** (1) normal rows: Task 3 renders panel only for receiver/history, list badges are conditional, manual checks 2 and 6; (2) null `receiver_pay` and thrown lookup: Task 1 tests + panel handles `receiverPay` null; (3) convert guards: `canConvert`, `converting` disabled state, manual checks 4, 5, 8; (4) settings persistence: Task 2 Step 3 + manual check 1; (5) token leak: Task 1 test + manual check 9.

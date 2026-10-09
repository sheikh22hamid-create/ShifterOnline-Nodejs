# Receiver Pays (customer app) Implementation Plan

> **Status & corrections (reviewed 2026-10-07): BUILT.** Implementation record - kept for history. Where it differs from the code, the code and the master document win. Current code-verified description: [Master Document section 5.2](../../SHIFTER_ONLINE_MASTER_DOCUMENT.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the booking customer choose "Receiver pays" (with a commission %) when placing a cash order, see the receiver-payment state on the order screen, and take the payment over ("I'll pay myself") or resend the receiver's pay link.

**Architecture:** Flutter (GetX, plain `StatefulWidget` + `setState`) customer app in `ShifterOnline/`, plus one small additive backend change so the order-details response carries a `receiver_pay` summary for orders that have not completed yet. A pure-Dart helper (`receiver_pay_options.dart`) holds the testable logic; UI changes are small edits to the existing booking and settlement screens; all strings go through the existing `.tr` translation maps.

**Tech Stack:** Flutter/Dart (sdk >=3.2.6), GetX, `http`, GetStorage; backend Express/Jest.

**Spec:** [docs/superpowers/specs/2026-10-05-receiver-pays-design.md](../specs/2026-10-05-receiver-pays-design.md) (Apps section). Backend is already on `main`; admin panel plan: `2026-10-05-receiver-pays-admin-panel.md`.

## Backend contract this app uses (already deployed on main)

- `GET api/order/receiver-pay/config` -> `{ ..., config: { enabled: bool, max_percent: number, max_amount: number } }`
- `POST api/order/create` accepts `receiver_pays` (bool) and `receiver_commission_percent` (number); the 200 response has `receiver_pay` (bool); HTTP 400 with `code: "RECEIVER_PAY_UNAVAILABLE"` when not allowed (feature off, non-cash, wallet-paid); a bad drop phone or a percent above max returns HTTP 400 with `code: "VALIDATION"` and a message instead.
- `POST api/order/settlement/take-over` `{uid, order_id}` -> `{phase, settlement}`; `POST api/order/settlement/resend-link` `{uid, order_id}` -> `{sent, link}` (`link` present only when `sent == false`). Errors use the existing envelope: HTTP 200, `Result: "false"`, `code`, `ResponseMsg`.
- Settlement view (`orderProduc["settlement"]` and the `settlement:updated` socket payload) gains `payer` (`'customer'|'receiver'`), `receiver_markup`, `advance_held`, `receiver_pay_total`.
- Error codes to map to friendly text: `RECEIVER_MODE`, `RECEIVER_PAY_UNAVAILABLE`, `NOT_ACTIVE`, `NOT_PAYABLE`, `NOT_CONFIGURED`, `TOO_SOON`, `LINK_LIMIT`, `FORBIDDEN`, `INVALID_STATE`, `NOT_FOUND`.

## Global Constraints

- Receiver pays is only offered when ALL hold: config `enabled`, payment method is **Cash** (`payValue == 1`; never Wallet `-2`), and the drop contact number normalises to exactly 10 digits. If any fails the toggle is hidden or disabled with a one-line reason and `receiver_pays` is **not sent**.
- The wallet withdrawal that happens before order create (`Config.nodeWalletWithdraw` in `_submitOrder`) must never run for a receiver-pays order (it is cash only, so this holds by construction; keep a defensive guard).
- Commission choices are bounded by `config.max_percent` (and the UI shows no value above it). Default selection: 0%. Percent is sent as a number, only when receiver pays is on.
- The advance behaves as today (booker pays it at accept). The UI must tell the user: "Receiver pays the fare at drop. Your advance is refunded to your wallet when they pay."
- Settlement sheet, receiver mode (`payer == 'receiver'`, status `pending`): show who pays and the total (`receiver_pay_total`), NO pay-online / pay-driver options, an "I'll pay myself" button (`takeOver`) and a "Resend payment link" button (`resendLink`); after `takeOver` succeeds the sheet reverts to the normal options (payer becomes `customer`).
- Polling/refresh comparisons in the sheet and in `trackingway.dart` must include `payer`, not only `status`/`customer_choice`.
- All new user-visible strings use `.tr` with an English key and are added to `en_US` and all nine Indian language maps (`test/language_test.dart` requires every language to hold the keys of `mr_IN` and non-empty values).
- Many app files are git-ignored: new/edited files that are not already tracked need `git add -f <exact file>`; never add keystores, `key.properties`, `build/`, logs. Tracked files (e.g. `select_vehicle.dart`, `confirm_order_map.dart`, `trackingway.dart`, `language_*.dart`) are committed normally.
- Verification: `cd ShifterOnline && flutter analyze <changed files>` must add **no new** issues versus the baseline captured before editing, and `flutter test` must pass. Do not run release builds.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Cash-only gating: switching the payment method to Wallet after enabling the toggle must turn receiver pays OFF and clear the percent; the request must never carry `receiver_pays: true` with wallet. (Task 3)
2. Drop contact number variants (`+91 98765 43210`, `098765...`, empty, <10 digits): the toggle must be disabled with a reason, never send a bad number. (Tasks 2, 3)
3. Config fetch failure/timeout or `enabled == false`: booking must work exactly as today, no crash, no toggle. (Task 3)
4. Settlement sheet receiver mode: no way to trigger pay-online/choose-driver while `payer == 'receiver'`; a failed `takeOver` shows the server's friendly message and leaves the sheet usable; double-tap safe; sheet reacts to the socket pushing `payer: 'customer'` (converted by driver/receiver/admin). (Task 4)
5. Settlement map replaced wholesale by socket payloads: a payload missing the new keys (old backend/legacy rows) must render as a normal customer settlement, with no null errors. (Task 4)

---

## File Structure

**Backend (modify):** `backend/src/controllers/orderController.js` (order-details `receiver_pay`), its test in `backend/src/controllers/__tests__/`.

**Customer app (create):**
- `ShifterOnline/lib/utils/receiver_pay_options.dart` - pure logic: phone normalisation, allowed percent choices, whether the toggle is available (and why not), estimate text.
- `ShifterOnline/test/receiver_pay_options_test.dart` - unit tests for it.

**Customer app (modify):**
- `lib/services/settlement_api_service.dart` (untracked) - `takeOver`, `resendLink`, `getReceiverPayConfig`, friendly errors.
- `lib/screens/home/confirm_order_map.dart` - toggle + percent chips UI, passes `ReceiverPaySelection` to the callback.
- `lib/screens/home/select_vehicle.dart` - request body, error handling.
- `lib/screens/myorder/customer_settlement_sheet.dart` (untracked) - receiver branch.
- `lib/screens/myorder/trackingway.dart` - payment summary / in-progress receiver status, polling comparison.
- `lib/Language/language_string.dart`, `lib/Language/language_indian.dart` - strings.

---

### Task 1: Backend - order details carries a `receiver_pay` summary

**Files:** Modify `backend/src/controllers/orderController.js` (`getOrderDetails`, next to `settlement:` at ~L873); test in `backend/src/controllers/__tests__/orderController.test.js` (extend the existing `getOrderDetails` tests; reuse their prisma mock block and add `order_receiver_pay: { findUnique: jest.fn() }`).

**Interfaces:** Produces `OrderProductList[0].receiver_pay`: `null` or `{ status: 'active'|'declined'|'paid'|'closed', commission_percent: number, receiver_name: string|null }`. Never include the token, phone or Razorpay ids.

- [ ] **Step 1: Write failing tests** - (a) order with an `order_receiver_pay` row `{status:'active', commission_percent:'3.00', receiver_name:'Ramesh', token_hash:'x'.repeat(64), receiver_phone:'9876543210'}` -> response `receiver_pay` equals `{status:'active', commission_percent:3, receiver_name:'Ramesh'}` and the serialized response does not contain `token_hash` or the phone; (b) no row -> `receiver_pay: null`; (c) `findUnique` rejects or the model is missing -> `receiver_pay: null` and the response is still 200.
- [ ] **Step 2: Run, expect FAIL:** `cd backend && npx jest src/controllers/__tests__/orderController.test.js -t "receiver_pay"`.
- [ ] **Step 3: Implement** a small helper in `orderController.js`:
```js
// Receiver-pay summary for the booker's order screen. Never exposes the token, phone or gateway ids;
// a missing table/model must not break order details.
async function getReceiverPaySummary(orderId) {
  try {
    const row = await prisma.order_receiver_pay.findUnique({
      where: { order_id: orderId },
      select: { status: true, commission_percent: true, receiver_name: true },
    });
    return row ? { status: row.status, commission_percent: Number(row.commission_percent), receiver_name: row.receiver_name || null } : null;
  } catch {
    return null;
  }
}
```
and add `receiver_pay: await getReceiverPaySummary(order.id),` right after the `settlement:` line.
- [ ] **Step 4: Run, expect PASS** (the three new tests and the whole file), then the full backend suite (`cd backend && npx jest`; only the known `aadharPdfVerify` failures allowed).
- [ ] **Step 5: Commit** `feat(receiver-pay): order details return a safe receiver_pay summary`.

---

### Task 2: Pure logic, API service and strings

**Files:** Create `ShifterOnline/lib/utils/receiver_pay_options.dart`, `ShifterOnline/test/receiver_pay_options_test.dart`; modify `lib/services/settlement_api_service.dart`, `lib/Language/language_string.dart`, `lib/Language/language_indian.dart`.

**Interfaces (Produces):**
```dart
// receiver_pay_options.dart
class ReceiverPayConfig { final bool enabled; final double maxPercent; final double maxAmount;
  const ReceiverPayConfig({required this.enabled, required this.maxPercent, required this.maxAmount});
  static const ReceiverPayConfig disabled = ReceiverPayConfig(enabled: false, maxPercent: 0, maxAmount: 0);
  factory ReceiverPayConfig.fromResponse(Map<String, dynamic>? res); // reads res['config']; null/garbage -> disabled
}
class ReceiverPaySelection { final bool enabled; final double percent;
  const ReceiverPaySelection({required this.enabled, required this.percent});
  static const ReceiverPaySelection off = ReceiverPaySelection(enabled: false, percent: 0);
}
String normalizeIndianMobile(String? raw);            // last 10 digits, '' if fewer than 10 digits
List<double> percentChoices(double maxPercent);       // e.g. max 5 -> [0,1,2,3,5]; max 3 -> [0,1,2,3]; max 0 -> [0]
// reason is null when available; otherwise a short English reason (the UI wraps it in .tr)
String? receiverPayUnavailableReason({required ReceiverPayConfig config, required int payValue, required String? dropMobile});
```
`payValue`: cash is `1`, wallet `-2`. `percentChoices`: always starts at 0, includes 1,2,3,5,10 when `<= maxPercent`, then `maxPercent` itself if not already present and > 0, ascending, de-duplicated.

- [ ] **Step 1: Capture baselines.** `cd ShifterOnline && flutter analyze lib/services/settlement_api_service.dart lib/screens/home/confirm_order_map.dart lib/screens/home/select_vehicle.dart lib/screens/myorder/customer_settlement_sheet.dart lib/screens/myorder/trackingway.dart > /tmp/analyze-baseline.txt` (keep the issue counts per file in the ledger/notes) and `flutter test` (record pass/fail).
- [ ] **Step 2: Write the failing unit tests** in `test/receiver_pay_options_test.dart` covering: `normalizeIndianMobile` (`'+91 98765 43210'`, `'09876543210'`, `'98765-43210'` -> `'9876543210'`; `''`, `null`, `'12345'` -> `''`); `percentChoices(5)==[0,1,2,3,5]`, `percentChoices(10)==[0,1,2,3,5,10]`, `percentChoices(2.5)==[0,1,2,2.5]`, `percentChoices(0)==[0]`, `percentChoices(-1)==[0]`; `ReceiverPayConfig.fromResponse` for a normal map, `null`, `{}` and a map where `config.enabled` is the string `'true'`/`1` (treat only `true`, `'true'`, `1`, `'1'` as enabled); `receiverPayUnavailableReason`: disabled config -> non-null, wallet (`-2`) -> non-null, cash with a bad number -> non-null, cash with a good number and enabled config -> `null`. Run `flutter test test/receiver_pay_options_test.dart` and expect FAIL (file missing).
- [ ] **Step 3: Implement `receiver_pay_options.dart`** (pure Dart, no Flutter imports) to satisfy the interface above.
- [ ] **Step 4: Run, expect PASS** (`flutter test test/receiver_pay_options_test.dart`).
- [ ] **Step 5: API service.** In `settlement_api_service.dart` add, following the file's existing `_post` pattern:
```dart
static const String _endpointTakeOver = "api/order/settlement/take-over";
static const String _endpointResendLink = "api/order/settlement/resend-link";
static const String _endpointReceiverPayConfig = "api/order/receiver-pay/config";

static Future<Map<String, dynamic>> takeOver({required int uid, required int orderId}) =>
    _post(_endpointTakeOver, {'uid': uid, 'order_id': orderId});

static Future<Map<String, dynamic>> resendLink({required int uid, required int orderId}) =>
    _post(_endpointResendLink, {'uid': uid, 'order_id': orderId});

/// Never throws: any failure yields ReceiverPayConfig.disabled so booking works exactly as before.
static Future<ReceiverPayConfig> getReceiverPayConfig() async {
  try {
    final res = await ApiWrapper.dataGetNode(_endpointReceiverPayConfig);
    return ReceiverPayConfig.fromResponse(res is Map<String, dynamic> ? res : null);
  } catch (_) {
    return ReceiverPayConfig.disabled;
  }
}
```
(import `../utils/receiver_pay_options.dart` and `../Api/Api_wrapper.dart` if not present; check `ApiWrapper.dataGetNode`'s exact return type and adapt the cast). Extend `friendlyErrorMessage` with: `RECEIVER_MODE` -> "The receiver is paying for this order. Tap \"I'll pay myself\" to pay instead."; `RECEIVER_PAY_UNAVAILABLE` -> "Receiver pays is not available for this order."; `NOT_ACTIVE`/`NOT_PAYABLE` -> "The receiver payment is no longer active."; `NOT_CONFIGURED` -> "Payment link is not available right now."; `TOO_SOON` -> "Please wait a minute before sending the link again."; `LINK_LIMIT` -> "The link was already sent too many times. Please contact support."
- [ ] **Step 6: Strings.** Add to `en_US` in `language_string.dart` and to all nine maps in `language_indian.dart` (Hindi, Marathi, Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Punjabi - real translations, non-empty) the new keys used by Tasks 3 and 4: `"Receiver pays"`, `"Receiver pays the fare at drop. Your advance is refunded to your wallet when they pay."`, `"Receiver's commission"`, `"Receiver gets a WhatsApp link to pay (no app needed)."`, `"Only for cash orders"`, `"Add a valid 10-digit drop contact number"`, `"Receiver pays is not available right now"`, `"Receiver is paying"`, `"Receiver pays total"`, `"Includes your {fee} service fee"` (use plain concatenation in code, not placeholders, unless the file already uses a replace helper), `"I'll pay myself"`, `"Resend payment link"`, `"Payment link sent to the receiver"`, `"Share this link with the receiver"`, `"You are now paying for this order"`. Run `flutter test test/language_test.dart` -> PASS.
- [ ] **Step 7: Verify and commit.** `flutter test` (all pass), `flutter analyze` on the touched files shows no new issues vs the baseline. Commit: `git add ShifterOnline/test/receiver_pay_options_test.dart ShifterOnline/lib/Language/language_string.dart ShifterOnline/lib/Language/language_indian.dart` and `git add -f ShifterOnline/lib/utils/receiver_pay_options.dart ShifterOnline/lib/services/settlement_api_service.dart` (new/untracked files need `-f`; check each with `git ls-files`).

---

### Task 3: Booking UI - toggle, percent chips, request body

**Files:** Modify `lib/screens/home/confirm_order_map.dart`, `lib/screens/home/select_vehicle.dart`.

**Interfaces:** Consumes Task 2's `ReceiverPayConfig`, `ReceiverPaySelection`, `percentChoices`, `receiverPayUnavailableReason`, `SettlementApiService.getReceiverPayConfig`. Produces: `ConfirmOrderMap` new optional constructor param `String? dropMobile` and its callback becomes `onConfirmPayment: Function(int payValue, String paymentTitle, ReceiverPaySelection receiverPay)`; `_submitOrder` takes the third argument.

- [ ] **Step 1: ConfirmOrderMap state.** Add `ReceiverPayConfig _receiverConfig = ReceiverPayConfig.disabled`, `bool _receiverPays = false`, `double _receiverPercent = 0`. In the existing settings-loading code (~L110-135) also `await SettlementApiService.getReceiverPayConfig()` (its own try/catch; failure keeps `disabled`) and `setState`.
- [ ] **Step 2: UI.** Directly under the payment-method cards add a card (`Container` with the same radius/border style as `_buildPaymentOptionCard`, `Switch(activeColor: linercolor)`), shown only when `_receiverConfig.enabled`. Title `"Receiver pays".tr`. When `receiverPayUnavailableReason(...)` is non-null, the switch is disabled and the reason is shown in small grey text (`.tr`). When on, show the explanation line, a `Wrap` of `ChoiceChip`s from `percentChoices(_receiverConfig.maxPercent)` labelled `"${p}%"` (0 labelled "0%") with `selectedColor: linercolor.withValues(alpha: .15)`, and the hint line `"Receiver gets a WhatsApp link to pay (no app needed).".tr`.
- [ ] **Step 3: Cash-only gating.** Whenever `_selectedPaymentMethod` changes to Wallet (or the reason becomes non-null) set `_receiverPays = false; _receiverPercent = 0` inside `setState`. `_handleConfirmOrder` passes `ReceiverPaySelection(enabled: _receiverPays && reason == null, percent: _receiverPays ? _receiverPercent : 0)` as the third callback argument.
- [ ] **Step 4: select_vehicle.dart.** Pass `dropMobile: _text(_dropData['c_number'])` into `ConfirmOrderMap` (line ~781) and update the callback to `(payValue, _, receiverPay) => _submitOrder(payValue, category, model, fee, receiverPay)`. In `_submitOrder`: add the named/positional parameter; guard `final receiverOn = receiverPay.enabled && payValue != -2;` and add to the request body `if (receiverOn) 'receiver_pays': true, if (receiverOn) 'receiver_commission_percent': receiverPay.percent,`; the wallet withdrawal block must be skipped/unchanged (it only runs for `payValue == -2`, so receiver pays never reaches it - add a comment). In the failure branch next to `SETTLEMENT_PENDING` handle `response['code'] == 'RECEIVER_PAY_UNAVAILABLE'` by showing `SettlementApiService.friendlyErrorMessage('RECEIVER_PAY_UNAVAILABLE', msg)` via `ApiWrapper.showToastMessage` and staying on the screen. On success, if `response['receiver_pay'] == false` while receiver pay was requested, show a toast `"Receiver pays could not be enabled; you will pay normally."` (add this key to the Task 2 string list).
- [ ] **Step 5: Other callers.** `grep -rn "ConfirmOrderMap(" lib/` and update any other constructor use for the new callback shape (the research found only one). 
- [ ] **Step 6: Verify and commit.** `flutter analyze` on both files (no new issues vs baseline), `flutter test`. Commit both (tracked files) normally.

---

### Task 4: Settlement sheet and order screen

**Files:** Modify `lib/screens/myorder/customer_settlement_sheet.dart` (untracked, `git add -f`), `lib/screens/myorder/trackingway.dart`.

- [ ] **Step 1: Sheet logic.** In `_CustomerSettlementSheetState`: `final payer = (_settlement['payer'] ?? 'customer').toString()`, `final isReceiverPaying = payer == 'receiver' && !isSettled && !isDisputed`. Add state `_takingOver`, `_resending`. Amount card: when `isReceiverPaying` show `receiver_pay_total` (fall back to `amount_due` when absent/zero) with a sub-line "Includes your ₹X service fee"-style text only when `receiver_markup > 0` (plain string concatenation; the fee is the booker's own commission, which is credited to the booker).
- [ ] **Step 2: Receiver branch UI.** In the `else` branch that currently renders "Choose How to Pay" (pay-driver + pay-online options): when `isReceiverPaying` render instead a card "Receiver is paying" + total, a primary button `"I'll pay myself".tr` calling `_handleTakeOver`, and a secondary text/outlined button `"Resend payment link".tr` calling `_handleResend`. Both disabled while their flag is set (double-tap safe).
- [ ] **Step 3: Handlers** modelled on `_handleChooseDriver` (spinner flag, merge `res['settlement']` into `_settlement`, else `_errorMessage = SettlementApiService.friendlyErrorMessage(code, msg)`):
```dart
Future<void> _handleTakeOver() async {
  if (_takingOver) return;
  setState(() { _takingOver = true; _errorMessage = null; });
  final res = await SettlementApiService.takeOver(uid: widget.uid, orderId: int.tryParse(widget.orderId.toString()) ?? 0);
  if (!mounted) return;
  final ok = res['Result'] == 'true' || res['Result'] == true;
  setState(() {
    _takingOver = false;
    if (ok && res['settlement'] is Map) {
      _settlement = {..._settlement, ...Map<String, dynamic>.from(res['settlement'] as Map)};
      _settlement['payer'] = (_settlement['payer'] ?? 'customer');
    } else if (ok) {
      _settlement = {..._settlement, 'payer': 'customer'};
    } else {
      _errorMessage = SettlementApiService.friendlyErrorMessage(res['code']?.toString(), res['ResponseMsg']?.toString());
    }
  });
}
```
(adapt types to the file's real field names: `widget.orderId`/`widget.uid` may be int or String). `_handleResend`: on `sent == true` show toast `"Payment link sent to the receiver"`; on `sent == false` show a dialog/snackbar with `res['link']` and a copy action (`Clipboard.setData`) titled `"Share this link with the receiver"`; errors via `friendlyErrorMessage`. Missing `payer` key (legacy payload) is treated as `'customer'`.
- [ ] **Step 4: Polling/refresh.** In the sheet's periodic refresh keep polling while `payer == 'receiver'` and `status == 'pending'`, and refresh when `payer` changed (add `payer` to the comparison that currently checks `status`/`customer_choice`). Same in `trackingway.dart`'s `_checkSettlementStatusAndPoll` (~L7959-7977). The socket handlers replace the whole settlement map: confirm every read of the new keys is null-safe.
- [ ] **Step 5: trackingway order screen.** (a) In the Payment Summary card where `settleStatus`/`settleAmount` are computed (~L4705-4950): when `settlement['payer'] == 'receiver'` and not settled, show a line "Receiver pays <receiver_pay_total>" and make the `settleAmount` text use `receiver_pay_total`; the action button label becomes `"Receiver is paying".tr` (still opens the sheet so the user can take over). (b) For in-progress orders (settlement null or not completed) read `orderProduc['receiver_pay']` (Task 1): when it is a Map with `status == 'active'`, show a small info row near the payment info: "Receiver pays <receiver_name>, commission <p>%"; for `declined`: "Receiver declined - you will pay normally." (both `.tr` strings; add keys to the Task 2 string list).
- [ ] **Step 6: Verify and commit.** `flutter analyze` on the two files (no new issues vs baseline), `flutter test` passes. Commit: `git add ShifterOnline/lib/screens/myorder/trackingway.dart` and `git add -f ShifterOnline/lib/screens/myorder/customer_settlement_sheet.dart`.

---

### Task 5: Verification and QA checklist

**Files:** Create `docs/superpowers/plans/2026-10-06-receiver-pays-customer-app-qa.md`.

- [ ] **Step 1:** `cd ShifterOnline && flutter analyze` (whole project): record counts and confirm no new issues in the touched files; `flutter test`: all pass.
- [ ] **Step 2:** Optionally `flutter build apk --debug` ONLY if it completes within a reasonable time; otherwise state that it was not run.
- [ ] **Step 3: Write the manual checklist** (device/emulator against dev backend with the feature enabled): toggle hidden when config disabled; hidden/disabled for Wallet; disabled with reason for a bad drop number; chips bounded by `max_percent`; booking with receiver pays sends `receiver_pays`/percent (check backend row); `RECEIVER_PAY_UNAVAILABLE` toast; order screen shows receiver status; after completion the sheet shows the receiver card and "I'll pay myself" works (settlement flips to customer mode and normal options appear); resend link toast/dialog; socket-pushed conversion by driver updates the sheet; legacy order (no receiver) unchanged.
- [ ] **Step 4: Commit** the checklist (docs, normal add).

---

## Self-Review

**Spec coverage (Apps section, customer):** booking toggle + percent picker bounded by the config endpoint (Tasks 2, 3), approximate fee display is intentionally limited to the settlement sheet (the final fare is unknown at booking; the booking UI states the behaviour rather than an amount), order screen receiver status and "I'll pay myself" (Task 4), backend summary needed for the pre-completion status (Task 1).
**Placeholders:** Tasks 3-4 describe edits against large existing screens by anchor (function names and line hints from the code survey) rather than full file text; implementers must read the surrounding code and adapt types (e.g. `uid`/`orderId` int vs String) - called out inline. New pure logic and tests are fully specified.
**Type consistency:** `ReceiverPayConfig`, `ReceiverPaySelection`, `percentChoices`, `receiverPayUnavailableReason`, `normalizeIndianMobile` are defined in Task 2 and consumed unchanged in Task 3; service method names `takeOver`/`resendLink`/`getReceiverPayConfig` match Task 4's use; callback arity change in Task 3 is applied at the single construction site.
**Review Focus coverage:** (1) Task 3 Step 3; (2) Task 2 tests + Task 3 Step 2; (3) Task 2 Step 5 (`getReceiverPayConfig` never throws); (4)/(5) Task 4 Steps 2-4.

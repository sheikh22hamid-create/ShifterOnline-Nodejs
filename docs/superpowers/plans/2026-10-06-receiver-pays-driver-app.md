# Receiver Pays (driver app) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the driver's Trip Payment screen, when the receiver (drop contact) is the payer, tell the driver who to collect from and how much, and give two new actions: "Receiver refused" and "Resend link".

**Architecture:** Native Android (Java, ViewBinding, Retrofit/Gson) driver app in `ShifterDriver/ShifterDriver`. The Trip Payment screen and its settlement API client already exist (`TripPaymentActivity`, `SettlementDriverClient`, `SettlementView`); this plan extends the models, the Retrofit interface and the client, adds a small pure-Java helper for the receiver-mode text/visibility rules (unit-testable), and wires two buttons into the existing layout.

**Tech Stack:** Java, Android ViewBinding, Retrofit 2.9 + Gson, JUnit 4 (JVM unit tests), Gradle 8.2.

**Spec:** [docs/superpowers/specs/2026-10-05-receiver-pays-design.md](../specs/2026-10-05-receiver-pays-design.md) (Apps section). Backend is already on `main`.

## Backend contract this app uses (already deployed on main)

All POST bodies are JSON maps with `rider_id` and `order_id`; every response is HTTP 200 with `{ResponseCode, Result, ResponseMsg, code?, ...}` (the existing `SettlementResponse` envelope).
- Existing: `api/rider/settlement/state`, `.../received`, `.../dispute`, `.../pending`.
- NEW `POST api/rider/settlement/receiver-refused` -> `{ phase: 'converted'|'already_normal'|'before_completion', settlement: <view>|null }`.
- NEW `POST api/rider/settlement/resend-link` -> `{ sent: boolean, link?: string }` (`link` present only when `sent == false`, so the driver can share it manually). Errors: codes `NOT_ACTIVE`, `NOT_PAYABLE`, `NOT_CONFIGURED`, `TOO_SOON`, `LINK_LIMIT`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `VALIDATION`.
- Settlement view JSON (state, received, socket `settlement:updated`) gains `payer` (`'customer'|'receiver'`), `receiver_markup`, `advance_held`, `receiver_pay_total`; existing fields (`amount_due`, `fare`, `status`, ...) unchanged. In receiver mode `amount_due` is the cash the driver collects from the receiver; `receiver_pay_total = amount_due + receiver_markup` is what the receiver pays if they pay online through the link.
- The receiver's name and phone come from the order, not the settlement view: `PDOrderItem.getDropName()` / `getCustomerDmobile()`.

## Global Constraints

- Receiver mode on screen = `settlement.payer == "receiver"` AND `settlement.isPending()`. Anything else (missing `payer`, `"customer"`, or a non-pending status) renders exactly as today.
- Pending + receiver mode: the amount shown to collect is `amount_due`; status text: `Collect <currency><amount_due> cash from <receiver name> (<phone>), or the receiver can pay online via the link we sent on WhatsApp.`; when the receiver name/phone are unknown (null `orderItem`, e.g. opened from the Home card or a push) use `the receiver` and omit the phone. The existing "Received" button, dispute button and polling stay as they are.
- New buttons are visible ONLY in receiver mode + pending: "Receiver refused" (confirm dialog first: "Receiver refused to pay? The customer will be asked to pay instead.") and "Resend link". Both disable while their request runs (double-tap safe).
- After "Receiver refused" succeeds the screen must update from the returned settlement (payer becomes `customer`, normal pending UI) or, if the response carries no settlement, re-fetch with `fetchState`.
- "Resend link": `sent == true` -> Toast "Payment link sent to the receiver"; `sent == false` -> dialog showing the link with a Copy button and text "WhatsApp could not deliver the link. Share it with the receiver."; errors -> the client's friendly message in the existing AlertDialog style.
- The screen's strings are hard-coded English today (only one string lives in `strings.xml`); keep that convention and add NO new locale files in this plan.
- `receiver_pay_total` may be absent in old payloads: fall back to `amount_due`.
- Git: most files involved are git-ignored (`ShifterDriver/` is ignored; only some files were force-added). New/edited files that are not already tracked need `git add -f <exact file>`; tracked ones (`NodeService.java`, `PDOrderItem.java`, ...) commit normally. Never add `key.properties`, `keystore.jks`, `local.properties`, `logcat_output.txt`, `replay_pid*.log`, `app/build/`.
- Verification: JVM unit tests must pass (`gradlew testDebugUnitTest` from `ShifterDriver/ShifterDriver`) if a Gradle build runs in this environment; otherwise at least `gradlew :app:compileDebugJavaWithJavac` or, failing that, a documented reason plus careful read-through. No release builds.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Normal settlements (payer missing/`customer`, or any non-pending status): the screen text, button visibility and amounts are unchanged; no NPE when `orderItem` is null or `payer` is absent. (Tasks 1, 2)
2. Receiver mode with `orderItem == null` (Home card / push entry): the screen must still render ("the receiver" fallback) and fill name/phone once `fetchOrderHistoryDetails` backfills the order. (Task 2)
3. Network/envelope failures for the two new calls: `NETWORK_ERROR`, `ResponseCode != 200`, null body, and the `{sent:false}` path; buttons re-enable and no crash after the activity is finished (callbacks arriving after `onDestroy`). (Tasks 1, 2)
4. The socket `settlement:updated` payload flipping `payer` to `customer` (converted by receiver/admin) must immediately hide the receiver-mode UI. (Task 2)

---

## File Structure

**Modify:** `app/src/main/java/com/shifter/driver/model/SettlementView.java`, `model/SettlementResponse.java` (untracked), `retrofit/NodeService.java` (tracked), `utility/SettlementDriverClient.java` (untracked), `activity/TripPaymentActivity.java` (untracked), `res/layout/activity_trip_payment.xml` (untracked).
**Create:** `app/src/main/java/com/shifter/driver/utility/ReceiverPayText.java` (pure helper), `app/src/test/java/com/shifter/driver/utility/ReceiverPayTextTest.java`, `app/src/test/java/com/shifter/driver/model/SettlementViewReceiverTest.java`.
(`R` below = `ShifterDriver/ShifterDriver`.)

---

### Task 1: Models, Retrofit and API client

**Files:** the models, `NodeService.java`, `SettlementDriverClient.java`; tests `SettlementViewReceiverTest.java`.

**Interfaces (Produces):**
```java
// SettlementView (add, Gson names exactly as the backend sends)
@SerializedName("payer") private String payer;
@SerializedName("receiver_markup") private String receiverMarkup;      // number or numeric string -> keep as String like amount_due
@SerializedName("advance_held") private String advanceHeld;
@SerializedName("receiver_pay_total") private String receiverPayTotal;
public String getPayer(); public boolean isReceiverPayer();            // "receiver".equals(payer)
public String getReceiverMarkup(); public String getAdvanceHeld(); public String getReceiverPayTotal();

// SettlementResponse (add)
@SerializedName("phase") private String phase;  @SerializedName("sent") private Boolean sent;  @SerializedName("link") private String link;
public String getPhase(); public boolean wasSent(); /* sent != null && sent */ public String getLink();

// NodeService
@POST("api/rider/settlement/receiver-refused") Call<SettlementResponse> receiverRefused(@Body Map<String, Object> body);
@POST("api/rider/settlement/resend-link")      Call<SettlementResponse> resendReceiverLink(@Body Map<String, Object> body);

// SettlementDriverClient
public interface ReceiverRefusedCallback { void onSuccess(String phase, SettlementView settlement /* may be null */); void onError(String code, String message); }
public interface ResendLinkCallback { void onSuccess(boolean sent, String link /* null when sent */); void onError(String code, String message); }
public static void receiverRefused(Context context, int riderId, int orderId, ReceiverRefusedCallback callback)
public static void resendLink(Context context, int riderId, int orderId, ResendLinkCallback callback)
```
Gson note: the backend may send the numeric fields as numbers or strings; Gson converts a JSON number into a `String` field transparently, so declare them as `String` (consistent with `amount_due`).

- [ ] **Step 1: Write the failing JVM test** `SettlementViewReceiverTest` (pure Gson, no Android classes): parse (a) a legacy payload without the new keys -> `isReceiverPayer()` false, `getReceiverPayTotal()` null; (b) `{"payer":"receiver","amount_due":90,"receiver_markup":2.7,"advance_held":20,"receiver_pay_total":92.7,"status":"pending","order_id":50,"settlement_id":4}` -> `isReceiverPayer()` true, `isPending()` true, getters return `"92.7"`/`"2.7"`/`"20"`-style values (assert with `Double.parseDouble`); (c) a `SettlementResponse` for `{"ResponseCode":"200","Result":"true","sent":false,"link":"https://x/pay/t"}` -> `wasSent()` false, link equals; for `{"sent":true}` -> `wasSent()` true, `getLink()` null; for `{"phase":"converted","settlement":{...}}` -> phase and settlement parsed. Run: `cd ShifterDriver/ShifterDriver && ./gradlew testDebugUnitTest --tests "com.shifter.driver.model.SettlementViewReceiverTest"` (Windows: `gradlew.bat`) and expect FAIL (methods missing).
- [ ] **Step 2: Implement** the model fields/getters, the two Retrofit methods and the two client methods. Follow `markReceived` exactly (`createBaseBody(context, riderId)` + `order_id`, `enqueue`, shared response handling). For `receiverRefused` success: `onSuccess(resp.getPhase(), resp.getSettlement())`; for `resendLink` success: `onSuccess(resp.wasSent(), resp.getLink())`. Extend `getFriendlyErrorMessage` with: `NOT_ACTIVE`/`NOT_PAYABLE` -> "The receiver payment is no longer active."; `NOT_CONFIGURED` -> "The payment link is not available right now."; `TOO_SOON` -> "Please wait a minute before sending the link again."; `LINK_LIMIT` -> "The link was already sent too many times. Contact support."
- [ ] **Step 3: Run the test, expect PASS.** If Gradle cannot run in this environment, record the exact failure (JDK/SDK/offline) in the report and verify by compiling the three model/client files with the project's classpath where possible, else by careful review; do not skip silently.
- [ ] **Step 4: Commit.** `git add ShifterDriver/ShifterDriver/app/src/main/java/com/shifter/driver/retrofit/NodeService.java ShifterDriver/ShifterDriver/app/src/test/java/com/shifter/driver/model/SettlementViewReceiverTest.java` and `git add -f` for `SettlementView.java`, `SettlementResponse.java`, `SettlementDriverClient.java` (check each with `git ls-files` first).

---

### Task 2: Trip Payment screen - receiver mode UI

**Files:** Create `utility/ReceiverPayText.java` + `ReceiverPayTextTest.java`; modify `activity/TripPaymentActivity.java`, `res/layout/activity_trip_payment.xml`.

**Interfaces:** Consumes Task 1 types. Produces (pure Java, no Android imports):
```java
public final class ReceiverPayText {
  public static boolean isReceiverMode(SettlementView s)  // s != null && s.isReceiverPayer() && s.isPending()
  public static String collectLine(String currency, String amountDue, String receiverName, String receiverPhone)
  public static String onlineHint(String currency, String total /* may be null/empty */, String amountDue)
}
```
`collectLine("₹","90","Ramesh","9876543210")` -> `Collect ₹90.00 cash from Ramesh (9876543210), or the receiver can pay online via the link we sent on WhatsApp.`; blank/null name -> `the receiver`; blank/null phone -> no parentheses; amounts formatted with two decimals using the same parsing as the screen (`parseDoubleSafe` equivalent: unparsable -> 0.00). `onlineHint` is `Receiver's online total: ₹92.70` using `total` when parsable and > 0, else `amountDue`.

- [ ] **Step 1: Write the failing test** `ReceiverPayTextTest`: `isReceiverMode` (null; payer customer; receiver+pending true; receiver+cash_received false; payer absent false); `collectLine` for the full case, null name, null phone, unparsable amount (`"abc"` -> `0.00`); `onlineHint` with a total, with null total (falls back), with `"0"` total (falls back). Run `gradlew testDebugUnitTest --tests "com.shifter.driver.utility.ReceiverPayTextTest"` -> FAIL (class missing).
- [ ] **Step 2: Implement `ReceiverPayText`** and make the test pass.
- [ ] **Step 3: Layout.** In `activity_trip_payment.xml`, inside the bottom actions block add a horizontal `LinearLayout` (id `layout_receiver_actions`, `visibility="gone"`, marginTop 8dp) below the primary `btn_received` and above the existing outlined-button row, with two `MaterialButton`s styled like `btn_report_problem`/`btn_done` (OutlinedButton style, 48dp, weight 1, cornerRadius 10dp): `btn_receiver_refused` (text "Receiver refused", red text/stroke like the dispute button) and `btn_resend_link` (text "Resend link"). Also add a `TextView` `txt_receiver_online_hint` (gone by default, 12sp, grey) under the status text area (next to `txtGraceWarning`'s neighbourhood), whichever container the existing pending branch writes its status into.
- [ ] **Step 4: Activity logic.** In `updateUI()`'s pending branch (~L439-464): compute `boolean receiverMode = ReceiverPayText.isReceiverMode(settlement)`; when true set the status text to `ReceiverPayText.collectLine(currency, settlement.getAmountDue(), orderItem != null ? orderItem.getDropName() : null, orderItem != null ? orderItem.getCustomerDmobile() : null)`, show `txt_receiver_online_hint` with `onlineHint(...)`, and show `layout_receiver_actions`; when false hide both and keep today's texts untouched. In every non-pending branch force `layout_receiver_actions` and the hint to `GONE`. Add `private boolean receiverBusy;` and the two handlers:
  - `btnReceiverRefused`: `AlertDialog` confirm ("Receiver refused to pay? The customer will be asked to pay instead.") -> `SettlementDriverClient.receiverRefused(...)`; on success `if (isFinishing()) return;` then if the callback's settlement is non-null `settlement = s; updateUI();` else `loadSettlementState(false)`; on error show the friendly message in the existing error `AlertDialog` helper. Set/clear `receiverBusy` (and disable both buttons) around the call.
  - `btnResendLink`: `SettlementDriverClient.resendLink(...)`; `sent == true` -> `Toast` "Payment link sent to the receiver"; `sent == false` -> `AlertDialog` titled "Share payment link" with message "WhatsApp could not deliver the link. Share it with the receiver.\n\n<link>" and a "Copy" button that uses `ClipboardManager`; errors as above. Guard every callback with `isFinishing()/isDestroyed()`.
  - The existing socket listener lambda already re-parses `SettlementView` and calls `updateUI()`; confirm a payload with `payer: "customer"` hides the receiver UI (it will, because `isReceiverMode` becomes false).
  - Also pass the name/phone through: when `fetchOrderHistoryDetails` backfills `orderItem` it already calls `updateUI()`; verify that path, no extra code unless it does not.
- [ ] **Step 5: Verify.** Run the two new test classes plus the whole unit suite: `gradlew testDebugUnitTest`; then `gradlew :app:compileDebugJavaWithJavac` (or `assembleDebug` only if it finishes in reasonable time) to make sure the layout ids / ViewBinding fields (`binding.btnReceiverRefused`, `binding.btnResendLink`, `binding.layoutReceiverActions`, `binding.txtReceiverOnlineHint`) compile. If Gradle cannot run here, state exactly why and re-read every edited file for syntax and id consistency.
- [ ] **Step 6: Commit.** `git add -f` the untracked edited files (`TripPaymentActivity.java`, `activity_trip_payment.xml`, `ReceiverPayText.java`) and `git add` the new test.

---

### Task 3: Verification and QA checklist

**Files:** Create `docs/superpowers/plans/2026-10-06-receiver-pays-driver-app-qa.md`.

- [ ] **Step 1:** Full unit run (`gradlew testDebugUnitTest`) - record the result and any pre-existing failures by name; compile check of the app module.
- [ ] **Step 2: Write the manual checklist** (device against dev backend, receiver-pays order, regular driver): completed ride opens Trip Payment with "Collect ₹X cash from <name> (<phone>)..." and the online hint; "Received" -> status becomes cash received (customer gets advance back); "Resend link" within a minute twice -> second shows the wait message; WhatsApp not connected -> link dialog with Copy; "Receiver refused" -> confirm -> screen switches to the normal pending text and the receiver buttons disappear; receiver pays online from another phone -> screen updates to paid online via socket; normal (non-receiver) order unchanged; opening from the Home pending card / push (no order item) shows "the receiver" until history backfills.
- [ ] **Step 3: Commit** the checklist (docs, normal add).

---

## Self-Review

**Spec coverage (Apps section, driver):** "Collect Rs X from <receiver name/number>" with Received, "Receiver refused" and "Resend link" (Tasks 1-2). Live updates ride the existing `settlement:updated` listener (Task 2 Step 4).
**Placeholders:** the activity/layout edits are specified by anchor (method and id names from the code survey) rather than full file text because the screen is a 684-line existing class; the implementer must read it. New pure code and tests are fully specified.
**Type consistency:** `ReceiverRefusedCallback`/`ResendLinkCallback`, `SettlementResponse.getPhase()/wasSent()/getLink()`, `SettlementView.isReceiverPayer()/getReceiverPayTotal()` are defined in Task 1 and used unchanged in Task 2; ViewBinding field names follow the layout ids chosen in Task 2 Step 3.
**Review Focus coverage:** (1) Task 2 Step 1 tests + Step 4 non-receiver branch; (2) `collectLine` null handling + Step 4 backfill note; (3) Task 1 callbacks + Task 2 `isFinishing()` guards; (4) Task 2 Step 4 socket note.

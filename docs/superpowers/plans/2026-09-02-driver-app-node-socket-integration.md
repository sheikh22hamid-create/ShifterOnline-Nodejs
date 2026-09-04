# Driver App Node.js Socket Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `ShifterPartnerFinal` native Android driver app to the Node.js order-flow backend's Socket.io layer, so the app receives dispatch cascade popups (`order:request`/`order:dismiss`) and submits accept/reject/status-update actions over a live socket connection instead of the old `accept_order.php`/`reject_order.php`/`update_status.php` Retrofit calls.

**Architecture:** A new singleton `NodeSocketManager` owns one persistent `socket.io-client` connection, opened/closed in lockstep with the existing online/offline toggle (the same trigger that already starts/stops the foreground `LocationUpdateService`, so the process — and the socket — legitimately stays alive in the background too, without adding a second foreground service). Incoming `order:request`/`order:dismiss` events are converted into the exact same `Map<String,String>` / `ACTION_ORDER_NOTIFICATION` broadcast shape the existing FCM path already produces, so they flow through the **existing, unmodified** `BaseActivity.showOrderDialog()` → `OrderDialogHelper` popup UI — no new UI is built. `OrderDialogHelper` and `OrderOverlayService`'s accept/reject methods are repointed from Retrofit calls to socket emits, because the Node backend has no REST equivalent for accept/reject (`orderSocket.js` only exposes `order:accept`/`order:reject` as socket events).

**Tech Stack:** Java (existing app is 100% Java, no Kotlin), `io.socket:socket.io-client:2.1.0`, existing Retrofit/OkHttp stack (untouched for every endpoint not explicitly listed below).

**Spec:** `backend/ORDER_FLOW_NODEJS_SPECIFICATION.md` (Node backend contract) + this plan's own research below (driver-app file map, gathered directly from the current `ShifterPartnerFinal` source, not from the spec — the app predates the Node backend and none of this wiring exists yet).

## Global Constraints

- Node backend production URL: `https://shifteronline-nodejs.onrender.com` (confirmed live in `backend/scripts/test-render-live-order-flow.js:4`). Use this as `NodeSocketManager.NODE_BASE_URL`.
- No auth token — the socket authenticates identically to every existing REST call: raw `rider_id` in the `driver:join` payload, no bearer token, no signature (matches the accepted, already-documented gap in project memory `order_dispatch_auth_gap.md` — do not add auth here).
- **Socket lifecycle is tied to online/offline status, not Activity foreground/background state.** `LocationUpdateService` (a foreground `Service`, `app/src/main/java/com/shifter/driver/locationservice/LocationUpdateService.java`) already starts when the driver goes online and keeps the process alive in the background — the socket connection rides on that same guarantee. Do not gate the socket connection on `MyApplication.isAppInForeground()`.
- **FCM stays the sole delivery channel for backgrounded/killed popups in this phase.** The socket's `order:request`/`order:dismiss` handlers only broadcast `ACTION_ORDER_NOTIFICATION` (the same intent `MyFirebaseMessagingService.sendOrderBroadcast()` already sends for the foreground case) — they do **not** attempt to start `OrderOverlayService` or post a notification themselves. `MyFirebaseMessagingService`, `OrderOverlayService`'s trigger path, and `LocationUpdateService` are **not modified** by this plan.
- Accept/reject/status-update always go over the socket once connected (never fall back to the old REST calls), because the socket is guaranteed connected whenever the driver is online — which is a precondition for receiving any order at all.
- Out of scope (do not touch): `LocationUpdateService.java`, Firestore live-location writes, `rider_status.php` (online/offline REST toggle stays exactly as-is — only the socket connect/disconnect is added alongside it), the "buy anything" order flow, any customer-app change (separate phase).
- Node's `tripLifecycle.updateStatus` (backend/src/services/tripLifecycle.js) only supports three status strings: `'arrived'` (order_status=2), `'pickup'` (order_status=3), `'complete'` (order_status=5). The app's own 5-state `order_flow_id` machine (`OrderDetailsActivity.java:971-1000`: `"accept"→"arrived"→"pickup"→"arrived_drop"→"complete"`) has a 4th transition, `"arrived_drop"`, with **no Node-side equivalent** — it must stay a local UI-only transition (button label change), not call the backend.

---

## File Structure

```
ShifterPartnerFinal/app/
├── build.gradle                                             # MODIFY: add socket.io-client dependency
└── src/main/java/com/shifter/driver/
    ├── socket/
    │   └── NodeSocketManager.java                           # NEW: singleton socket connection + order:request/dismiss listeners
    ├── fragment/HomeFragment.java                            # MODIFY: connect/disconnect socket in updateDriverStatusApi()
    ├── utility/OrderDialogHelper.java                        # MODIFY: acceptOrder()/rejectOrder() → socket emit instead of Retrofit
    ├── service/OrderOverlayService.java                      # MODIFY: acceptOrder()/rejectOrder() → socket emit instead of Retrofit
    └── activity/OrderDetailsActivity.java                    # MODIFY: orderstatus() → socket emit for arrived/pickup/complete, skip arrived_drop
```

**Why this split:** `NodeSocketManager` is a single new file because the connection, `driver:join`, and the two inbound listeners (`order:request`, `order:dismiss`) all share the same `Socket` instance and must be created/torn down together — splitting them would just add cross-file coupling for no benefit. Every other file is a *targeted* modification to an existing, working method (not a rewrite) so the diff stays reviewable against the current behavior.

---

## Interfaces (contracts between files)

```java
// socket/NodeSocketManager.java
public static NodeSocketManager getInstance();
public synchronized void connect(Context context, int riderId);  // no-op if already connected for this riderId; no-op with a log if context is null
public synchronized void disconnect();
public boolean isConnected();
public io.socket.client.Socket getSocket();          // null if not connected — callers must null-check before emit
```

Consumed by: `HomeFragment.updateDriverStatusApi()` (connect/disconnect), `OrderDialogHelper.acceptOrder()/rejectOrder()`, `OrderOverlayService.acceptOrder()/rejectOrder()`, `OrderDetailsActivity.orderstatus()` (all four via `getSocket()`/`isConnected()`).

---

## Task 1: Add socket.io-client dependency

**Files:**
- Modify: `ShifterPartnerFinal/app/build.gradle:84-132`

- [ ] **Step 1: Add the dependency**

In `ShifterPartnerFinal/app/build.gradle`, inside the `dependencies { ... }` block, add this line directly after the existing `implementation 'com.squareup.okhttp3:okhttp:4.9.3'` line (line 122):

```gradle
    implementation('io.socket:socket.io-client:2.1.0') {
        exclude group: 'org.json', module: 'json'
    }
```

The exclude is required — Android ships its own `org.json` classes at the platform level, and `HomeFragment`/`BaseActivity` already `import org.json.JSONObject` directly; without the exclude, `socket.io-client`'s bundled `org.json` artifact conflicts with the platform one at build time (a well-known socket.io-client-on-Android issue).

- [ ] **Step 2: Sync and build**

Run (from `ShifterPartnerFinal/`): `./gradlew :app:compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL` — this only proves the dependency resolves and nothing else in the app broke; no new code references it yet.

- [ ] **Step 3: Commit**

```bash
git add ShifterPartnerFinal/app/build.gradle
git commit -m "build(driver-app): add socket.io-client dependency for Node backend integration"
```

---

## Task 2: `NodeSocketManager` — connection lifecycle + inbound listeners

**Files:**
- Create: `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java`

**Interfaces:**
- Produces: `getInstance()`, `connect(int riderId)`, `disconnect()`, `isConnected()`, `getSocket()` — see Interfaces section above.
- Consumes: `android.content.Context` (application context, passed into `connect()` for broadcasting), `com.shifter.driver.activity.BaseActivity`'s `ACTION_ORDER_NOTIFICATION`/`EXTRA_ORDER_ID` constants — these are `protected static final` on `BaseActivity`, not accessible from another package, so this task **redeclares the same string values** (`"com.shifter.driver.ORDER_NOTIFICATION"` and `"order_id"`) as its own `public static final` constants rather than trying to reach into `BaseActivity` — the two Java files never call each other, they're just relying on an `Intent`'s string `action` matching.

- [ ] **Step 1: Write `NodeSocketManager.java`**

```java
package com.shifter.driver.socket;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.net.URISyntaxException;
import java.util.Iterator;

import io.socket.client.IO;
import io.socket.client.Socket;

/**
 * One persistent Socket.io connection to the Node order-flow backend,
 * opened when the driver goes online and closed when they go offline —
 * the same lifecycle as LocationUpdateService, which is a foreground
 * Service and already keeps the process (and this socket) alive in the
 * background. See docs/superpowers/plans/2026-09-02-driver-app-node-
 * socket-integration.md Global Constraints for why this is safe.
 */
public class NodeSocketManager {

    private static final String TAG = "NodeSocketManager";
    public static final String NODE_BASE_URL = "https://shifteronline-nodejs.onrender.com";

    /** Must match BaseActivity.ACTION_ORDER_NOTIFICATION / EXTRA_ORDER_ID exactly — see Task 2 note. */
    public static final String ACTION_ORDER_NOTIFICATION = "com.shifter.driver.ORDER_NOTIFICATION";
    public static final String EXTRA_ORDER_ID = "order_id";
    public static final String ACTION_ORDER_DISMISS = "com.shifter.driver.ORDER_DISMISS";

    private static NodeSocketManager instance;

    private Socket socket;
    private int riderId = -1;
    private Context appContext;

    private NodeSocketManager() {
    }

    public static synchronized NodeSocketManager getInstance() {
        if (instance == null) {
            instance = new NodeSocketManager();
        }
        return instance;
    }

    public synchronized void connect(Context context, int riderId) {
        if (socket != null && socket.connected() && this.riderId == riderId) {
            return; // already connected for this rider — no-op
        }
        disconnect();

        this.appContext = context.getApplicationContext();
        this.riderId = riderId;

        try {
            IO.Options opts = new IO.Options();
            opts.reconnection = true;
            opts.reconnectionDelay = 2000;
            opts.forceNew = true;
            socket = IO.socket(NODE_BASE_URL, opts);
        } catch (URISyntaxException e) {
            Log.e(TAG, "Bad Node socket URL", e);
            socket = null;
            return;
        }

        socket.on(Socket.EVENT_CONNECT, args -> {
            Log.d(TAG, "Node socket connected — joining driver_" + this.riderId);
            JSONObject payload = new JSONObject();
            try {
                payload.put("rider_id", this.riderId);
            } catch (JSONException ignored) {
            }
            socket.emit("driver:join", payload);
        });

        socket.on(Socket.EVENT_DISCONNECT, args -> Log.d(TAG, "Node socket disconnected"));
        socket.on(Socket.EVENT_CONNECT_ERROR, args ->
                Log.e(TAG, "Node socket connect_error: " + (args.length > 0 ? String.valueOf(args[0]) : "unknown")));

        socket.on("order:request", args -> handleOrderRequest(args));
        socket.on("order:dismiss", args -> handleOrderDismiss(args));

        socket.connect();
    }

    private void handleOrderRequest(Object[] args) {
        if (args.length == 0 || !(args[0] instanceof JSONObject) || appContext == null) return;
        JSONObject data = (JSONObject) args[0];

        String orderId = data.optString("order_id", "");
        if (orderId.isEmpty()) return;

        Intent intent = new Intent(ACTION_ORDER_NOTIFICATION);
        intent.setPackage(appContext.getPackageName());
        intent.putExtra(EXTRA_ORDER_ID, orderId);

        Iterator<String> keys = data.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            intent.putExtra(key, data.optString(key, ""));
        }

        Log.d(TAG, "order:request received for order_id=" + orderId + " — broadcasting to foreground Activities");
        appContext.sendBroadcast(intent);
    }

    private void handleOrderDismiss(Object[] args) {
        if (args.length == 0 || !(args[0] instanceof JSONObject) || appContext == null) return;
        JSONObject data = (JSONObject) args[0];

        String orderId = data.optString("order_id", "");
        String reason = data.optString("reason", "");
        Log.d(TAG, "order:dismiss received for order_id=" + orderId + " reason=" + reason);

        Intent intent = new Intent(ACTION_ORDER_DISMISS);
        intent.setPackage(appContext.getPackageName());
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        intent.putExtra("reason", reason);
        appContext.sendBroadcast(intent);
    }

    public synchronized void disconnect() {
        if (socket != null) {
            socket.off();
            socket.disconnect();
            socket = null;
        }
        riderId = -1;
    }

    public boolean isConnected() {
        return socket != null && socket.connected();
    }

    public Socket getSocket() {
        return socket;
    }
}
```

- [ ] **Step 2: Build**

Run: `./gradlew :app:compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`. This class is not called from anywhere yet, so there is nothing to manually verify beyond compilation.

- [ ] **Step 3: Commit**

```bash
git add ShifterPartnerFinal/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java
git commit -m "feat(driver-app): add NodeSocketManager singleton for Node backend socket connection"
```

---

## Task 3: `order:dismiss` receiver in `BaseActivity`

**Files:**
- Modify: `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/activity/BaseActivity.java:22-90`

**Interfaces:**
- Consumes: `NodeSocketManager.ACTION_ORDER_DISMISS`, `NodeSocketManager.EXTRA_ORDER_ID` (Task 2).

`BaseActivity` already tracks `lastShownOrderId` as the currently-displayed popup's order id (line 31, 115, reset to `""` on accept/reject/failure at lines 139/147/153). This task adds a second receiver, registered/unregistered on the same `onStart()`/`onStop()` lifecycle as the existing `orderNotificationReceiver`, that dismisses the active `AlertDialog` when a matching `order:dismiss` arrives. `OrderDialogHelper` does not currently expose a way to programmatically dismiss its dialog from outside — this task adds that.

- [ ] **Step 1: Add a dismiss callback to `OrderDialogHelper`**

In `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/utility/OrderDialogHelper.java`, add a static field to track the currently-shown dialog and a public method to dismiss it, right after the `TAG` constant (line 28):

```java
    private static AlertDialog activeDialog;
    private static String activeDialogOrderId;

    /** Called by BaseActivity when an order:dismiss socket event matches the currently-shown popup. */
    public static void dismissIfShowing(String orderId) {
        if (activeDialog != null && activeDialog.isShowing()
                && orderId != null && orderId.equals(activeDialogOrderId)) {
            activeDialog.dismiss();
        }
    }
```

Then, inside `showOrderDialog(...)`, right after `AlertDialog dialog = builder.create();` (line 61), track it:

```java
        activeDialog = dialog;
        activeDialogOrderId = orderId;
```

And in the existing `dialog.setOnDismissListener(d -> countDownTimer.cancel());` block (line 135) — leave it as-is, it already fires on any dismissal path (button click, timeout, or this new external dismiss call) since `AlertDialog.dismiss()` always triggers `OnDismissListener`.

- [ ] **Step 2: Register the dismiss receiver in `BaseActivity`**

In `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/activity/BaseActivity.java`, add a second `BroadcastReceiver` field next to `orderNotificationReceiver` (line 27):

```java
    private BroadcastReceiver orderDismissReceiver;
```

Add its setup, modeled exactly on `setupOrderNotificationReceiver()` (lines 52-65):

```java
    private void setupOrderDismissReceiver() {
        orderDismissReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (com.shifter.driver.socket.NodeSocketManager.ACTION_ORDER_DISMISS.equals(intent.getAction())) {
                    String orderId = intent.getStringExtra(EXTRA_ORDER_ID);
                    if (orderId != null && orderId.equals(lastShownOrderId)) {
                        Log.d(TAG, "order:dismiss matched active popup for order_id: " + orderId);
                        OrderDialogHelper.dismissIfShowing(orderId);
                        lastShownOrderId = "";
                    }
                }
            }
        };
    }
```

Call it from `onCreate()` (line 47-50), right after `setupOrderNotificationReceiver();`:

```java
        setupOrderDismissReceiver();
```

Register/unregister it alongside the existing receiver in `onStart()`/`onStop()`:

```java
    @Override
    protected void onStart() {
        super.onStart();
        IntentFilter filter = new IntentFilter(ACTION_ORDER_NOTIFICATION);
        filter.setPriority(IntentFilter.SYSTEM_HIGH_PRIORITY);
        ContextCompat.registerReceiver(
                this,
                orderNotificationReceiver,
                filter,
                ContextCompat.RECEIVER_NOT_EXPORTED);

        IntentFilter dismissFilter = new IntentFilter(com.shifter.driver.socket.NodeSocketManager.ACTION_ORDER_DISMISS);
        ContextCompat.registerReceiver(
                this,
                orderDismissReceiver,
                dismissFilter,
                ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (orderNotificationReceiver != null) {
            try {
                unregisterReceiver(orderNotificationReceiver);
            } catch (Exception e) {
                Log.e(TAG, "Error unregistering receiver", e);
            }
        }
        if (orderDismissReceiver != null) {
            try {
                unregisterReceiver(orderDismissReceiver);
            } catch (Exception e) {
                Log.e(TAG, "Error unregistering dismiss receiver", e);
            }
        }
    }
```

- [ ] **Step 3: Build**

Run: `./gradlew :app:compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add ShifterPartnerFinal/app/src/main/java/com/shifter/driver/activity/BaseActivity.java ShifterPartnerFinal/app/src/main/java/com/shifter/driver/utility/OrderDialogHelper.java
git commit -m "feat(driver-app): dismiss active order popup on order:dismiss socket event"
```

---

## Task 4: Connect/disconnect the socket on online/offline toggle

**Files:**
- Modify: `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/fragment/HomeFragment.java:357-372`

**Interfaces:**
- Consumes: `NodeSocketManager.getInstance().connect(Context, int)` / `.disconnect()` (Task 2).

`updateDriverStatusApi(boolean isOnline)` is the single method every online/offline toggle path already funnels through (manual swipe at line 226, permission-denial revert at line 245, server-sync at line 439) — wiring the socket here covers all three call sites with one change.

- [ ] **Step 1: Add socket connect/disconnect to `updateDriverStatusApi`**

In `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/fragment/HomeFragment.java`, modify `updateDriverStatusApi` (lines 357-372):

```java
    private void updateDriverStatusApi(boolean isOnline) {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("status", isOnline ? "1" : "0");
        } catch (JSONException e) {
            e.printStackTrace();
        }

        if (isOnline) {
            com.shifter.driver.socket.NodeSocketManager.getInstance().connect(getActivity(), riderData.getId());
        } else {
            com.shifter.driver.socket.NodeSocketManager.getInstance().disconnect();
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().riderStatus(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "3");
    }
```

`getActivity()` can be null if this fires during fragment teardown (matches the existing `if (getActivity() == null) return;` guard already present in `toggleOnlineOffline()` at line 223) — `NodeSocketManager.connect` must not NPE on a null context in that case, which is why the next step guards it.

- [ ] **Step 2: Guard `NodeSocketManager.connect` against a null context**

In `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java`, at the top of `connect(Context context, int riderId)` (from Task 2), add:

```java
    public synchronized void connect(Context context, int riderId) {
        if (context == null) {
            Log.e(TAG, "connect() called with null context — skipping");
            return;
        }
        if (socket != null && socket.connected() && this.riderId == riderId) {
```

(This replaces the first `if` check written in Task 2 Step 1 — the new null-check goes immediately before it, the existing already-connected check stays unchanged right after.)

- [ ] **Step 3: Build**

Run: `./gradlew :app:compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Manual verification — socket connects on going online**

This app has no unit-test seam for Android networking/lifecycle code (confirmed: no existing tests touch `HomeFragment`, `APIClient`, or any Retrofit call site — `testImplementation`/`androidTestImplementation` in `build.gradle` are present but unused by any file in `app/src/test` or `app/src/androidTest` related to networking). Verify manually instead:

1. Start the Node backend locally or confirm `https://shifteronline-nodejs.onrender.com/health` returns `{"status":"ok"}`.
2. Install a debug build on a device/emulator, log in as a test rider, toggle "GO ONLINE".
3. Run `adb logcat -s NodeSocketManager` and confirm log lines: `Node socket connected — joining driver_<id>`.
4. Toggle "GO OFFLINE" — confirm `Node socket disconnected` appears (from the `EVENT_DISCONNECT` handler firing after `disconnect()` is called).

- [ ] **Step 5: Commit**

```bash
git add ShifterPartnerFinal/app/src/main/java/com/shifter/driver/fragment/HomeFragment.java ShifterPartnerFinal/app/src/main/java/com/shifter/driver/socket/NodeSocketManager.java
git commit -m "feat(driver-app): open/close Node socket connection on online/offline toggle"
```

---

## Task 5: Route `order:request` through the existing popup UI end-to-end

**Files:**
- No new files — this task is the manual end-to-end verification that Task 2's `handleOrderRequest` broadcast actually reaches `BaseActivity.showOrderDialog()` correctly, since that path (socket → broadcast → existing receiver) was written but never exercised against a real payload.

**Interfaces:**
- Consumes: `backend/src/services/dispatchManager.js`'s `buildOrderRequestPayload()` (backend/src/services/dispatchManager.js:119-147) — the exact field set this task must confirm renders correctly: `order_id`, `estimated_earning`, `pickup_address`, `delivery_address`, `customer_name`, `distance`, `order_details`. Note `pickup_name`/`drop_name` are **not** present in this payload (only in the FCM/PHP path) — `OrderDialogHelper.showOrderDialog` already defaults those to `"PICKUP"`/`"DROP OFF"` (lines 89, 92) when absent, so this is expected, not a bug to fix.

- [ ] **Step 1: Manual verification — live popup via socket**

1. With the driver app online (Task 4 verified) and in the **foreground**, use the backend's dispatch simulator or `backend/scripts/test-order-flow-20-drivers.js`-style script to create a real order whose pickup point is within this rider's search radius and matching vehicle/package-tier toggle.
2. Confirm `adb logcat -s NodeSocketManager` shows `order:request received for order_id=<id> — broadcasting to foreground Activities`.
3. Confirm the existing `dialog_new_order` `AlertDialog` appears (same UI FCM already produces) with the price, pickup/drop address, customer name, and distance populated.
4. Let the popup's countdown timer expire without tapping anything; confirm it auto-rejects (existing `OrderDialogHelper` countdown behavior, untouched — this just proves the socket-fed data didn't break the existing timer logic).

- [ ] **Step 2: Manual verification — `order:dismiss` while a popup is showing**

1. Repeat step 1's order creation, but this time have a *second* driver (or the dispatch simulator) accept the order before this rider's popup times out.
2. Confirm the dialog dismisses immediately (not waiting for the countdown) and `adb logcat -s NodeSocketManager` shows `order:dismiss received for order_id=<id> reason=accepted_by_other`.

No commit for this task — it verifies Tasks 2-4 wired together correctly and surfaces any payload/field mismatch before Task 6 changes what happens when Accept is tapped.

---

## Task 6: `OrderDialogHelper` — accept/reject over the socket

**Files:**
- Modify: `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/utility/OrderDialogHelper.java:182-345`

**Interfaces:**
- Consumes: `NodeSocketManager.getInstance().getSocket()`, `.isConnected()` (Task 2). Node's `order:accept`/`order:reject` socket contract (`backend/src/sockets/orderSocket.js:4-43`): emit `{rider_id, order_id}`, `order:accept` acks via a **separate** `order:accept:ack` event (not a socket.io ack callback) with `{Result: boolean, msg: string}`; `order:reject` has no ack at all (fire-and-forget, per `orderSocket.js:39-44`).

- [ ] **Step 1: Replace `acceptOrder`'s Retrofit call with a socket emit**

In `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/utility/OrderDialogHelper.java`, replace the entire body of `acceptOrder(...)` (lines 182-265) with:

```java
    private static void acceptOrder(Context context, String orderId, String riderId,
            java.util.Map<String, String> orderData, OrderActionListener listener) {
        com.shifter.driver.socket.NodeSocketManager manager = com.shifter.driver.socket.NodeSocketManager.getInstance();
        io.socket.client.Socket socket = manager.getSocket();

        if (socket == null || !manager.isConnected()) {
            Log.e(TAG, "acceptOrder: socket not connected");
            Toast.makeText(context, "Not connected. Please check your connection and try again.", Toast.LENGTH_SHORT).show();
            if (listener != null) {
                listener.onOrderActionFailed(orderId, "accept", "Socket not connected");
            }
            return;
        }

        io.socket.emitter.Emitter.Listener ackListener = new io.socket.emitter.Emitter.Listener() {
            @Override
            public void call(Object... args) {
                socket.off("order:accept:ack", this);
                if (args.length == 0 || !(args[0] instanceof org.json.JSONObject)) {
                    return;
                }
                org.json.JSONObject ack = (org.json.JSONObject) args[0];
                boolean isSuccess = ack.optBoolean("Result", false);
                String message = ack.optString("msg", "");

                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                    if (isSuccess) {
                        Log.d(TAG, "Order accepted successfully");
                        if (listener != null) {
                            listener.onOrderAccepted(orderId);
                        }
                        Toast.makeText(context, message.isEmpty() ? "Order accepted successfully" : message,
                                Toast.LENGTH_SHORT).show();
                        startOrderDetailsActivity(context, orderId, orderData);
                    } else {
                        Log.e(TAG, "Order accept failed: " + message);
                        new AlertDialog.Builder(context)
                                .setTitle("Alert")
                                .setMessage(message.isEmpty() ? "Failed to accept order" : message)
                                .setPositiveButton("OK", null)
                                .show();
                        if (listener != null) {
                            listener.onOrderActionFailed(orderId, "accept", message);
                        }
                    }
                });
            }
        };
        socket.on("order:accept:ack", ackListener);

        org.json.JSONObject payload = new org.json.JSONObject();
        try {
            payload.put("rider_id", riderId);
            payload.put("order_id", orderId);
        } catch (org.json.JSONException e) {
            Log.e(TAG, "Error building order:accept payload", e);
            return;
        }
        socket.emit("order:accept", payload);
    }
```

- [ ] **Step 2: Replace `rejectOrder`'s Retrofit call with a socket emit**

Replace the entire body of `rejectOrder(...)` (lines 270-345) with:

```java
    private static void rejectOrder(Context context, String orderId, String riderId,
            OrderActionListener listener) {
        com.shifter.driver.socket.NodeSocketManager manager = com.shifter.driver.socket.NodeSocketManager.getInstance();
        io.socket.client.Socket socket = manager.getSocket();

        if (socket == null || !manager.isConnected()) {
            Log.e(TAG, "rejectOrder: socket not connected");
            if (listener != null) {
                listener.onOrderActionFailed(orderId, "reject", "Socket not connected");
            }
            return;
        }

        org.json.JSONObject payload = new org.json.JSONObject();
        try {
            payload.put("rider_id", riderId);
            payload.put("order_id", orderId);
        } catch (org.json.JSONException e) {
            Log.e(TAG, "Error building order:reject payload", e);
            return;
        }
        // order:reject has no server ack (orderSocket.js is fire-and-forget for it) —
        // treat the emit itself as success, matching how the old REST call's happy
        // path behaved (it also never blocked the UI on a slow/failed response for reject).
        socket.emit("order:reject", payload);
        Log.d(TAG, "Order reject sent");
        if (listener != null) {
            listener.onOrderRejected(orderId);
        }
        Toast.makeText(context, "Order rejected", Toast.LENGTH_SHORT).show();
    }
```

- [ ] **Step 3: Remove the now-unused Retrofit imports**

At the top of `OrderDialogHelper.java`, remove these three imports (lines 16-20) — nothing in the file calls `APIClient`/Retrofit anymore after Steps 1-2:

```java
import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
```

Also remove `import com.shifter.driver.retrofit.APIClient;` (line 14) and `import com.google.gson.JsonObject;` (line 13) — neither type is referenced anymore (the ack is now parsed as `org.json.JSONObject`, used fully-qualified inline rather than imported, matching how `BaseActivity.java` already fully-qualifies `org.json.JSONObject` at its call sites rather than importing it, to avoid ambiguity with `com.google.gson.JsonObject` used elsewhere in the same package).

- [ ] **Step 4: Build**

Run: `./gradlew :app:compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Manual verification — accept and reject via socket**

1. Repeat Task 5's live order-request test. When the popup appears, tap **Accept**.
2. Confirm `adb logcat -s OrderDialogHelper` shows `Order accepted successfully` and `OrderDetailsActivity` opens.
3. On the backend, confirm (via `backend` logs or a DB check) `pkg_order.rid` is now set to this rider's id and the order's other pending drivers received `order:dismiss` with `reason: "accepted_by_other"`.
4. Repeat with a fresh order and tap **Reject** instead — confirm `adb logcat -s OrderDialogHelper` shows `Order reject sent`, and on the backend confirm `tbl_order_requests.status` for this rider/order is `"10"` (rejected).

- [ ] **Step 6: Commit**

```bash
git add ShifterPartnerFinal/app/src/main/java/com/shifter/driver/utility/OrderDialogHelper.java
git commit -m "feat(driver-app): accept/reject orders over Node socket instead of legacy REST"
```

---

## Task 7: `OrderOverlayService` — accept/reject over the socket

**Files:**
- Modify: `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/service/OrderOverlayService.java:347-468`

**Interfaces:**
- Same as Task 6 — this is the duplicated overlay-UI implementation of the identical accept/reject logic, still triggered only by FCM (unmodified in this plan per Global Constraints) but must submit over the socket like every other accept/reject path, since Node has no REST equivalent and the socket is expected to be connected whenever online.

- [ ] **Step 1: Replace `acceptOrder`'s Retrofit call with a socket emit**

In `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/service/OrderOverlayService.java`, replace the entire body of `acceptOrder(String orderId, String riderId, Intent intent)` (lines 347-414) with:

```java
    private void acceptOrder(String orderId, String riderId, Intent intent) {
        com.shifter.driver.socket.NodeSocketManager manager = com.shifter.driver.socket.NodeSocketManager.getInstance();
        io.socket.client.Socket socket = manager.getSocket();

        if (socket == null || !manager.isConnected()) {
            Log.e(TAG, "acceptOrder: socket not connected");
            Toast.makeText(getApplicationContext(), "Not connected. Please check your connection and try again.", Toast.LENGTH_SHORT).show();
            stopSelf();
            return;
        }

        io.socket.emitter.Emitter.Listener ackListener = new io.socket.emitter.Emitter.Listener() {
            @Override
            public void call(Object... args) {
                socket.off("order:accept:ack", this);
                if (args.length == 0 || !(args[0] instanceof org.json.JSONObject)) {
                    stopSelf();
                    return;
                }
                org.json.JSONObject ack = (org.json.JSONObject) args[0];
                boolean isSuccess = ack.optBoolean("Result", false);
                String message = ack.optString("msg", "");

                new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                    if (isSuccess) {
                        Log.d(TAG, "Order accepted successfully");
                        Toast.makeText(getApplicationContext(), message.isEmpty() ? "Order accepted successfully" : message, Toast.LENGTH_SHORT).show();

                        java.util.Map<String, String> data = new java.util.HashMap<>();
                        if (intent != null && intent.getExtras() != null) {
                            for (String key : intent.getExtras().keySet()) {
                                Object value = intent.getExtras().get(key);
                                if (value != null) data.put(key, String.valueOf(value));
                            }
                        }
                        com.shifter.driver.utility.OrderDialogHelper.startOrderDetailsActivity(getApplicationContext(), orderId, data);
                    } else {
                        Log.e(TAG, "Order accept failed: " + message);
                        Toast.makeText(getApplicationContext(), message.isEmpty() ? "Failed to accept order" : message, Toast.LENGTH_LONG).show();
                    }
                    stopSelf();
                });
            }
        };
        socket.on("order:accept:ack", ackListener);

        org.json.JSONObject payload = new org.json.JSONObject();
        try {
            payload.put("rider_id", riderId);
            payload.put("order_id", orderId);
        } catch (org.json.JSONException e) {
            Log.e(TAG, "Error building order:accept payload", e);
            stopSelf();
            return;
        }
        socket.emit("order:accept", payload);
    }
```

- [ ] **Step 2: Replace `rejectOrder`'s Retrofit call with a socket emit**

Replace the entire body of `rejectOrder(String orderId, String riderId)` (lines 416-468) with:

```java
    private void rejectOrder(String orderId, String riderId) {
        com.shifter.driver.socket.NodeSocketManager manager = com.shifter.driver.socket.NodeSocketManager.getInstance();
        io.socket.client.Socket socket = manager.getSocket();

        if (socket == null || !manager.isConnected()) {
            Log.e(TAG, "rejectOrder: socket not connected");
            stopSelf();
            return;
        }

        org.json.JSONObject payload = new org.json.JSONObject();
        try {
            payload.put("rider_id", riderId);
            payload.put("order_id", orderId);
        } catch (org.json.JSONException e) {
            Log.e(TAG, "Error building order:reject payload", e);
            stopSelf();
            return;
        }
        socket.emit("order:reject", payload);
        Log.d(TAG, "Order reject sent");
        stopSelf();
    }
```

- [ ] **Step 3: Remove the now-unused Retrofit imports**

At the top of `OrderOverlayService.java`, remove:

```java
import com.google.gson.JsonObject;
import com.shifter.driver.retrofit.APIClient;
```
```java
import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
```

(lines 33, 35, 38-42) — nothing else in the file references these types after Steps 1-2.

- [ ] **Step 4: Build**

Run: `./gradlew :app:compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Manual verification — accept via the overlay (background state)**

1. Put the app in the background (press Home, don't force-close) while online.
2. Trigger an order via the same method as Task 5 — confirm the FCM-driven system overlay (`dialog_new_order` drawn over other apps) still appears exactly as before (this path is untouched — only what happens after tapping Accept/Reject changed).
3. Tap **Accept** — confirm `adb logcat -s OrderOverlayService` shows `Order accepted successfully` and the app comes to the foreground on `OrderDetailsActivity`. This specifically proves the socket (opened when the driver went online, per Task 4) is still alive after the app was backgrounded, since `acceptOrder` here has no fallback if it isn't.

- [ ] **Step 6: Commit**

```bash
git add ShifterPartnerFinal/app/src/main/java/com/shifter/driver/service/OrderOverlayService.java
git commit -m "feat(driver-app): accept/reject orders over Node socket in overlay service too"
```

---

## Task 8: Trip status updates (`arrived`/`pickup`/`complete`) over the socket

**Files:**
- Modify: `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/activity/OrderDetailsActivity.java:1081-1107`

**Interfaces:**
- Consumes: `NodeSocketManager.getInstance().getSocket()`/`.isConnected()` (Task 2). Node's `order:status_update` contract (`backend/src/sockets/orderSocket.js:47-72`): emit `{rider_id, order_id, status}` where `status` ∈ `'arrived' | 'pickup' | 'complete'`; ack arrives on the **same emit's socket.io ack callback** is NOT used by Node's handler — it emits a separate `order:status_update:ack` event with `{Result: boolean, msg: string}`, plus a room-wide `order:status_changed` / `order:completed` broadcast that this app does not need to listen for in this task (the customer app listens for that; out of scope here).

Per Global Constraints, the app's own `"arrived_drop"` transition (`OrderDetailsActivity.java:993-997`) has no Node-side status — this task must **not** emit anything for it, only update the local button/UI (which the existing `switch` at lines 971-1000 already does purely from `orderItem.getOrderFlowId()`, unrelated to this task).

- [ ] **Step 1: Replace `orderstatus`'s Retrofit call with a socket emit for the three mapped statuses**

In `ShifterPartnerFinal/app/src/main/java/com/shifter/driver/activity/OrderDetailsActivity.java`, replace the entire body of `orderstatus(String status, String comment)` (lines 1082-1107):

```java
    private void orderstatus(String status, String comment) {
        lastAction = status;
        if ("pickup".equalsIgnoreCase(status)) {
            pausePickupWaitingTimer();
        }

        String nodeStatus;
        if ("arrived".equalsIgnoreCase(status)) {
            nodeStatus = "arrived";
        } else if ("pickup".equalsIgnoreCase(status)) {
            nodeStatus = "pickup";
        } else if ("complete".equalsIgnoreCase(status)) {
            nodeStatus = "complete";
        } else {
            // "arrived_drop" (and any other UI-only transition) has no Node-side
            // status — nothing to send. See plan Global Constraints.
            Log.d("OrderDetailsActivity", "orderstatus: '" + status + "' is local-UI-only, not sent to backend");
            return;
        }

        com.shifter.driver.socket.NodeSocketManager manager = com.shifter.driver.socket.NodeSocketManager.getInstance();
        io.socket.client.Socket socket = manager.getSocket();
        if (socket == null || !manager.isConnected()) {
            Log.e("OrderDetailsActivity", "orderstatus: socket not connected");
            Toast.makeText(this, "Not connected. Please check your connection and try again.", Toast.LENGTH_SHORT).show();
            return;
        }

        custPrograssbar.prograssCreate(this);

        io.socket.emitter.Emitter.Listener ackListener = new io.socket.emitter.Emitter.Listener() {
            @Override
            public void call(Object... args) {
                socket.off("order:status_update:ack", this);
                runOnUiThread(() -> {
                    custPrograssbar.closePrograssBar();
                    if (args.length == 0 || !(args[0] instanceof org.json.JSONObject)) {
                        return;
                    }
                    org.json.JSONObject ack = (org.json.JSONObject) args[0];
                    boolean isSuccess = ack.optBoolean("Result", false);
                    String message = ack.optString("msg", "");
                    if (isSuccess) {
                        Toast.makeText(OrderDetailsActivity.this, "Status updated successfully", Toast.LENGTH_SHORT).show();
                    } else {
                        Toast.makeText(OrderDetailsActivity.this, "Failed to update status: " + message, Toast.LENGTH_SHORT).show();
                    }
                });
            }
        };
        socket.on("order:status_update:ack", ackListener);

        org.json.JSONObject payload = new org.json.JSONObject();
        try {
            payload.put("rider_id", riderData.getId());
            payload.put("order_id", orderItem.getId());
            payload.put("status", nodeStatus);
        } catch (org.json.JSONException e) {
            Log.e("OrderDetailsActivity", "Error building order:status_update payload", e);
            custPrograssbar.closePrograssBar();
            return;
        }
        socket.emit("order:status_update", payload);
    }
```

Note: this drops the `comment` parameter from the outgoing payload — Node's `order:status_update` handler (`orderSocket.js:47`) only reads `{rider_id, order_id, status}`, it has no comment field. Every existing call site (`OrderDetailsActivity.java:736,738,740,828,914`) already passes `""` for `comment`, so no call site changes are needed and nothing observable is lost.

- [ ] **Step 2: Build**

Run: `./gradlew :app:compileDebugJavaWithJavac`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Manual verification — full trip status progression**

1. Accept a live order (Task 6/7 already verified accept works).
2. Tap through **ARRIVED ORDER** → OTP dialog → confirm → status becomes `"pickup"` (`order_flow_id` "1"→"2" per the existing switch at lines 979-991, driven by whatever `OrderDetailsActivity` re-fetches after each successful `order:status_update:ack` — this refetch logic is pre-existing and untouched by this plan).
3. Confirm `adb logcat -s OrderDetailsActivity` shows the emit going out and `Status updated successfully` after each of **arrived** and **pickup**.
4. Progress to **ARRIVED DROP** (`order_flow_id` "3") — confirm via logcat that `orderstatus: 'arrived_drop' is local-UI-only, not sent to backend` prints and nothing is emitted.
5. Tap the final confirm (`order_flow_id` "4", `status="complete"`) — confirm the emit fires and the backend marks `pkg_order.o_status = 'Completed'` (check via DB or admin panel).

- [ ] **Step 4: Commit**

```bash
git add ShifterPartnerFinal/app/src/main/java/com/shifter/driver/activity/OrderDetailsActivity.java
git commit -m "feat(driver-app): send arrived/pickup/complete status updates over Node socket"
```

---

## Self-Review Notes

- Every task that touches an existing Retrofit call site (`acceptOrder`, `rejectOrder`, `orderstatus`) fully replaces it rather than leaving a dead fallback path, per the scope note in the original research brief ("Old Retrofit calls to those three specific PHP endpoints should be replaced, not kept as dead code"). `UserService.java`'s `acceptOrder()`/`rejectOrder()`/`updateOrderStatus()` interface method *declarations* are deliberately left untouched (out of scope) — only the call sites that invoked them are changed; the dead-but-declared Retrofit methods can be removed in a later cleanup pass if desired, but leaving an unused Retrofit interface method is inert (no runtime cost, no behavior change) unlike leaving a dead *call site* that silently still hits the old PHP endpoint.
- `rider_status.php` (online/offline toggle) is deliberately **not** moved to `/api/rider/status` in this phase (per the AskUserQuestion decision already made) — Task 4 only adds the socket connect/disconnect alongside the existing REST call, it does not touch what that REST call does.
- FCM-triggered popups (background/killed state) are untouched in *how they're triggered*, but Task 7 changes what happens *after* Accept/Reject is tapped on that same popup — this is intentional and covered by Task 7's manual verification step specifically testing the backgrounded case.
- No task introduces a new auth mechanism — every socket emit carries only `rider_id`, matching every existing REST call in this app.

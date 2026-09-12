package com.shifter.driver.socket;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import com.shifter.driver.MyFirebaseMessagingService;
import com.shifter.driver.service.OrderOverlayService;

/**
 * Routes the Node socket's order:request/order:dismiss events into the
 * exact same popup UI paths FCM already drives (foreground broadcast,
 * background overlay + heads-up notification) — see
 * MyFirebaseMessagingService.routeOrderNotification, which both channels
 * now share, deduped against each other via OrderNotificationDedup.
 *
 * Node's field names (backend/API_INTEGRATION_GUIDE.md §6.2) don't all
 * match what this app's existing FCM-driven UI expects (short plat/plong
 * vs Node's pickup_latitude/pickup_longitude, etc.) — mapOrderRequestData
 * bridges that.
 */
public class SocketOrderRouter {

    private static final String TAG = "SocketOrderRouter";

    /** Foreground counterpart of OrderOverlayService's own dismiss handling — see BaseActivity's receiver. */
    public static final String ACTION_ORDER_DISMISS = "com.shifter.driver.ORDER_DISMISS";

    public static void handleOrderRequest(Context context, JSONObject data) {
        Map<String, String> mapped = mapOrderRequestData(data);
        String title = "New Order";
        String modelName = mapped.get("driver_title");
        if (modelName == null || modelName.isEmpty()) {
            modelName = mapped.get("package_name");
        }
        if (modelName == null || modelName.isEmpty()) {
            modelName = mapped.get("package_title");
        }
        if (modelName == null || modelName.isEmpty()) {
            modelName = mapped.get("model_name");
        }
        String body = "You have a new order request" + (modelName != null && !modelName.isEmpty() ? " (" + modelName + ")" : "");
        MyFirebaseMessagingService.routeOrderNotification(context, mapped, title, body);
    }

    public static void handleOrderDismiss(Context context, JSONObject data) {
        String orderId = data.optString("order_id", null);
        if (orderId == null) return;

        Log.d(TAG, "order:dismiss for order " + orderId);

        // Sent unconditionally alongside the overlay dismiss below, rather
        // than branching on foreground/background like handleOrderRequest
        // does: the app's state can change between when a popup was shown
        // and when this dismiss arrives, so there's no single "which UI is
        // this order showing in right now" check to safely gate on. Each
        // path already no-ops harmlessly when it has nothing to dismiss —
        // OrderDialogHelper.dismissIfShowing checks the order id actually
        // matches its currently-open dialog, and OrderOverlayService's own
        // dismiss branch (below) already does the equivalent check. Without
        // this broadcast, a dismiss arriving while the app was in the
        // foreground had nothing to act on at all (confirmed live: order
        // #1533 — a driver's foreground popup stayed open after a different
        // driver accepted the order).
        Intent dismissBroadcast = new Intent(ACTION_ORDER_DISMISS);
        dismissBroadcast.putExtra("order_id", orderId);
        dismissBroadcast.setPackage(context.getPackageName());
        context.sendBroadcast(dismissBroadcast);

        Intent dismissIntent = new Intent(context, OrderOverlayService.class);
        dismissIntent.putExtra("dismiss", true);
        dismissIntent.putExtra("order_id", orderId);
        try {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(dismissIntent);
            } else {
                context.startService(dismissIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to deliver dismiss to OrderOverlayService", e);
        }
    }

    private static Map<String, String> mapOrderRequestData(JSONObject data) {
        Map<String, String> out = new HashMap<>();

        // Pass every field through as-is first...
        Iterator<String> keys = data.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            out.put(key, data.optString(key, ""));
        }

        // ...then add the renamed keys this app's UI actually reads.
        putIfPresent(out, "pickup_address", data, "paddress");
        putIfPresent(out, "delivery_address", data, "daddress");
        putIfPresent(out, "plat", data, "pickup_latitude");
        putIfPresent(out, "plat", data, "plat");
        putIfPresent(out, "plong", data, "pickup_longitude");
        putIfPresent(out, "plong", data, "plong");
        putIfPresent(out, "dlat", data, "delivery_latitude");
        putIfPresent(out, "dlat", data, "dlat");
        putIfPresent(out, "dlong", data, "delivery_longitude");
        putIfPresent(out, "dlong", data, "dlong");
        putIfPresent(out, "customer_pmobile", data, "customer_phone");
        putIfPresent(out, "order_date", data, "pickup_time");
        putIfPresent(out, "order_date", data, "schedule_date_time");
        putIfPresent(out, "estimated_earning", data, "driver_earning");
        putIfPresent(out, "estimated_earning", data, "trip_total");
        putIfPresent(out, "estimated_earning", data, "total");
        putIfPresent(out, "estimated_earning", data, "fare");
        putIfPresent(out, "customer_rating", data, "cust_rating");
        putIfPresent(out, "customer_rating", data, "user_rating");
        putIfPresent(out, "customer_orders", data, "customer_total_orders");
        putIfPresent(out, "customer_orders", data, "total_orders");

        return out;
    }

    private static void putIfPresent(Map<String, String> out, String outKey, JSONObject data, String inKey) {
        String v = data.optString(inKey, null);
        if (v != null && !v.isEmpty() && (!out.containsKey(outKey) || out.get(outKey).isEmpty())) {
            out.put(outKey, v);
        }
    }
}

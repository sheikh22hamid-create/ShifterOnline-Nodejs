package com.shifter.driver.activity;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.shifter.driver.model.RiderData;
import com.shifter.driver.utility.LocaleHelper;
import com.shifter.driver.utility.OrderDialogHelper;
import com.shifter.driver.utility.SessionManager;

import java.util.HashMap;
import java.util.Map;

public class BaseActivity extends AppCompatActivity {
    private static final String TAG = "BaseActivity";
    protected static final String ACTION_ORDER_NOTIFICATION = "com.shifter.driver.ORDER_NOTIFICATION";
    protected static final String EXTRA_ORDER_ID = "order_id";
    protected static final String EXTRA_SHOW_ORDER_DIALOG = "show_order_dialog";
    private BroadcastReceiver orderNotificationReceiver;

    // Duplicate guard — same orderId ke liye ek hi baar dialog dikhao
    // (killed state mein startActivity + notification click dono trigger ho sakte hain)
    private static String lastShownOrderId = "";

    // Order notification ID — MyFirebaseMessagingService.NOTIFICATION_ID_ORDER se match karna chahiye
    private static final int NOTIFICATION_ID_ORDER = 2001;

    @Override
    protected void attachBaseContext(Context newBase) {
        SessionManager sessionManager = new SessionManager(newBase);
        String lang = sessionManager.getLanguage();
        if (lang == null || lang.isEmpty()) {
            lang = "en";
        }
        super.attachBaseContext(LocaleHelper.setLocale(newBase, lang));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupOrderNotificationReceiver();
    }

    private void setupOrderNotificationReceiver() {
        orderNotificationReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (ACTION_ORDER_NOTIFICATION.equals(intent.getAction())) {
                    String orderId = intent.getStringExtra(EXTRA_ORDER_ID);
                    if (orderId != null && !orderId.isEmpty()) {
                        Map<String, String> data = getMapFromIntent(intent);
                        showOrderDialog(orderId, data);
                    }
                }
            }
        };
    }

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
    }

    protected Map<String, String> getMapFromIntent(Intent intent) {
        Map<String, String> data = new HashMap<>();
        if (intent != null && intent.getExtras() != null) {
            for (String key : intent.getExtras().keySet()) {
                Object value = intent.getExtras().get(key);
                if (value != null) {
                    data.put(key, value.toString());
                }
            }
        }
        return data;
    }

    protected void showOrderDialog(String orderId, Map<String, String> data) {
        if (isFinishing() || (Build.VERSION.SDK_INT >= Build.VERSION_CODES.JELLY_BEAN_MR1 && isDestroyed())) {
            return;
        }

        // Duplicate check — same order ka dialog dobara mat dikhao
        if (orderId != null && orderId.equals(lastShownOrderId)) {
            Log.d(TAG, "Order dialog already shown/showing for id: " + orderId);
            return;
        }

        lastShownOrderId = orderId;

        // Dialog open hote hi notification dismiss kar do taaki user status bar se stale orders na dekhe
        try {
            android.app.NotificationManager notificationManager = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                notificationManager.cancel(NOTIFICATION_ID_ORDER);
                Log.d(TAG, "Cancelled order notification from dialog");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling notification", e);
        }

        SessionManager sessionManager = new SessionManager(this);
        RiderData riderData = sessionManager.getUserDetails();
        if (riderData == null) {
            Log.e(TAG, "Rider not logged in, cannot show order dialog");
            return;
        }

        OrderDialogHelper.showOrderDialog(this, orderId, String.valueOf(riderData.getId()), data, new OrderDialogHelper.OrderActionListener() {
            @Override
            public void onOrderAccepted(String orderId) {
                Log.d(TAG, "Order accepted: " + orderId);
                lastShownOrderId = ""; // Reset — agli order ke liye ready
                // Now OrderDialogHelper directly starts OrderDetailsActivity on success,
                // so we don't need to call fetchOrderDetailsAndStartActivity(orderId, data) here.
            }

            @Override
            public void onOrderRejected(String orderId) {
                Log.d(TAG, "Order rejected: " + orderId);
                lastShownOrderId = ""; // Reset — agli order ke liye ready
            }

            @Override
            public void onOrderActionFailed(String orderId, String action, String error) {
                Log.e(TAG, "Order action failed: " + action + " for order_id: " + orderId + ", error: " + error);
                lastShownOrderId = ""; // Reset on failure
            }
        });
    }

    private void fetchOrderDetailsAndStartActivity(String orderId, Map<String, String> data) {
        com.shifter.driver.utility.CustPrograssbar custPrograssbar = new com.shifter.driver.utility.CustPrograssbar();
        custPrograssbar.prograssCreate(this);
        SessionManager sessionManager = new SessionManager(this);
        RiderData riderData = sessionManager.getUserDetails();
        org.json.JSONObject jsonObject = new org.json.JSONObject();
        try {
            jsonObject.put("type", "recent");
            jsonObject.put("rid", String.valueOf(riderData.getId()));
        } catch (org.json.JSONException e) {
            e.printStackTrace();
        }
        okhttp3.RequestBody bodyRequest = okhttp3.RequestBody.create(okhttp3.MediaType.parse("application/json"), jsonObject.toString());
        retrofit2.Call<com.google.gson.JsonObject> call = com.shifter.driver.retrofit.APIClient.getInterface().pkgHistory(bodyRequest);
        call.enqueue(new retrofit2.Callback<com.google.gson.JsonObject>() {
            @Override
            public void onResponse(retrofit2.Call<com.google.gson.JsonObject> call, retrofit2.Response<com.google.gson.JsonObject> response) {
                custPrograssbar.closePrograssBar();
                try {
                    com.google.gson.Gson gson = new com.google.gson.Gson();
                    com.shifter.driver.model.PDOrder pdOrder = gson.fromJson(response.body(), com.shifter.driver.model.PDOrder.class);
                    if (pdOrder.getResult().equalsIgnoreCase("true") && pdOrder.getOrderHistory() != null) {
                        for (com.shifter.driver.model.PDOrderItem item : pdOrder.getOrderHistory()) {
                            if (orderId.equals(item.getId())) {
                                launchOrderDetailsOrShowPaymentDialog(item);
                                return;
                            }
                        }
                    }
                    fallbackToNotificationData(orderId, data);
                } catch (Exception e) {
                    fallbackToNotificationData(orderId, data);
                }
            }

            @Override
            public void onFailure(retrofit2.Call<com.google.gson.JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                fallbackToNotificationData(orderId, data);
            }
        });
    }

    private void fallbackToNotificationData(String orderId, Map<String, String> data) {
        com.shifter.driver.model.PDOrderItem orderItem = buildOrderItemFromData(orderId, data);
        launchOrderDetailsOrShowPaymentDialog(orderItem);
    }

    private void launchOrderDetailsOrShowPaymentDialog(com.shifter.driver.model.PDOrderItem orderItem) {
        if ("1".equals(orderItem.getPaymentStatus())) {
            Intent intent = new Intent(BaseActivity.this, OrderDetailsActivity.class);
            intent.putExtra("myclass", orderItem);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(intent);
        } else {
            new android.app.AlertDialog.Builder(BaseActivity.this)
                .setTitle("Waiting for advance payment")
                .setMessage("Advance payment has not been received yet. Order details will be shown after the advance payment is completed.")
                .setPositiveButton("OK", (dialog, which) -> dialog.dismiss())
                .show();
        }
    }

    /**
     * FCM notification ke Map data se PDOrderItem directly banao
     * Koi API call nahi — jo data notification mein aaya wahi use karo
     */
    private com.shifter.driver.model.PDOrderItem buildOrderItemFromData(String orderId, Map<String, String> data) {
        if (data == null) data = new HashMap<>();

        double plat = 0.0, plong = 0.0, dlat = 0.0, dlong = 0.0;
        try { plat  = Double.parseDouble(getMapValue(data, "plat",  "0")); } catch (Exception ignored) {}
        try { plong = Double.parseDouble(getMapValue(data, "plong", "0")); } catch (Exception ignored) {}
        try { dlat  = Double.parseDouble(getMapValue(data, "dlat",  "0")); } catch (Exception ignored) {}
        try { dlong = Double.parseDouble(getMapValue(data, "dlong", "0")); } catch (Exception ignored) {}

        return new com.shifter.driver.model.PDOrderItem(
                orderId,
                getMapValue(data, "order_flow_id", "1"),          // accepted = flow 1 (pickup phase)
                getMapValue(data, "customer_name",  "Customer"),  // pick_name
                getMapValue(data, "drop_name",      ""),
                getMapValue(data, "pickup_address", ""),          // customer_paddress
                getMapValue(data, "delivery_address", ""),        // customer_daddress
                getMapValue(data, "customer_pmobile", ""),
                getMapValue(data, "customer_dmobile", ""),
                getMapValue(data, "pick_type",  ""),
                getMapValue(data, "drop_type",  ""),
                plat, plong, dlat, dlong,
                getMapValue(data, "estimated_earning", "0"),      // total
                getMapValue(data, "distance",          "0"),
                getMapValue(data, "time_duration",     "0"),
                getMapValue(data, "order_date",        ""),
                getMapValue(data, "order_details",     ""),
                getMapValue(data, "status",            ""),
                getMapValue(data, "order_user_id",     ""),
                "0.00", "0.00", "0.00", "0.00", "0.00", "0", "0.00",
                getMapValue(data, "payment_status", "1")
        );
    }

    private String getMapValue(Map<String, String> map, String key, String defaultValue) {
        if (map != null && map.containsKey(key)) {
            String value = map.get(key);
            return value != null ? value : defaultValue;
        }
        return defaultValue;
    }
}

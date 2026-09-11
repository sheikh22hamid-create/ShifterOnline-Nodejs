package com.shifter.driver.utility;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.media.AudioManager;
import android.util.Log;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Helper class to show Accept/Reject Order dialog
 * Handles API calls for accepting/rejecting orders
 */
public class OrderDialogHelper {

    private static final String TAG = "OrderDialogHelper";

    // Tracks the currently-shown foreground dialog so dismissIfShowing (see
    // below) can close it when the server reports the order is no longer
    // this rider's to take (another driver accepted it, or it timed out
    // some other way) — this dialog is created fresh via a local variable
    // each call, with no other externally-reachable handle to it.
    private static AlertDialog currentDialog;
    private static String currentOrderId;

    /**
     * Closes the foreground dialog currently shown for orderId, if any.
     * Called from SocketOrderRouter.handleOrderDismiss — without this, an
     * order:dismiss arriving while the app is in the foreground (e.g.
     * another driver accepted the order first) had nothing to act on: it
     * only ever reached OrderOverlayService, which has no overlay running
     * for an order whose popup was shown via this foreground dialog path
     * instead, so the dialog just sat open until its own local timer
     * eventually finished it (confirmed live: order #1533, a driver whose
     * foreground popup didn't close when a different driver accepted).
     */
    public static void dismissIfShowing(String orderId) {
        if (currentDialog != null && currentDialog.isShowing()
                && orderId != null && orderId.equals(currentOrderId)) {
            currentDialog.dismiss();
        }
    }

    /**
     * Show Accept/Reject dialog for an order
     * 
     * @param context  Activity context
     * @param orderId  Order ID to accept/reject
     * @param riderId  Rider ID (from session)
     * @param listener Callback for dialog actions
     */
    /**
     * Show Accept/Reject dialog for an order with custom UI
     * 
     * @param context   Activity context
     * @param orderId   Order ID to accept/reject
     * @param riderId   Rider ID (from session)
     * @param orderData Map/Bundle containing order details
     * @param listener  Callback for dialog actions
     */
    public static void showOrderDialog(Context context, String orderId, String riderId,
            java.util.Map<String, String> orderData,
            OrderActionListener listener) {
        if (context == null || orderId == null || riderId == null) {
            Log.e(TAG, "Invalid parameters for showOrderDialog");
            return;
        }

        // Close out any dialog still open from an earlier tier of this (or
        // any other) order before showing the new one — mirrors
        // OrderOverlayService's own "clean up previous view" step, and is
        // now the ONLY thing gating a new tier's popup: a separate
        // order-id-based guard in BaseActivity used to also do this, but it
        // could only ever be reset by an async broadcast or the local
        // countdown, both of which race against the very next tier's
        // order:request arriving first — confirmed live via logcat on
        // order #1565: the dismiss for Model 1 was logged 58ms AFTER
        // Model 2's request had already been evaluated and silently
        // dropped as "already shown". Dismissing synchronously, right here,
        // has no such window.
        if (currentDialog != null && currentDialog.isShowing()) {
            currentDialog.dismiss();
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        android.view.View view = android.view.LayoutInflater.from(context)
                .inflate(com.shifter.driver.R.layout.dialog_new_order, null);
        builder.setView(view);
        builder.setCancelable(false);

        AlertDialog dialog = builder.create();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(
                    new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        }

        // Find Views
        android.widget.TextView txtPrice = view.findViewById(com.shifter.driver.R.id.txt_estimated_price);
        android.widget.TextView txtPickupTitle = view.findViewById(com.shifter.driver.R.id.txt_pickup_name_title);
        android.widget.TextView txtDropTitle = view.findViewById(com.shifter.driver.R.id.txt_drop_name_title);
        android.widget.TextView txtPickup = view.findViewById(com.shifter.driver.R.id.txt_pickup_address);
        android.widget.TextView txtDrop = view.findViewById(com.shifter.driver.R.id.txt_drop_address);
        android.widget.TextView txtName = view.findViewById(com.shifter.driver.R.id.txt_customer_name);
        android.widget.TextView txtDist = view.findViewById(com.shifter.driver.R.id.txt_distance);
        android.widget.TextView txtDetails = view.findViewById(com.shifter.driver.R.id.txt_order_details);
        android.widget.Button btnAccept = view.findViewById(com.shifter.driver.R.id.btn_accept);
        android.widget.Button btnReject = view.findViewById(com.shifter.driver.R.id.btn_reject);

        // "Khajrana (4.2 km away)" / "Rajwada (10.2 km trip)" — driver's own
        // distance to pickup, and the pickup->drop trip distance, shown on
        // the location line AND spoken in the voice announcement below, so
        // both read off the same computed values instead of each deriving
        // their own.
        String pickupAddress = getMapValue(orderData, "pickup_address", null);
        String deliveryAddress = getMapValue(orderData, "delivery_address", null);
        String rawStops = getMapValue(orderData, "stops", null);
        String routeText = formatStops(deliveryAddress, rawStops);
        String tripDistanceKm = getMapValue(orderData, "distance", null);
        Double pickupLat = parseNullableDouble(getMapValue(orderData, "pickup_latitude", null));
        Double pickupLng = parseNullableDouble(getMapValue(orderData, "pickup_longitude", null));
        android.location.Location driverLocation = com.shifter.driver.locationservice.LocationUpdateService.getLocation();

        // Populate Data
        if (orderData != null) {
            txtPrice.setText(getMapValue(orderData, "estimated_earning", "₹0"));
            txtPickup.setText(pickupAddress != null
                    ? OrderVoiceAnnouncer.pickupLabel(pickupAddress, pickupLat, pickupLng, driverLocation)
                    : "Unknown Pickup Location");
            txtDrop.setText(hasStops(rawStops)
                    ? appendTripDistance(routeText, tripDistanceKm)
                    : (deliveryAddress != null
                        ? OrderVoiceAnnouncer.dropLabel(deliveryAddress, tripDistanceKm)
                        : "Unknown Drop Location"));
            txtName.setText(getMapValue(orderData, "customer_name", "Customer"));
            txtDist.setText(getMapValue(orderData, "distance", "0 km"));
            txtDetails.setText(getMapValue(orderData, "order_details", "No additional details"));

            if (txtPickupTitle != null) {
                txtPickupTitle.setText(getMapValue(orderData, "pickup_name", "PICKUP"));
            }
            if (txtDropTitle != null) {
                txtDropTitle.setText(getMapValue(orderData, "drop_name", "DROP OFF"));
            }
        } else {
            txtPickup.setText("New Order Request");
            txtDrop.setText("Check details in app");
        }

        // Auto-reject timer (Dynamic from popup_duration in notification, fallback to home_data.php, default 10s)
        int timerSeconds = 10;
        try {
            String popupDurationStr = getMapValue(orderData, "popup_duration", null);
            if (popupDurationStr != null && !popupDurationStr.isEmpty()) {
                timerSeconds = Integer.parseInt(popupDurationStr);
            } else {
                com.shifter.driver.utility.SessionManager sessionManager = new com.shifter.driver.utility.SessionManager(context);
                String timerStr = sessionManager.getStringData(com.shifter.driver.utility.SessionManager.rejectTimer);
                if (timerStr != null && !timerStr.isEmpty()) {
                    timerSeconds = Integer.parseInt(timerStr);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing reject timer", e);
        }
        
        // expires_at (server epoch-ms deadline, armed the moment the offer's
        // lock was acquired server-side) is the source of truth for how much
        // time is ACTUALLY left — a fresh popup_duration-second countdown
        // starting only now double-counts however long push/socket delivery
        // already took before this dialog was shown, so it shows more time
        // than the server will actually still honor an accept for (see
        // OrderOverlayService's identical fix — same bug, foreground path).
        // Falls back to the old relative countdown if expires_at is missing
        // (older payload shape).
        long timerMillis = timerSeconds * 1000L;
        try {
            String expiresAtStr = getMapValue(orderData, "expires_at", null);
            if (expiresAtStr != null && !expiresAtStr.isEmpty()) {
                long expiresAt = Long.parseLong(expiresAtStr);
                timerMillis = Math.max(0, expiresAt - System.currentTimeMillis());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing expires_at, falling back to popup_duration", e);
        }

        android.os.CountDownTimer countDownTimer = new android.os.CountDownTimer(timerMillis, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                btnReject.setText("Reject (" + (millisUntilFinished / 1000) + "s)");
            }

            @Override
            public void onFinish() {
                // Local countdown running out is NOT the same as tapping Reject:
                // rejecting excludes this rider from every model of this order
                // (see API_INTEGRATION_GUIDE.md §6.1), but simply not responding
                // in time should only cost them this one model — the server's
                // own popup timer (order:dismiss) still lets them be re-offered
                // a later model. So this just closes the dialog locally and
                // sends nothing; the backend's own timeout handles the rest.
                if (dialog.isShowing()) {
                    dialog.dismiss();
                }
                // Unlike Accept/Reject/failure, a natural timeout never
                // called back into `listener` before — BaseActivity's own
                // duplicate-popup guard (lastShownOrderId) was only ever
                // reset from those three paths, so once a popup for this
                // order_id timed out on its own, every LATER tier's dialog
                // for the same order_id silently never showed again for
                // the rest of the app's process lifetime (confirmed live:
                // order #1555 — a driver only ever saw Model 2's popup,
                // despite the server correctly cascading through 3/4/5).
                if (listener != null) {
                    listener.onOrderTimedOut(orderId);
                }
            }
        };

        dialog.setOnShowListener(d -> countDownTimer.start());

        // Set Listeners
        btnAccept.setOnClickListener(v -> {
            Log.d("TimingProbe", "ACCEPT_TAP t=" + System.currentTimeMillis());
            dialog.dismiss(); // Will cancel the timer via onDismissListener
            acceptOrder(context, orderId, riderId, orderData, listener);
        });

        btnReject.setOnClickListener(v -> {
            dialog.dismiss(); // Will cancel the timer via onDismissListener
            rejectOrder(context, orderId, riderId, getMapValue(orderData, "package_id", null), listener);
        });

        currentDialog = dialog;
        currentOrderId = orderId;
        dialog.show();
        Log.d(TAG, "dialog.show() returned at t=" + System.currentTimeMillis() + " orderId=" + orderId);

        // ── Speak the order out loud instead of a generic ringtone (volume
        // controlled by showVolumeControlDialog) — "Aapse 4.2 km door
        // Khajrana mein order hai, kamai 250 rupaye" — so the driver gets
        // pickup/drop/earning without reading the screen. ──
        try {
            AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null && audioManager.getStreamVolume(AudioManager.STREAM_RING) > 0) {
                String announcement = OrderVoiceAnnouncer.buildAnnouncement(
                        pickupAddress, deliveryAddress, tripDistanceKm,
                        getMapValue(orderData, "estimated_earning", "0"),
                        pickupLat, pickupLng, driverLocation);
                OrderVoiceAnnouncer.announce(announcement);
                Log.d(TAG, "Order voice announcement started: " + announcement);
            } else {
                Log.d(TAG, "STREAM_RING volume is 0 — skipping voice announcement");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing voice announcement", e);
        }

        // Single dismiss listener for every cleanup this dialog needs —
        // setOnDismissListener only keeps the LAST one registered, so an
        // earlier separate call here to just cancel the timer would have
        // been silently replaced by this one, leaving countDownTimer
        // running (harmlessly, since onFinish() checks isShowing, but
        // pointlessly) for up to its full duration after the dialog closed.
        dialog.setOnDismissListener(d -> {
            countDownTimer.cancel();
            OrderVoiceAnnouncer.stop();
            if (currentDialog == dialog) {
                currentDialog = null;
                currentOrderId = null;
            }
        });
    }

    private static String formatStops(String finalDrop, String rawStops) {
        if (rawStops == null || rawStops.trim().isEmpty() || "[]".equals(rawStops.trim())) return finalDrop;
        try {
            JSONArray stops = new JSONArray(rawStops);
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < stops.length(); i++) {
                JSONObject stop = stops.optJSONObject(i);
                if (stop == null) continue;
                String address = stop.optString("address", "Address unavailable");
                result.append("Stop ").append(stop.optInt("sequence", i + 1)).append(": ").append(address).append("\n");
            }
            result.append("Final Drop: ").append(finalDrop == null ? "Address unavailable" : finalDrop);
            return result.toString();
        } catch (Exception ignored) {
            return finalDrop;
        }
    }

    private static boolean hasStops(String rawStops) {
        return rawStops != null && !rawStops.trim().isEmpty() && !"[]".equals(rawStops.trim());
    }

    private static String appendTripDistance(String routeText, String tripDistanceKm) {
        if (tripDistanceKm == null || tripDistanceKm.trim().isEmpty()) return routeText;
        return routeText + "\nTotal trip: " + tripDistanceKm + " km";
    }

    /**
     * Accept via the Node socket (order:accept) — this order_id belongs to
     * Node's dispatch system, not the legacy PHP accept_order.php. See
     * backend/API_INTEGRATION_GUIDE.md §6.1.
     */
    private static void acceptOrder(Context context, String orderId, String riderId,
            java.util.Map<String, String> orderData, OrderActionListener listener) {
        try {
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("order_id", orderId);
            payload.put("rider_id", riderId);

            Log.d("TimingProbe", "EMIT_ACCEPT t=" + System.currentTimeMillis());
            com.shifter.driver.socket.NodeSocketManager.getInstance().emitAccept(payload, ackData -> {
                Log.d("TimingProbe", "ACCEPT_ACK_RECEIVED t=" + System.currentTimeMillis());
                boolean isSuccess = ackData.optBoolean("Result", false);
                String message = ackData.optString("msg", "");

                if (isSuccess) {
                    Log.d(TAG, "Order accepted successfully");
                    if (listener != null) listener.onOrderAccepted(orderId);
                    Toast.makeText(context, message.isEmpty() ? "Order accepted successfully" : message,
                            Toast.LENGTH_SHORT).show();
                    Log.d("TimingProbe", "BEFORE_START_ORDER_DETAILS t=" + System.currentTimeMillis());
                    startOrderDetailsActivity(context, orderId, orderData);
                } else {
                    Log.e(TAG, "Order accept failed: " + message);
                    new AlertDialog.Builder(context)
                            .setTitle("Alert")
                            .setMessage(message.isEmpty() ? "Order no longer available" : message)
                            .setPositiveButton("OK", null)
                            .show();
                    if (listener != null) listener.onOrderActionFailed(orderId, "accept", message);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error emitting order:accept", e);
            Toast.makeText(context, "Error processing request", Toast.LENGTH_SHORT).show();
            if (listener != null) listener.onOrderActionFailed(orderId, "accept", e.getMessage());
        }
    }

    /**
     * Reject via the Node socket (order:reject) — no ack, matches the
     * driver-facing behaviour (see backend/API_INTEGRATION_GUIDE.md §6.1:
     * rejecting one model excludes this rider from every model of this
     * order, not just this one).
     */
    private static void rejectOrder(Context context, String orderId, String riderId, String packageId,
            OrderActionListener listener) {
        try {
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("order_id", orderId);
            payload.put("rider_id", riderId);
            // The exact tier the driver was shown — order:reject has no ack
            // (fire and forget), so if this event is delayed past the
            // popup's own 15s timeout, the server's in-memory lock for it is
            // already gone by the time it arrives; sending package_id lets
            // the server still record the reject correctly instead of
            // silently dropping it (confirmed live: a driver's reject
            // recorded as a plain timeout, so the cascade kept offering
            // them this order's later tiers).
            if (packageId != null) payload.put("package_id", packageId);
            com.shifter.driver.socket.NodeSocketManager.getInstance().emitReject(payload);
            Log.d(TAG, "order:reject emitted for order " + orderId + " package_id=" + packageId);
            if (listener != null) listener.onOrderRejected(orderId);
        } catch (Exception e) {
            Log.e(TAG, "Error emitting order:reject", e);
            Toast.makeText(context, "Error processing request", Toast.LENGTH_SHORT).show();
            if (listener != null) listener.onOrderActionFailed(orderId, "reject", e.getMessage());
        }
    }

    /**
     * Interface for order action callbacks
     */
    public interface OrderActionListener {
        void onOrderAccepted(String orderId);

        void onOrderRejected(String orderId);

        void onOrderActionFailed(String orderId, String action, String error);

        /** The popup's local countdown finished with no tap — the dialog closed itself, nothing was sent to the server. */
        void onOrderTimedOut(String orderId);
    }
    
    public static void startOrderDetailsActivity(Context context, String orderId, java.util.Map<String, String> data) {
        if (data == null) data = new java.util.HashMap<>();
        
        double plat = 0.0, plong = 0.0, dlat = 0.0, dlong = 0.0;
        try { plat  = Double.parseDouble(getMapValue(data, "plat",  "0")); } catch (Exception ignored) {}
        try { plong = Double.parseDouble(getMapValue(data, "plong", "0")); } catch (Exception ignored) {}
        try { dlat  = Double.parseDouble(getMapValue(data, "dlat",  "0")); } catch (Exception ignored) {}
        try { dlong = Double.parseDouble(getMapValue(data, "dlong", "0")); } catch (Exception ignored) {}
        
        com.shifter.driver.model.PDOrderItem orderItem = new com.shifter.driver.model.PDOrderItem(
                orderId,
                getMapValue(data, "order_flow_id", "1"),          
                getMapValue(data, "customer_name",  "Customer"),  
                getMapValue(data, "drop_name",      ""),
                getMapValue(data, "pickup_address", ""),          
                getMapValue(data, "delivery_address", ""),        
                getMapValue(data, "customer_pmobile", ""),
                getMapValue(data, "customer_dmobile", ""),
                getMapValue(data, "pick_type",  ""),
                getMapValue(data, "drop_type",  ""),
                plat, plong, dlat, dlong,
                getMapValue(data, "estimated_earning", "0"),      
                getMapValue(data, "distance",          "0"),
                getMapValue(data, "time_duration",     "0"),
                getMapValue(data, "order_date",        ""),
                getMapValue(data, "order_details",     ""),
                getMapValue(data, "status",            ""),
                getMapValue(data, "order_user_id",     ""),
                "0.00", "0.00", "0.00", "0.00", "0.00", "0", "0.00",
                getMapValue(data, "payment_status", "1")
        );
        // Save active order locally so app always remembers and re-opens it
        try {
            new com.shifter.driver.utility.SessionManager(context).setActiveOrder(orderItem);
        } catch (Exception e) {
            e.printStackTrace();
        }

        android.content.Intent homeIntent = new android.content.Intent(context, com.shifter.driver.activity.HomeActivity.class);
        homeIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
        
        android.content.Intent intent = new android.content.Intent(context, com.shifter.driver.activity.OrderDetailsActivity.class);
        intent.putExtra("myclass", orderItem);
        // Tells OrderDetailsActivity this is a fresh Accept, not a resumed/
        // reopened order — see its EXTRA_JUST_ACCEPTED for why that matters
        // (skips blocking the first frame on a network round-trip).
        intent.putExtra("just_accepted", true);
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);

        try {
            int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                flags |= android.app.PendingIntent.FLAG_IMMUTABLE;
            }
            
            Log.d("TimingProbe", "PENDING_INTENTS_START t=" + System.currentTimeMillis());
            android.app.PendingIntent piHome = android.app.PendingIntent.getActivity(context, 101, homeIntent, flags);
            piHome.send();

            android.app.PendingIntent piDetails = android.app.PendingIntent.getActivity(context, 102, intent, flags);
            piDetails.send();
            Log.d("TimingProbe", "PENDING_INTENTS_SENT t=" + System.currentTimeMillis());

        } catch (Exception e) {
            e.printStackTrace();
            try {
                context.startActivity(homeIntent);
                context.startActivity(intent);
            } catch (Exception ex) {
                ex.printStackTrace();
            }
        }
    }

    private static String getMapValue(java.util.Map<String, String> map, String key, String defaultValue) {
        if (map != null && map.containsKey(key)) {
            String value = map.get(key);
            return value != null ? value : defaultValue;
        }
        return defaultValue;
    }

    private static Double parseNullableDouble(String value) {
        if (value == null || value.trim().isEmpty()) return null;
        try {
            return Double.parseDouble(value);
        } catch (NumberFormatException e) {
            return null;
        }
    }
}

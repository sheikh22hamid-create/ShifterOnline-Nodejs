package com.shifter.driver.utility;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.media.AudioManager;
import android.util.Log;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;

import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import com.shifter.driver.model.OrderStop;

import java.lang.reflect.Type;
import java.util.ArrayList;
import java.util.List;

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
     * Show Accept/Reject dialog for an order with custom themed UI
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
        // OrderOverlayService's own "clean up previous view" step.
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
        android.widget.TextView txtDetails = view.findViewById(com.shifter.driver.R.id.txt_order_details);
        android.widget.Button btnAccept = view.findViewById(com.shifter.driver.R.id.btn_accept);
        android.widget.Button btnReject = view.findViewById(com.shifter.driver.R.id.btn_reject);

        String pickupAddress = getMapValue(orderData, "pickup_address", null);
        String deliveryAddress = getMapValue(orderData, "delivery_address", null);
        String rawStops = getMapValue(orderData, "stops", null);
        String tripDistanceKm = getMapValue(orderData, "distance", null);
        String packageId = getMapValue(orderData, "package_id", null);
        String modelName = getMapValue(orderData, "model_name", getMapValue(orderData, "driver_title", getMapValue(orderData, "package_name", null)));
        String packageTitle = getMapValue(orderData, "package_title", getMapValue(orderData, "title", null));
        String category = getMapValue(orderData, "category", getMapValue(orderData, "vehicle_type", "Bike"));
        String customerName = getMapValue(orderData, "customer_name", null);
        Double pickupLat = parseNullableDouble(getMapValue(orderData, "pickup_latitude", null));
        Double pickupLng = parseNullableDouble(getMapValue(orderData, "pickup_longitude", null));
        android.location.Location driverLocation = com.shifter.driver.locationservice.LocationUpdateService.getLocation();

        String estimatedEarning = getMapValue(orderData, "estimated_earning",
                getMapValue(orderData, "driver_earning",
                getMapValue(orderData, "trip_total",
                getMapValue(orderData, "total",
                getMapValue(orderData, "fare", "0")))));

        // 1. Apply Tier Visual Theme & Bind Order Data to View
        TierTheme.applyThemeToView(
                view,
                context,
                orderId,
                packageId,
                modelName,
                packageTitle,
                pickupAddress != null ? pickupAddress : "Unknown Pickup Location",
                deliveryAddress != null ? deliveryAddress : "Unknown Drop Location",
                pickupLat,
                pickupLng,
                tripDistanceKm,
                category,
                customerName,
                estimatedEarning,
                driverLocation
        );

        // 2. Configure Multi-stop timeline
        configureRouteTimeline(view, rawStops, deliveryAddress, tripDistanceKm);

        if (txtDetails != null && orderData != null) {
            String details = getMapValue(orderData, "order_details", null);
            if (details != null && !details.isEmpty() && !"No additional details".equalsIgnoreCase(details)) {
                txtDetails.setText(details);
                txtDetails.setVisibility(android.view.View.VISIBLE);
            }
        }

        boolean isDirectAssign = "true".equalsIgnoreCase(getMapValue(orderData, "is_direct_assign", "false"))
                || "true".equalsIgnoreCase(getMapValue(orderData, "is_monthly_order", "false"));

        if (isDirectAssign) {
            btnReject.setVisibility(android.view.View.GONE);
            btnAccept.setText("START TRIP / ACCEPT");
            android.widget.TextView txtSubtitle = view.findViewById(com.shifter.driver.R.id.txt_header_subtitle);
            if (txtSubtitle != null) {
                txtSubtitle.setText("Mandatory Trip • Monthly Driver");
            }
        }

        // Auto-reject timer (Dynamic from popup_duration in notification, fallback to home_data.php, default 10s)
        int timerSeconds = isDirectAssign ? 60 : 10;
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
        // time is ACTUALLY left.
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

        btnReject.setText("REJECT (" + (timerMillis / 1000) + "S)");

        android.os.CountDownTimer countDownTimer = new android.os.CountDownTimer(timerMillis, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                btnReject.setText("REJECT (" + (millisUntilFinished / 1000) + "S)");
            }

            @Override
            public void onFinish() {
                if (dialog.isShowing()) {
                    dialog.dismiss();
                }
                if (isDirectAssign) {
                    acceptOrder(context, orderId, riderId, orderData, listener);
                } else if (listener != null) {
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
        if (dialog.getWindow() != null) {
            android.util.DisplayMetrics metrics = context.getResources().getDisplayMetrics();
            int dialogWidth = Math.min((int) (metrics.widthPixels * 0.94), metrics.widthPixels - 20);
            dialog.getWindow().setLayout(dialogWidth, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
        }
        Log.d(TAG, "dialog.show() returned at t=" + System.currentTimeMillis() + " orderId=" + orderId);

        // Voice announcement
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

    private static void configureRouteTimeline(android.view.View root, String rawStops, String finalDrop, String tripDistanceKm) {
        android.view.View stop1 = root.findViewById(com.shifter.driver.R.id.route_stop1_block);
        android.view.View stop2 = root.findViewById(com.shifter.driver.R.id.route_stop2_block);
        android.view.View line1 = root.findViewById(com.shifter.driver.R.id.route_line_stop1_stop2);
        android.view.View line2 = root.findViewById(com.shifter.driver.R.id.route_line_stop2_drop);
        if (stop1 == null || stop2 == null || line1 == null || line2 == null) return;

        stop1.setVisibility(android.view.View.GONE);
        stop2.setVisibility(android.view.View.GONE);
        line1.setVisibility(android.view.View.GONE);
        line2.setVisibility(android.view.View.GONE);
        if (!hasStops(rawStops)) return;

        try {
            JSONArray stops = new JSONArray(rawStops);
            int count = Math.min(stops.length(), 2);
            for (int i = 0; i < count; i++) {
                JSONObject stop = stops.optJSONObject(i);
                if (stop == null) continue;
                int number = i + 1;
                int blockId = number == 1 ? com.shifter.driver.R.id.route_stop1_block : com.shifter.driver.R.id.route_stop2_block;
                int titleId = number == 1 ? com.shifter.driver.R.id.txt_stop1_title : com.shifter.driver.R.id.txt_stop2_title;
                int addressId = number == 1 ? com.shifter.driver.R.id.txt_stop1_address : com.shifter.driver.R.id.txt_stop2_address;
                root.findViewById(blockId).setVisibility(android.view.View.VISIBLE);
                ((android.widget.TextView) root.findViewById(titleId)).setText("STOP " + number);
                ((android.widget.TextView) root.findViewById(addressId)).setText(stop.optString("address", "Address unavailable"));
            }
            line1.setVisibility(count >= 1 ? android.view.View.VISIBLE : android.view.View.GONE);
            line2.setVisibility(count >= 2 ? android.view.View.VISIBLE : android.view.View.GONE);
            
            android.widget.TextView dropTitle = root.findViewById(com.shifter.driver.R.id.txt_drop_name_title);
            if (dropTitle != null) {
                String d = (tripDistanceKm != null && !tripDistanceKm.trim().isEmpty()) ? tripDistanceKm.trim() : "";
                if (!d.isEmpty()) {
                    if (!d.toLowerCase().contains("km")) d += " km";
                    dropTitle.setText("FINAL DROP (Stop " + (count + 1) + ") • (" + d + " from pickup)");
                } else {
                    dropTitle.setText("FINAL DROP (Stop " + (count + 1) + ")");
                }
            }
        } catch (Exception ignored) {
            // Keep the normal pickup/drop layout if the socket payload is malformed.
        }
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
            if (riderId != null && !riderId.isEmpty()) {
                try {
                    int rId = Integer.parseInt(riderId);
                    if (rId > 0) {
                        com.shifter.driver.socket.NodeSocketManager.getInstance().connectDriver(rId);
                    }
                } catch (Exception ignored) {}
            }

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
        orderItem.setAdvancePayment(getMapValue(data, "advance_payment", "0"));
        // The socket dispatch payload carries stops as a JSON string.
        orderItem.setStops(parseStops(getMapValue(data, "stops", "[]")));
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

    private static List<OrderStop> parseStops(String rawStops) {
        if (rawStops == null || rawStops.trim().isEmpty() || "[]".equals(rawStops.trim())) {
            return new ArrayList<>();
        }
        try {
            Type type = new TypeToken<List<OrderStop>>() {}.getType();
            List<OrderStop> parsed = new Gson().fromJson(rawStops, type);
            return parsed == null ? new ArrayList<>() : parsed;
        } catch (Exception e) {
            Log.w(TAG, "Unable to parse order stops", e);
            return new ArrayList<>();
        }
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

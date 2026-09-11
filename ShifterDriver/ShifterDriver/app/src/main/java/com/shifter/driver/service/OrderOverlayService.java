package com.shifter.driver.service;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.ColorDrawable;
import android.media.AudioManager;
import android.os.Build;
import android.os.CountDownTimer;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;

import com.shifter.driver.R;
import com.shifter.driver.utility.OrderDialogHelper;

public class OrderOverlayService extends Service {

    private static final String TAG = "OrderOverlayService";
    private static final int FOREGROUND_ID = 3001;
    private static final String CHANNEL_ID = "overlay_service_channel";

    private WindowManager windowManager;
    private FrameLayout rootContainer;
    private CountDownTimer countDownTimer;
    private PowerManager.WakeLock wakeLock;

    private String orderId;
    private String riderId;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Incoming Order")
                .setContentText("Displaying order dialog...")
                .setSmallIcon(R.drawable.ic_notification)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setSilent(true)
                .build();
        
        if (Build.VERSION.SDK_INT >= 34) { // Android 14+ (UPSIDE_DOWN_CAKE)
            startForeground(FOREGROUND_ID, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE);
        } else {
            startForeground(FOREGROUND_ID, notification);
        }

        if (intent != null && intent.getBooleanExtra("dismiss", false)) {
            // The Node socket's order:dismiss arrived for the order this
            // overlay is currently showing (e.g. it timed out or someone
            // else took it server-side, slightly ahead of this popup's own
            // local countdown) — close it without treating it as a reject.
            String dismissOrderId = intent.getStringExtra("order_id");
            if (dismissOrderId != null && dismissOrderId.equals(orderId)) {
                Log.d(TAG, "Dismiss received for currently-shown order " + dismissOrderId);
                removeOverlay(); // also stops this service
            } else {
                // Nothing currently shown for this order (already handled,
                // or this is a fresh service instance) — this start only
                // existed to deliver the dismiss check, nothing to clean up.
                stopSelf();
            }
            return START_NOT_STICKY;
        }

        if (intent != null) {
            orderId = intent.getStringExtra("order_id");
            riderId = intent.getStringExtra("rider_id");

            if (riderId == null || riderId.isEmpty()) {
                try {
                    com.shifter.driver.utility.SessionManager sessionManager = new com.shifter.driver.utility.SessionManager(this);
                    if (sessionManager.getUserDetails() != null) {
                        riderId = String.valueOf(sessionManager.getUserDetails().getId());
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error fetching riderId from SessionManager", e);
                }
            }

            if (riderId != null && !riderId.isEmpty()) {
                try {
                    int rId = Integer.parseInt(riderId);
                    if (rId > 0) {
                        com.shifter.driver.socket.NodeSocketManager.getInstance().connectDriver(rId);
                    }
                } catch (Exception ignored) {}
            }
            
            showOverlayDialog(intent);
        } else {
            stopSelf();
        }

        return START_NOT_STICKY;
    }

    private void showOverlayDialog(Intent intent) {
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);

        // Turn on screen using WakeLock
        PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (powerManager != null) {
            wakeLock = powerManager.newWakeLock(
                    PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP,
                    "OrderOverlayService::WakeLock");
            wakeLock.acquire(15000); // Max 15 seconds
        }

        // Clean up previous view/timer if attached — a new order:request for
        // this same order (a later tier's popup) can arrive while this
        // service's previous overlay is still showing. The old
        // CountDownTimer must be cancelled here explicitly: losing the Java
        // reference alone does NOT stop it, it keeps ticking independently
        // in the background, and its own onFinish() (removeOverlay ->
        // hideOverlayUI) operates on this service's CURRENT fields — not
        // scoped to itself — so it would tear down the brand-new overlay
        // set up below the moment the OLD timer's original ~15s elapses,
        // which can be mere moments after the new one is shown.
        if (countDownTimer != null) {
            countDownTimer.cancel();
            countDownTimer = null;
        }
        if (rootContainer != null && windowManager != null) {
            try {
                if (rootContainer.isAttachedToWindow()) {
                    windowManager.removeView(rootContainer);
                }
            } catch (Exception e) {
                // Ignore
            }
            rootContainer = null;
        }

        rootContainer = new FrameLayout(this);
        rootContainer.setBackgroundColor(Color.parseColor("#99000000")); // Dim background
        FrameLayout.LayoutParams rootParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        rootContainer.setLayoutParams(rootParams);

        // Inflate using Theme_UserApp so CardView & Material components render properly in Service
        android.view.ContextThemeWrapper contextThemeWrapper = new android.view.ContextThemeWrapper(this, R.style.Theme_UserApp);
        View view = LayoutInflater.from(contextThemeWrapper).inflate(R.layout.dialog_new_order, rootContainer, false);
        FrameLayout.LayoutParams viewParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        viewParams.gravity = Gravity.CENTER;
        
        int margin = (int) (20 * getResources().getDisplayMetrics().density);
        viewParams.setMargins(margin, margin, margin, margin);

        rootContainer.addView(view, viewParams);

        int layoutType;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            layoutType = WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY;
        } else {
            layoutType = WindowManager.LayoutParams.TYPE_PHONE;
        }

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                layoutType,
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                        | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                        | WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.CENTER;

        try {
            windowManager.addView(rootContainer, params);
            Log.e(TAG, "Order overlay window added successfully!");
            Log.d(TAG, "overlay addView() returned at t=" + System.currentTimeMillis());
        } catch (Exception e) {
            Log.e(TAG, "Error adding overlay to WindowManager", e);
            stopSelf();
            return;
        }

        // Find Views
        TextView txtDetails = view.findViewById(R.id.txt_order_details);
        Button btnAccept = view.findViewById(R.id.btn_accept);
        Button btnReject = view.findViewById(R.id.btn_reject);

        String pickupAddress = intent.getStringExtra("pickup_address");
        String finalDropAddress = intent.getStringExtra("delivery_address");
        String rawStops = intent.getStringExtra("stops");
        String deliveryAddress = finalDropAddress;
        String tripDistanceKm = intent.getStringExtra("distance");
        String packageId = intent.getStringExtra("package_id");
        String modelName = intent.getStringExtra("model_name") != null ? intent.getStringExtra("model_name")
                : (intent.getStringExtra("driver_title") != null ? intent.getStringExtra("driver_title") : intent.getStringExtra("package_name"));
        String packageTitle = intent.getStringExtra("package_title") != null ? intent.getStringExtra("package_title") : intent.getStringExtra("title");
        String category = intent.getStringExtra("category") != null ? intent.getStringExtra("category") : intent.getStringExtra("vehicle_type");
        String customerName = intent.getStringExtra("customer_name");
        Double pickupLat = parseNullableDouble(intent.getStringExtra("pickup_latitude"));
        Double pickupLng = parseNullableDouble(intent.getStringExtra("pickup_longitude"));
        android.location.Location driverLocation = com.shifter.driver.locationservice.LocationUpdateService.getLocation();

        // 1. Apply Tier Visual Theme & Bind Order Data
        com.shifter.driver.utility.TierTheme.applyThemeToView(
                view,
                this,
                orderId,
                packageId,
                modelName,
                packageTitle,
                pickupAddress != null
                        ? com.shifter.driver.utility.OrderVoiceAnnouncer.pickupLabel(pickupAddress, pickupLat, pickupLng, driverLocation)
                        : "Unknown Pickup Location",
                hasStops(rawStops)
                        ? deliveryAddress
                        : (finalDropAddress != null
                            ? com.shifter.driver.utility.OrderVoiceAnnouncer.dropLabel(finalDropAddress, tripDistanceKm)
                            : "Unknown Drop Location"),
                tripDistanceKm,
                category,
                customerName,
                driverLocation
        );

        // 2. Configure Multi-stop timeline
        configureRouteTimeline(view, rawStops, finalDropAddress);

        if (txtDetails != null) {
            String details = intent.getStringExtra("order_details");
            if (details != null && !details.isEmpty() && !"No additional details".equalsIgnoreCase(details)) {
                txtDetails.setText(details);
                txtDetails.setVisibility(View.VISIBLE);
            }
        }

        boolean isDirectAssign = "true".equalsIgnoreCase(intent.getStringExtra("is_direct_assign"))
                || "true".equalsIgnoreCase(intent.getStringExtra("is_monthly_order"));

        if (isDirectAssign) {
            btnReject.setVisibility(View.GONE);
            btnAccept.setText("START TRIP / ACCEPT");
            TextView txtSubtitle = view.findViewById(R.id.txt_header_subtitle);
            if (txtSubtitle != null) {
                txtSubtitle.setText("Mandatory Trip • Monthly Driver");
            }
        }

        playVoiceAnnouncement(intent);

        int timerSeconds = isDirectAssign ? 60 : 10;
        try {
            String popupDurationStr = intent.getStringExtra("popup_duration");
            if (popupDurationStr != null && !popupDurationStr.isEmpty()) {
                timerSeconds = Integer.parseInt(popupDurationStr);
            } else {
                com.shifter.driver.utility.SessionManager sessionManager = new com.shifter.driver.utility.SessionManager(this);
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
            String expiresAtStr = intent.getStringExtra("expires_at");
            if (expiresAtStr != null && !expiresAtStr.isEmpty()) {
                long expiresAt = Long.parseLong(expiresAtStr);
                timerMillis = Math.max(0, expiresAt - System.currentTimeMillis());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing expires_at, falling back to popup_duration", e);
        }

        // update wake lock to release matching the timeout
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock.acquire(timerMillis + 5000); // Max timer + 5s buffer
        }

        btnReject.setText("REJECT (" + (timerMillis / 1000) + "S)");

        countDownTimer = new CountDownTimer(timerMillis, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                btnReject.setText("REJECT (" + (millisUntilFinished / 1000) + "S)");
            }

            @Override
            public void onFinish() {
                if (isDirectAssign) {
                    hideOverlayUI();
                    acceptOrder(orderId, riderId, intent);
                } else {
                    removeOverlay();
                }
            }
        };
        countDownTimer.start();

        btnAccept.setOnClickListener(v -> {
            Log.d("TimingProbe", "ACCEPT_TAP t=" + System.currentTimeMillis());
            hideOverlayUI();
            acceptOrder(orderId, riderId, intent);
        });

        btnReject.setOnClickListener(v -> {
            hideOverlayUI();
            rejectOrder(orderId, riderId, intent.getStringExtra("package_id"));
        });
    }

    private String formatStops(String finalDrop, String rawStops) {
        if (rawStops == null || rawStops.trim().isEmpty() || "[]".equals(rawStops.trim())) return finalDrop;
        try {
            org.json.JSONArray stops = new org.json.JSONArray(rawStops);
            StringBuilder result = new StringBuilder();
            for (int i = 0; i < stops.length(); i++) {
                org.json.JSONObject stop = stops.optJSONObject(i);
                if (stop == null) continue;
                result.append("Stop ").append(stop.optInt("sequence", i + 1)).append(": ")
                        .append(stop.optString("address", "Address unavailable")).append("\n");
            }
            result.append("Final Drop: ").append(finalDrop == null ? "Address unavailable" : finalDrop);
            return result.toString();
        } catch (Exception ignored) { return finalDrop; }
    }

    private boolean hasStops(String rawStops) {
        return rawStops != null && !rawStops.trim().isEmpty() && !"[]".equals(rawStops.trim());
    }

    private void configureRouteTimeline(View root, String rawStops, String finalDrop) {
        View stop1 = root.findViewById(R.id.route_stop1_block);
        View stop2 = root.findViewById(R.id.route_stop2_block);
        View line1 = root.findViewById(R.id.route_line_stop1_stop2);
        View line2 = root.findViewById(R.id.route_line_stop2_drop);
        TextView drop = root.findViewById(R.id.txt_drop_address);
        TextView dropTitle = root.findViewById(R.id.txt_drop_name_title);
        if (stop1 == null || stop2 == null || line1 == null || line2 == null) return;

        stop1.setVisibility(View.GONE);
        stop2.setVisibility(View.GONE);
        line1.setVisibility(View.GONE);
        line2.setVisibility(View.GONE);
        if (drop != null) drop.setText(finalDrop == null ? "Address unavailable" : finalDrop);
        if (dropTitle != null) dropTitle.setText("Drop (Stop 1)");
        if (!hasStops(rawStops)) return;

        try {
            org.json.JSONArray stops = new org.json.JSONArray(rawStops);
            int count = Math.min(stops.length(), 2);
            for (int i = 0; i < count; i++) {
                org.json.JSONObject stop = stops.optJSONObject(i);
                if (stop == null) continue;
                int number = i + 1;
                int blockId = number == 1 ? R.id.route_stop1_block : R.id.route_stop2_block;
                int titleId = number == 1 ? R.id.txt_stop1_title : R.id.txt_stop2_title;
                int addressId = number == 1 ? R.id.txt_stop1_address : R.id.txt_stop2_address;
                root.findViewById(blockId).setVisibility(View.VISIBLE);
                ((TextView) root.findViewById(titleId)).setText("Stop " + number);
                ((TextView) root.findViewById(addressId)).setText(stop.optString("address", "Address unavailable"));
            }
            line1.setVisibility(count >= 1 ? View.VISIBLE : View.GONE);
            line2.setVisibility(count >= 2 ? View.VISIBLE : View.GONE);
            if (dropTitle != null) {
                dropTitle.setText("Drop (Stop " + (count + 1) + ")");
            }
        } catch (Exception ignored) {
            // Keep the normal pickup/drop layout if the socket payload is malformed.
        }
    }

    private String appendTripDistance(String routeText, String tripDistanceKm) {
        if (tripDistanceKm == null || tripDistanceKm.trim().isEmpty()) return routeText;
        return routeText + "\nTotal trip: " + tripDistanceKm + " km";
    }

    private void playVoiceAnnouncement(Intent intent) {
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null && audioManager.getStreamVolume(AudioManager.STREAM_RING) > 0) {
                String announcement = com.shifter.driver.utility.OrderVoiceAnnouncer.buildAnnouncement(
                        intent.getStringExtra("pickup_address"),
                        intent.getStringExtra("delivery_address"),
                        intent.getStringExtra("distance"),
                        intent.getStringExtra("estimated_earning") != null ? intent.getStringExtra("estimated_earning") : "0",
                        parseNullableDouble(intent.getStringExtra("pickup_latitude")),
                        parseNullableDouble(intent.getStringExtra("pickup_longitude")),
                        com.shifter.driver.locationservice.LocationUpdateService.getLocation());
                com.shifter.driver.utility.OrderVoiceAnnouncer.announce(announcement);
                Log.d(TAG, "Order overlay voice announcement started: " + announcement);
            } else {
                Log.d(TAG, "STREAM_RING volume is 0 — skipping voice announcement");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing voice announcement", e);
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

    private void hideOverlayUI() {
        if (countDownTimer != null) {
            countDownTimer.cancel();
        }
        com.shifter.driver.utility.OrderVoiceAnnouncer.stop();
        
        try {
            NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                notificationManager.cancel(2001); // NOTIFICATION_ID_ORDER
            }
        } catch (Exception e) {
            Log.e(TAG, "Error dismissing notification", e);
        }

        if (rootContainer != null && windowManager != null) {
            try {
                if (rootContainer.isAttachedToWindow()) {
                    windowManager.removeView(rootContainer);
                }
            } catch (Exception e) {
                Log.e(TAG, "Error removing overlay view", e);
            }
            rootContainer = null;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    private void removeOverlay() {
        hideOverlayUI();
        stopSelf();
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        removeOverlay();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Order Overlay Service",
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Running service for incoming order overlay");
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Accept/reject go over the Node socket now, not the legacy PHP
    // accept_order.php/reject_order.php — this order_id belongs to Node's
    // dispatch system (see backend/API_INTEGRATION_GUIDE.md §6.1), and the
    // driver must already be connected as this rider (NodeSocketManager
    // connects at login/app-start — see HomeFragment). (Duplicated from
    // OrderDialogHelper to avoid UI coupling.)
    // ────────────────────────────────────────────────────────────────────────

    private void acceptOrder(String orderId, String riderId, Intent intent) {
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
                    Toast.makeText(getApplicationContext(), message.isEmpty() ? "Order no longer available" : message, Toast.LENGTH_LONG).show();
                }
                stopSelf();
            });
        } catch (Exception e) {
            Log.e(TAG, "Error emitting order:accept", e);
            stopSelf();
        }
    }

    private void rejectOrder(String orderId, String riderId, String packageId) {
        try {
            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("order_id", orderId);
            payload.put("rider_id", riderId);
            // See OrderDialogHelper.rejectOrder for why this matters: order:reject
            // has no ack, so a delayed event needs its own tier id to still be
            // recorded correctly once the server's in-memory lock is already gone.
            if (packageId != null) payload.put("package_id", packageId);
            com.shifter.driver.socket.NodeSocketManager.getInstance().emitReject(payload);
        } catch (Exception e) {
            Log.e(TAG, "Error emitting order:reject", e);
        } finally {
            stopSelf();
        }
    }
}

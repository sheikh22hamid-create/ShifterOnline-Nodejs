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
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
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
    private Ringtone ringtone;
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

        // Clean up previous view if attached
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
        } catch (Exception e) {
            Log.e(TAG, "Error adding overlay to WindowManager", e);
            stopSelf();
            return;
        }

        // Find Views
        TextView txtPrice = view.findViewById(R.id.txt_estimated_price);
        TextView txtPickupTitle = view.findViewById(R.id.txt_pickup_name_title);
        TextView txtDropTitle = view.findViewById(R.id.txt_drop_name_title);
        TextView txtPickup = view.findViewById(R.id.txt_pickup_address);
        TextView txtDrop = view.findViewById(R.id.txt_drop_address);
        TextView txtName = view.findViewById(R.id.txt_customer_name);
        TextView txtDist = view.findViewById(R.id.txt_distance);
        TextView txtDetails = view.findViewById(R.id.txt_order_details);
        Button btnAccept = view.findViewById(R.id.btn_accept);
        Button btnReject = view.findViewById(R.id.btn_reject);

        // Populate Data
        txtPrice.setText(intent.getStringExtra("estimated_earning") != null ? intent.getStringExtra("estimated_earning") : "₹0");
        txtPickup.setText(intent.getStringExtra("pickup_address") != null ? intent.getStringExtra("pickup_address") : "Unknown Pickup Location");
        txtDrop.setText(intent.getStringExtra("delivery_address") != null ? intent.getStringExtra("delivery_address") : "Unknown Drop Location");
        txtName.setText(intent.getStringExtra("customer_name") != null ? intent.getStringExtra("customer_name") : "Customer");
        txtDist.setText(intent.getStringExtra("distance") != null ? intent.getStringExtra("distance") : "0 km");
        txtDetails.setText(intent.getStringExtra("order_details") != null ? intent.getStringExtra("order_details") : "No additional details");

        if (txtPickupTitle != null) {
            String pName = intent.getStringExtra("pickup_name");
            txtPickupTitle.setText(pName != null && !pName.isEmpty() ? pName : "PICKUP");
        }
        if (txtDropTitle != null) {
            String dName = intent.getStringExtra("drop_name");
            txtDropTitle.setText(dName != null && !dName.isEmpty() ? dName : "DROP OFF");
        }

        playRingtone();

        int timerSeconds = 10;
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

        long timerMillis = timerSeconds * 1000L;
        
        // update wake lock to release matching the timeout
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock.acquire(timerMillis + 5000); // Max timer + 5s buffer
        }

        countDownTimer = new CountDownTimer(timerMillis, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                btnReject.setText("Reject (" + (millisUntilFinished / 1000) + "s)");
            }

            @Override
            public void onFinish() {
                removeOverlay();
                rejectOrder(orderId, riderId);
                Toast.makeText(OrderOverlayService.this, "Order automatically rejected (timeout)", Toast.LENGTH_SHORT).show();
            }
        };
        countDownTimer.start();

        btnAccept.setOnClickListener(v -> {
            hideOverlayUI();
            acceptOrder(orderId, riderId, intent);
        });

        btnReject.setOnClickListener(v -> {
            hideOverlayUI();
            rejectOrder(orderId, riderId);
        });
    }

    private void playRingtone() {
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null && audioManager.getStreamVolume(AudioManager.STREAM_RING) > 0) {
                Uri ringtoneUri = Uri.parse("android.resource://" + getPackageName() + "/" + com.shifter.driver.R.raw.movigo_ringtone);
                ringtone = RingtoneManager.getRingtone(this, ringtoneUri);
                if (ringtone != null) {
                    ringtone.setStreamType(AudioManager.STREAM_RING);
                    ringtone.play();
                    Log.d(TAG, "Order overlay ringtone started");
                }
            } else {
                Log.d(TAG, "STREAM_RING volume is 0 — skipping sound");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing ringtone", e);
        }
    }

    private void stopRingtone() {
        if (ringtone != null && ringtone.isPlaying()) {
            ringtone.stop();
            Log.d(TAG, "Order overlay ringtone stopped");
        }
    }

    private void hideOverlayUI() {
        if (countDownTimer != null) {
            countDownTimer.cancel();
        }
        stopRingtone();
        
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
    // API CALLS (Duplicated from OrderDialogHelper to avoid UI coupling)
    // ────────────────────────────────────────────────────────────────────────

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
}

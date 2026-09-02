package com.shifter.driver;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import com.shifter.driver.activity.ChatActivityUser;
import com.shifter.driver.activity.HomeActivity;
import com.shifter.driver.utility.AppStatus;

public class MyFirebaseMessagingService extends FirebaseMessagingService {

    private static final String TAG = "FCMService";
    private static final String ACTION_ORDER_NOTIFICATION = "com.shifter.driver.ORDER_NOTIFICATION";
    private static final String EXTRA_ORDER_ID = "order_id";
    private static final String CHANNEL_ID_ORDER = "order_channel";
    private static final int NOTIFICATION_ID_ORDER = 2001;

    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        Log.e("FCM_ORDER_DATA", "========================================");
        Log.e("FCM_ORDER_DATA", ">> FCM MESSAGE RECEIVED <<");

        if (remoteMessage.getData() != null && remoteMessage.getData().size() > 0) {
            Log.e("FCM_ORDER_DATA", "DATA PAYLOAD: " + remoteMessage.getData().toString());
            for (String key : remoteMessage.getData().keySet()) {
                Log.e("FCM_ORDER_DATA", "   " + key + " = " + remoteMessage.getData().get(key));
            }
        } else {
            Log.e("FCM_ORDER_DATA", "DATA PAYLOAD: [EMPTY]");
        }

        if (remoteMessage.getNotification() != null) {
            Log.e("FCM_ORDER_DATA", "NOTIFICATION TITLE: " + remoteMessage.getNotification().getTitle());
            Log.e("FCM_ORDER_DATA", "NOTIFICATION BODY: " + remoteMessage.getNotification().getBody());
            Log.e("FCM_ORDER_DATA", "NOTIFICATION CHANNEL: " + remoteMessage.getNotification().getChannelId());
        }
        Log.e("FCM_ORDER_DATA", "========================================");

        // Check if this is an order notification
        boolean isOrder = (remoteMessage.getData() != null && remoteMessage.getData().containsKey("order_id"))
                || (remoteMessage.getData() != null && remoteMessage.getData().containsKey("type") && (
                        "order".equalsIgnoreCase(remoteMessage.getData().get("type"))
                        || "new_order".equalsIgnoreCase(remoteMessage.getData().get("type"))
                        || "order_assign".equalsIgnoreCase(remoteMessage.getData().get("type"))
                ))
                || (remoteMessage.getNotification() != null && remoteMessage.getNotification().getTitle() != null
                    && remoteMessage.getNotification().getTitle().toLowerCase().contains("order"));

        if (isOrder) {
            handleOrderNotification(remoteMessage);
            return;
        }

        // Handle chat messages (existing logic)
        if (remoteMessage.getData().size() > 0) {
            String message = remoteMessage.getData().get("message");
            if (!AppStatus.isChatActivityOpen()) {
                sendNotification("New message", message, remoteMessage.getData().get("receiverId"));
            }
        }

        if (remoteMessage.getNotification() != null) {
            String title = remoteMessage.getNotification().getTitle();
            String body = remoteMessage.getNotification().getBody();
            Log.e("title " + title, "body " + body);
            if (!AppStatus.isChatActivityOpen()) {
                sendNotification(title, body, remoteMessage.getData().get("receiverId"));
            }
        }
    }

    /**
     * Handle order notification:
     *   FOREGROUND → Broadcast → BroadcastReceiver → dialog directly (no notification)
     *   BACKGROUND / KILLED → Overlay dialog over other apps + Full-screen notification
     */
    private static String lastHandledOrderId = "";
    private static long lastHandledTimestamp = 0;

    private void handleOrderNotification(RemoteMessage remoteMessage) {
        java.util.Map<String, String> data = remoteMessage.getData();

        String orderId = data != null ? data.get("order_id") : null;
        String earning = data != null ? data.get("estimated_earning") : null;

        // Unique key for dedup (orderId + earning combo)
        String currentKey = (orderId != null ? orderId : "") + "_" + (earning != null ? earning : "");

        String title = (data != null && data.containsKey("title")) ? data.get("title")
                : (remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "New Order");
        String body = (data != null && data.containsKey("body")) ? data.get("body")
                : (remoteMessage.getNotification() != null ? remoteMessage.getNotification().getBody()
                        : "You have a new order request");

        if (orderId == null || orderId.isEmpty()) {
            Log.e(TAG, "Order ID missing in FCM data");
            return;
        }

        // Duplicate check (3-second window)
        long now = System.currentTimeMillis();
        if (currentKey.equals(lastHandledOrderId) && (now - lastHandledTimestamp) < 3000) {
            Log.d(TAG, "Duplicate FCM skipped within 3s: " + currentKey);
            return;
        }
        lastHandledOrderId = currentKey;
        lastHandledTimestamp = now;

        Log.d(TAG, "FCM order received | order_id=" + orderId
                + " | fg=" + MyApplication.isAppInForeground()
                + " | bg=" + MyApplication.isAppInBackground()
                + " | killed=" + MyApplication.isAppKilled());

        if (MyApplication.isAppInForeground()) {
            // ── FOREGROUND ──────────────────────────────────────────────────────
            // App screen pe hai → broadcast → BroadcastReceiver → dialog turant
            Log.d(TAG, "FOREGROUND — broadcast sent");
            sendOrderBroadcast(orderId, data);

        } else {
            // ── BACKGROUND or KILLED / OTHER APPS ───────────────────────────────
            
            // 1. Show system overlay dialog over other apps
            if (com.shifter.driver.utility.OverlayPermissionHelper.hasOverlayPermission(this)) {
                Log.d(TAG, "Starting OrderOverlayService for background overlay");
                try {
                    Intent overlayIntent = new Intent(this, com.shifter.driver.service.OrderOverlayService.class);
                    overlayIntent.putExtra("order_id", orderId);
                    if (data != null) {
                        for (String key : data.keySet()) {
                            overlayIntent.putExtra(key, data.get(key));
                        }
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(overlayIntent);
                    } else {
                        startService(overlayIntent);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start OrderOverlayService", e);
                }
            } else {
                Log.d(TAG, "No overlay permission");
            }

            // 2. Also trigger high-priority heads-up / full-screen notification for sound & wake-up
            showOrderNotification(title, body, orderId, data);
        }
    }

    /**
     * Send broadcast to show Accept/Reject dialog (for foreground state)
     */
    private void sendOrderBroadcast(String orderId, java.util.Map<String, String> data) {
        Intent intent = new Intent(ACTION_ORDER_NOTIFICATION);
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        // Put all data fields
        if (data != null) {
            for (String key : data.keySet()) {
                intent.putExtra(key, data.get(key));
            }
        }
        intent.setPackage(getPackageName());
        sendBroadcast(intent);
        Log.d(TAG, "Broadcast sent for order_id: " + orderId);
    }

    /**
     * Show high-priority notification (for background/killed state)
     */
    private void showOrderNotification(String title, String body, String orderId, java.util.Map<String, String> data) {
        ensureOrderNotificationChannel();

        // Content intent: user notification tap kare tab HomeActivity open ho + dialog dikhao
        Intent intent = new Intent(this, HomeActivity.class);
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        intent.putExtra("show_order_dialog", true);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (data != null) {
            for (String key : data.keySet()) {
                intent.putExtra(key, data.get(key));
            }
        }

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                : PendingIntent.FLAG_UPDATE_CURRENT;

        // Content intent (request code 0) — notification tap karne par
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, intent, flags);

        // Full-screen intent (request code 1) — auto-show on screen
        // Android 10-13: Works without extra permission
        // Android 14+: Needs USE_FULL_SCREEN_INTENT user approval (already in manifest)
        // When app is in background: Shows as Heads-up (top pe popup)
        // When device is locked: Shows as full-screen overlay (call jaisa)
        Intent fullScreenIntent = new Intent(this, HomeActivity.class);
        fullScreenIntent.putExtra(EXTRA_ORDER_ID, orderId);
        fullScreenIntent.putExtra("show_order_dialog", true);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (data != null) {
            for (String key : data.keySet()) {
                fullScreenIntent.putExtra(key, data.get(key));
            }
        }
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                this, 1, fullScreenIntent, flags);

        // Custom ringtone from raw resources
        android.net.Uri ringtoneUri = android.net.Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.movigo_ringtone);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID_ORDER)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setSound(ringtoneUri, android.media.AudioManager.STREAM_RING)
                .setVibrate(new long[]{0, 500, 200, 500})
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)   // ← auto-popup!
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            notificationManager.notify(NOTIFICATION_ID_ORDER, builder.build());
            Log.d(TAG, "Order notification posted | ID=" + NOTIFICATION_ID_ORDER
                    + " | order_id=" + orderId);
        } else {
            Log.e(TAG, "NotificationManager is NULL");
        }
    }

    /**
     * Create notification channel for order notifications (Android O+).
     * Uses the default ringtone on STREAM_RING so the volume is controlled
     * by showVolumeControlDialog in HomeFragment.
     */
    private void ensureOrderNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID_ORDER,
                    "Order Notifications",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Notifications for new order requests");
            channel.setShowBadge(true);
            channel.enableVibration(true);
            channel.enableLights(true);

            // Use custom movigo_ringtone on STREAM_RING
            android.net.Uri ringtoneUri = android.net.Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.movigo_ringtone);
            android.media.AudioAttributes audioAttributes = new android.media.AudioAttributes.Builder()
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build();
            channel.setSound(ringtoneUri, audioAttributes);

            NotificationManager notificationManager = (NotificationManager) getSystemService(
                    Context.NOTIFICATION_SERVICE);
            if (notificationManager != null) {
                notificationManager.createNotificationChannel(channel);
            }
        }
    }

    /**
     * Check if app is in foreground using Application lifecycle tracking
     */
    private boolean isAppInForeground() {
        return MyApplication.isAppInForeground();
    }

    // private void sendNotification(String title, String body) {
    // // Implement notification code here
    // // You can use NotificationManager to show notifications
    // }
    public void sendNotification(String title, String body, String receiverId) {
        Intent intent = new Intent(this, ChatActivityUser.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("receiverId", receiverId);

        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        String channelId = "chat_notifications";
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    channelId,
                    "Chat Notifications",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(channel);
        }

        NotificationCompat.Builder notificationBuilder = new NotificationCompat.Builder(this, channelId)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(pendingIntent);

        notificationManager.notify(0, notificationBuilder.build());
    }
}
package com.shifter.driver.utility;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import com.shifter.driver.MyApplication;
import com.shifter.driver.R;
import com.shifter.driver.activity.HomeActivity;
import com.shifter.driver.service.OrderOverlayService;

/**
 * Makes sure a driver notices that the customer cancelled an order they had
 * accepted, wherever they are: on another app, Google Maps navigation, the
 * home screen, or with the screen locked. Plays the same ringtone as a new
 * order, once, and
 *   - app in foreground: the in-app dialog (BaseActivity / OrderDetailsActivity,
 *     driven by SocketOrderRouter.ACTION_ORDER_CANCELLED) shows the popup;
 *   - otherwise with "draw over other apps" granted: a popup overlay over
 *     whatever is on screen (OrderOverlayService, mode=cancelled);
 *   - otherwise: a heads-up/full-screen notification.
 *
 * The same cancellation arrives over both FCM and the socket, so repeats for
 * one order are dropped.
 */
public final class OrderCancelAlert {
    private static final String TAG = "OrderCancelAlert";
    private static final long DEDUPE_MS = 10_000;
    private static final String CHANNEL_ID = "order_cancelled_alert";
    private static final int NOTIFICATION_ID = 2002;

    private static String lastOrderId;
    private static long lastAt;

    private OrderCancelAlert() {}

    static synchronized boolean shouldHandle(String orderId, long now) {
        if (orderId != null && orderId.equals(lastOrderId) && now - lastAt < DEDUPE_MS) {
            return false;
        }
        lastOrderId = orderId;
        lastAt = now;
        return true;
    }

    public static void show(Context context, String orderId, String reason) {
        if (context == null || orderId == null || orderId.isEmpty()) return;
        if (!shouldHandle(orderId, System.currentTimeMillis())) {
            Log.d(TAG, "Duplicate cancel alert skipped for order " + orderId);
            return;
        }
        Context app = context.getApplicationContext();

        OrderAlertPlayer.playOnce(app);

        if (MyApplication.isAppInForeground()) return;

        if (OverlayPermissionHelper.hasOverlayPermission(app)) {
            try {
                Intent overlay = new Intent(app, OrderOverlayService.class);
                overlay.putExtra("mode", "cancelled");
                overlay.putExtra("order_id", orderId);
                overlay.putExtra("reason", reason == null ? "" : reason);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    app.startForegroundService(overlay);
                } else {
                    app.startService(overlay);
                }
                return;
            } catch (Exception e) {
                Log.e(TAG, "Overlay start failed, falling back to notification", e);
            }
        }
        postHeadsUp(app, orderId, reason);
    }

    private static void postHeadsUp(Context app, String orderId, String reason) {
        NotificationManager manager = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        ensureChannel(manager);

        Intent open = new Intent(app, HomeActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                : PendingIntent.FLAG_UPDATE_CURRENT;
        PendingIntent pending = PendingIntent.getActivity(app, 3, open, flags);

        String body = (reason == null || reason.trim().isEmpty())
                ? "Order #" + orderId + " was cancelled by the customer."
                : "Order #" + orderId + " was cancelled: " + reason;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(app, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Order Cancelled")
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setSound(null)
                .setAutoCancel(true)
                .setContentIntent(pending)
                .setFullScreenIntent(pending, true);
        manager.notify(NOTIFICATION_ID, builder.build());
    }

    // Silent channel: the ringtone is already played once by OrderAlertPlayer,
    // so the notification must not ring a second time on top of it.
    private static void ensureChannel(NotificationManager manager) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Order cancelled", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Alerts when a customer cancels an order you accepted");
        channel.setSound(null, null);
        channel.enableVibration(true);
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }
}

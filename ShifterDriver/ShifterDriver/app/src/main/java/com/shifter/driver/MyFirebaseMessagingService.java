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
    // A NEW channel id, not "order_channel" — Android locks a channel's sound
    // once created, so devices that already have "order_channel" installed
    // would keep playing its ringtone forever no matter what this code sets
    // now. This channel carries no sound at all (see ensureOrderNotificationChannel):
    // the system notification's own movigo_ringtone (~8-10s) was competing
    // with OrderVoiceAnnouncer's TTS for audio output, delaying the voice
    // until the ringtone finished — confirmed live (order popups arriving
    // via this background/killed-state path were the exact ones with the
    // ~10s voice delay; popups arriving via the already-foregrounded socket
    // path, with no system notification/ringtone involved, played instantly).
    private static final String CHANNEL_ID_ORDER = "order_channel_silent_v1";
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

        // pushNotifier.notifyDriverDismiss's FCM push also carries an
        // order_id (so the OS can route/group it), which used to make the
        // isOrder check below misclassify it as a brand-new order and show
        // a "New Order" popup for it — with none of a real order's fields
        // (pickup_address, delivery_address, estimated_earning...), so it
        // rendered as "Unknown Pickup Location" / "Unknown Drop Location".
        // Combined with OrderDialogHelper now always closing out whatever
        // dialog is currently open before showing a new one (see its own
        // "clean up previous dialog" step), this fake popup could even
        // replace a real, still-relevant tier's popup on screen. Must be
        // checked and routed away BEFORE the isOrder check below, which
        // Intercept order dismissal or cancellation pushes so they don't get misclassified
        // as brand-new incoming orders (which caused "Unknown Pickup Location" popups).
        if (remoteMessage.getData() != null && (
                "order_dismiss".equalsIgnoreCase(remoteMessage.getData().get("type"))
                || "order_cancelled".equalsIgnoreCase(remoteMessage.getData().get("type"))
                || "advance_timeout_cancel".equalsIgnoreCase(remoteMessage.getData().get("type"))
        )) {
            String orderId = remoteMessage.getData().get("order_id");
            String type = remoteMessage.getData().get("type");
            String reason = remoteMessage.getData().get("reason");
            if (orderId != null) {
                org.json.JSONObject cancelData = new org.json.JSONObject();
                try {
                    cancelData.put("order_id", orderId);
                    if (reason != null) cancelData.put("reason", reason);
                    cancelData.put("package_id", remoteMessage.getData().get("package_id"));
                    cancelData.put("expires_at", remoteMessage.getData().get("expires_at"));
                } catch (org.json.JSONException ignored) {
                }
                if ("order_dismiss".equalsIgnoreCase(type)) {
                    com.shifter.driver.socket.SocketOrderRouter.handleOrderDismiss(this, cancelData);
                } else {
                    com.shifter.driver.socket.SocketOrderRouter.handleOrderCancelledByCustomer(this, cancelData);
                    com.shifter.driver.utility.OrderDialogHelper.dismissIfShowing(orderId);
                }
            }
            if (remoteMessage.getNotification() != null) {
                sendNotification(
                        remoteMessage.getNotification().getTitle(),
                        remoteMessage.getNotification().getBody(),
                        null
                );
            }
            return;
        }

        if (remoteMessage.getData() != null && "destination_updated".equalsIgnoreCase(remoteMessage.getData().get("type"))) {
            org.json.JSONObject updateData = new org.json.JSONObject(remoteMessage.getData());
            com.shifter.driver.socket.SocketOrderRouter.handleOrderDestinationUpdated(this, updateData);
            String title = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "Drop Location Updated";
            String body = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getBody() : "Customer updated the drop location";
            sendNotification(title, body, null);
            return;
        }

        // A KYC document decision (approve/reject) - tapping it should take
        // the driver straight to the re-upload screen, not the generic
        // chat-activity fallback the plain-notification path below opens.
        String pushType = remoteMessage.getData() != null ? remoteMessage.getData().get("type") : null;
        if ("kyc_document_decision".equalsIgnoreCase(pushType)) {
            String title = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "Document update";
            String body = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getBody() : "Your KYC document status was updated.";
            boolean isApproved = "1".equals(remoteMessage.getData().get("is_approved"));
            sendKycNotification(title, body, isApproved);
            return;
        }

        // Account blocked/reactivated - open the app itself so the driver
        // lands on a screen that reflects the fresh (blocked) status rather
        // than a stale cached one.
        if ("account_status".equalsIgnoreCase(pushType)) {
            String title = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "Account status update";
            String body = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getBody() : "Your account status was updated.";
            sendHomeNotification(title, body);
            return;
        }

        if ("settlement_pending".equalsIgnoreCase(pushType)) {
            String title = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "Trip Payment Pending";
            String orderId = remoteMessage.getData().get("order_id");
            String amount = remoteMessage.getData().get("amount");
            String body = remoteMessage.getNotification() != null ? remoteMessage.getNotification().getBody() :
                    ("Payment of ₹" + (amount != null ? amount : "") + " is pending for order #" + (orderId != null ? orderId : "") + ". Tap to collect and confirm.");
            sendSettlementPendingNotification(title, body, orderId);
            return;
        }

        // Check if this is a real incoming order notification
        String msgType = remoteMessage.getData() != null ? remoteMessage.getData().get("type") : null;
        boolean isCancellation = "order_cancelled".equalsIgnoreCase(msgType)
                || "advance_timeout_cancel".equalsIgnoreCase(msgType)
                || (remoteMessage.getNotification() != null && remoteMessage.getNotification().getTitle() != null
                    && remoteMessage.getNotification().getTitle().toLowerCase().contains("cancel"));

        boolean isOrder = !isCancellation && remoteMessage.getData() != null && (
                "new_order".equalsIgnoreCase(msgType)
                || "order_assign".equalsIgnoreCase(msgType)
                || ("order".equalsIgnoreCase(msgType) && remoteMessage.getData().containsKey("order_id"))
                || (remoteMessage.getData().containsKey("order_id") && (
                        remoteMessage.getData().containsKey("pickup_address")
                        || remoteMessage.getData().containsKey("paddress")
                        || remoteMessage.getData().containsKey("daddress")
                        || remoteMessage.getData().containsKey("total")
                ))
        );

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
     *
     * Extracted to a public static method (below) so the same routing also
     * handles the Node socket's order:request event — see
     * com.shifter.driver.socket.SocketOrderRouter.
     */
    private void handleOrderNotification(RemoteMessage remoteMessage) {
        java.util.Map<String, String> data = remoteMessage.getData();

        String title = (data != null && data.containsKey("title")) ? data.get("title")
                : (remoteMessage.getNotification() != null ? remoteMessage.getNotification().getTitle() : "New Order");
        String body = (data != null && data.containsKey("body")) ? data.get("body")
                : (remoteMessage.getNotification() != null ? remoteMessage.getNotification().getBody()
                        : "You have a new order request");

        routeOrderNotification(this, data, title, body);
    }

    /**
     * Shared entry point for both FCM and the socket's order:request event.
     * Dedups (see OrderNotificationDedup) and then either broadcasts (app in
     * foreground) or starts the overlay service + posts a heads-up
     * notification (background/killed).
     */
    public static void routeOrderNotification(Context context, java.util.Map<String, String> data, String title, String body) {
        String orderId = data != null ? data.get("order_id") : null;
        String packageId = data != null ? data.get("package_id") : null;

        if (orderId == null || orderId.isEmpty()) {
            Log.e(TAG, "Order ID missing in order notification data");
            return;
        }

        if (!com.shifter.driver.utility.OrderNotificationDedup.shouldHandle(orderId, packageId)) {
            Log.d(TAG, "Duplicate order notification skipped within 3s: " + orderId);
            return;
        }

        // This offer's own server-side deadline (armed when its dispatch
        // lock was acquired — see backend POPUP_TIMEOUT_MS/expires_at) may
        // already be in the past by the time this delivery actually reaches
        // the device: FCM can hold/redeliver a push well after it was sent
        // if the phone was briefly offline/Doze'd, and by then the order can
        // have been accepted by someone else, or even fully completed.
        // Showing Accept/Reject for it is guaranteed-stale — the server
        // will always reject the accept — and is exactly what produced a
        // long-finished order's popup reappearing, stuck on screen with no
        // dismiss ever coming for it (confirmed live: order already
        // "taken or cancelled" yet its popup kept showing). Drop it here,
        // before either UI path (overlay or foreground dialog) ever renders
        // it.
        String expiresAtStr = data != null ? data.get("expires_at") : null;
        if (expiresAtStr != null && !expiresAtStr.isEmpty()) {
            try {
                long expiresAt = Long.parseLong(expiresAtStr);
                if (expiresAt <= System.currentTimeMillis()) {
                    Log.d(TAG, "Dropping stale order request " + orderId
                            + " — expired " + (System.currentTimeMillis() - expiresAt) + "ms before delivery");
                    return;
                }
            } catch (NumberFormatException ignored) {}
        }

        Log.d(TAG, "Order received | order_id=" + orderId
                + " | fg=" + MyApplication.isAppInForeground()
                + " | bg=" + MyApplication.isAppInBackground()
                + " | killed=" + MyApplication.isAppKilled());

        boolean isDirectOrManual = data != null && ("true".equalsIgnoreCase(data.get("is_direct_assign"))
                || "true".equalsIgnoreCase(data.get("is_manual_assign")));

        if (isDirectOrManual) {
            Log.d(TAG, "Direct/Manual order assigned: " + orderId + " — launching OrderDetailsActivity immediately");
            com.shifter.driver.utility.OrderDialogHelper.dismissIfShowing(orderId);
            com.shifter.driver.utility.OrderDialogHelper.startOrderDetailsActivity(context, orderId, data);
            if (!MyApplication.isAppInForeground()) {
                // Post high-priority notification to ensure device wakes up and alerts driver
                showOrderNotification(context, title != null && !title.isEmpty() ? title : "Order Assigned",
                        body != null && !body.isEmpty() ? body : "New trip assigned to you.", orderId, data);
            }
            return;
        }

        if (MyApplication.isAppInForeground()) {
            // ── FOREGROUND ──────────────────────────────────────────────────────
            // App screen pe hai → broadcast → BroadcastReceiver → dialog turant
            Log.d(TAG, "FOREGROUND — broadcast sent");
            sendOrderBroadcast(context, orderId, data);

        } else {
            // ── BACKGROUND or KILLED / OTHER APPS ───────────────────────────────

            // 1. Show system overlay dialog over other apps
            if (com.shifter.driver.utility.OverlayPermissionHelper.hasOverlayPermission(context)) {
                Log.d(TAG, "Starting OrderOverlayService for background overlay");
                try {
                    Intent overlayIntent = new Intent(context, com.shifter.driver.service.OrderOverlayService.class);
                    overlayIntent.putExtra("order_id", orderId);
                    if (data != null) {
                        for (String key : data.keySet()) {
                            overlayIntent.putExtra(key, data.get(key));
                        }
                    }
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startForegroundService(overlayIntent);
                    } else {
                        context.startService(overlayIntent);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Failed to start OrderOverlayService", e);
                }
            } else {
                Log.d(TAG, "No overlay permission");
            }

            // 2. Also trigger high-priority heads-up / full-screen notification for sound & wake-up
            showOrderNotification(context, title, body, orderId, data);
        }
    }

    /**
     * Send broadcast to show Accept/Reject dialog (for foreground state)
     */
    private static void sendOrderBroadcast(Context context, String orderId, java.util.Map<String, String> data) {
        Intent intent = new Intent(ACTION_ORDER_NOTIFICATION);
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        // Put all data fields
        if (data != null) {
            for (String key : data.keySet()) {
                intent.putExtra(key, data.get(key));
            }
        }
        intent.setPackage(context.getPackageName());
        context.sendBroadcast(intent);
        Log.d(TAG, "Broadcast sent for order_id: " + orderId);
    }

    /**
     * Show high-priority notification (for background/killed state)
     */
    private static void showOrderNotification(Context context, String title, String body, String orderId, java.util.Map<String, String> data) {
        ensureOrderNotificationChannel(context);

        boolean isDirect = data != null && ("true".equalsIgnoreCase(data.get("is_direct_assign"))
                || "true".equalsIgnoreCase(data.get("is_manual_assign")));

        // Content intent: user notification tap kare tab HomeActivity open ho (+ dialog only if normal request)
        Intent intent = new Intent(context, HomeActivity.class);
        intent.putExtra(EXTRA_ORDER_ID, orderId);
        intent.putExtra("show_order_dialog", !isDirect);
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
        PendingIntent contentIntent = PendingIntent.getActivity(context, 0, intent, flags);

        // Full-screen intent (request code 1) — auto-show on screen
        Intent fullScreenIntent = new Intent(context, HomeActivity.class);
        fullScreenIntent.putExtra(EXTRA_ORDER_ID, orderId);
        fullScreenIntent.putExtra("show_order_dialog", !isDirect);
        fullScreenIntent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (data != null) {
            for (String key : data.keySet()) {
                fullScreenIntent.putExtra(key, data.get(key));
            }
        }
        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                context, 1, fullScreenIntent, flags);

        // No sound here — OrderVoiceAnnouncer's TTS is the audio now; this
        // notification is silent (vibration still alerts the driver).
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID_ORDER)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setSound(null)
                .setVibrate(new long[]{0, 500, 200, 500})
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setFullScreenIntent(fullScreenPendingIntent, true)   // ← auto-popup!
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        NotificationManager notificationManager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
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
     * No sound — OrderVoiceAnnouncer's TTS announcement is the audio for an
     * order popup now; a channel-level ringtone here would compete with it
     * for the audio output and delay the voice until the ringtone finished
     * (confirmed live: this channel's old movigo_ringtone, ~8-10s, matched
     * the ~10s voice delay exactly). Vibration still alerts the driver.
     */
    private static void ensureOrderNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID_ORDER,
                    "Order Notifications",
                    NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("Notifications for new order requests");
            channel.setShowBadge(true);
            channel.enableVibration(true);
            channel.enableLights(true);
            channel.setSound(null, null);

            NotificationManager notificationManager = (NotificationManager) context.getSystemService(
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

    /** Tapped notification opens the RC/documents screen directly - see VehicleDetailsActivity. */
    private void sendKycNotification(String title, String body, boolean isApproved) {
        Intent intent = new Intent(this, com.shifter.driver.activity.VehicleDetailsActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        showSimpleNotification(title, body, intent, "kyc_notifications", "KYC Updates");
    }

    /** Tapped notification opens the app's home screen - used for account block/unblock. */
    private void sendHomeNotification(String title, String body) {
        Intent intent = new Intent(this, HomeActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        showSimpleNotification(title, body, intent, "account_notifications", "Account Updates");
    }

    /** Tapped notification opens the dedicated TripPaymentActivity for this order. */
    private void sendSettlementPendingNotification(String title, String body, String orderId) {
        Intent intent = new Intent(this, com.shifter.driver.activity.TripPaymentActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (orderId != null && !orderId.trim().isEmpty()) {
            intent.putExtra(com.shifter.driver.activity.TripPaymentActivity.EXTRA_ORDER_ID, orderId.trim());
        }
        showSimpleNotification(title, body, intent, "settlement_notifications", "Payment Settlement Reminders");
    }

    private void showSimpleNotification(String title, String body, Intent intent, String channelId, String channelName) {
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT
                        | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_HIGH);
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

        notificationManager.notify((int) System.currentTimeMillis(), notificationBuilder.build());
    }
}
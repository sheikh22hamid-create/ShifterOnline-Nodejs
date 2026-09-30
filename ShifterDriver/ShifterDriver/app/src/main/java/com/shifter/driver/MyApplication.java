package com.shifter.driver;

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.os.Bundle;
import android.util.Log;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.FirebaseMessaging;
import com.onesignal.OneSignal;
import com.shifter.driver.utility.LocaleHelper;
import com.shifter.driver.utility.OrderVoiceAnnouncer;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.socket.NodeSocketManager;
import com.shifter.driver.socket.SocketOrderRouter;

public class MyApplication extends Application {
    public static Context mContext;
    private static int activityCount = 0;
    private static boolean activityVisible = false;

    /**
     * processHadActivity = true jab is process mein koi bhi activity ek baar start ho.
     * Yeh kabhi false nahi hota (is process ke andar).
     * Killed process mein yeh false rehta hai kyunki naya process ban ta hai.
     *
     * Isse hum CORRECTLY differentiate kar sakte hain:
     *   Foreground  → isAppInForeground() = true
     *   Background  → processHadActivity = true, !isAppInForeground()
     *   Killed      → processHadActivity = false (fresh process, no activity ever)
     */
    private static boolean processHadActivity = false;

    private static final String TAG = "MyApplication";

    @Override
    public void onCreate() {
        super.onCreate();
        mContext = this;
        FirebaseApp.initializeApp(this);
        createOrderNotificationChannels();
        OrderVoiceAnnouncer.init(this);
        FirebaseMessaging.getInstance().subscribeToTopic("appTopic");

        // OneSignal — basic init only (notifications come via direct FCM)
        OneSignal.setLogLevel(OneSignal.LOG_LEVEL.VERBOSE, OneSignal.LOG_LEVEL.NONE);
        OneSignal.initWithContext(this);
        OneSignal.setAppId("8644edca-db2e-4782-8958-1c1f4d086b61");

        FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful()) {
                        Log.w(TAG, "Fetching FCM token failed", task.getException());
                        return;
                    }
                    String token = task.getResult();
                    Log.d(TAG, "FCM Token: " + token);
                });

        // Node order/dispatch backend — the single always-registered
        // receiver of order:request/order:dismiss, routed through the same
        // FCM-driven popup UI (see MyFirebaseMessagingService.routeOrderNotification
        // and com.shifter.driver.socket.SocketOrderRouter). Actually
        // connecting the socket (with the logged-in rider_id) happens at
        // login/app-start — see HomeFragment / SplashActivity /
        // FirstActivity — not here, since the rider isn't known yet at
        // process start.
        NodeSocketManager.getInstance().setOrderRequestListener(new NodeSocketManager.OrderRequestListener() {
            @Override
            public void onOrderRequest(org.json.JSONObject data) {
                SocketOrderRouter.handleOrderRequest(MyApplication.this, data);
            }

            @Override
            public void onOrderDismiss(org.json.JSONObject data) {
                SocketOrderRouter.handleOrderDismiss(MyApplication.this, data);
            }
        });

        NodeSocketManager.getInstance().setOrderCancelledListener(data -> SocketOrderRouter.handleOrderCancelledByCustomer(MyApplication.this, data));
        NodeSocketManager.getInstance().setOrderDestinationUpdatedListener(data -> SocketOrderRouter.handleOrderDestinationUpdated(MyApplication.this, data));

        NodeSocketManager.getInstance().setNextDayAssignmentListener(data -> {
            com.shifter.driver.utility.NextDayOrderNotifier.show(this, data);
            org.json.JSONArray orders = data.optJSONArray("orders");
            if (orders != null && orders.length() > 0) {
                org.json.JSONObject first = orders.optJSONObject(0);
                if (first != null) {
                    try {
                        first.put("is_direct_assign", "true");
                        first.put("is_monthly_order", "true");
                    } catch (Exception ignored) {}
                    SocketOrderRouter.handleOrderRequest(MyApplication.this, first);
                }
            }
        });

        try {
            SessionManager session = new SessionManager(this);
            com.shifter.driver.model.RiderData rider = session.getUserDetails();
            if (rider != null && rider.getId() > 0) {
                NodeSocketManager.getInstance().connectDriver(rider.getId());
            }
        } catch (Exception ignored) {}

        // Track activity lifecycle to detect foreground/background/killed state
        registerActivityLifecycleCallbacks(new ActivityLifecycleCallbacks() {
            @Override
            public void onActivityCreated(Activity activity, Bundle savedInstanceState) {
            }

            @Override
            public void onActivityStarted(Activity activity) {
                activityCount++;
                // Ek baar true hone ke baad kabhi false nahi hoga is process mein
                processHadActivity = true;
                activityVisible = true;
                Log.d(TAG, "Activity started, count: " + activityCount);
            }

            @Override
            public void onActivityResumed(Activity activity) {
                activityVisible = true;
            }

            @Override
            public void onActivityPaused(Activity activity) {
                // Wait for onStop before marking background
            }

            @Override
            public void onActivityStopped(Activity activity) {
                activityCount--;
                if (activityCount <= 0) {
                    activityCount = 0;
                    activityVisible = false;
                    Log.d(TAG, "All activities stopped — app in background (processHadActivity=" + processHadActivity + ")");
                }
            }

            @Override
            public void onActivitySaveInstanceState(Activity activity, Bundle outState) {
            }

            @Override
            public void onActivityDestroyed(Activity activity) {
            }
        });
    }

    public static boolean isActivityVisible() {
        return activityVisible;
    }

    public static void activityResumed() {
        activityVisible = true;
    }

    public static void activityPaused() {
        activityVisible = false;
    }

    /**
     * App foreground mein hai (koi activity resume/visible hai).
     */
    public static boolean isAppInForeground() {
        return activityCount > 0 && activityVisible;
    }

    /**
     * App background mein hai — process alive hai (processHadActivity=true)
     * lekin koi activity visible nahi.
     * FCM service ke liye: startActivity() se HomeActivity ko bring-to-front karo.
     */
    public static boolean isAppInBackground() {
        return processHadActivity && !isAppInForeground();
    }

    /**
     * App killed thi — fresh process, koi activity kabhi start nahi hui.
     * FCM service ke liye: startActivity() try karo + notification fallback.
     */
    public static boolean isAppKilled() {
        return !processHadActivity;
    }

    private void createOrderNotificationChannels() {
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            android.app.NotificationManager notificationManager = (android.app.NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (notificationManager == null) return;

            // No channel sound — OrderVoiceAnnouncer's TTS is the audio for
            // an order popup now. A channel-level ringtone (the old
            // movigo_ringtone, ~8-10s) competed with the TTS for audio
            // output and delayed the voice until the ringtone finished; see
            // MyFirebaseMessagingService's matching CHANNEL_ID_ORDER rename
            // for the full explanation (a channel's sound is locked once
            // created on a device, hence the new id instead of stripping
            // the old channel's sound in place). Vibration still alerts.

            // 1. order_channel_silent_v1 (posted by MyFirebaseMessagingService for background/killed-state order popups)
            android.app.NotificationChannel orderChannel = new android.app.NotificationChannel(
                    "order_channel_silent_v1",
                    "Order Notifications",
                    android.app.NotificationManager.IMPORTANCE_HIGH);
            orderChannel.setDescription("Incoming order notifications and alerts");
            orderChannel.enableVibration(true);
            orderChannel.setSound(null, null);
            orderChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(orderChannel);

            // 2. order_notifications_v5 (app custom channel)
            android.app.NotificationChannel customChannel = new android.app.NotificationChannel(
                    "order_notifications_v5",
                    "Order Alerts",
                    android.app.NotificationManager.IMPORTANCE_HIGH);
            customChannel.setDescription("Order alerts and requests");
            customChannel.enableVibration(true);
            customChannel.setSound(null, null);
            customChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(customChannel);

            // 3. overlay_service_channel
            android.app.NotificationChannel overlayChannel = new android.app.NotificationChannel(
                    "overlay_service_channel",
                    "Order Overlay Service",
                    android.app.NotificationManager.IMPORTANCE_LOW);
            overlayChannel.setDescription("Overlay service background channel");
            notificationManager.createNotificationChannel(overlayChannel);

            // 4. order_dismiss_channel_v1 — server-driven "Order No Longer
            // Available" notification (backend/src/services/pushNotifier.js
            // notifyDriverDismiss), sent when a popup times out or the order
            // goes to someone else. Purely informational, no action needed,
            // so IMPORTANCE_DEFAULT (no heads-up) with the system's normal
            // short default sound — NOT setSound(null, ...) (silent, wrong
            // here: there's no competing TTS for this one) and NOT the long
            // movigo_ringtone (this isn't an actionable popup). Must exist
            // BEFORE the backend's channelId reference reaches this device —
            // referencing a channel id the app never created falls back to
            // Android/FCM's own uncontrolled default channel behavior,
            // confirmed live as the cause of this notification ringing
            // indefinitely until manually cleared.
            android.app.NotificationChannel dismissChannel = new android.app.NotificationChannel(
                    "order_dismiss_channel_v1",
                    "Order Updates",
                    android.app.NotificationManager.IMPORTANCE_DEFAULT);
            dismissChannel.setDescription("Order offer expired / no longer available");
            dismissChannel.enableVibration(true);
            dismissChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(dismissChannel);

            com.shifter.driver.utility.NextDayOrderNotifier.createChannel(this);
        }
    }
}
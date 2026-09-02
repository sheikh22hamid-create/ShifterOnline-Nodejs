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
import com.shifter.driver.utility.SessionManager;

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

            android.net.Uri ringtoneUri = android.net.Uri.parse("android.resource://" + getPackageName() + "/" + R.raw.movigo_ringtone);
            android.media.AudioAttributes audioAttributes = new android.media.AudioAttributes.Builder()
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .build();

            // 1. order_channel (requested by server/Firebase)
            android.app.NotificationChannel orderChannel = new android.app.NotificationChannel(
                    "order_channel",
                    "Order Notifications",
                    android.app.NotificationManager.IMPORTANCE_HIGH);
            orderChannel.setDescription("Incoming order notifications and alerts");
            orderChannel.enableVibration(true);
            orderChannel.setSound(ringtoneUri, audioAttributes);
            orderChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(orderChannel);

            // 2. order_notifications_v5 (app custom channel)
            android.app.NotificationChannel customChannel = new android.app.NotificationChannel(
                    "order_notifications_v5",
                    "Order Alerts",
                    android.app.NotificationManager.IMPORTANCE_HIGH);
            customChannel.setDescription("Order alerts and requests");
            customChannel.enableVibration(true);
            customChannel.setSound(ringtoneUri, audioAttributes);
            customChannel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            notificationManager.createNotificationChannel(customChannel);

            // 3. overlay_service_channel
            android.app.NotificationChannel overlayChannel = new android.app.NotificationChannel(
                    "overlay_service_channel",
                    "Order Overlay Service",
                    android.app.NotificationManager.IMPORTANCE_LOW);
            overlayChannel.setDescription("Overlay service background channel");
            notificationManager.createNotificationChannel(overlayChannel);
        }
    }
}
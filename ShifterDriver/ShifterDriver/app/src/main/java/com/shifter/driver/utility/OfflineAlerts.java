package com.shifter.driver.utility;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.shifter.driver.R;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.service.OfflineAlertReceiver;

/**
 * Offline Alerts: while the driver is OFFLINE and has the alerts switched ON, a "You are offline" notification with
 * a sound is shown every N minutes.
 *
 * "Offline" is the same signal the rest of the app uses: LocationUpdateService is not running (see
 * {@link LocationUpdateService#isRunning}). There is ONE alarm (fixed request code, FLAG_UPDATE_CURRENT) so a timer
 * can never be duplicated; scheduling again simply replaces it. Whenever the alarm fires it re-checks login, the
 * switch and the online state, so an online driver can never get a reminder even if a lifecycle hook was missed.
 * The alarm is not exact on purpose (setAndAllowWhileIdle needs no special permission and works under Doze / battery
 * saver, but the system may delay it a little).
 *
 * Settings are kept per driver in their own preferences file, so they survive app restarts and logout/login.
 */
public final class OfflineAlerts {
    private static final String TAG = "OfflineAlerts";
    private static final String PREFS = "offline_alerts_prefs";
    private static final String CHANNEL_ID = "offline_alerts_v1";
    private static final int NOTIFICATION_ID = 7301;
    private static final int ALARM_REQUEST = 7302;
    public static final String ACTION_FIRE = "com.shifter.driver.OFFLINE_ALERT_FIRE";
    public static final int DEFAULT_MINUTES = 10;
    public static final int MIN_MINUTES = 1;
    public static final int MAX_MINUTES = 1440;

    private OfflineAlerts() {}

    // --- settings -------------------------------------------------------------------------------------------------

    private static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** The logged-in driver's id, or -1 when nobody is logged in. */
    private static int riderId(Context c) {
        try {
            RiderData r = new SessionManager(c.getApplicationContext()).getUserDetails();
            return r == null ? -1 : r.getId();
        } catch (Exception e) {
            return -1;
        }
    }

    public static boolean isEnabled(Context c) {
        int id = riderId(c);
        return id >= 0 && prefs(c).getBoolean("enabled_" + id, false);
    }

    public static int intervalMinutes(Context c) {
        int id = riderId(c);
        int v = id < 0 ? DEFAULT_MINUTES : prefs(c).getInt("interval_" + id, DEFAULT_MINUTES);
        return isValidInterval(v) ? v : DEFAULT_MINUTES;
    }

    public static boolean isValidInterval(int minutes) {
        return minutes >= MIN_MINUTES && minutes <= MAX_MINUTES;
    }

    /** Persists the switch (and the interval when {@code minutes} is valid) and applies it right away. */
    public static void save(Context c, boolean enabled, int minutes) {
        int id = riderId(c);
        if (id < 0) return;
        SharedPreferences.Editor e = prefs(c).edit().putBoolean("enabled_" + id, enabled);
        boolean intervalChanged = false;
        if (isValidInterval(minutes) && minutes != intervalMinutes(c)) {
            e.putInt("interval_" + id, minutes);
            intervalChanged = true;
        }
        e.apply();
        if (intervalChanged) cancelAlarm(c.getApplicationContext()); // the next reminder must follow the new interval
        reconcile(c);
    }

    public static void setEnabled(Context c, boolean enabled) {
        save(c, enabled, -1);
    }

    // --- scheduling -----------------------------------------------------------------------------------------------

    private static boolean online(Context c) {
        return LocationUpdateService.isRunning(c.getApplicationContext());
    }

    /**
     * The single decision point: no alarm unless logged in + switched ON + offline; otherwise exactly one alarm
     * (an already pending one is kept, so opening the app does not keep pushing the next reminder away).
     */
    public static void reconcile(Context c) {
        Context app = c.getApplicationContext();
        try {
            if (!isEnabled(app) || online(app)) {
                cancel(app);
                return;
            }
            if (!alarmPending(app)) scheduleNext(app);
        } catch (Exception e) {
            Log.e(TAG, "reconcile failed", e);
        }
    }

    /** The driver went online: stop everything at once. */
    public static void onOnline(Context c) {
        cancel(c.getApplicationContext());
    }

    /** The driver went offline: the first reminder comes one full interval from now. */
    public static void onOffline(Context c) {
        Context app = c.getApplicationContext();
        try {
            if (!isEnabled(app)) return;
            scheduleNext(app);
        } catch (Exception e) {
            Log.e(TAG, "onOffline failed", e);
        }
    }

    /** Alarm fired. Re-checks every condition before bothering the driver. */
    public static void onFire(Context c) {
        Context app = c.getApplicationContext();
        if (!isEnabled(app) || online(app)) {
            cancel(app);
            return;
        }
        notifyOffline(app);
        scheduleNext(app);
    }

    private static PendingIntent alarmIntent(Context c, int flags) {
        Intent i = new Intent(c, OfflineAlertReceiver.class).setAction(ACTION_FIRE);
        return PendingIntent.getBroadcast(c, ALARM_REQUEST, i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static boolean alarmPending(Context c) {
        return alarmIntent(c, PendingIntent.FLAG_NO_CREATE) != null;
    }

    private static void scheduleNext(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        long at = System.currentTimeMillis() + intervalMinutes(c) * 60_000L;
        PendingIntent pi = alarmIntent(c, PendingIntent.FLAG_UPDATE_CURRENT); // same request code: replaces, never duplicates
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        else am.set(AlarmManager.RTC_WAKEUP, at, pi);
    }

    private static void cancelAlarm(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(c, PendingIntent.FLAG_NO_CREATE);
        if (am != null && pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }

    /** Stops the timer and removes a reminder that is still showing. */
    public static void cancel(Context c) {
        try {
            cancelAlarm(c);
            NotificationManagerCompat.from(c).cancel(NOTIFICATION_ID);
        } catch (Exception e) {
            Log.e(TAG, "cancel failed", e);
        }
    }

    // --- notification ---------------------------------------------------------------------------------------------

    private static void ensureChannel(Context c) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null || nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, c.getString(R.string.offline_alerts_channel), NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription(c.getString(R.string.offline_alerts_channel_desc));
        ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    private static void notifyOffline(Context c) {
        if (!NotificationManagerCompat.from(c).areNotificationsEnabled()) {
            Log.w(TAG, "notifications are switched off for the app: reminder not shown");
            return;
        }
        ensureChannel(c);
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent tap = open == null ? null : PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(c.getString(R.string.offline_alerts_notification_title))
                .setContentText(c.getString(R.string.offline_alerts_notification_text))
                .setStyle(new NotificationCompat.BigTextStyle().bigText(c.getString(R.string.offline_alerts_notification_text)))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setSound(sound)       // pre-Oreo; on Oreo+ the channel's sound applies
                .setVibrate(new long[]{0, 400, 200, 400});
        if (tap != null) b.setContentIntent(tap);
        try {
            NotificationManagerCompat.from(c).notify(NOTIFICATION_ID, b.build()); // fixed id: a new reminder replaces the old one
        } catch (SecurityException e) {
            Log.w(TAG, "notification permission missing", e);
        }
    }
}

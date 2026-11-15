package com.shifter.driver.service;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import com.shifter.driver.utility.OfflineAlerts;

/**
 * Drives Offline Alerts: the alarm itself, and the events that wipe alarms (reboot, app update) so the timer is
 * rebuilt from the saved settings.
 */
public class OfflineAlertReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent == null ? null : intent.getAction();
        if (OfflineAlerts.ACTION_FIRE.equals(action)) {
            OfflineAlerts.onFire(context);
        } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            OfflineAlerts.reconcile(context);
        }
    }
}

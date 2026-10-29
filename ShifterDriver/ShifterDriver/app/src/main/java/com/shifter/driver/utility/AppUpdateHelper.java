package com.shifter.driver.utility;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.appcompat.app.AlertDialog;

import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Asks Google Play (via the Play Core app-update API) whether a newer version
 * of this app exists, and if so shows an optional, dismissible
 * "Update Available" popup whose button opens this app's Play Store page.
 *
 * Only the availability check comes from Play; the installed version is never
 * hardcoded. A sideloaded install, no network or an unavailable Play Store
 * just fails the check, and nothing is shown. The caller decides when it runs
 * (HomeActivity: once per fresh launch, not on rotation/resume), so the popup
 * does not repeat within a session.
 */
public class AppUpdateHelper {

    private static final String TAG = "AppUpdateHelper";

    private final Activity activity;
    private AlertDialog dialog;

    public AppUpdateHelper(Activity activity) {
        this.activity = activity;
    }

    public void checkForUpdate() {
        try {
            AppUpdateManager manager = AppUpdateManagerFactory.create(activity);
            manager.getAppUpdateInfo()
                    .addOnSuccessListener(info -> {
                        if (info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE) {
                            showDialog();
                        }
                    })
                    .addOnFailureListener(e -> Log.w(TAG, "getAppUpdateInfo failed: " + e.getMessage()));
        } catch (Exception e) {
            Log.w(TAG, "update check failed: " + e.getMessage());
        }
    }

    private void showDialog() {
        if (activity.isFinishing() || activity.isDestroyed()) return;
        dialog = new AlertDialog.Builder(activity)
                .setTitle("Update Available")
                .setMessage("A new version of the app is available. Please update to get the latest improvements and features.")
                .setPositiveButton("Update App", (d, w) -> openPlayStore())
                .setNegativeButton("Cancel", null)
                .setCancelable(true)
                .create();
        dialog.show();
    }

    private void openPlayStore() {
        String pkg = activity.getPackageName();
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=" + pkg)));
        } catch (ActivityNotFoundException e) {
            activity.startActivity(new Intent(Intent.ACTION_VIEW,
                    Uri.parse("https://play.google.com/store/apps/details?id=" + pkg)));
        }
    }

    /** Call from onDestroy so the dialog doesn't leak past the Activity. */
    public void unregister() {
        if (dialog != null && dialog.isShowing()) dialog.dismiss();
        dialog = null;
    }
}

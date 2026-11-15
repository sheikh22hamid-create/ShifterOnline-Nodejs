package com.shifter.driver.utility;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Typeface;
import android.net.Uri;
import android.util.Log;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AlertDialog;

import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Asks Google Play (via the Play Core app-update API) whether a newer version
 * of this app exists, and if so shows an optional, dismissible
 * "Update Available" popup (Cancel button, an X, or a tap outside all close it)
 * whose button opens this app's own Play Store page.
 *
 * Only the availability check comes from Play; the installed version is never
 * hardcoded. A sideloaded install, no network or an unavailable Play Store
 * just fails the check, and nothing is shown. Screens that can be a launch
 * screen (HomeActivity when logged in, LoginActivity when not) call it once on
 * a fresh start; {@link #sPrompted} keeps the popup to once per app process, so
 * logging out and in again, or moving between those screens, never repeats it.
 */
public class AppUpdateHelper {

    private static final String TAG = "AppUpdateHelper";

    /** True once the popup has been shown in this app process (= this session). */
    private static volatile boolean sPrompted = false;

    private final Activity activity;
    private AlertDialog dialog;

    public AppUpdateHelper(Activity activity) {
        this.activity = activity;
    }

    public void checkForUpdate() {
        if (sPrompted) return;
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

    private int dp(int v) {
        return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, activity.getResources().getDisplayMetrics());
    }

    /** Title row: "Update Available" with an X on the right that closes the popup. */
    private LinearLayout titleRow() {
        LinearLayout row = new LinearLayout(activity);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(24), dp(16), dp(12), dp(0));
        TextView title = new TextView(activity);
        title.setText("Update Available");
        title.setTextSize(20);
        title.setTypeface(null, Typeface.BOLD);
        title.setTextColor(0xFF0F172A);
        row.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView close = new TextView(activity);
        close.setText("✕");
        close.setTextSize(18);
        close.setTextColor(0xFF64748B);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("Close");
        close.setPadding(dp(12), dp(8), dp(12), dp(8));
        close.setOnClickListener(v -> {
            if (dialog != null) dialog.dismiss();
        });
        row.addView(close);
        return row;
    }

    private void showDialog() {
        if (sPrompted || activity.isFinishing() || activity.isDestroyed()) return;
        sPrompted = true;
        dialog = new AlertDialog.Builder(activity)
                .setCustomTitle(titleRow())
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

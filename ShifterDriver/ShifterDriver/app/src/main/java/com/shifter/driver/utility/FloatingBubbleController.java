package com.shifter.driver.utility;

import android.annotation.SuppressLint;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Outline;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.ViewOutlineProvider;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageView;

import com.shifter.driver.MyApplication;
import com.shifter.driver.R;
import com.shifter.driver.locationservice.LocationUpdateService;

import java.util.List;

/**
 * Movable floating bubble shown over other apps while the driver is online
 * and the app is in the background.
 *
 * "Online" is the same signal the rest of the app uses: LocationUpdateService
 * is running. It is stopped on go-offline and on logout, so the bubble
 * follows without a second source of truth. {@link #sync(Context)} is the
 * single decision point and is called from the three places that can change
 * the answer: app foreground/background transitions (MyApplication), the
 * service starting, and the service stopping.
 */
public final class FloatingBubbleController {

    private static final String TAG = "FloatingBubble";
    private static final String PREFS = "floating_bubble_prefs";
    private static final String KEY_X = "x";
    private static final String KEY_Y = "y";
    private static final int SIZE_DP = 56;
    private static final int EDGE_MARGIN_DP = 4;
    // Activity transitions pass through a moment where nothing is "started";
    // wait briefly before showing so the bubble doesn't flicker between screens.
    private static final long SHOW_DELAY_MS = 350;

    private static final Handler MAIN = new Handler(Looper.getMainLooper());
    private static View bubble;
    private static WindowManager.LayoutParams params;
    private static WindowManager windowManager;

    private FloatingBubbleController() {}

    /** Re-evaluates whether the bubble should be on screen. Safe from any thread. */
    public static void sync(Context context) {
        if (context == null) return;
        final Context app = context.getApplicationContext();
        MAIN.removeCallbacks(SHOW_TASK);
        if (shouldShow(app)) {
            // Show after a short delay (see SHOW_DELAY_MS); re-checked inside.
            SHOW_TASK.app = app;
            MAIN.postDelayed(SHOW_TASK, SHOW_DELAY_MS);
        } else {
            MAIN.post(() -> hideNow(app));
        }
    }

    /** Removes the bubble immediately (offline, logout). */
    public static void hide(Context context) {
        if (context == null) return;
        final Context app = context.getApplicationContext();
        MAIN.removeCallbacks(SHOW_TASK);
        MAIN.post(() -> hideNow(app));
    }

    private static boolean shouldShow(Context app) {
        try {
            if (!LocationUpdateService.isRunning(app)) return false;       // offline
            if (MyApplication.isAppInForeground()) return false;           // app is on screen
            if (!OverlayPermissionHelper.hasOverlayPermission(app)) return false;
            com.shifter.driver.model.RiderData rider = new SessionManager(app).getUserDetails();
            return rider != null && rider.getId() > 0;                     // logged in
        } catch (Exception e) {
            Log.w(TAG, "shouldShow failed", e);
            return false;
        }
    }

    private static final class ShowTask implements Runnable {
        Context app;
        @Override public void run() {
            if (app != null && shouldShow(app)) showNow(app); else if (app != null) hideNow(app);
        }
    }
    private static final ShowTask SHOW_TASK = new ShowTask();

    @SuppressLint("ClickableViewAccessibility")
    private static void showNow(Context app) {
        if (bubble != null) return;
        try {
            windowManager = (WindowManager) app.getSystemService(Context.WINDOW_SERVICE);
            if (windowManager == null) return;
            final int size = dp(app, SIZE_DP);

            FrameLayout root = new FrameLayout(app);
            GradientDrawable bg = new GradientDrawable();
            bg.setShape(GradientDrawable.OVAL);
            bg.setColor(Color.WHITE);
            bg.setStroke(dp(app, 2), Color.parseColor("#C2540A"));
            root.setBackground(bg);
            root.setElevation(dp(app, 6));
            root.setOutlineProvider(new ViewOutlineProvider() {
                @Override public void getOutline(View v, Outline o) { o.setOval(0, 0, v.getWidth(), v.getHeight()); }
            });
            root.setClipToOutline(true);
            root.setContentDescription("Open Shifter Driver");

            ImageView icon = new ImageView(app);
            icon.setImageResource(R.mipmap.ic_launcher);
            icon.setScaleType(ImageView.ScaleType.CENTER_CROP);
            int pad = dp(app, 6);
            icon.setPadding(pad, pad, pad, pad);
            root.addView(icon, new FrameLayout.LayoutParams(size, size));

            DisplayMetrics dm = app.getResources().getDisplayMetrics();
            SharedPreferences prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    : WindowManager.LayoutParams.TYPE_PHONE;
            params = new WindowManager.LayoutParams(size, size, type,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                    android.graphics.PixelFormat.TRANSLUCENT);
            params.gravity = Gravity.TOP | Gravity.START;
            // Default: right edge, 40% down; later: wherever the driver left it.
            params.x = clamp(prefs.getInt(KEY_X, dm.widthPixels - size - dp(app, EDGE_MARGIN_DP)), 0, dm.widthPixels - size);
            params.y = clamp(prefs.getInt(KEY_Y, (int) (dm.heightPixels * 0.4f)), 0, dm.heightPixels - size);

            root.setOnTouchListener(new DragListener(app, size));
            windowManager.addView(root, params);
            bubble = root;
        } catch (Exception e) {
            // e.g. permission revoked between check and add — stay hidden.
            Log.w(TAG, "could not show bubble", e);
            bubble = null;
        }
    }

    private static void hideNow(Context app) {
        if (bubble == null) return;
        try {
            if (windowManager != null) windowManager.removeView(bubble);
        } catch (Exception e) {
            Log.w(TAG, "could not remove bubble", e);
        }
        bubble = null;
    }

    /** Drag anywhere; on release snap to the nearest side edge. A short touch is a tap. */
    private static final class DragListener implements View.OnTouchListener {
        private final Context app;
        private final int size;
        private final int slop;
        private int startX, startY;
        private float downRawX, downRawY;
        private boolean dragging;

        DragListener(Context app, int size) {
            this.app = app;
            this.size = size;
            this.slop = ViewConfiguration.get(app).getScaledTouchSlop();
        }

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            if (params == null || windowManager == null) return false;
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    startX = params.x; startY = params.y;
                    downRawX = e.getRawX(); downRawY = e.getRawY();
                    dragging = false;
                    return true;
                case MotionEvent.ACTION_MOVE: {
                    float dx = e.getRawX() - downRawX, dy = e.getRawY() - downRawY;
                    if (!dragging && Math.abs(dx) < slop && Math.abs(dy) < slop) return true;
                    dragging = true;
                    DisplayMetrics dm = app.getResources().getDisplayMetrics();
                    params.x = clamp(startX + (int) dx, 0, dm.widthPixels - size);
                    params.y = clamp(startY + (int) dy, 0, dm.heightPixels - size);
                    try { windowManager.updateViewLayout(v, params); } catch (Exception ignored) {}
                    return true;
                }
                case MotionEvent.ACTION_UP:
                    if (dragging) {
                        DisplayMetrics dm = app.getResources().getDisplayMetrics();
                        int margin = dp(app, EDGE_MARGIN_DP);
                        params.x = (params.x + size / 2 < dm.widthPixels / 2) ? margin : dm.widthPixels - size - margin;
                        try { windowManager.updateViewLayout(v, params); } catch (Exception ignored) {}
                        app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                                .putInt(KEY_X, params.x).putInt(KEY_Y, params.y).apply();
                    } else {
                        v.performClick();
                        openApp(app);
                    }
                    return true;
                default:
                    return false;
            }
        }
    }

    /**
     * Brings the existing task forward so the driver lands on the screen they
     * left (no restart, no reload). Only if no task exists (process alive but
     * every activity gone) does it launch the app from scratch.
     */
    private static void openApp(Context app) {
        try {
            ActivityManager am = (ActivityManager) app.getSystemService(Context.ACTIVITY_SERVICE);
            List<ActivityManager.AppTask> tasks = am != null ? am.getAppTasks() : null;
            if (tasks != null && !tasks.isEmpty()) {
                tasks.get(0).moveToFront();
                return;
            }
        } catch (Exception e) {
            Log.w(TAG, "moveToFront failed, falling back to launch intent", e);
        }
        try {
            Intent launch = app.getPackageManager().getLaunchIntentForPackage(app.getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
                app.startActivity(launch);
            }
        } catch (Exception e) {
            Log.w(TAG, "could not open app", e);
        }
    }

    private static int dp(Context c, int v) {
        return Math.round(v * c.getResources().getDisplayMetrics().density);
    }

    private static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi < lo ? lo : hi, v));
    }
}

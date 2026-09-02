package com.shifter.driver.activity;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.MenuItem;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;
import androidx.fragment.app.FragmentTransaction;

import com.google.android.material.bottomnavigation.BottomNavigationView;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityHomeBinding;
import com.shifter.driver.fragment.AccountFragment;
import com.shifter.driver.fragment.HomeFragment;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.utility.OrderDialogHelper;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

public class HomeActivity extends BaseActivity {

    private static final String TAG = "HomeActivity";

    private ActivityHomeBinding binding;
    SessionManager sessionManager;

    private static final int REQ_FOREGROUND_PERMISSIONS = 101;
    private static final int REQ_BACKGROUND_LOCATION = 102;
    private static final int REQ_NOTIFICATION = 103;

    private AlertDialog overlayDialog = null;

    @RequiresApi(api = Build.VERSION_CODES.M)
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityHomeBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        sessionManager = new SessionManager(this);
        binding.bottomNavigation.setOnItemSelectedListener(navigationItemSelectedListener);

        checkAndRequestPermissions();

        final LocationManager manager = (LocationManager) this.getSystemService(Context.LOCATION_SERVICE);
        if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER) && Utility.hasGPSDevice(this)) {
            Toast.makeText(this, getString(R.string.gps_not_enabled), Toast.LENGTH_SHORT).show();
            Utility.enableLoc(this);
        }
        openFragment(new HomeFragment());

        handleIntent(getIntent());
    }

    private void checkAndRequestPermissions() {
        // Step 1: Notification Permission (Android 13+)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this,
                        Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[] { Manifest.permission.POST_NOTIFICATIONS },
                    REQ_NOTIFICATION);
            return;
        }

        // Step 2: Foreground location
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this,
                    Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                requestForegroundPermissions();
                return;
            }
        }

        // Step 3: Overlay permission
        checkOverlayPermission();
    }

    private void requestForegroundPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            if (ContextCompat.checkSelfPermission(this,
                    Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                if (ActivityCompat.shouldShowRequestPermissionRationale(this,
                        Manifest.permission.ACCESS_FINE_LOCATION)) {
                    new AlertDialog.Builder(this)
                            .setTitle("Location Permission Needed")
                            .setMessage(
                                    "Please grant Location permission to track your delivery routes and find nearby orders. This is required to receive new delivery tasks.")
                            .setPositiveButton("OK", (dialog, which) -> {
                                requestPermissions(new String[] {
                                        Manifest.permission.ACCESS_COARSE_LOCATION,
                                        Manifest.permission.ACCESS_FINE_LOCATION
                                }, REQ_FOREGROUND_PERMISSIONS);
                            })
                            .setNegativeButton("Cancel", (dialog, which) -> {
                                dialog.dismiss();
                                checkOverlayPermission();
                            })
                            .create().show();
                } else {
                    requestPermissions(new String[] {
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                            Manifest.permission.ACCESS_FINE_LOCATION
                    }, REQ_FOREGROUND_PERMISSIONS);
                }
            } else {
                checkOverlayPermission();
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
            @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_NOTIFICATION) {
            requestForegroundPermissions();
        } else if (requestCode == REQ_FOREGROUND_PERMISSIONS) {
            checkOverlayPermission();
        }
    }

    public void checkOverlayPermission() {
        if (!com.shifter.driver.utility.OverlayPermissionHelper.hasOverlayPermission(this)) {
            if (overlayDialog != null && overlayDialog.isShowing()) {
                return;
            }
            overlayDialog = new AlertDialog.Builder(this)
                    .setTitle("Overlay Permission Needed")
                    .setMessage("To receive order requests while you are using other apps or when the app is in the background, please allow 'Display over other apps'.")
                    .setPositiveButton("Allow", (dialog, which) -> {
                        dialog.dismiss();
                        com.shifter.driver.utility.OverlayPermissionHelper.requestOverlayPermission(this);
                    })
                    .setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss())
                    .setCancelable(false)
                    .create();
            overlayDialog.show();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean notifGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
                || ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
        boolean locGranted = Build.VERSION.SDK_INT < Build.VERSION_CODES.M
                || ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;

        if (notifGranted && locGranted) {
            checkOverlayPermission();
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    /**
     * Handle intent to show order dialog (from notification click).
     *
     * Two paths lead here:
     * 1. Our custom PendingIntent (showOrderNotification) — has
     * show_order_dialog=true + order_id
     * 2. Firebase auto-shown notification (notification block present) — opens
     * FirstActivity
     * which forwards all FCM data extras to HomeActivity; has order_id +
     * type="order" but
     * no show_order_dialog flag.
     * Both paths are handled below.
     */
    private void handleIntent(Intent intent) {
        if (intent != null) {
            // Log all intent extras
            if (intent.getExtras() != null) {
                Log.e("FCM_ORDER_DATA", "HomeActivity Received Intent Extras:");
                for (String key : intent.getExtras().keySet()) {
                    Object value = intent.getExtras().get(key);
                    Log.e("FCM_ORDER_DATA", "   " + key + " = " + value);
                }
            } else {
                Log.e("FCM_ORDER_DATA", "HomeActivity Received Intent with NO Extras");
            }

            // Path 1: Custom PendingIntent from showOrderNotification() — explicit flag set
            boolean showDialog = intent.getBooleanExtra(EXTRA_SHOW_ORDER_DIALOG, false);

            // Path 2: Firebase auto-notification tap — FCM data extras forwarded by FirstActivity
            String typeFromData = intent.getStringExtra("type");
            String rawOrderId = intent.getStringExtra("order_id") != null ? intent.getStringExtra("order_id") : intent.getStringExtra(EXTRA_ORDER_ID);
            if (!showDialog && (rawOrderId != null && !rawOrderId.isEmpty() || "order".equalsIgnoreCase(typeFromData))) {
                showDialog = true;
                Log.e("FCM_ORDER_DATA", "Order detected via FCM data extras (auto-notification path)");
            }

            if (showDialog) {
                String orderId = intent.getStringExtra(EXTRA_ORDER_ID);
                if (orderId != null && !orderId.isEmpty()) {
                    Log.d(TAG, "Showing order dialog from notification click for order_id: " + orderId);
                    java.util.Map<String, String> data = getMapFromIntent(intent);
                    // Post with a small delay so the Activity window is fully attached
                    // before we try to show a dialog (important when app was killed).
                    new Handler(Looper.getMainLooper()).postDelayed(() -> showOrderDialog(orderId, data), 600);
                }
            }
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
    }

    BottomNavigationView.OnItemSelectedListener navigationItemSelectedListener = item -> {

        int id = item.getItemId();

        if (id == R.id.navigation_home) {
            openFragment(new HomeFragment());
            return true;

        } else if (id == R.id.navigation_orders) {
            startActivity(new Intent(this, OrderActivity.class));
            return true;

        } else if (id == R.id.navigation_ordersany) {//
            // startActivity(new Intent(this, OrderAnyActivity.class));
            startActivity(new Intent(this, WalletActivity.class));
            return true;

        } else if (id == R.id.navigation_notification) {
            startActivity(new Intent(this, NotificationActivity.class));
            return true;

        } else if (id == R.id.navigation_user) {
            openFragment(new AccountFragment());
            return true;
        }

        return false;
    };

    public void openFragment(Fragment fragment) {
        FragmentTransaction transaction = getSupportFragmentManager().beginTransaction();
        transaction.replace(R.id.container, fragment);
        transaction.addToBackStack(null);
        transaction.commit();
    }

    @Override
    public void onBackPressed() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.exit_app)
                .setMessage(R.string.do_you_want_to_exit)
                .setPositiveButton(R.string.yes, (dialog, which) -> finish())
                .setNegativeButton(R.string.no, null)
                .show();
    }
}
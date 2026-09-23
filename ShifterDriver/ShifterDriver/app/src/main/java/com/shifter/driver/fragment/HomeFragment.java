package com.shifter.driver.fragment;

import android.Manifest;
import android.animation.ObjectAnimator;
import android.animation.PropertyValuesHolder;
import android.animation.ValueAnimator;
import android.app.ActivityManager;
import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.HapticFeedbackConstants;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.Button;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.widget.SwitchCompat;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.Fragment;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.bumptech.glide.Glide;
import com.google.gson.Gson;
import com.google.gson.JsonObject;

import org.json.JSONException;
import org.json.JSONObject;

import com.shifter.driver.R;
import com.shifter.driver.activity.CustomOrderListActivity;
import com.shifter.driver.activity.LeadReferralActivity;
import com.shifter.driver.activity.NotificationActivity;
import com.shifter.driver.activity.OrderActivity;
import com.shifter.driver.activity.OrderAnyDetailsActivity;
import com.shifter.driver.activity.OrderDetailsActivity;
import com.shifter.driver.activity.ProfileActivity;
import com.shifter.driver.activity.WalletActivity;
import com.shifter.driver.adepter.RecentOrderHomeAdapter;
import com.shifter.driver.databinding.FragmentHomeBinding;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.model.HomeData;
import com.shifter.driver.model.MonthlyDutyStatus;
import com.shifter.driver.model.PackageData;
import com.shifter.driver.model.PackageListResponse;
import com.shifter.driver.model.QueuedOrder;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.socket.NodeSocketManager;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.DeliveryPreferencesBottomSheet;
import com.shifter.driver.utility.ModelInfoBottomSheet;
import com.shifter.driver.utility.MonthlyDriverApiClient;
import com.shifter.driver.utility.MonthlyDutyManager;
import com.shifter.driver.utility.SessionManager;

import java.text.DecimalFormat;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class HomeFragment extends Fragment implements RecentOrderHomeAdapter.RecyclerTouchListener,
        GetResult.MyListener, SwipeRefreshLayout.OnRefreshListener {

    private FragmentHomeBinding binding;

    private List<PackageData> packageDataList;
    private AudioManager audioManager;

    SessionManager sessionManager;
    RiderData riderData;
    CustPrograssbar custPrograssbar;
    private boolean isOnline = false;

    // Online/Offline animated status pill states
    private static final int STATUS_OFFLINE = 1;
    private static final int STATUS_CONNECTING = 2;
    private static final int STATUS_ALMOST_THERE = 3;
    private static final int STATUS_ONLINE = 4;
    private static final int STATUS_DISCONNECTING = 5;
    private static final int STATUS_RECONNECTING = 6;
    private int currentStatusState = STATUS_OFFLINE;
    private final NodeSocketManager.ConnectionListener connectionListener = connected -> {
        if (binding != null && isOnline && (currentStatusState == STATUS_ONLINE || currentStatusState == STATUS_RECONNECTING)) {
            updateStatusControlUI(STATUS_ONLINE);
        }
    };

    private ObjectAnimator pulseAnimator = null;
    public static boolean isUpdateHome = false;

    public HomeFragment() {
        // Required empty public constructor
    }

    private void getPackageList() {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("uid", riderData != null ? riderData.getId() : 0);
            jsonObject.put("cat_id", "8");
            jsonObject.put("type", "DRIVER");
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = NodeApiClient.getInterface().getPackageList(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "2");
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        binding = FragmentHomeBinding.inflate(inflater, container, false);
        sessionManager = new SessionManager(getActivity());
        custPrograssbar = new CustPrograssbar();

        riderData = sessionManager.getUserDetails();
        if (riderData != null) {
            NodeSocketManager.getInstance().connectDriver(riderData.getId());
        }

        // 1. Dynamic Greeting & Driver Avatar with presence indicator
        updateGreetingAndAvatar();

        // 2. Volume control button
        audioManager = (AudioManager) getActivity().getSystemService(Context.AUDIO_SERVICE);
        if (binding.btnVolumeControl != null) {
            binding.btnVolumeControl.setOnClickListener(v -> showVolumeControlDialog());
            updateVolumeButtonIcon();
        }

        // 3. Status control state initialization
        isOnline = isServiceRunning(LocationUpdateService.class);
        updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
        setupOnlineStatusControl();

        // 4. Quick Actions (Orders, Wallet, Incentives, Support)
        setupQuickActions();
        binding.btnMoreOptions.setOnClickListener(v -> {
            boolean expanded = binding.layoutMoreOptions.getVisibility() == View.VISIBLE;
            binding.layoutMoreOptions.setVisibility(expanded ? View.GONE : View.VISIBLE);
            binding.btnMoreOptions.setText(expanded ? R.string.home_more_options : R.string.home_fewer_options);
        });

        // 5. Swipe refresh & initial data fetch
        sessionManager.setStringData(SessionManager.currency, "₹");
        binding.refares.setColorSchemeResources(
                R.color.shifter_orange,
                android.R.color.holo_green_dark,
                android.R.color.holo_orange_dark,
                android.R.color.holo_blue_dark);

        binding.refares.setOnRefreshListener(this);

        getHome();
        getPackageList();
        fetchCustomerSupportSettings();

        // Active Order Cards click listeners
        binding.crdOrder.setOnClickListener(this::onBindClick);
        binding.txtContinue.setOnClickListener(this::onBindClick);
        binding.crdOrderby.setOnClickListener(this::onBindClick);
        binding.txtContinue1.setOnClickListener(this::onBindClick);

        // Custom Orders button
        binding.btnCustomOrders.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), CustomOrderListActivity.class));
        });

        // Scheduled Trips button — browse booking_type=2 scheduled trips and
        // mark non-binding interest ahead of time (Task 9; see
        // ScheduledTripsActivity's own header for details).
        if (binding.btnScheduledTrips != null) {
            binding.btnScheduledTrips.setOnClickListener(v -> {
                startActivity(new Intent(getActivity(), com.shifter.driver.ScheduledTripsActivity.class));
            });
        }

        // How To Use button
        binding.btnHowToUse.setOnClickListener(v -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/shorts/h7KMfS0IrI8"));
                startActivity(intent);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        // Listen for real-time queue updates from Node backend
        NodeSocketManager.getInstance().setQueueUpdateListener(data -> {
            if (isAdded() && getActivity() != null) {
                getActivity().runOnUiThread(() -> {
                    setupMonthlyDriverUI();
                    fetchDriverQueue();
                });
            }
        });

        // Listen for real-time driver role shifts (e.g. Monthly -> Freelance or Freelance -> Monthly)
        NodeSocketManager.getInstance().setRoleChangeListener(data -> {
            if (isAdded() && getActivity() != null) {
                getActivity().runOnUiThread(() -> {
                    int newPlan = data.optInt("monthly_plan", 0);
                    if (riderData != null) {
                        riderData.setMonthlyPlan(newPlan);
                    }
                    String msg = data.optString("message", "");
                    if (!msg.isEmpty()) {
                        Toast.makeText(getActivity(), msg, Toast.LENGTH_LONG).show();
                    }
                    MonthlyDutyStatus nonMonthly = new MonthlyDutyStatus();
                    nonMonthly.setMonthlyDriver(newPlan == 1);
                    MonthlyDutyManager.getInstance().setCurrentStatus(nonMonthly);
                    setupMonthlyDriverUI();
                    getPackageList();
                    getHome();
                });
            }
        });

        // Initialize Monthly Duty UI
        setupMonthlyDriverUI();

        return binding.getRoot();
    }

    private final android.os.Handler dutyTickerHandler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable dutyTickerRunnable = new Runnable() {
        @Override
        public void run() {
            if (isAdded() && getActivity() != null) {
                setupMonthlyDriverUI();
                dutyTickerHandler.postDelayed(this, 10000); // Live poll duty stats every 10s
            }
        }
    };

    /**
     * Updates header greeting dynamically based on current time of day
     * and loads driver profile picture with presence dot tint.
     */
    private void updateGreetingAndAvatar() {
        if (binding == null) return;
        if (riderData == null && sessionManager != null) {
            riderData = sessionManager.getUserDetails();
        }

        // Determine greeting based on current local hour
        Calendar cal = Calendar.getInstance();
        int hour = cal.get(Calendar.HOUR_OF_DAY);
        String greetingPrefix;
        if (hour >= 5 && hour < 12) {
            greetingPrefix = "Good morning";
        } else if (hour >= 12 && hour < 17) {
            greetingPrefix = "Good afternoon";
        } else {
            greetingPrefix = "Good evening";
        }

        String driverName = "Partner";
        if (riderData != null && riderData.getFullName() != null && !riderData.getFullName().trim().isEmpty()) {
            driverName = riderData.getFullName().trim();
        }
        binding.txtTitle.setText(greetingPrefix + ", " + driverName + " 👋");

        // Profile Avatar loading with fallback
        if (riderData != null && riderData.getProfilePicture() != null && !riderData.getProfilePicture().trim().isEmpty() && getActivity() != null) {
            String pic = riderData.getProfilePicture().trim();
            String fullUrl = pic.startsWith("http") ? pic : (pic.startsWith("/") ? NodeApiClient.baseUrl + pic.substring(1) : NodeApiClient.baseUrl + pic);
            Glide.with(this)
                    .load(fullUrl)
                    .placeholder(R.drawable.user)
                    .error(R.drawable.user)
                    .into(binding.imgDriverAvatar);
        }

        // Avatar click -> Profile Activity
        binding.btnProfileAvatar.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), ProfileActivity.class));
        });

        // Notification button click -> Notification Activity
        binding.btnNotification.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), NotificationActivity.class));
        });
    }

    /**
     * Wires up 4 quick action cards: My Orders, Wallet, Incentives, and Support.
     */
    private void setupQuickActions() {
        if (binding == null) return;

        binding.btnHomeContactReferral.setOnClickListener(v ->
                startActivity(new Intent(requireContext(), LeadReferralActivity.class)));

        // 1. My Orders
        binding.btnQuickOrders.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), OrderActivity.class));
        });

        // 2. Wallet
        binding.btnQuickWallet.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), WalletActivity.class));
        });

        // View Details link in earnings card
        binding.btnViewEarningsDetails.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), com.shifter.driver.activity.EarningsActivity.class));
        });

        // 3. Incentives / Lead Referral
        binding.btnQuickIncentives.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), LeadReferralActivity.class));
        });


        // 4. Support (Dial Support Helpline configured in Admin Panel)
        binding.btnQuickSupport.setOnClickListener(v -> {
            String supportNum = sessionManager != null ? sessionManager.getCustomerCareNumber() : "+91 9999908008";
            String cleanDial = supportNum.replaceAll("[^0-9+]", "");
            try {
                Intent dialIntent = new Intent(Intent.ACTION_DIAL);
                dialIntent.setData(android.net.Uri.parse("tel:" + cleanDial));
                startActivity(dialIntent);
            } catch (Exception e) {
                Toast.makeText(getActivity(), "Customer Support: " + supportNum, Toast.LENGTH_SHORT).show();
            }
        });

        // Delivery Preferences Triggers: opens bottom sheet immediately
        if (binding.btnDeliveryPreferencesHeader != null) {
            binding.btnDeliveryPreferencesHeader.setOnClickListener(v -> {
                v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                openDeliveryPreferencesSheet();
            });
        }
        if (binding.btnLearnMoreTypes != null) {
            binding.btnLearnMoreTypes.setOnClickListener(v -> openDeliveryPreferencesSheet());
        }
    }

    /**
     * Wires the interactive animated online/offline card and delivery types shortcut.
     */
    private void setupOnlineStatusControl() {
        if (binding.btnOnlineStatusControl == null) return;

        // Shortcut to Delivery Preferences bottom sheet when online
        if (binding.layoutOnlineDeliveryTypesShortcut != null) {
            binding.layoutOnlineDeliveryTypesShortcut.setOnClickListener(v -> {
                v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                openDeliveryPreferencesSheet();
            });
        }

        // Tap on top online status row -> go offline flow
        if (binding.layoutOnlineHeaderRow != null) {
            binding.layoutOnlineHeaderRow.setOnClickListener(v -> {
                if (currentStatusState == STATUS_CONNECTING || currentStatusState == STATUS_ALMOST_THERE || currentStatusState == STATUS_DISCONNECTING) {
                    return;
                }
                v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                updateStatusControlUI(STATUS_DISCONNECTING);
                sendDriverStatusUpdateToBackend(false);
            });
        }

        // Main card tap (handles offline -> online flow)
        binding.btnOnlineStatusControl.setOnClickListener(v -> {
            if (currentStatusState == STATUS_CONNECTING || currentStatusState == STATUS_ALMOST_THERE || currentStatusState == STATUS_DISCONNECTING) {
                return;
            }

            v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);

            if (!isOnline) {
                // GO ONLINE FLOW
                if (!hasLocationPermission()) {
                    requestLocationPermissionForOnline();
                    return;
                }
                updateStatusControlUI(STATUS_CONNECTING);
                sendDriverStatusUpdateToBackend(true);
            } else {
                // GO OFFLINE FLOW
                updateStatusControlUI(STATUS_DISCONNECTING);
                sendDriverStatusUpdateToBackend(false);
            }
        });
    }

    /**
     * Controls the visual layout, background pill, and animations for each state.
     */
    private void updateStatusControlUI(int state) {
        if (binding == null || getActivity() == null) return;
        if (state == STATUS_ONLINE && !NodeSocketManager.getInstance().isConnected()) state = STATUS_RECONNECTING;
        this.currentStatusState = state;

        binding.layoutStateOffline.setVisibility(View.GONE);
        binding.layoutStateConnecting.setVisibility(View.GONE);
        binding.layoutStateAlmostThere.setVisibility(View.GONE);
        binding.layoutStateOnline.setVisibility(View.GONE);
        binding.layoutStateDisconnecting.setVisibility(View.GONE);

        switch (state) {
            case STATUS_OFFLINE:
                binding.btnOnlineStatusControl.setBackgroundResource(R.drawable.bg_status_offline_pill);
                binding.layoutStateOffline.setVisibility(View.VISIBLE);
                stopPulseAnimation();
                if (binding.viewAvatarPresence != null) {
                    binding.viewAvatarPresence.setBackgroundTintList(
                            ColorStateList.valueOf(Color.parseColor("#9E9E9E")));
                }
                break;

            case STATUS_CONNECTING:
                binding.btnOnlineStatusControl.setBackgroundResource(R.drawable.bg_status_connecting_pill);
                binding.layoutStateConnecting.setVisibility(View.VISIBLE);
                stopPulseAnimation();
                if (binding.viewAvatarPresence != null) {
                    binding.viewAvatarPresence.setBackgroundTintList(
                            ColorStateList.valueOf(Color.parseColor("#FF5E1E")));
                }
                break;

            case STATUS_ALMOST_THERE:
                binding.btnOnlineStatusControl.setBackgroundResource(R.drawable.bg_status_almost_there_pill);
                binding.layoutStateAlmostThere.setVisibility(View.VISIBLE);
                stopPulseAnimation();
                if (binding.viewAvatarPresence != null) {
                    binding.viewAvatarPresence.setBackgroundTintList(
                            ColorStateList.valueOf(Color.parseColor("#059669")));
                }
                break;

            case STATUS_RECONNECTING:
                binding.btnOnlineStatusControl.setBackgroundResource(R.drawable.bg_status_connecting_pill);
                binding.layoutStateOnline.setVisibility(View.VISIBLE);
                binding.txtOnlineTitle.setText(R.string.home_reconnecting);
                binding.txtOnlineSubtitle.setText(R.string.home_reconnecting_hint);
                stopPulseAnimation();
                binding.viewAvatarPresence.setBackgroundTintList(ColorStateList.valueOf(Color.parseColor("#FF5E1E")));
                break;

            case STATUS_ONLINE:
                binding.txtOnlineTitle.setText(R.string.home_online_title);
                binding.txtOnlineSubtitle.setText(R.string.home_connection_ready);
                binding.btnOnlineStatusControl.setBackgroundResource(R.drawable.bg_status_online_pill);
                binding.layoutStateOnline.setVisibility(View.VISIBLE);
                startPulseAnimation();
                if (binding.viewAvatarPresence != null) {
                    binding.viewAvatarPresence.setBackgroundTintList(
                            ColorStateList.valueOf(Color.parseColor("#059669")));
                }
                break;

            case STATUS_DISCONNECTING:
                binding.btnOnlineStatusControl.setBackgroundResource(R.drawable.bg_status_disconnecting_pill);
                binding.layoutStateDisconnecting.setVisibility(View.VISIBLE);
                stopPulseAnimation();
                if (binding.viewAvatarPresence != null) {
                    binding.viewAvatarPresence.setBackgroundTintList(
                            ColorStateList.valueOf(Color.parseColor("#DC2626")));
                }
                break;
        }
    }

    /**
     * Starts gentle breathing pulse ring animation on online status dot.
     */
    private void startPulseAnimation() {
        if (binding == null || binding.viewOnlinePulse == null) return;
        if (pulseAnimator != null && pulseAnimator.isRunning()) return;

        PropertyValuesHolder scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 1.0f, 1.45f);
        PropertyValuesHolder scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.0f, 1.45f);
        PropertyValuesHolder alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.65f, 0.0f);

        pulseAnimator = ObjectAnimator.ofPropertyValuesHolder(binding.viewOnlinePulse, scaleX, scaleY, alpha);
        pulseAnimator.setDuration(1600);
        pulseAnimator.setRepeatCount(ValueAnimator.INFINITE);
        pulseAnimator.setRepeatMode(ValueAnimator.RESTART);
        pulseAnimator.setInterpolator(new AccelerateDecelerateInterpolator());
        pulseAnimator.start();
    }

    /**
     * Stops pulse animation safely without memory leak.
     */
    private void stopPulseAnimation() {
        if (pulseAnimator != null) {
            pulseAnimator.cancel();
            pulseAnimator = null;
        }
        if (binding != null && binding.viewOnlinePulse != null) {
            binding.viewOnlinePulse.setScaleX(1.0f);
            binding.viewOnlinePulse.setScaleY(1.0f);
            binding.viewOnlinePulse.setAlpha(0.0f);
        }
    }

    /**
     * Backward-compatible update method.
     */
    private void updateSwipeButton(boolean online) {
        this.isOnline = online;
        updateStatusControlUI(online ? STATUS_ONLINE : STATUS_OFFLINE);
    }

    private void requestLocationPermissionForOnline() {
        if (getActivity() == null) return;
        if (shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)) {
            new androidx.appcompat.app.AlertDialog.Builder(getActivity())
                    .setTitle("Location Permission Needed")
                    .setMessage("Please grant Location permission to track your delivery routes and find nearby orders. This is required to go online and receive delivery tasks.")
                    .setPositiveButton("OK", (dialog, which) -> {
                        requestPermissions(new String[]{
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                                Manifest.permission.ACCESS_FINE_LOCATION
                        }, 101);
                    })
                    .setNegativeButton("Cancel", (dialog, which) -> {
                        dialog.dismiss();
                        isOnline = false;
                        updateStatusControlUI(STATUS_OFFLINE);
                    })
                    .create().show();
        } else {
            requestPermissions(new String[]{
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                    Manifest.permission.ACCESS_FINE_LOCATION
            }, 101);
        }
    }

    private int dpToPx(int dp) {
        return (int) (dp * getResources().getDisplayMetrics().density);
    }

    private boolean hasLocationPermission() {
        Context context = getActivity();
        if (context == null) return false;
        int fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION);
        int coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION);
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocationServiceIfNeeded() {
        if (!isServiceRunning(LocationUpdateService.class) && getActivity() != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getActivity().startForegroundService(new Intent(getActivity(), LocationUpdateService.class));
            } else {
                getActivity().startService(new Intent(getActivity(), LocationUpdateService.class));
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 101) {
            boolean granted = false;
            for (int result : grantResults) {
                if (result == PackageManager.PERMISSION_GRANTED) {
                    granted = true;
                    break;
                }
            }
            if (granted) {
                updateStatusControlUI(STATUS_CONNECTING);
                sendDriverStatusUpdateToBackend(true);
            } else {
                isOnline = false;
                updateStatusControlUI(STATUS_OFFLINE);
                Toast.makeText(getActivity(), "Location permission is required to go online", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onClickRecentOrderItem(String titel, int position) {
        if (!isServiceRunning(LocationUpdateService.class)) {
            Toast.makeText(getActivity(), "Your status is offline, Please make it online.", Toast.LENGTH_LONG).show();
        } else {
            startActivity(new Intent(getActivity(), OrderDetailsActivity.class));
        }
    }

    private boolean isServiceRunning(Class<?> serviceClass) {
        if (getActivity() == null) return false;
        ActivityManager manager = (ActivityManager) getActivity().getSystemService(Context.ACTIVITY_SERVICE);
        if (manager == null) return false;
        for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (serviceClass.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }

    private void sendDriverStatusUpdateToBackend(boolean online) {
        if (riderData == null && sessionManager != null) {
            riderData = sessionManager.getUserDetails();
        }
        if (riderData == null || getActivity() == null) {
            updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
            return;
        }

        java.util.Map<String, Object> nodeBody = new java.util.HashMap<>();
        nodeBody.put("rider_id", riderData.getId());
        nodeBody.put("a_status", online ? 1 : 0);
        nodeBody.put("device_id", com.shifter.driver.utility.Utility.getDeviceId(getActivity()));

        NodeApiClient.getInterface().setStatus(nodeBody).enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                if (!isAdded() || getActivity() == null || binding == null) return;

                if (response.isSuccessful() && response.body() != null) {
                    JsonObject result = response.body();
                    if (result.has("device_match") && !result.get("device_match").isJsonNull() && !result.get("device_match").getAsBoolean()) {
                        Toast.makeText(getActivity(), "Logged in from another device", Toast.LENGTH_LONG).show();
                        logoutUser();
                        return;
                    }

                    if (!result.has("Result") || !"true".equalsIgnoreCase(result.get("Result").getAsString())) {
                        updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
                        Toast.makeText(getActivity(), R.string.home_status_failed, Toast.LENGTH_LONG).show();
                        return;
                    }
                    if (online) {
                        isOnline = true;
                        startLocationServiceIfNeeded();
                        NodeSocketManager.getInstance().connectDriver(riderData.getId());
                        updateStatusControlUI(STATUS_ONLINE);
                    } else {
                        isOnline = false;
                        updateStatusControlUI(STATUS_OFFLINE);
                        if (getActivity() != null) {
                            getActivity().stopService(new Intent(getActivity(), LocationUpdateService.class));
                        }
                        Toast.makeText(getActivity(), "You are now OFFLINE.", Toast.LENGTH_SHORT).show();
                    }

                    if (result.has("msg") && !result.get("msg").isJsonNull()) {
                        String msg = result.get("msg").getAsString();
                        if (!msg.isEmpty() && !"Status updated successfully".equalsIgnoreCase(msg)) {
                            Toast.makeText(getActivity(), msg, Toast.LENGTH_SHORT).show();
                        }
                    }
                } else {
                    Toast.makeText(getActivity(), "Failed to update status. Please retry.", Toast.LENGTH_SHORT).show();
                    updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
                }
            }

            @Override
            public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                if (!isAdded() || getActivity() == null || binding == null) return;
                Log.e("HomeFragment", "Node rider status update failed", t);
                Toast.makeText(getActivity(), "Network error. Status not updated.", Toast.LENGTH_SHORT).show();
                updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
            }
        });
    }

    private void updateDriverStatusApi(boolean isOnline) {
        sendDriverStatusUpdateToBackend(isOnline);
    }

    private void getHome() {
        if (riderData == null && sessionManager != null) {
            riderData = sessionManager.getUserDetails();
        }
        if (riderData == null || riderData.getId() <= 0) {
            return;
        }
        custPrograssbar.prograssCreate(getActivity());
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rid", riderData.getId());
            jsonObject.put("device_id", com.shifter.driver.utility.Utility.getDeviceId(getActivity()));

        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = NodeApiClient.getInterface().homeData(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

    private void fetchCustomerSupportSettings() {
        try {
            JSONObject jsonObject = new JSONObject();
            int rid = (riderData != null) ? riderData.getId() : 0;
            jsonObject.put("rid", rid);
            RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            NodeApiClient.getInterface().pagelist(body).enqueue(new retrofit2.Callback<JsonObject>() {
                @Override
                public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                    if (response.isSuccessful() && response.body() != null) {
                        JsonObject obj = response.body();
                        if (obj.has("customer_care_number") && !obj.get("customer_care_number").isJsonNull()) {
                            String num = obj.get("customer_care_number").getAsString().trim();
                            if (!num.isEmpty() && sessionManager != null) {
                                sessionManager.setCustomerCareNumber(num);
                            }
                        }
                    }
                }

                @Override
                public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        if (binding == null || !isAdded()) return;
        try {
            custPrograssbar.closePrograssBar();

            if (callNo.equalsIgnoreCase("1")) {
                // Home data
                binding.refares.setRefreshing(false);
                Gson gson = new Gson();
                homeData = gson.fromJson(result.toString(), HomeData.class);

                if (!homeData.isDeviceMatch()) {
                    Toast.makeText(getActivity(), "Logged in from another device", Toast.LENGTH_LONG).show();
                    logoutUser();
                    return;
                }

                if (homeData.getResult().equalsIgnoreCase("true")) {
                    if (result.has("customer_care_number") && !result.get("customer_care_number").isJsonNull()) {
                        String careNum = result.get("customer_care_number").getAsString().trim();
                        if (!careNum.isEmpty() && sessionManager != null) {
                            sessionManager.setCustomerCareNumber(careNum);
                        }
                    }
                    boolean apiOnline = false;
                    if (result.has("Online") && !result.get("Online").isJsonNull()) {
                        try {
                            com.google.gson.JsonElement el = result.get("Online");
                            if (el.isJsonPrimitive() && el.getAsJsonPrimitive().isBoolean()) {
                                apiOnline = el.getAsBoolean();
                            } else {
                                String s = el.getAsString();
                                apiOnline = "true".equalsIgnoreCase(s) || "1".equals(s);
                            }
                        } catch (Exception e) {
                            apiOnline = homeData.isOnline();
                        }
                    } else {
                        apiOnline = homeData.isOnline();
                    }

                    boolean currentStatus = isOnline;
                    if (currentStatus != apiOnline) {
                        isOnline = apiOnline;
                        updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
                        if (isOnline) {
                            if (hasLocationPermission()) {
                                startLocationServiceIfNeeded();
                            }
                        } else {
                            if (getActivity() != null && isServiceRunning(LocationUpdateService.class)) {
                                getActivity().stopService(new Intent(getActivity(), LocationUpdateService.class));
                            }
                        }
                        updateDriverStatusApi(isOnline);
                    } else {
                        updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
                        if (isOnline) {
                            if (hasLocationPermission()) {
                                startLocationServiceIfNeeded();
                            }
                        } else {
                            if (getActivity() != null && isServiceRunning(LocationUpdateService.class)) {
                                getActivity().stopService(new Intent(getActivity(), LocationUpdateService.class));
                            }
                        }
                    }

                    if (homeData.isHowUse()) {
                        binding.btnHowToUse.setVisibility(View.GONE);
                    } else {
                        binding.btnHowToUse.setVisibility(View.VISIBLE);
                    }

                    if (homeData.getRejectTimer() != null && !homeData.getRejectTimer().isEmpty()) {
                        sessionManager.setStringData(SessionManager.rejectTimer, homeData.getRejectTimer());
                    }

                    String currency = sessionManager.getStringData(SessionManager.currency);
                    if (currency == null || currency.isEmpty()) {
                        currency = "₹";
                    }

                    // Dynamic Today's Earnings with safe fallback (no null / NaN)
                    double pastEarningVal = homeData.getTodayEarning();
                    String todayEarn = String.format(Locale.getDefault(), "%.0f", pastEarningVal);
                    binding.txtEarning.setText(currency + todayEarn);
                    if (binding.txtEarning2 != null) {
                        binding.txtEarning2.setText(currency + String.format(Locale.getDefault(), "%.0f", homeData.getCurrentMonthEarning()));
                    }

                    // 4 Metrics Dynamic Binding
                    int pastComplete = homeData.getPastTotalComplete();
                    int curComplete = homeData.getCurrentTotalComplete();
                    int totalOrders = pastComplete + (homeData.getOrderHistory() != null ? 1 : 0);

                    if (binding.txtStatTotalOrders != null) {
                        binding.txtStatTotalOrders.setText(String.valueOf(totalOrders > 0 ? totalOrders : pastComplete));
                    }
                    binding.txtComplete.setText(String.valueOf(pastComplete));
                    if (binding.txtComplete2 != null) {
                        binding.txtComplete2.setText(String.valueOf(curComplete));
                    }

                    int inProgressCount = 0;
                    if (homeData.getOrderHistory() != null) inProgressCount++;
                    if (homeData.getBuyOrderHistory() != null) inProgressCount++;
                    if (binding.txtStatInProgress != null) {
                        binding.txtStatInProgress.setText(String.valueOf(inProgressCount));
                    }

                    String rating = homeData.getCurrentStar();
                    if (rating == null || rating.trim().isEmpty() || "null".equalsIgnoreCase(rating)) {
                        rating = getString(R.string.home_no_rating);
                        binding.txtRating.setTextSize(12);
                    }
                    if (!rating.equals(getString(R.string.home_no_rating))) binding.txtRating.setTextSize(21);
                    binding.txtRating.setText(rating);
                    if (binding.txtRating2 != null) {
                        binding.txtRating2.setText(homeData.getPastStar() != null ? homeData.getPastStar() : getString(R.string.home_no_rating));
                    }



                    // Priority Active Order Card
                    if (homeData.getOrderHistory() != null) {
                        binding.crdOrder.setVisibility(View.VISIBLE);
                        binding.txtOrderid.setText(getString(R.string.order_id) + " #" + homeData.getOrderHistory().getId());
                        binding.txtStatus.setText(homeData.getOrderHistory().getStatus() != null ? homeData.getOrderHistory().getStatus() : "Active");
                        binding.txtToaddress.setText(homeData.getOrderHistory().getCustomerPaddress() != null ? homeData.getOrderHistory().getCustomerPaddress() : "Pickup address");
                        binding.txtFromaddress.setText(homeData.getOrderHistory().getCustomerDaddress() != null ? homeData.getOrderHistory().getCustomerDaddress() : "Drop address");
                        binding.txtKm.setText((homeData.getOrderHistory().getDistance() != null ? homeData.getOrderHistory().getDistance() : "0") + " km");
                        binding.txtEarningorder.setText(currency + (homeData.getOrderHistory().getTotal() != null ? homeData.getOrderHistory().getTotal() : "0"));

                        try {
                            if (homeData.getOrderHistory().getTimeDuration() != null && !homeData.getOrderHistory().getTimeDuration().isEmpty()) {
                                DecimalFormat df = new DecimalFormat("#.##");
                                binding.txtMit.setText(df.format(Double.parseDouble(homeData.getOrderHistory().getTimeDuration())) + " min deliver");
                            } else {
                                binding.txtMit.setText("Express deliver");
                            }
                        } catch (Exception ex) {
                            binding.txtMit.setText("Express deliver");
                        }

                        // Keep the active order available through the Continue Delivery card.
                        String status = homeData.getOrderHistory().getStatus();
                        if (getActivity() != null && !"Completed".equalsIgnoreCase(status) && !"Cancelled".equalsIgnoreCase(status)) {
                            sessionManager.setActiveOrder(homeData.getOrderHistory());
                            isUpdateHome = false;

                        } else {
                            sessionManager.clearActiveOrder();
                        }
                    } else {
                        sessionManager.clearActiveOrder();
                        binding.crdOrder.setVisibility(View.GONE);
                    }

                    // Buy Order History (Secondary order card)
                    if (homeData.getBuyOrderHistory() != null) {
                        binding.crdOrderby.setVisibility(View.VISIBLE);
                        binding.txtOrderid1.setText(getString(R.string.order_id) + " #" + homeData.getBuyOrderHistory().getId());
                        binding.txtStatus1.setText(homeData.getBuyOrderHistory().getStatus());
                        binding.txtToaddress1.setText(homeData.getBuyOrderHistory().getStorePaddress());
                        binding.txtFromaddress1.setText(homeData.getBuyOrderHistory().getCustomerDaddress());
                        binding.txtKm1.setText(homeData.getBuyOrderHistory().getDistance() + "km");
                        binding.txtEarningorder1.setText(currency + homeData.getBuyOrderHistory().getTotal());
                        try {
                            DecimalFormat df = new DecimalFormat("#.##");
                            binding.txtMit1.setText(df.format(Double.parseDouble(homeData.getBuyOrderHistory().getTimeDuration())) + " min deliver");
                        } catch (Exception ex) {
                            binding.txtMit1.setText("Express deliver");
                        }
                    } else {
                        binding.crdOrderby.setVisibility(View.GONE);
                    }
                }

            } else if (callNo.equalsIgnoreCase("2")) {
                // Package list response
                Gson gson = new Gson();
                PackageListResponse packageResponse = gson.fromJson(result.toString(), PackageListResponse.class);

                if (packageResponse != null && "true".equalsIgnoreCase(packageResponse.getResult())) {
                    packageDataList = packageResponse.getPackageData();
                    updateDeliveryTypesUI();
                }
            } else if (callNo.equalsIgnoreCase("3") || callNo.equalsIgnoreCase("4")) {
                try {
                    if (result.has("device_match") && !result.get("device_match").getAsBoolean()) {
                        Toast.makeText(getActivity(), "Logged in from another device", Toast.LENGTH_LONG).show();
                        logoutUser();
                        return;
                    }
                    if (result.has("ResponseMsg") && !result.get("ResponseMsg").isJsonNull()) {
                        String responseMsg = result.get("ResponseMsg").getAsString();
                        Toast.makeText(getActivity(), responseMsg, Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    HomeData homeData;

    public void onBindClick(View view) {
        int id = view.getId();

        if (id == R.id.crd_order || id == R.id.txt_continue) {
            if (!isServiceRunning(LocationUpdateService.class)) {
                Toast.makeText(getActivity(), "Your status is offline, Please make it online.", Toast.LENGTH_LONG).show();
            } else if (homeData != null && homeData.getOrderHistory() != null) {
                isUpdateHome = false;
                startActivity(new Intent(getActivity(), OrderDetailsActivity.class)
                        .putExtra("myclass", homeData.getOrderHistory()));
            } else {
                Toast.makeText(getActivity(), "No active order found.", Toast.LENGTH_SHORT).show();
            }
        } else if (id == R.id.crd_orderby || id == R.id.txt_continue1) {
            if (!isServiceRunning(LocationUpdateService.class)) {
                Toast.makeText(getActivity(), "Your status is offline, Please make it online.", Toast.LENGTH_LONG).show();
            } else if (homeData != null && homeData.getBuyOrderHistory() != null) {
                startActivity(new Intent(getActivity(), OrderAnyDetailsActivity.class)
                        .putExtra("myclass", homeData.getBuyOrderHistory()));
            } else {
                Toast.makeText(getActivity(), "No active order found.", Toast.LENGTH_SHORT).show();
            }
        }
    }

    @Override
    public void onRefresh() {
        getHome();
        getPackageList();
        fetchCustomerSupportSettings();
        setupMonthlyDriverUI();
    }

    /**
     * Inflates and binds delivery tier cards using DeliveryPreferencesBottomSheet.bindTierCard
     * with optimistic UI updates and updates the active types summary on the online status card.
     */
    private void updateDeliveryTypesUI() {
        if (getActivity() == null || binding == null || binding.deliveryTypesContainer == null) {
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {
                // If monthly driver, hide delivery types selection completely
                MonthlyDutyStatus currentDuty = MonthlyDutyManager.getInstance().getCurrentStatus();
                boolean isMonthly = (currentDuty != null && currentDuty.isMonthlyDriver());
                if (isMonthly) {
                    if (binding.cardDeliveryTypesSection != null) {
                        binding.cardDeliveryTypesSection.setVisibility(View.GONE);
                    }
                    return;
                } else {
                    if (binding.cardDeliveryTypesSection != null) {
                        binding.cardDeliveryTypesSection.setVisibility(View.VISIBLE);
                    }
                }

                binding.deliveryTypesContainer.removeAllViews();

                if (packageDataList == null || packageDataList.isEmpty()) {
                    TextView emptyText = new TextView(getActivity());
                    emptyText.setText(getString(R.string.no_delivery_types_available));
                    emptyText.setGravity(android.view.Gravity.CENTER);
                    emptyText.setPadding(20, 20, 20, 20);
                    emptyText.setTextColor(getResources().getColor(R.color.driver_text_secondary));
                    binding.deliveryTypesContainer.addView(emptyText);
                    return;
                }

                LayoutInflater inflater = LayoutInflater.from(getActivity());
                int riderId = (riderData != null) ? riderData.getId() : 0;

                for (PackageData packageData : packageDataList) {
                    View card = inflater.inflate(R.layout.item_delivery_type_card, binding.deliveryTypesContainer, false);
                    DeliveryPreferencesBottomSheet.bindTierCard(getActivity(), card, packageData, riderId, () -> {
                        updateActiveDeliveryTypesSummary();
                    });
                    binding.deliveryTypesContainer.addView(card);
                }

                updateActiveDeliveryTypesSummary();
            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    /**
     * Dynamically updates the active delivery types counter and comma-separated summary
     * shown in the top unified status card.
     */
    private void updateActiveDeliveryTypesSummary() {
        if (binding == null) return;
        int activeCount = 0;
        StringBuilder sb = new StringBuilder();
        if (packageDataList != null) {
            for (PackageData p : packageDataList) {
                if ("1".equals(p.getDriver_active())) {
                    activeCount++;
                    if (sb.length() > 0) sb.append(", ");
                    String t = p.getTitle();
                    if (t != null && t.toLowerCase().contains("tier")) {
                        t = t.substring(0, t.toLowerCase().indexOf("tier")).trim();
                    }
                    sb.append(t != null ? t : "Model");
                }
            }
        }
        if (binding.txtOnlineActiveTypesCount != null) {
            binding.txtOnlineActiveTypesCount.setText(activeCount + " delivery types active");
        }
        if (binding.txtOnlineActiveTypesSummary != null) {
            binding.txtOnlineActiveTypesSummary.setText(sb.length() > 0 ? sb.toString() : "None active");
        }
    }

    /**
     * Opens the native 60fps Delivery Preferences Bottom Sheet with spring physics,
     * independent scrolling, and instant optimistic toggle updates.
     */
    private void openDeliveryPreferencesSheet() {
        if (getActivity() == null) return;
        if (packageDataList == null || packageDataList.isEmpty()) {
            Toast.makeText(getActivity(), "Loading delivery types...", Toast.LENGTH_SHORT).show();
            getPackageList();
            return;
        }
        DeliveryPreferencesBottomSheet.show(getActivity(), packageDataList, riderData, () -> {
            updateDeliveryTypesUI();
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        NodeSocketManager.getInstance().addConnectionListener(connectionListener);
        updateStatusControlUI(isOnline ? STATUS_ONLINE : STATUS_OFFLINE);
        if (isUpdateHome) {
            getHome();
        }
        setupMonthlyDriverUI();
        dutyTickerHandler.removeCallbacks(dutyTickerRunnable);
        dutyTickerHandler.postDelayed(dutyTickerRunnable, 10000);

        // Update volume button icon when fragment resumes
        if (binding.btnVolumeControl != null) {
            updateVolumeButtonIcon();
        }


    }

    @Override
    public void onPause() {
        super.onPause();
        NodeSocketManager.getInstance().removeConnectionListener(connectionListener);
        dutyTickerHandler.removeCallbacks(dutyTickerRunnable);
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        stopPulseAnimation();
        dutyTickerHandler.removeCallbacks(dutyTickerRunnable);
        NodeSocketManager.getInstance().removeConnectionListener(connectionListener);
        binding = null;
    }

    private void showVolumeControlDialog() {
        if (getActivity() == null || audioManager == null) {
            return;
        }

        final Dialog dialog = new Dialog(getActivity());
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_volume_control);
        dialog.setCancelable(true);

        // Get current ringtone volume
        int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_RING);
        int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING);

        // Find views in dialog
        SeekBar seekBarVolume = dialog.findViewById(R.id.seekbar_volume);
        TextView txtVolumePercentage = dialog.findViewById(R.id.txt_volume_percentage);
        ImageView imgVolumeIcon = dialog.findViewById(R.id.img_volume_icon);
        Button btnVolumeDown = dialog.findViewById(R.id.btn_volume_down);
        Button btnVolumeUp = dialog.findViewById(R.id.btn_volume_up);
        Button btnCloseDialog = dialog.findViewById(R.id.btn_close_dialog);

        // Set seekbar max and current value
        seekBarVolume.setMax(maxVolume);
        seekBarVolume.setProgress(currentVolume);
        updateVolumePercentage(txtVolumePercentage, currentVolume, maxVolume);
        updateVolumeIcon(imgVolumeIcon, currentVolume, maxVolume);

        // Initialize preview ringtone
        final android.media.Ringtone previewRingtone = android.media.RingtoneManager.getRingtone(
                getActivity(), 
                android.net.Uri.parse("android.resource://" + getActivity().getPackageName() + "/" + R.raw.movigo_ringtone)
        );
        if (previewRingtone != null) {
            previewRingtone.setStreamType(AudioManager.STREAM_RING);
        }

        // Helper to play preview sound
        Runnable playPreview = () -> {
            if (previewRingtone != null && !previewRingtone.isPlaying()) {
                previewRingtone.play();
            }
        };

        // SeekBar change listener
        seekBarVolume.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                if (fromUser) {
                    audioManager.setStreamVolume(AudioManager.STREAM_RING, progress, 0);
                    updateVolumePercentage(txtVolumePercentage, progress, maxVolume);
                    updateVolumeIcon(imgVolumeIcon, progress, maxVolume);
                    updateVolumeButtonIcon();
                    playPreview.run();
                }
            }

            @Override
            public void onStartTrackingTouch(SeekBar seekBar) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar seekBar) {
            }
        });

        // Volume Down button
        btnVolumeDown.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                int currentVol = audioManager.getStreamVolume(AudioManager.STREAM_RING);
                if (currentVol > 0) {
                    int newVolume = Math.max(0, currentVol - 1);
                    audioManager.setStreamVolume(AudioManager.STREAM_RING, newVolume, 0);
                    seekBarVolume.setProgress(newVolume);
                    updateVolumePercentage(txtVolumePercentage, newVolume, maxVolume);
                    updateVolumeIcon(imgVolumeIcon, newVolume, maxVolume);
                    updateVolumeButtonIcon();
                    playPreview.run();
                }
            }
        });

        // Volume Up button
        btnVolumeUp.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                int currentVol = audioManager.getStreamVolume(AudioManager.STREAM_RING);
                if (currentVol < maxVolume) {
                    int newVolume = Math.min(maxVolume, currentVol + 1);
                    audioManager.setStreamVolume(AudioManager.STREAM_RING, newVolume, 0);
                    seekBarVolume.setProgress(newVolume);
                    updateVolumePercentage(txtVolumePercentage, newVolume, maxVolume);
                    updateVolumeIcon(imgVolumeIcon, newVolume, maxVolume);
                    updateVolumeButtonIcon();
                    playPreview.run();
                }
            }
        });

        // Stop ringtone when dialog dismisses
        dialog.setOnDismissListener(d -> {
            if (previewRingtone != null && previewRingtone.isPlaying()) {
                previewRingtone.stop();
            }
        });

        // Close button
        btnCloseDialog.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                dialog.dismiss();
            }
        });

        // Show dialog
        dialog.show();

        // Make dialog window wider and rounded
        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(
                    (int) (getResources().getDisplayMetrics().widthPixels * 0.9),
                    ViewGroup.LayoutParams.WRAP_CONTENT);
        }
    }

    private void updateVolumePercentage(TextView textView, int currentVolume, int maxVolume) {
        if (textView != null) {
            int percentage = (int) ((currentVolume * 100.0) / maxVolume);
            textView.setText(percentage + "%");
        }
    }

    private void updateVolumeIcon(ImageView imageView, int currentVolume, int maxVolume) {
        if (imageView == null)
            return;

        // Use custom volume icon for all states
        imageView.setImageResource(R.drawable.ic_volume);

        // Change tint color based on volume level for visual feedback
        if (currentVolume == 0) {
            imageView.setColorFilter(getResources().getColor(R.color.gray1));
        } else if (currentVolume < maxVolume / 3) {
            imageView.setColorFilter(getResources().getColor(R.color.purple_500));
        } else if (currentVolume < (maxVolume * 2) / 3) {
            imageView.setColorFilter(getResources().getColor(R.color.purple_700));
        } else {
            imageView.setColorFilter(getResources().getColor(R.color.green));
        }
    }

    private void updateVolumeButtonIcon() {
        if (binding.btnVolumeControl == null || audioManager == null) {
            return;
        }

        int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_RING);
        int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING);

        // Keep the volume icon, but we can add visual feedback if needed
        // The icon will remain the same, but the dialog will show the actual volume
        binding.btnVolumeControl.setImageResource(R.drawable.ic_volume);
    }

    private void logoutUser() {
        if (getActivity() != null) {
            try {
                getActivity().stopService(new Intent(getActivity(), LocationUpdateService.class));
            } catch (Exception e) {
                e.printStackTrace();
            }

            if (riderData != null) {
                try {
                    java.util.Map<String, Object> statusBody = new java.util.HashMap<>();
                    statusBody.put("rider_id", riderData.getId());
                    statusBody.put("a_status", 0);
                    NodeApiClient.getInterface().setStatus(statusBody).enqueue(new retrofit2.Callback<JsonObject>() {
                        @Override
                        public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {}
                        @Override
                        public void onFailure(Call<JsonObject> call, Throwable t) {}
                    });
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }

            sessionManager.logoutUser();
            Intent intent = new Intent(getActivity(), com.shifter.driver.activity.LoginActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            startActivity(intent);
            getActivity().finish();
        }
    }

    private void showDriverDetailImageDialog(String imageUrl, String title) {
        if (getActivity() == null) return;

        Dialog dialog = new Dialog(getActivity(), android.R.style.Theme_Black_NoTitleBar_Fullscreen);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);

        android.widget.RelativeLayout layout = new android.widget.RelativeLayout(getActivity());
        layout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        layout.setBackgroundColor(android.graphics.Color.BLACK);

        ImageView imageView = new ImageView(getActivity());
        android.widget.RelativeLayout.LayoutParams imgParams = new android.widget.RelativeLayout.LayoutParams(
                android.widget.RelativeLayout.LayoutParams.MATCH_PARENT,
                android.widget.RelativeLayout.LayoutParams.MATCH_PARENT);
        imageView.setLayoutParams(imgParams);
        imageView.setScaleType(ImageView.ScaleType.FIT_CENTER);

        com.bumptech.glide.Glide.with(getActivity())
                .load(imageUrl)
                .into(imageView);

        layout.addView(imageView);

        // Header container (Title + Close button)
        LinearLayout header = new LinearLayout(getActivity());
        android.widget.RelativeLayout.LayoutParams headerParams = new android.widget.RelativeLayout.LayoutParams(
                android.widget.RelativeLayout.LayoutParams.MATCH_PARENT,
                android.widget.RelativeLayout.LayoutParams.WRAP_CONTENT);
        headerParams.addRule(android.widget.RelativeLayout.ALIGN_PARENT_TOP);
        header.setLayoutParams(headerParams);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setPadding(30, 40, 30, 30);
        header.setBackgroundColor(android.graphics.Color.parseColor("#80000000"));
        header.setGravity(android.view.Gravity.CENTER_VERTICAL);

        TextView tvTitle = new TextView(getActivity());
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        tvTitle.setLayoutParams(titleParams);
        tvTitle.setText(title != null ? title : "Detail Image");
        tvTitle.setTextColor(android.graphics.Color.WHITE);
        tvTitle.setTextSize(18);
        tvTitle.setTypeface(null, android.graphics.Typeface.BOLD);
        header.addView(tvTitle);

        ImageView btnClose = new ImageView(getActivity());
        LinearLayout.LayoutParams closeParams = new LinearLayout.LayoutParams(dpToPx(36), dpToPx(36));
        btnClose.setLayoutParams(closeParams);
        btnClose.setImageResource(android.R.drawable.ic_menu_close_clear_cancel);
        btnClose.setColorFilter(android.graphics.Color.WHITE);
        btnClose.setPadding(6, 6, 6, 6);
        btnClose.setOnClickListener(v -> dialog.dismiss());
        header.addView(btnClose);

        layout.addView(header);

        dialog.setContentView(layout);
        dialog.setCancelable(true);
        dialog.show();
    }

    private void setupMonthlyDriverUI() {
        if (riderData == null || getActivity() == null || binding == null) return;

        MonthlyDriverApiClient.getDutyStatus(riderData.getId(), new MonthlyDriverApiClient.DutyStatusCallback() {
            @Override
            public void onSuccess(MonthlyDutyStatus status) {
                if (!isAdded() || getActivity() == null || binding == null) return;

                if (status != null && status.isMonthlyDriver()) {
                    if (binding.cardDeliveryTypesSection != null) {
                        binding.cardDeliveryTypesSection.setVisibility(View.GONE);
                    }
                    if (binding.incMonthlyDutyCard != null && binding.incMonthlyDutyCard.cardMonthlyDuty != null) {
                        binding.incMonthlyDutyCard.cardMonthlyDuty.setVisibility(View.VISIBLE);

                        // 1. Shift timing
                        String shiftStart = status.getShiftStartTime() != null ? status.getShiftStartTime() : "10:00 AM";
                        String shiftEnd = status.getShiftEndTime() != null ? status.getShiftEndTime() : "08:00 PM";
                        binding.incMonthlyDutyCard.txtMonthlyShiftTiming.setText(
                                "Shift: " + shiftStart + " - " + shiftEnd + " (" + status.getTargetHoursDaily() + "h)");

                        // 2. Live in-zone duty hours
                        int dutyMins = status.getTodayDutyMinutes();
                        int hrs = dutyMins / 60;
                        int mins = dutyMins % 60;
                        binding.incMonthlyDutyCard.txtLiveDutyHours.setText(
                                String.format(Locale.getDefault(), "%02dh %02dm / %dh", hrs, mins, status.getTargetHoursDaily()));

                        // 3. Today's earned salary
                        binding.incMonthlyDutyCard.txtTodaySalaryEarned.setText(
                                "₹" + String.format(Locale.getDefault(), "%.2f", status.getTodaySalaryEarned()));

                        // 4. Overtime pay & hours
                        int otMins = status.getTodayOvertimeMinutes();
                        int otHrs = otMins / 60;
                        int otRemMins = otMins % 60;
                        double otPay = status.getTodayOvertimePay();
                        binding.incMonthlyDutyCard.txtTodayOvertime.setText(
                                "₹" + String.format(Locale.getDefault(), "%.2f", otPay) + " (" + otHrs + "h " + otRemMins + "m)");

                        // 5. Cash collected today (Cash in Hand)
                        double cashCol = status.getTodayCashCollected();
                        binding.incMonthlyDutyCard.txtTodayCashCollected.setText(
                                "₹" + String.format(Locale.getDefault(), "%.2f", cashCol));

                        // 6. Punch In / Punch Out Button
                        if (status.isCurrentlyPunchedIn()) {
                            binding.incMonthlyDutyCard.btnPunchDuty.setText("END DUTY (PUNCH OUT)");
                            binding.incMonthlyDutyCard.btnPunchDuty.setBackgroundTintList(
                                    ColorStateList.valueOf(Color.parseColor("#DC2626")));
                        } else {
                            binding.incMonthlyDutyCard.btnPunchDuty.setText("START DUTY (PUNCH IN)");
                            binding.incMonthlyDutyCard.btnPunchDuty.setBackgroundTintList(
                                    ColorStateList.valueOf(Color.parseColor("#059669")));
                        }
                        binding.incMonthlyDutyCard.btnPunchDuty.setOnClickListener(v -> handlePunchDuty(status));

                        // 7. In-Zone Badge
                        boolean inside = MonthlyDutyManager.getInstance().isInsideZone();
                        if (inside) {
                            binding.incMonthlyDutyCard.badgeZoneStatus.setText("🟢 In-Zone");
                            binding.incMonthlyDutyCard.badgeZoneStatus.setBackgroundTintList(
                                    ColorStateList.valueOf(Color.parseColor("#059669")));
                        } else {
                            binding.incMonthlyDutyCard.badgeZoneStatus.setText("🔴 Out-of-Zone");
                            binding.incMonthlyDutyCard.badgeZoneStatus.setBackgroundTintList(
                                    ColorStateList.valueOf(Color.parseColor("#DC2626")));
                        }
                    }

                    // Fetch upcoming orders in queue
                    fetchDriverQueue();
                } else {
                    MonthlyDutyStatus nonMonthly = new MonthlyDutyStatus();
                    nonMonthly.setMonthlyDriver(false);
                    MonthlyDutyManager.getInstance().setCurrentStatus(nonMonthly);

                    if (binding.cardDeliveryTypesSection != null) {
                        binding.cardDeliveryTypesSection.setVisibility(View.VISIBLE);
                    }
                    if (binding.incMonthlyDutyCard != null && binding.incMonthlyDutyCard.cardMonthlyDuty != null) {
                        binding.incMonthlyDutyCard.cardMonthlyDuty.setVisibility(View.GONE);
                    }
                    if (binding.incQueuedOrdersDrawer != null && binding.incQueuedOrdersDrawer.cardQueuedOrders != null) {
                        binding.incQueuedOrdersDrawer.cardQueuedOrders.setVisibility(View.GONE);
                    }
                }
            }

            @Override
            public void onError(String message) {
                Log.e("HomeFragment", "Failed to fetch duty status: " + message);
            }
        });
    }

    private void handlePunchDuty(MonthlyDutyStatus status) {
        if (riderData == null || getActivity() == null) return;

        if (status.isCurrentlyPunchedIn()) {
            // Punch Out
            MonthlyDriverApiClient.punchOut(riderData.getId(), new MonthlyDriverApiClient.PunchCallback() {
                @Override
                public void onSuccess(boolean isInsideZone, String message) {
                    if (getActivity() != null) {
                        Toast.makeText(getActivity(), message, Toast.LENGTH_SHORT).show();
                        setupMonthlyDriverUI();
                    }
                }

                @Override
                public void onError(String message) {
                    if (getActivity() != null) {
                        Toast.makeText(getActivity(), "Punch out failed: " + message, Toast.LENGTH_SHORT).show();
                    }
                }
            });
        } else {
            // Punch In
            android.location.Location loc = LocationUpdateService.getLocation();
            double lat = loc != null ? loc.getLatitude() : 0.0;
            double lng = loc != null ? loc.getLongitude() : 0.0;

            MonthlyDriverApiClient.punchIn(riderData.getId(), lat, lng, new MonthlyDriverApiClient.PunchCallback() {
                @Override
                public void onSuccess(boolean isInsideZone, String message) {
                    if (getActivity() != null) {
                        Toast.makeText(getActivity(), message, Toast.LENGTH_SHORT).show();
                        setupMonthlyDriverUI();
                    }
                }

                @Override
                public void onError(String message) {
                    if (getActivity() != null) {
                        Toast.makeText(getActivity(), "Punch in failed: " + message, Toast.LENGTH_SHORT).show();
                    }
                }
            });
        }
    }

    private void fetchDriverQueue() {
        if (riderData == null || getActivity() == null || binding == null || binding.incQueuedOrdersDrawer == null) return;

        MonthlyDriverApiClient.getDriverQueue(riderData.getId(), new MonthlyDriverApiClient.QueueCallback() {
            @Override
            public void onSuccess(List<QueuedOrder> queue) {
                if (!isAdded() || getActivity() == null || binding == null || binding.incQueuedOrdersDrawer == null) return;

                if (queue == null || queue.isEmpty()) {
                    binding.incQueuedOrdersDrawer.cardQueuedOrders.setVisibility(View.GONE);
                } else {
                    binding.incQueuedOrdersDrawer.cardQueuedOrders.setVisibility(View.VISIBLE);
                    binding.incQueuedOrdersDrawer.txtQueueHeader.setText("Upcoming Orders (" + queue.size() + ")");
                    binding.incQueuedOrdersDrawer.containerQueuedItems.removeAllViews();

                    LayoutInflater inflater = LayoutInflater.from(getActivity());
                    for (QueuedOrder item : queue) {
                        View row = inflater.inflate(R.layout.item_queued_order, binding.incQueuedOrdersDrawer.containerQueuedItems, false);

                        TextView txtOrderId = row.findViewById(R.id.txt_queue_order_id);
                        TextView txtPrice = row.findViewById(R.id.txt_queue_price);
                        TextView txtRoute = row.findViewById(R.id.txt_queue_route);

                        if (txtOrderId != null) {
                            txtOrderId.setText("#" + item.getOrderId() + " (Queue #" + item.getQueuePosition() + ")");
                        }
                        if (txtPrice != null) {
                            txtPrice.setText("₹" + (int) item.getEstimatedEarnings());
                        }
                        if (txtRoute != null) {
                            String pAddr = item.getPickupAddress() != null && !item.getPickupAddress().isEmpty() ? item.getPickupAddress() : "Pickup";
                            String dAddr = item.getDropAddress() != null && !item.getDropAddress().isEmpty() ? item.getDropAddress() : "Drop";
                            txtRoute.setText("📍 " + pAddr + " ➔ 🏁 " + dAddr);
                        }

                        binding.incQueuedOrdersDrawer.containerQueuedItems.addView(row);
                    }
                }
            }

            @Override
            public void onError(String message) {
                Log.e("HomeFragment", "Failed to fetch driver queue: " + message);
            }
        });
    }

}

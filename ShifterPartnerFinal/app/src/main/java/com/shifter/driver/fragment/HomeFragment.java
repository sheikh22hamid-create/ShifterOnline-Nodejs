package com.shifter.driver.fragment;

import android.Manifest;
import android.app.ActivityManager;
import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.content.pm.PackageManager;

import androidx.fragment.app.Fragment;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.core.content.ContextCompat;

import android.util.Log;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.SeekBar;

import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

import org.json.JSONException;
import org.json.JSONObject;

import com.shifter.driver.R;
import com.shifter.driver.activity.CustomOrderListActivity;
import com.shifter.driver.activity.OrderAnyDetailsActivity;
import com.shifter.driver.activity.OrderDetailsActivity;
import com.shifter.driver.adepter.RecentOrderHomeAdapter;
import com.shifter.driver.databinding.FragmentHomeBinding;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.model.HomeData;
import com.shifter.driver.model.PackageData;
import com.shifter.driver.model.PackageListResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import java.text.DecimalFormat;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

import android.widget.ToggleButton;
import java.util.List;

public class HomeFragment extends Fragment implements RecentOrderHomeAdapter.RecyclerTouchListener,
        GetResult.MyListener, SwipeRefreshLayout.OnRefreshListener {

    private FragmentHomeBinding binding;

    private List<PackageData> packageDataList;
    private AudioManager audioManager;

    SessionManager sessionManager;
    RiderData riderData;
    CustPrograssbar custPrograssbar;
    private boolean isOnline = false;

    public HomeFragment() {
        // Required empty public constructor
    }

    private void getPackageList() {

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("uid", riderData.getId());
            jsonObject.put("cat_id", "8");
            jsonObject.put("type", "DRIVER");
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getPackageList(bodyRequest);
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

        // Debug binding

        riderData = sessionManager.getUserDetails();
        binding.txtTitle.setText(getString(R.string.welcome) + " " + riderData.getFullName()+ " " + riderData.getVehicle());

        // Initialize AudioManager for volume control
        audioManager = (AudioManager) getActivity().getSystemService(Context.AUDIO_SERVICE);

        // Set up volume control button click listener
        if (binding.btnVolumeControl != null) {
            binding.btnVolumeControl.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    showVolumeControlDialog();
                }
            });
            updateVolumeButtonIcon();
        }

        // Initialize swipe button state
        isOnline = isServiceRunning(LocationUpdateService.class);
        updateSwipeButton(isOnline);
        setupSwipeButton();

        sessionManager.setStringData(SessionManager.currency, "₹");
        binding.refares.setColorSchemeResources(R.color.purple_700,
                android.R.color.holo_green_dark,
                android.R.color.holo_orange_dark,
                android.R.color.holo_blue_dark);

        binding.refares.setOnRefreshListener(this);
        binding.refares.post(() -> {

            // binding.refares.setRefreshing(true);

            // Fetching data from server
        });

        getHome();
        getPackageList();

        binding.crdOrder.setOnClickListener(this::onBindClick);
        binding.crdOrderby.setOnClickListener(this::onBindClick);

        // Custom Orders button
        binding.btnCustomOrders.setOnClickListener(v -> {
            startActivity(new Intent(getActivity(), CustomOrderListActivity.class));
        });

        // How To Use button
        binding.btnHowToUse.setOnClickListener(v -> {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, android.net.Uri.parse("https://www.youtube.com/shorts/h7KMfS0IrI8"));
                startActivity(intent);
            } catch (Exception e) {
                e.printStackTrace();
            }
        });

        return binding.getRoot();
    }
    private void setupSwipeButton() {
        android.widget.FrameLayout thumb = binding.swipeThumb;
        android.widget.FrameLayout container = binding.swipeBtnContainer;

        final float[] startRawX = { 0 };
        final boolean[] actionFired = { false };

        thumb.setOnTouchListener((v, event) -> {
            float containerWidth = container.getWidth();
            float thumbWidth = v.getWidth();
            float margin = dpToPx(2);
            float maxTranslation = containerWidth - thumbWidth - margin * 2;
            float threshold = maxTranslation * 0.55f;

            switch (event.getAction()) {
                case MotionEvent.ACTION_DOWN:
                    startRawX[0] = event.getRawX();
                    actionFired[0] = false;
                    return true;

                case MotionEvent.ACTION_MOVE:
                    float delta = event.getRawX() - startRawX[0];
                    float newTX = Math.max(0, Math.min(delta, maxTranslation));
                    v.setTranslationX(newTX);
                    return true;

                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    float currentTX = v.getTranslationX();
                    if (currentTX >= threshold && !actionFired[0]) {
                        actionFired[0] = true;
                        // Animate to end then snap back and toggle
                        v.animate().translationX(maxTranslation).setDuration(150)
                                .withEndAction(() -> v.postDelayed(() -> {
                                    v.setTranslationX(0);
                                    toggleOnlineOffline();
                                }, 150)).start();
                    } else {
                        // Snap back to start
                        v.animate().translationX(0).setDuration(200).start();
                    }
                    return true;
            }
            return false;
        });
    }

    private void toggleOnlineOffline() {
        if (getActivity() == null) return;
        isOnline = !isOnline;
        updateSwipeButton(isOnline);
        updateDriverStatusApi(isOnline);
        if (isOnline) {
            if (hasLocationPermission()) {
                startLocationServiceIfNeeded();
            } else {
                if (shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_FINE_LOCATION)) {
                    new androidx.appcompat.app.AlertDialog.Builder(getActivity())
                            .setTitle("Location Permission Needed")
                            .setMessage("Please grant Location permission to track your delivery routes and find nearby orders. This is required to go online and receive new delivery tasks.")
                            .setPositiveButton("OK", (dialog, which) -> {
                                requestPermissions(new String[]{
                                        Manifest.permission.ACCESS_COARSE_LOCATION,
                                        Manifest.permission.ACCESS_FINE_LOCATION
                                }, 101);
                            })
                            .setNegativeButton("Cancel", (dialog, which) -> {
                                dialog.dismiss();
                                isOnline = false;
                                updateSwipeButton(false);
                                updateDriverStatusApi(false);
                            })
                            .create().show();
                } else {
                    requestPermissions(new String[]{
                            Manifest.permission.ACCESS_COARSE_LOCATION,
                            Manifest.permission.ACCESS_FINE_LOCATION
                    }, 101);
                }
            }
        } else {
            if (getActivity() != null) {
                getActivity().stopService(new Intent(getActivity(), LocationUpdateService.class));
            }
        }
    }

    private int dpToPx(int dp) {
        return (int) (dp * getResources().getDisplayMetrics().density);
    }

    private void updateSwipeButton(boolean online) {
        if (binding == null || binding.swipeBtnContainer == null) return;
        TextView arrowsText = binding.txtThumbArrows;
        if (binding.swipeThumb != null) {
            binding.swipeThumb.setTranslationX(0);
        }
        if (online) {
            // Online state → show GO OFFLINE (white bg + pink border)
            binding.swipeBtnContainer.setBackgroundResource(R.drawable.swipe_btn_go_offline_bg);
            binding.txtStats.setText("GO OFFLINE");
            binding.txtStats.setTextColor(getResources().getColor(R.color.red));
            binding.swipeThumb.setBackgroundResource(R.drawable.swipe_thumb_pink_circle);
            if (arrowsText != null) {
                arrowsText.setText("»");
                arrowsText.setTextColor(android.graphics.Color.WHITE);
            }
        } else {
            // Offline state → show GO ONLINE (green)
            binding.swipeBtnContainer.setBackgroundResource(R.drawable.swipe_btn_go_online_bg);
            binding.txtStats.setText("GO ONLINE");
            binding.txtStats.setTextColor(getResources().getColor(R.color.white));
            binding.swipeThumb.setBackgroundResource(R.drawable.swipe_thumb_white_circle);
            if (arrowsText != null) {
                arrowsText.setText("»");
                arrowsText.setTextColor(android.graphics.Color.parseColor("#2ECC71"));
            }
        }
    }

    private boolean hasLocationPermission() {
        Context context = getActivity();
        if (context == null)
            return false;
        int fine = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION);
        int coarse = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION);
        return fine == PackageManager.PERMISSION_GRANTED || coarse == PackageManager.PERMISSION_GRANTED;
    }

    private void startLocationServiceIfNeeded() {
        if (!isServiceRunning(LocationUpdateService.class)) {
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
            if (granted && isOnline) {
                startLocationServiceIfNeeded();
            } else if (isOnline) {
                isOnline = false;
                updateSwipeButton(false);
                updateDriverStatusApi(false);
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
        ActivityManager manager = (ActivityManager) getActivity().getSystemService(Context.ACTIVITY_SERVICE);
        for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (serviceClass.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }

    private void updateDriverStatusApi(boolean isOnline) {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("status", isOnline ? "1" : "0");
        } catch (JSONException e) {
            e.printStackTrace();
        }


        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().riderStatus(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "3");
    }

    private void getHome() {
        custPrograssbar.prograssCreate(getActivity());
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rid", riderData.getId());
            jsonObject.put("device_id", com.shifter.driver.utility.Utility.getDeviceId(getActivity()));

        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().homeData(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

    @Override
    public void callback(JsonObject result, String callNo) {
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
                        updateSwipeButton(isOnline);
                        if (isOnline) {
                            if (hasLocationPermission()) {
                                startLocationServiceIfNeeded();
                            }
                        } else {
                            if (getActivity() != null) {
                                getActivity().stopService(new Intent(getActivity(), LocationUpdateService.class));
                            }
                        }
                        updateDriverStatusApi(isOnline);
                    } else {
                        updateSwipeButton(isOnline);
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
                    binding.txtEarning.setText(
                            sessionManager.getStringData(SessionManager.currency) + homeData.getPastMonthEarning());
                    binding.txtEarning2.setText(
                            sessionManager.getStringData(SessionManager.currency) + homeData.getCurrentMonthEarning());
                    binding.txtComplete.setText("" + homeData.getPastTotalComplete());
                    binding.txtComplete2.setText("" + homeData.getCurrentTotalComplete());
                    binding.txtRating.setText(homeData.getCurrentStar());
                    binding.txtRating2.setText(homeData.getPastStar());

                    if (homeData.getOrderHistory() != null) {
                        binding.txtOrderid
                                .setText(getString(R.string.order_id) + " #" + homeData.getOrderHistory().getId());
                        binding.txtStatus.setText(homeData.getOrderHistory().getStatus());
                        binding.txtToaddress.setText(homeData.getOrderHistory().getCustomerPaddress());
                        binding.txtFromaddress.setText(homeData.getOrderHistory().getCustomerDaddress());
                        binding.txtKm.setText(homeData.getOrderHistory().getDistance() + "km");
                        binding.txtEarningorder.setText(sessionManager.getStringData(SessionManager.currency)
                                + homeData.getOrderHistory().getTotal());
                        binding.txtMit.setText(homeData.getOrderHistory().getTimeDuration() + "mit");
                        DecimalFormat df = new DecimalFormat("#.##");
                        binding.txtMit
                                .setText(df.format(Double.parseDouble(homeData.getOrderHistory().getTimeDuration()))
                                        + " min deliver");

                        // Auto-navigate to OrderDetailsActivity if active order is present
                        String status = homeData.getOrderHistory().getStatus();
                        if (getActivity() != null && !"Completed".equalsIgnoreCase(status) && !"Cancelled".equalsIgnoreCase(status)) {
                            sessionManager.setActiveOrder(homeData.getOrderHistory());
                            isUpdateHome = false;
                            startActivity(new Intent(getActivity(), OrderDetailsActivity.class)
                                    .putExtra("myclass", homeData.getOrderHistory()));
                        } else {
                            sessionManager.clearActiveOrder();
                        }
                    } else {
                        sessionManager.clearActiveOrder();
                        binding.crdOrder.setVisibility(View.GONE);
                    }
                    if (homeData.getBuyOrderHistory() != null) {
                        binding.txtOrderid1
                                .setText(getString(R.string.order_id) + " #" + homeData.getBuyOrderHistory().getId());
                        binding.txtStatus1.setText(homeData.getBuyOrderHistory().getStatus());
                        binding.txtToaddress1.setText(homeData.getBuyOrderHistory().getStorePaddress());
                        binding.txtFromaddress1.setText(homeData.getBuyOrderHistory().getCustomerDaddress());
                        binding.txtKm1.setText(homeData.getBuyOrderHistory().getDistance() + "km");
                        binding.txtEarningorder1.setText(sessionManager.getStringData(SessionManager.currency)
                                + homeData.getBuyOrderHistory().getTotal());
                        DecimalFormat df = new DecimalFormat("#.##");
                        binding.txtMit1
                                .setText(df.format(Double.parseDouble(homeData.getBuyOrderHistory().getTimeDuration()))
                                        + " min deliver");
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
                } else {
                }
            } else if (callNo.equalsIgnoreCase("3")) {
                try {
                    // device_match check — rider_status.php
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
            } else if (callNo.equalsIgnoreCase("4")) {
                try {
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

    /*
     * public void onBindClick(View view) {
     * switch (view.getId()) {
     * case R.id.crd_order:
     *
     * if (!isServiceRunning(LocationUpdateService.class)) {
     * Toast.makeText(getActivity(),"Your status is offline, Please make it online."
     * ,Toast.LENGTH_LONG).show();
     * }else {
     * isUpdateHome = false;
     * startActivity(new Intent(getActivity(),
     * OrderDetailsActivity.class).putExtra("myclass", homeData.getOrderHistory()));
     * }
     *
     * break;
     * case R.id.crd_orderby:
     * if (!isServiceRunning(LocationUpdateService.class)) {
     * Toast.makeText(getActivity(),"Your status is offline, Please make it online."
     * ,Toast.LENGTH_LONG).show();
     * }else {
     * startActivity(new Intent(getActivity(),
     * OrderAnyDetailsActivity.class).putExtra("myclass",homeData.getBuyOrderHistory
     * ()));
     *
     * }
     *
     * break;
     *
     * }
     * }
     */

    public void onBindClick(View view) {

        int id = view.getId();

        if (id == R.id.crd_order) {

            if (!isServiceRunning(LocationUpdateService.class)) {
                Toast.makeText(
                        getActivity(),
                        "Your status is offline, Please make it online.",
                        Toast.LENGTH_LONG).show();
            } else if (homeData != null && homeData.getOrderHistory() != null) {
                isUpdateHome = false;
                startActivity(
                        new Intent(getActivity(), OrderDetailsActivity.class)
                                .putExtra("myclass", homeData.getOrderHistory()));
            } else {
                Toast.makeText(getActivity(), "No active order found.", Toast.LENGTH_SHORT).show();
            }

        } else if (id == R.id.crd_orderby) {

            if (!isServiceRunning(LocationUpdateService.class)) {
                Toast.makeText(
                        getActivity(),
                        "Your status is offline, Please make it online.",
                        Toast.LENGTH_LONG).show();
            } else if (homeData != null && homeData.getBuyOrderHistory() != null) {
                startActivity(
                        new Intent(getActivity(), OrderAnyDetailsActivity.class)
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
    }

    private void updateDeliveryTypesUI() {
        if (getActivity() == null) {
            return;
        }

        getActivity().runOnUiThread(() -> {
            try {

                if (binding.deliveryTypesContainer == null) {
                    return;
                }

                if (packageDataList == null || packageDataList.isEmpty()) {
                    // Show empty message
                    TextView emptyText = new TextView(getActivity());
                    emptyText.setText(getString(R.string.no_delivery_types_available));
                    emptyText.setGravity(android.view.Gravity.CENTER);
                    emptyText.setPadding(20, 20, 20, 20);
                    binding.deliveryTypesContainer.addView(emptyText);
                    return;
                }

                binding.deliveryTypesContainer.removeAllViews();

                // Create header
                LinearLayout headerRow = createHeaderRow();
                binding.deliveryTypesContainer.addView(headerRow);

                // Create rows for each package
                for (PackageData packageData : packageDataList) {
                    LinearLayout packageRow = createPackageRow(packageData);
                    binding.deliveryTypesContainer.addView(packageRow);

                }


            } catch (Exception e) {
                e.printStackTrace();
            }
        });
    }

    private LinearLayout createHeaderRow() {
        LinearLayout headerRow = new LinearLayout(getActivity());
        headerRow.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        headerRow.setOrientation(LinearLayout.HORIZONTAL);
        headerRow.setPadding(20, 18, 20, 18);

        // Gradient background effect
        android.graphics.drawable.GradientDrawable headerBg = new android.graphics.drawable.GradientDrawable();
        headerBg.setColors(new int[] {
                getResources().getColor(R.color.purple_700),
                getResources().getColor(R.color.purple_500)
        });
        headerBg.setOrientation(android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT);
        headerBg.setCornerRadius(12f);
        headerRow.setBackground(headerBg);
        headerRow.setElevation(6f);

        // Type Header - Left
        TextView typeHeader = new TextView(getActivity());
        LinearLayout.LayoutParams typeParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.5f);
        typeParams.setMargins(0, 0, 8, 0);
        typeHeader.setLayoutParams(typeParams);
        typeHeader.setText(R.string.delivery_type);
        typeHeader.setTextColor(getResources().getColor(R.color.white));
        typeHeader.setTextSize(16);
        typeHeader.setTypeface(null, android.graphics.Typeface.BOLD);
        typeHeader.setPadding(12, 0, 12, 0);
        typeHeader.setGravity(android.view.Gravity.CENTER_VERTICAL | android.view.Gravity.START);
        typeHeader.setLetterSpacing(0.05f); // Spacing between letters
        headerRow.addView(typeHeader);

        // Status Header - Right
        TextView statusHeader = new TextView(getActivity());
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        statusParams.setMargins(8, 0, 0, 0);
        statusHeader.setLayoutParams(statusParams);
        statusHeader.setText(R.string.status);
        statusHeader.setTextColor(getResources().getColor(R.color.white));
        statusHeader.setTextSize(16);
        statusHeader.setTypeface(null, android.graphics.Typeface.BOLD);
        statusHeader.setPadding(12, 0, 12, 0);
        statusHeader.setGravity(android.view.Gravity.CENTER_VERTICAL | android.view.Gravity.CENTER);
        statusHeader.setLetterSpacing(0.05f);
        headerRow.addView(statusHeader);

        return headerRow;
    }

    private LinearLayout createPackageRow(PackageData packageData) {
        LinearLayout row = new LinearLayout(getActivity());
        LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        rowParams.setMargins(12, 8, 12, 8);
        row.setLayoutParams(rowParams);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setPadding(16, 20, 16, 20);
        row.setBackgroundResource(R.drawable.rounded_corner_box);
        row.setElevation(2f);

        // Type column - Left side
        TextView typeText = new TextView(getActivity());
        LinearLayout.LayoutParams typeParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f);
        typeParams.setMargins(4, 0, 4, 0);
        typeText.setLayoutParams(typeParams);
        typeText.setText(packageData.getTitle());
        typeText.setTextColor(getResources().getColor(R.color.black));
        typeText.setTextSize(16);
        typeText.setTypeface(null, android.graphics.Typeface.BOLD);
        typeText.setPadding(8, 0, 4, 0);
        typeText.setGravity(android.view.Gravity.CENTER_VERTICAL | android.view.Gravity.START);
        row.addView(typeText);

        // Info Icon - Middle
        ImageView infoIcon = new ImageView(getActivity());
        LinearLayout.LayoutParams infoParams = new LinearLayout.LayoutParams(
                dpToPx(28), dpToPx(28));
        infoParams.setMargins(4, 0, 8, 0);
        infoParams.gravity = android.view.Gravity.CENTER_VERTICAL;
        infoIcon.setLayoutParams(infoParams);
        infoIcon.setImageResource(R.drawable.ic_info);
        infoIcon.setPadding(2, 2, 2, 2);
        infoIcon.setColorFilter(getResources().getColor(R.color.purple_500));
        infoIcon.setOnClickListener(v -> {
            String imgPath = packageData.getDriverDetailImage();
            if (imgPath != null && !imgPath.isEmpty()) {
                String fullUrl = imgPath.startsWith("http") ? imgPath : (APIClient.baseUrl + "/" + imgPath);
                showDriverDetailImageDialog(fullUrl, packageData.getTitle());
            } else {
                Toast.makeText(getActivity(), "No detail image available", Toast.LENGTH_SHORT).show();
            }
        });
        row.addView(infoIcon);

        // Toggle Switch - Right side
        Switch statusSwitch = new Switch(getActivity());
        LinearLayout.LayoutParams switchParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        switchParams.setMargins(8, 0, 4, 0);
        statusSwitch.setLayoutParams(switchParams);

        // Status check
        boolean isActive = "1".equals(packageData.getDriver_active());
        statusSwitch.setChecked(isActive);

        // Switch listener
        statusSwitch.setOnCheckedChangeListener((buttonView, isChecked) -> {
            Log.e("SWITCH", packageData.getTitle() + " changed to: " + (isChecked ? "ACTIVE" : "INACTIVE"));
            packageData.setDriver_active(isChecked ? "1" : "0");
            packageData.setStatus(isChecked ? "1" : "0");


            // API call yahan karo status update ke liye
            updatePackageStatus(packageData);

            Toast.makeText(getActivity(),
                    packageData.getTitle() + " " + (isChecked ? "Activated" : "Deactivated"),
                    Toast.LENGTH_SHORT).show();
        });

        row.addView(statusSwitch);

        return row;
    }

    // API call method for status update
    private void updatePackageStatus(PackageData packageData) {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("delivery_type", packageData.getId());
            jsonObject.put("status", packageData.getStatus());


            RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            Call<JsonObject> call = APIClient.getInterface().updateDeliveryType(bodyRequest);
            GetResult getResult = new GetResult();
            getResult.setMyListener(this);
            getResult.callForLogin(call, "4");

        } catch (JSONException e) {
            e.printStackTrace();
        }
    }
    /*
     * private LinearLayout createPackageRow(PackageData packageData) {
     * LinearLayout row = new LinearLayout(getActivity());
     * LinearLayout.LayoutParams rowParams = new LinearLayout.LayoutParams(
     * LinearLayout.LayoutParams.MATCH_PARENT,
     * LinearLayout.LayoutParams.WRAP_CONTENT
     * );
     * rowParams.setMargins(8, 4, 8, 4);
     * row.setLayoutParams(rowParams);
     * row.setOrientation(LinearLayout.HORIZONTAL);
     * row.setPadding(16, 16, 16, 16);
     * row.setBackgroundResource(R.drawable.rounded_corner_box);
     *
     * // Delivery Type - 1st column (Bigger font, bold)
     * TextView typeText = createDataTextView(packageData.getTitle(), 1f, true);
     * typeText.setTextSize(16);
     * typeText.setTypeface(null, android.graphics.Typeface.BOLD);
     * row.addView(typeText);
     *
     * // KM - 2nd column
     * String kmText = packageData.getKm() + " km";
     * TextView kmTextView = createDataTextView(kmText, 1f, false);
     * row.addView(kmTextView);
     *
     * // Time - 3rd column (Only time)
     * //String timeText = packageData.getTime() + " min";
     * String timeText = getString(
     * R.string.time_in_min,
     * packageData.getTime()
     * );
     * TextView timeTextView = createDataTextView(timeText, 1f, false);
     * row.addView(timeTextView);
     *
     * // Toggle Button - 4th column (Better looking toggle)
     * ToggleButton toggleBtn = createToggleButton(packageData);
     * row.addView(toggleBtn);
     *
     * return row;
     * }
     */

    private TextView createDataTextView(String text, float weight, boolean isType) {
        TextView textView = new TextView(getActivity());
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, weight);
        params.setMargins(4, 4, 4, 4);
        textView.setLayoutParams(params);
        textView.setText(text);
        textView.setTextColor(getResources().getColor(R.color.black));
        textView.setTextSize(14);
        textView.setPadding(12, 12, 12, 12);
        textView.setGravity(android.view.Gravity.CENTER);

        if (isType) {
            textView.setBackgroundResource(R.drawable.rounded_corner_primary);
            textView.setTextColor(getResources().getColor(R.color.white));
        } else {
            textView.setBackgroundResource(R.drawable.rounded_corner_light);
        }

        return textView;
    }

    private ToggleButton createToggleButton(PackageData packageData) {
        ToggleButton toggleBtn = new ToggleButton(getActivity());
        LinearLayout.LayoutParams toggleParams = new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f);
        toggleParams.setMargins(4, 4, 4, 4);
        toggleBtn.setLayoutParams(toggleParams);

        // Better text
        toggleBtn.setTextOn(getString(R.string.status_active));
        toggleBtn.setTextOff(getString(R.string.status_inactive));

        // Better styling
        toggleBtn.setTextSize(12);
        toggleBtn.setPadding(8, 8, 8, 8);

        // Status check - string comparison use karo
        boolean isActive = "1".equals(packageData.getDriver_active());
        toggleBtn.setChecked(isActive);

        // Custom background based on state
        updateToggleAppearance(toggleBtn, isActive);

        toggleBtn.setOnCheckedChangeListener((buttonView, isChecked) -> {
            updateToggleAppearance(toggleBtn, isChecked);
            packageData.setStatus(isChecked ? "1" : "0");

            Toast.makeText(getActivity(),
                    packageData.getTitle() + " " + (isChecked ? "Activated" : "Deactivated"),
                    Toast.LENGTH_SHORT).show();
        });

        return toggleBtn;
    }

    private void updateToggleAppearance(ToggleButton toggleBtn, boolean isChecked) {
        if (isChecked) {
            toggleBtn.setBackgroundResource(R.drawable.toggle_active_bg);
            toggleBtn.setTextColor(getResources().getColor(R.color.white));
        } else {
            toggleBtn.setBackgroundResource(R.drawable.toggle_inactive_bg);
            toggleBtn.setTextColor(getResources().getColor(R.color.white));
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (isUpdateHome) {
            getHome();
        }
        // Update volume button icon when fragment resumes
        if (binding.btnVolumeControl != null) {
            updateVolumeButtonIcon();
        }

        // Auto-navigate to OrderDetailsActivity if active order is present
        if (homeData != null && homeData.getOrderHistory() != null
                && getActivity() != null) {
            String status = homeData.getOrderHistory().getStatus();
            if (!"Completed".equalsIgnoreCase(status) && !"Cancelled".equalsIgnoreCase(status)) {
                isUpdateHome = false;
                startActivity(
                        new Intent(getActivity(), OrderDetailsActivity.class)
                                .putExtra("myclass", homeData.getOrderHistory()));
            }
        }
    }

    public static boolean isUpdateHome = false;

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
                    JSONObject statusObj = new JSONObject();
                    statusObj.put("rider_id", String.valueOf(riderData.getId()));
                    statusObj.put("status", "0");
                    RequestBody statusBody = RequestBody.create(MediaType.parse("application/json"), statusObj.toString());
                    APIClient.getInterface().riderStatus(statusBody).enqueue(new retrofit2.Callback<JsonObject>() {
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

}

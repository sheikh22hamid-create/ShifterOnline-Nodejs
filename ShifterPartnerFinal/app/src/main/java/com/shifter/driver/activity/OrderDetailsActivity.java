package com.shifter.driver.activity;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.maps.CameraUpdate;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.gms.maps.model.Polyline;
import com.google.android.gms.maps.model.PolylineOptions;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityOrderDetailsBinding;
import com.shifter.driver.fragment.HomeFragment;
import com.shifter.driver.locationservice.FetchURL;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.locationservice.TaskLoadedCallback;
import com.shifter.driver.model.PDOrder;
import com.shifter.driver.model.PDOrderItem;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.text.DecimalFormat;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class OrderDetailsActivity extends AppCompatActivity
        implements OnMapReadyCallback, TaskLoadedCallback, GetResult.MyListener {

    private ActivityOrderDetailsBinding binding;

    private PDOrderItem orderItem;
    private SessionManager sessionManager;
    private CustPrograssbar custPrograssbar;
    private RiderData riderData;

    private GoogleMap mMap;
    private Polyline currentPolyline;

    private String dialPhone = "";
    private String status = "";
    private String lastAction = "";
    private String pendingOrderId = ""; // order_id jo notification/dialog se aaya ho
    public static boolean isUpdate = false;

    private android.os.Handler waitingHandler;
    private Runnable waitingRunnable;
    private boolean isWaitingForPayment = false;
    private android.os.CountDownTimer paymentCountDownTimer;
    private long remainingPaymentSeconds = 120;
    private final String defaultPaymentMsg = "Please wait for 2 minutes while the user completes the payment.\nIf the payment is not received within 2 minutes, the order will be automatically cancelled.";

    private android.os.Handler pickupWaitingTimerHandler;
    private Runnable pickupWaitingTimerRunnable;
    private long arrivalTimestamp = 0;

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (waitingHandler != null) {
            waitingHandler.removeCallbacksAndMessages(null);
        }
        if (paymentCountDownTimer != null) {
            paymentCountDownTimer.cancel();
            paymentCountDownTimer = null;
        }
        stopAndClearPickupWaitingTimer();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        orderItem = getIntent().getParcelableExtra("myclass");
        if (orderItem == null) {
            Toast.makeText(this, "Order data not found", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        custPrograssbar = new CustPrograssbar();
        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();

        checkPaymentStatusFromApi();
    }

    private void checkPaymentStatusFromApi() {
        custPrograssbar.prograssCreate(this);
        try {
            org.json.JSONObject jsonObject = new org.json.JSONObject();
            jsonObject.put("type", "recent");
            jsonObject.put("rid", riderData.getId());

            RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            Call<com.google.gson.JsonObject> call = com.shifter.driver.retrofit.APIClient.getInterface().pkgHistory(bodyRequest);
            call.enqueue(new retrofit2.Callback<com.google.gson.JsonObject>() {
                @Override
                public void onResponse(Call<com.google.gson.JsonObject> call, retrofit2.Response<com.google.gson.JsonObject> response) {
                    custPrograssbar.closePrograssBar();
                    try {
                        com.google.gson.Gson gson = new com.google.gson.Gson();
                        PDOrder pdOrder = gson.fromJson(response.body(), PDOrder.class);
                        if (pdOrder != null && "true".equalsIgnoreCase(pdOrder.getResult())) {
                            PDOrderItem latestOrder = null;
                            for (PDOrderItem item : pdOrder.getOrderHistory()) {
                                if (item.getId().equals(orderItem.getId())) {
                                    latestOrder = item;
                                    break;
                                }
                            }

                            if (latestOrder != null) {
                                if ("CANCEL".equalsIgnoreCase(latestOrder.getStatus()) || "CANCELLED".equalsIgnoreCase(latestOrder.getStatus())) {
                                    navigateToHomeAndFinish("Order was cancelled.");
                                } else if ("1".equals(latestOrder.getPaymentStatus())) {
                                    orderItem = latestOrder;
                                    new SessionManager(OrderDetailsActivity.this).setActiveOrder(orderItem);
                                    initOrderDetailsScreen();
                                } else {
                                    showWaitingForPaymentScreen(response.body(), pdOrder);
                                }
                            } else {
                                // Order missing from recent, maybe completed or cancelled
                                navigateToHomeAndFinish("Order not found or cancelled.");
                            }
                        } else {
                            navigateToHomeAndFinish("Order not found or cancelled.");
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        navigateToHomeAndFinish("Error checking order status.");
                    }
                }

                @Override
                public void onFailure(Call<com.google.gson.JsonObject> call, Throwable t) {
                    custPrograssbar.closePrograssBar();
                    navigateToHomeAndFinish("Network error.");
                }
            });
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
            navigateToHomeAndFinish(null);
        }
    }

    private void navigateToHomeAndFinish(String message) {
        try {
            new SessionManager(this).clearActiveOrder();
        } catch (Exception ignored) {}
        if (waitingHandler != null) {
            waitingHandler.removeCallbacksAndMessages(null);
        }
        if (paymentCountDownTimer != null) {
            paymentCountDownTimer.cancel();
            paymentCountDownTimer = null;
        }
        stopAndClearPickupWaitingTimer();
        isWaitingForPayment = false;
        if (message != null && !message.isEmpty()) {
            Toast.makeText(this, message, Toast.LENGTH_SHORT).show();
        }
        Intent intent = new Intent(this, HomeActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        startActivity(intent);
        finish();
    }

    private void applySystemWindowInsets(View root) {
        if (root == null) return;
        androidx.core.view.ViewCompat.setOnApplyWindowInsetsListener(root, (v, windowInsets) -> {
            androidx.core.graphics.Insets insets = windowInsets.getInsets(
                    androidx.core.view.WindowInsetsCompat.Type.systemBars());
            v.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return windowInsets;
        });
        androidx.core.view.ViewCompat.requestApplyInsets(root);
    }

    private void initOrderDetailsScreen() {
        binding = ActivityOrderDetailsBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        applySystemWindowInsets(binding.getRoot());
        setupUI();
        setupClicks();
        setupMap();
    }

    private void showWaitingForPaymentScreen(com.google.gson.JsonObject rootObj, PDOrder pdOrder) {
        isWaitingForPayment = true;
        setContentView(R.layout.activity_waiting_payment);
        applySystemWindowInsets(findViewById(android.R.id.content));
        
        TextView txtOrderId = findViewById(R.id.txt_waiting_order_id);
        if (txtOrderId != null) {
            txtOrderId.setText("Order #" + orderItem.getId());
        }

        String msg = extractAdvancePaymentMsg(rootObj, pdOrder);
        updateWaitingMessage(msg);

        long timerSeconds = extractAdvancePaymentTimer(rootObj, pdOrder);
        startPaymentCountDown(timerSeconds);

        findViewById(R.id.btn_cancel_order_waiting).setOnClickListener(v -> {
            showRejectSheet();
        });

        View refreshBtn = findViewById(R.id.img_refresh_waiting);
        if (refreshBtn != null) {
            refreshBtn.setOnClickListener(v -> {
                pollPaymentStatusFromApi();
                Toast.makeText(OrderDetailsActivity.this, "Refreshing...", Toast.LENGTH_SHORT).show();
            });
        }

        startPaymentPolling();
    }

    private String extractAdvancePaymentMsg(com.google.gson.JsonObject rootObj, PDOrder pdOrder) {
        String msg = null;
        try {
            if (rootObj != null) {
                // 1. Root level advance_payment_msg
                if (rootObj.has("advance_payment_msg") && !rootObj.get("advance_payment_msg").isJsonNull()) {
                    msg = rootObj.get("advance_payment_msg").getAsString();
                }
                // 2. OrderHistory item level advance_payment_msg
                if ((msg == null || msg.trim().isEmpty()) && rootObj.has("OrderHistory") && rootObj.get("OrderHistory").isJsonArray()) {
                    com.google.gson.JsonArray arr = rootObj.getAsJsonArray("OrderHistory");
                    for (int i = 0; i < arr.size(); i++) {
                        com.google.gson.JsonElement el = arr.get(i);
                        if (el != null && el.isJsonObject()) {
                            com.google.gson.JsonObject o = el.getAsJsonObject();
                            if (o.has("advance_payment_msg") && !o.get("advance_payment_msg").isJsonNull()) {
                                String m = o.get("advance_payment_msg").getAsString();
                                if (m != null && !m.trim().isEmpty()) {
                                    msg = m;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        if ((msg == null || msg.trim().isEmpty()) && pdOrder != null) {
            if (pdOrder.getAdvancePaymentMsg() != null && !pdOrder.getAdvancePaymentMsg().trim().isEmpty()) {
                msg = pdOrder.getAdvancePaymentMsg();
            } else if (pdOrder.getOrderHistory() != null) {
                for (PDOrderItem item : pdOrder.getOrderHistory()) {
                    if (item.getAdvancePaymentMsg() != null && !item.getAdvancePaymentMsg().trim().isEmpty()) {
                        msg = item.getAdvancePaymentMsg();
                        break;
                    }
                }
            }
        }

        if (msg == null || msg.trim().isEmpty()) {
            msg = defaultPaymentMsg;
        }
        return msg;
    }

    private long extractAdvancePaymentTimer(com.google.gson.JsonObject rootObj, PDOrder pdOrder) {
        String timerStr = null;
        try {
            if (rootObj != null) {
                // 1. Root level advance_payment_timer
                if (rootObj.has("advance_payment_timer") && !rootObj.get("advance_payment_timer").isJsonNull()) {
                    timerStr = rootObj.get("advance_payment_timer").getAsString();
                }
                // 2. OrderHistory item level advance_payment_timer
                if ((timerStr == null || timerStr.trim().isEmpty()) && rootObj.has("OrderHistory") && rootObj.get("OrderHistory").isJsonArray()) {
                    com.google.gson.JsonArray arr = rootObj.getAsJsonArray("OrderHistory");
                    for (int i = 0; i < arr.size(); i++) {
                        com.google.gson.JsonElement el = arr.get(i);
                        if (el != null && el.isJsonObject()) {
                            com.google.gson.JsonObject o = el.getAsJsonObject();
                            if (o.has("advance_payment_timer") && !o.get("advance_payment_timer").isJsonNull()) {
                                String t = o.get("advance_payment_timer").getAsString();
                                if (t != null && !t.trim().isEmpty()) {
                                    timerStr = t;
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        if ((timerStr == null || timerStr.trim().isEmpty()) && pdOrder != null) {
            if (pdOrder.getAdvancePaymentTimer() != null && !pdOrder.getAdvancePaymentTimer().trim().isEmpty()) {
                timerStr = pdOrder.getAdvancePaymentTimer();
            } else if (pdOrder.getOrderHistory() != null) {
                for (PDOrderItem item : pdOrder.getOrderHistory()) {
                    if (item.getAdvancePaymentTimer() != null && !item.getAdvancePaymentTimer().trim().isEmpty()) {
                        timerStr = item.getAdvancePaymentTimer();
                        break;
                    }
                }
            }
        }

        long seconds = 120;
        if (timerStr != null && !timerStr.trim().isEmpty()) {
            try {
                seconds = Long.parseLong(timerStr.trim());
            } catch (Exception e) {
                try {
                    seconds = (long) Double.parseDouble(timerStr.trim());
                } catch (Exception ignored) {}
            }
        }
        return seconds > 0 ? seconds : 120;
    }

    private void startPaymentCountDown(long totalSeconds) {
        if (paymentCountDownTimer != null) {
            paymentCountDownTimer.cancel();
        }
        remainingPaymentSeconds = totalSeconds > 0 ? totalSeconds : 120;
        updateTimerText(remainingPaymentSeconds);

        paymentCountDownTimer = new android.os.CountDownTimer(remainingPaymentSeconds * 1000L, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                remainingPaymentSeconds = millisUntilFinished / 1000;
                updateTimerText(remainingPaymentSeconds);
            }

            @Override
            public void onFinish() {
                remainingPaymentSeconds = 0;
                updateTimerText(0);
                pollPaymentStatusFromApi();
            }
        }.start();
    }

    private void updateTimerText(long seconds) {
        TextView txtTimer = findViewById(R.id.txt_waiting_timer);
        if (txtTimer != null) {
            long minutes = seconds / 60;
            long secs = seconds % 60;
            txtTimer.setText(String.format(java.util.Locale.getDefault(), "%02d:%02d", minutes, secs));
        }
    }

    private void updateWaitingMessage(String message) {
        TextView txtMessage = findViewById(R.id.txt_waiting_message);
        if (txtMessage != null) {
            if (message != null && !message.trim().isEmpty()) {
                txtMessage.setText(message);
            } else {
                txtMessage.setText(defaultPaymentMsg);
            }
        }
    }

    private void updateWaitingDetailsFromResponse(com.google.gson.JsonObject rootObj, PDOrder pdOrder) {
        if (!isWaitingForPayment) return;

        String msg = extractAdvancePaymentMsg(rootObj, pdOrder);
        updateWaitingMessage(msg);

        if (paymentCountDownTimer == null) {
            long timerSecs = extractAdvancePaymentTimer(rootObj, pdOrder);
            startPaymentCountDown(timerSecs);
        }
    }

    private void startPaymentPolling() {
        waitingHandler = new android.os.Handler();
        waitingRunnable = new Runnable() {
            @Override
            public void run() {
                if (isWaitingForPayment) {
                    pollPaymentStatusFromApi();
                }
            }
        };
        waitingHandler.postDelayed(waitingRunnable, 2000);
    }

    private void pollPaymentStatusFromApi() {
        try {
            org.json.JSONObject jsonObject = new org.json.JSONObject();
            jsonObject.put("type", "recent");
            jsonObject.put("rid", riderData.getId());

            RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            Call<com.google.gson.JsonObject> call = com.shifter.driver.retrofit.APIClient.getInterface().pkgHistory(bodyRequest);
            call.enqueue(new retrofit2.Callback<com.google.gson.JsonObject>() {
                @Override
                public void onResponse(Call<com.google.gson.JsonObject> call, retrofit2.Response<com.google.gson.JsonObject> response) {
                    try {
                        com.google.gson.Gson gson = new com.google.gson.Gson();
                        PDOrder pdOrder = gson.fromJson(response.body(), PDOrder.class);
                        if (pdOrder != null && "true".equalsIgnoreCase(pdOrder.getResult())) {
                            PDOrderItem latestOrder = null;
                            for (PDOrderItem item : pdOrder.getOrderHistory()) {
                                if (item.getId().equals(orderItem.getId())) {
                                    latestOrder = item;
                                    break;
                                }
                            }

                            if (latestOrder != null) {
                                if ("CANCEL".equalsIgnoreCase(latestOrder.getStatus()) || "CANCELLED".equalsIgnoreCase(latestOrder.getStatus())) {
                                    navigateToHomeAndFinish("Order was cancelled.");
                                } else if ("1".equals(latestOrder.getPaymentStatus())) {
                                    if (waitingHandler != null) waitingHandler.removeCallbacksAndMessages(null);
                                    if (paymentCountDownTimer != null) {
                                        paymentCountDownTimer.cancel();
                                        paymentCountDownTimer = null;
                                    }
                                    isWaitingForPayment = false;
                                    orderItem = latestOrder;
                                    new SessionManager(OrderDetailsActivity.this).setActiveOrder(orderItem);
                                    initOrderDetailsScreen();
                                } else {
                                    updateWaitingDetailsFromResponse(response.body(), pdOrder);
                                    if (isWaitingForPayment) waitingHandler.postDelayed(waitingRunnable, 2000);
                                }
                            } else {
                                // Order ID missing from recent list -> order cancelled/removed
                                navigateToHomeAndFinish("Order was cancelled.");
                            }
                        } else {
                            // Server returned Result: false (e.g. "Order Not Found!!!") -> order is cancelled/removed
                            navigateToHomeAndFinish("Order was cancelled.");
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        if (isWaitingForPayment) waitingHandler.postDelayed(waitingRunnable, 2000);
                    }
                }

                @Override
                public void onFailure(Call<com.google.gson.JsonObject> call, Throwable t) {
                    if (isWaitingForPayment) waitingHandler.postDelayed(waitingRunnable, 2000);
                }
            });
        } catch (Exception e) {
            e.printStackTrace();
            if (isWaitingForPayment) waitingHandler.postDelayed(waitingRunnable, 2000);
        }
    }

    // ------------------------------------------------ UI
    private void setupUI() {
        binding.txtOrderid.setText(getString(R.string.order_id) + " #" + orderItem.getId());
        binding.txtDatetime.setText(getString(R.string.date) + " " + orderItem.getOrderDate());
        binding.txtUname.setText(orderItem.getPickName());
        binding.txtKm.setText(orderItem.getDistance() + " Km");

        binding.txtEarning.setText(
                sessionManager.getStringData(SessionManager.currency) + orderItem.getTotal());

        DecimalFormat df = new DecimalFormat("#.##");
        try {
            binding.txtMit.setText(df.format(Double.parseDouble(orderItem.getTimeDuration())) + " min");
        } catch (Exception e) {
            binding.txtMit.setText(orderItem.getTimeDuration() + " min");
        }

        String pickType = orderItem.getPickType();
        if (TextUtils.isEmpty(pickType)) pickType = "Pickup";
        binding.txtTotype.setText(pickType);

        String dropType = orderItem.getDropType();
        if (TextUtils.isEmpty(dropType)) dropType = "Drop";
        binding.txtFromtype.setText(dropType);

        String pAddress = orderItem.getCustomerPaddress();
        if (pAddress != null) {
            pAddress = pAddress.replaceAll("^[\\s,]+", "").trim();
        }
        binding.txtToaddress.setText(pAddress);

        String dAddress = orderItem.getCustomerDaddress();
        if (dAddress != null) {
            dAddress = dAddress.replaceAll("^[\\s,]+", "").trim();
        }
        binding.txtFromaddress.setText(dAddress);

        if (orderItem.getOrderFlowId().equals("1") || orderItem.getOrderFlowId().equals("2")) {
            dialPhone = orderItem.getCustomerPmobile();
            binding.imgCall.setVisibility(View.VISIBLE);
        } else if (orderItem.getOrderFlowId().equals("3")
                || orderItem.getOrderFlowId().equals("4")
                || orderItem.getOrderFlowId().equals("5")) {
            dialPhone = orderItem.getCustomerDmobile();
            binding.imgCall.setVisibility(View.VISIBLE);
        } else {
            binding.imgCall.setVisibility(View.GONE);
        }

        checkAndManagePickupTimer();
    }

    private void checkAndManagePickupTimer() {
        if (binding == null || binding.layoutWaitingTimer == null || orderItem == null) return;

        String flowId = orderItem.getOrderFlowId();
        if ("2".equals(flowId)) {
            // Flow 2: Arrived at Pickup -> Run pickup timer
            startPickupWaitingTimer();
        } else if ("3".equals(flowId)) {
            // Flow 3: Driving to Drop -> Pause pickup timer and hide UI
            pausePickupWaitingTimer();
        } else if ("4".equals(flowId)) {
            // Flow 4: Arrived at Drop -> Continue / Resume previous timer
            startPickupWaitingTimer();
        } else {
            // Flow 0, 1, or completed -> Stop and clear timer
            stopAndClearPickupWaitingTimer();
        }
    }

    private void pausePickupWaitingTimer() {
        if (pickupWaitingTimerHandler != null && pickupWaitingTimerRunnable != null) {
            pickupWaitingTimerHandler.removeCallbacks(pickupWaitingTimerRunnable);
        }
        if (binding != null && binding.layoutWaitingTimer != null) {
            binding.layoutWaitingTimer.setVisibility(View.GONE);
        }
        if (orderItem != null && !TextUtils.isEmpty(orderItem.getId())) {
            String orderId = orderItem.getId();
            android.content.SharedPreferences prefs = getSharedPreferences("pickup_timer_prefs", MODE_PRIVATE);
            long pickupStart = prefs.getLong("pickup_start_" + orderId, 0);
            if (pickupStart > 0) {
                long elapsed = Math.max(0, (System.currentTimeMillis() - pickupStart) / 1000);
                prefs.edit().putLong("pickup_elapsed_" + orderId, elapsed).apply();
            }
        }
    }

    private void startPickupWaitingTimer() {
        if (binding == null || binding.layoutWaitingTimer == null || orderItem == null) return;

        String orderId = orderItem.getId();
        if (TextUtils.isEmpty(orderId)) return;

        boolean isDropWaiting = "4".equals(orderItem.getOrderFlowId());
        android.content.SharedPreferences prefs = getSharedPreferences("pickup_timer_prefs", MODE_PRIVATE);

        if (!isDropWaiting) {
            // FLOW 2: Pickup Waiting (starts fresh from arrival at pickup)
            long pickupStart = prefs.getLong("pickup_start_" + orderId, 0);
            if (pickupStart == 0) {
                pickupStart = System.currentTimeMillis();
                prefs.edit().putLong("pickup_start_" + orderId, pickupStart).apply();
            }
        } else {
            // FLOW 4: Drop Unloading (continues from paused pickup duration)
            long pausedElapsed = prefs.getLong("pickup_elapsed_" + orderId, -1);
            if (pausedElapsed == -1) {
                long pickupStart = prefs.getLong("pickup_start_" + orderId, 0);
                if (pickupStart > 0) {
                    pausedElapsed = Math.max(0, (System.currentTimeMillis() - pickupStart) / 1000);
                } else {
                    pausedElapsed = 0;
                }
                prefs.edit().putLong("pickup_elapsed_" + orderId, pausedElapsed).apply();
            }

            long dropStart = prefs.getLong("drop_start_" + orderId, 0);
            if (dropStart == 0) {
                dropStart = System.currentTimeMillis();
                prefs.edit().putLong("drop_start_" + orderId, dropStart).apply();
            }
        }

        binding.layoutWaitingTimer.setVisibility(View.VISIBLE);

        if (binding.txtWaitingTimerTitle != null) {
            binding.txtWaitingTimerTitle.setText(isDropWaiting ? "Waiting at Drop (Unloading)" : "Waiting at Pickup");
        }

        if (!TextUtils.isEmpty(orderItem.getFreeWaitingTime()) && !"0".equals(orderItem.getFreeWaitingTime())) {
            String currency = sessionManager.getStringData(SessionManager.currency);
            if (currency == null) currency = "₹";
            String chargeInfo = "Free: " + orderItem.getFreeWaitingTime() + " mins";
            binding.txtWaitingTimerInfo.setText(chargeInfo);
        } else {
            binding.txtWaitingTimerInfo.setText(isDropWaiting ? "Continuing timer for unloading" : "Timer running since arrival");
        }

        if (pickupWaitingTimerHandler == null) {
            pickupWaitingTimerHandler = new android.os.Handler(android.os.Looper.getMainLooper());
        }
        if (pickupWaitingTimerRunnable != null) {
            pickupWaitingTimerHandler.removeCallbacks(pickupWaitingTimerRunnable);
        }

        pickupWaitingTimerRunnable = new Runnable() {
            @Override
            public void run() {
                if (binding != null && binding.layoutWaitingTimer != null && orderItem != null) {
                    String currentFlow = orderItem.getOrderFlowId();
                    long totalElapsedSeconds = 0;

                    if ("2".equals(currentFlow)) {
                        long pickupStart = prefs.getLong("pickup_start_" + orderId, 0);
                        if (pickupStart > 0) {
                            totalElapsedSeconds = Math.max(0, (System.currentTimeMillis() - pickupStart) / 1000);
                        }
                    } else if ("4".equals(currentFlow)) {
                        long pausedElapsed = prefs.getLong("pickup_elapsed_" + orderId, 0);
                        long dropStart = prefs.getLong("drop_start_" + orderId, 0);
                        long dropElapsed = (dropStart > 0) ? Math.max(0, (System.currentTimeMillis() - dropStart) / 1000) : 0;
                        totalElapsedSeconds = pausedElapsed + dropElapsed;
                    } else {
                        pausePickupWaitingTimer();
                        return;
                    }

                    long hours = totalElapsedSeconds / 3600;
                    long minutes = (totalElapsedSeconds % 3600) / 60;
                    long seconds = totalElapsedSeconds % 60;

                    String timeStr;
                    if (hours > 0) {
                        timeStr = String.format(java.util.Locale.getDefault(), "%02d:%02d:%02d", hours, minutes, seconds);
                    } else {
                        timeStr = String.format(java.util.Locale.getDefault(), "%02d:%02d", minutes, seconds);
                    }

                    binding.txtWaitingTimerValue.setText(timeStr);
                    pickupWaitingTimerHandler.postDelayed(this, 1000);
                }
            }
        };

        pickupWaitingTimerHandler.post(pickupWaitingTimerRunnable);
    }

    private void stopAndClearPickupWaitingTimer() {
        if (pickupWaitingTimerHandler != null && pickupWaitingTimerRunnable != null) {
            pickupWaitingTimerHandler.removeCallbacks(pickupWaitingTimerRunnable);
        }
        if (binding != null && binding.layoutWaitingTimer != null) {
            binding.layoutWaitingTimer.setVisibility(View.GONE);
        }
        if (orderItem != null && !TextUtils.isEmpty(orderItem.getId())) {
            try {
                getSharedPreferences("pickup_timer_prefs", MODE_PRIVATE)
                        .edit()
                        .remove("pickup_start_" + orderItem.getId())
                        .remove("pickup_elapsed_" + orderItem.getId())
                        .remove("drop_start_" + orderItem.getId())
                        .remove("arrived_time_" + orderItem.getId())
                        .remove("arrived_drop_time_" + orderItem.getId())
                        .apply();
            } catch (Exception ignored) {}
        }
    }

    // ------------------------------------------------ CLICKS
    private void setupClicks() {

        binding.imgBack.setOnClickListener(v -> onBackPressed());

        if (binding.imgRefresh != null) {
            binding.imgRefresh.setOnClickListener(v -> {
                finish();
                startActivity(getIntent());
                overridePendingTransition(0, 0);
            });
        }

        binding.imgCall.setOnClickListener(v -> {
            if (!TextUtils.isEmpty(dialPhone)) {
                Intent intent = new Intent(Intent.ACTION_DIAL);
                intent.setData(Uri.parse("tel:" + dialPhone));
                startActivity(intent);
            }
        });

        binding.imgMsg.setOnClickListener(v -> {
            Intent i = new Intent(this, ChatActivityUser.class);
            i.putExtra("receiverName", orderItem.getDropName());
            i.putExtra("receiverId", orderItem.getOrderUserid());
            startActivity(i);
        });

        binding.txtReject.setOnClickListener(v -> {
            showRejectSheet();
        });

        binding.txtConfirm.setOnClickListener(v -> {
            if ("arrived".equalsIgnoreCase(status)) {
                showOtpDialog();
            } else if ("pickup".equalsIgnoreCase(status)) {
                orderstatus(status, "");
            } else if ("arrived_drop".equalsIgnoreCase(status)) {
                orderstatus(status, "");
            } else {
                orderstatus(status, "");
            }
        });

        binding.btnStartDrive.setOnClickListener(v -> {
            if (orderItem != null) {
                double destLat = 0.0;
                double destLng = 0.0;
                
                if ("0".equals(orderItem.getOrderFlowId()) || "1".equals(orderItem.getOrderFlowId()) || "2".equals(orderItem.getOrderFlowId())) {
                    destLat = orderItem.getPlat();
                    destLng = orderItem.getPlong();
                } else {
                    destLat = orderItem.getDlat();
                    destLng = orderItem.getDlong();
                }
                
                if (destLat != 0.0 && destLng != 0.0) {
                    Uri gmmIntentUri = Uri.parse("google.navigation:q=" + destLat + "," + destLng);
                    Intent mapIntent = new Intent(Intent.ACTION_VIEW, gmmIntentUri);
                    mapIntent.setPackage("com.google.android.apps.maps");
                    try {
                        startActivity(mapIntent);
                    } catch (Exception e) {
                        Toast.makeText(OrderDetailsActivity.this, "Google Maps is not installed", Toast.LENGTH_SHORT).show();
                        Uri fallbackUri = Uri.parse("https://www.google.com/maps/dir/?api=1&destination=" + destLat + "," + destLng);
                        startActivity(new Intent(Intent.ACTION_VIEW, fallbackUri));
                    }
                }
            }
        });
    }

    // ------------------------------------------------ MAP
    private void showOtpDialog() {
        android.app.Dialog dialog = new android.app.Dialog(this);
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_enter_otp);

        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            dialog.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        }

        EditText edOtp = dialog.findViewById(R.id.ed_otp);
        TextView txtSubmit = dialog.findViewById(R.id.txt_submit_otp);
        TextView txtCancel = dialog.findViewById(R.id.txt_cancel_otp);

        txtCancel.setOnClickListener(v -> dialog.dismiss());

        txtSubmit.setOnClickListener(v -> {
            String otp = edOtp.getText().toString().trim();
            if (TextUtils.isEmpty(otp)) {
                edOtp.setError("Enter OTP");
                return;
            }

            // Call API
            custPrograssbar.prograssCreate(this);
            JSONObject jsonObject = new JSONObject();
            try {
                jsonObject.put("oid", orderItem.getId());
                jsonObject.put("otp", otp);
            } catch (JSONException e) {
                e.printStackTrace();
            }

            RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            Call<JsonObject> call = APIClient.getInterface().checkArrivedOtp(bodyRequest);
            call.enqueue(new retrofit2.Callback<JsonObject>() {
                @Override
                public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                    custPrograssbar.closePrograssBar();
                    if (response.isSuccessful() && response.body() != null) {
                        try {
                            JsonObject jsonResponse = response.body();
                            boolean isSuccess = false;
                            if (jsonResponse.has("Result")) {
                                com.google.gson.JsonElement resElem = jsonResponse.get("Result");
                                if (resElem.isJsonPrimitive() && resElem.getAsJsonPrimitive().isBoolean()) {
                                    isSuccess = resElem.getAsBoolean();
                                } else {
                                    isSuccess = "true".equalsIgnoreCase(resElem.getAsString());
                                }
                            }
                            
                            if (isSuccess) {
                                dialog.dismiss();
                                orderstatus(status, ""); // Proceed with arrived status
                            } else {
                                String msg = jsonResponse.has("ResponseMsg") ? jsonResponse.get("ResponseMsg").getAsString() : "Invalid OTP";
                                Toast.makeText(OrderDetailsActivity.this, msg, Toast.LENGTH_SHORT).show();
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                            Toast.makeText(OrderDetailsActivity.this, "Error processing response", Toast.LENGTH_SHORT).show();
                        }
                    } else {
                        Toast.makeText(OrderDetailsActivity.this, "Server error", Toast.LENGTH_SHORT).show();
                    }
                }

                @Override
                public void onFailure(Call<JsonObject> call, Throwable t) {
                    custPrograssbar.closePrograssBar();
                    Toast.makeText(OrderDetailsActivity.this, "Network error", Toast.LENGTH_SHORT).show();
                }
            });
        });

        dialog.show();
    }

    private void checkPickupChargeAndShowDialog() {
        custPrograssbar.prograssCreate(this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("oid", orderItem.getId());
            jsonObject.put("rid", riderData.getId());
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().checkAmount(bodyRequest);
        call.enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    try {
                        JsonObject jsonResponse = response.body();
                        boolean isSuccess = false;
                        if (jsonResponse.has("Result")) {
                            com.google.gson.JsonElement resElem = jsonResponse.get("Result");
                            if (resElem.isJsonPrimitive() && resElem.getAsJsonPrimitive().isBoolean()) {
                                isSuccess = resElem.getAsBoolean();
                            } else {
                                isSuccess = "true".equalsIgnoreCase(resElem.getAsString());
                            }
                        }

                        if (isSuccess && jsonResponse.has("pickup_charge")) {
                            double charge = jsonResponse.get("pickup_charge").getAsDouble();
                            showPickupConfirmationDialog(charge);
                        } else {
                            String msg = jsonResponse.has("ResponseMsg") ? jsonResponse.get("ResponseMsg").getAsString() : "Failed to fetch charge";
                            Toast.makeText(OrderDetailsActivity.this, msg, Toast.LENGTH_SHORT).show();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        Toast.makeText(OrderDetailsActivity.this, "Error processing response", Toast.LENGTH_SHORT).show();
                    }
                } else {
                    Toast.makeText(OrderDetailsActivity.this, "Server error", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(OrderDetailsActivity.this, "Network error", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void showPickupConfirmationDialog(double charge) {
        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(this);
        builder.setTitle("Pickup Confirmation");
        String currency = sessionManager.getStringData(SessionManager.currency);
        builder.setMessage("Have you received the pickup charge of " + currency + charge + "?");
        
        builder.setPositiveButton("YES", (dialog, which) -> {
            dialog.dismiss();
            orderstatus(status, "");
        });
        
        builder.setNegativeButton("NO", (dialog, which) -> {
            dialog.dismiss();
        });
        
        android.app.AlertDialog dialog = builder.create();
        dialog.setCancelable(false);
        dialog.show();
    }

    private void setupMap() {
        if (mMap != null) {
            updateLocationPath();
            return;
        }
        SupportMapFragment mapFragment = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
        if (mapFragment != null) {
            mapFragment.getMapAsync(this);
        }
    }

    @Override
    public void onMapReady(@NonNull GoogleMap googleMap) {
        mMap = googleMap;
        updateLocationPath();
    }

    @Override
    public void onTaskDone(Object... values) {
        if (currentPolyline != null)
            currentPolyline.remove();
        currentPolyline = mMap.addPolyline((PolylineOptions) values[0]);
    }

    // ------------------------------------------------ PATH
    private void updateLocationPath() {
        if (mMap == null || orderItem == null) {
            return;
        }

        mMap.clear();

        double driverLat = 0.0;
        double driverLng = 0.0;
        try {
            android.location.Location loc = LocationUpdateService.getLocation();
            if (loc != null && loc.getLatitude() != 0.0 && loc.getLongitude() != 0.0) {
                driverLat = loc.getLatitude();
                driverLng = loc.getLongitude();
            }
        } catch (Exception ignored) {}

        LatLng pickupLoc = new LatLng(orderItem.getPlat(), orderItem.getPlong());
        LatLng dropLoc = new LatLng(orderItem.getDlat(), orderItem.getDlong());

        switch (orderItem.getOrderFlowId()) {
            case "0":
                status = "accept";
                binding.txtConfirm.setText(getString(R.string.confirm_order_btn));
                binding.txtReject.setText(getString(R.string.reject_btn));
                binding.txtReject.setVisibility(View.VISIBLE);
                break;

            case "1":
                status = "arrived";
                binding.txtConfirm.setText("ARRIVED ORDER");
                binding.txtReject.setText(getString(R.string.cancel));
                binding.txtReject.setVisibility(View.VISIBLE);
                break;

            case "2":
                status = "pickup";
                binding.txtConfirm.setText(getString(R.string.pickup_complete));
                binding.txtReject.setText(getString(R.string.cancel));
                binding.txtReject.setVisibility(View.VISIBLE);
                break;

            case "3":
                status = "arrived_drop";
                binding.txtConfirm.setText("ARRIVED DROP");
                binding.txtReject.setVisibility(View.GONE);
                break;

            case "4":
                status = "complete";
                binding.txtConfirm.setText("DROP COMPLETE");
                binding.txtReject.setVisibility(View.GONE);
                break;

            default:
                break;
        }

        // 1. Always add Pickup Marker (Green)
        if (pickupLoc.latitude != 0.0 && pickupLoc.longitude != 0.0) {
            MarkerOptions p1 = new MarkerOptions()
                    .position(pickupLoc)
                    .title("Pickup: " + (orderItem.getPickName() != null ? orderItem.getPickName() : "Pickup Location"))
                    .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_GREEN));
            mMap.addMarker(p1);
        }

        // 2. Always add Drop Marker (Red)
        if (dropLoc.latitude != 0.0 && dropLoc.longitude != 0.0) {
            MarkerOptions p2 = new MarkerOptions()
                    .position(dropLoc)
                    .title("Drop: " + (orderItem.getDropType() != null ? orderItem.getDropType() : "Drop Location"))
                    .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_RED));
            mMap.addMarker(p2);
        }

        // 3. Add Driver Live Location Marker (Blue) if available
        if (driverLat != 0.0 && driverLng != 0.0) {
            LatLng driverLoc = new LatLng(driverLat, driverLng);
            MarkerOptions driverMarker = new MarkerOptions()
                    .position(driverLoc)
                    .title("My Location")
                    .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE));
            mMap.addMarker(driverMarker);
        }

        // 4. Draw Polyline between Pickup & Drop
        if (pickupLoc.latitude != 0.0 && pickupLoc.longitude != 0.0 && dropLoc.latitude != 0.0 && dropLoc.longitude != 0.0) {
            if (Math.abs(pickupLoc.latitude - dropLoc.latitude) > 0.0001 || Math.abs(pickupLoc.longitude - dropLoc.longitude) > 0.0001) {
                new FetchURL(this).execute(getUrl(pickupLoc, dropLoc, "driving"), "driving");
            }
        }

        // 5. Adjust Camera to show both Pickup and Drop (and Driver if available)
        try {
            com.google.android.gms.maps.model.LatLngBounds.Builder builder = new com.google.android.gms.maps.model.LatLngBounds.Builder();
            boolean hasPoints = false;

            if (pickupLoc.latitude != 0.0 && pickupLoc.longitude != 0.0) {
                builder.include(pickupLoc);
                hasPoints = true;
            }
            if (dropLoc.latitude != 0.0 && dropLoc.longitude != 0.0) {
                builder.include(dropLoc);
                hasPoints = true;
            }
            if (driverLat != 0.0 && driverLng != 0.0) {
                builder.include(new LatLng(driverLat, driverLng));
                hasPoints = true;
            }

            if (hasPoints) {
                com.google.android.gms.maps.model.LatLngBounds bounds = builder.build();
                mMap.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds, 140));
            }
        } catch (Exception e) {
            if (pickupLoc.latitude != 0.0 && pickupLoc.longitude != 0.0) {
                mMap.animateCamera(CameraUpdateFactory.newLatLngZoom(pickupLoc, 14));
            }
        }
    }

    private String getUrl(LatLng o, LatLng d, String mode) {
        return "https://maps.googleapis.com/maps/api/directions/json?"
                + "origin=" + o.latitude + "," + o.longitude
                + "&destination=" + d.latitude + "," + d.longitude
                + "&mode=" + mode
                + "&key=" + getString(R.string.google_maps_key);
    }

    // ------------------------------------------------ API
    private void orderstatus(String status, String comment) {
        lastAction = status;
        if ("pickup".equalsIgnoreCase(status)) {
            pausePickupWaitingTimer();
        }

        String nodeStatus;
        if ("arrived".equalsIgnoreCase(status)) {
            nodeStatus = "arrived";
        } else if ("pickup".equalsIgnoreCase(status)) {
            nodeStatus = "pickup";
        } else if ("complete".equalsIgnoreCase(status)) {
            nodeStatus = "complete";
        } else {
            // "arrived_drop" (and any other UI-only transition) has no Node-side
            // status — nothing to send. See plan Global Constraints.
            Log.d("OrderDetailsActivity", "orderstatus: '" + status + "' is local-UI-only, not sent to backend");
            advanceLocalOrderFlow();
            return;
        }

        com.shifter.driver.socket.NodeSocketManager manager = com.shifter.driver.socket.NodeSocketManager.getInstance();
        io.socket.client.Socket socket = manager.getSocket();
        if (socket == null || !manager.isConnected()) {
            Log.e("OrderDetailsActivity", "orderstatus: socket not connected");
            Toast.makeText(this, "Not connected. Please check your connection and try again.", Toast.LENGTH_SHORT).show();
            return;
        }

        custPrograssbar.prograssCreate(this);

        io.socket.emitter.Emitter.Listener ackListener = new io.socket.emitter.Emitter.Listener() {
            @Override
            public void call(Object... args) {
                socket.off("order:status_update:ack", this);
                runOnUiThread(() -> {
                    custPrograssbar.closePrograssBar();
                    if (args.length == 0 || !(args[0] instanceof org.json.JSONObject)) {
                        return;
                    }
                    org.json.JSONObject ack = (org.json.JSONObject) args[0];
                    boolean isSuccess = ack.optBoolean("Result", false);
                    String message = ack.optString("msg", "");
                    if (isSuccess) {
                        Toast.makeText(OrderDetailsActivity.this, "Status updated successfully", Toast.LENGTH_SHORT).show();
                        if ("complete".equalsIgnoreCase(status)) {
                            stopAndClearPickupWaitingTimer();
                            fetchCompletedOrderAndShowDialog(orderItem != null ? orderItem.getId() : "");
                        } else {
                            advanceLocalOrderFlow();
                        }
                    } else {
                        Toast.makeText(OrderDetailsActivity.this, "Failed to update status: " + message, Toast.LENGTH_SHORT).show();
                    }
                });
            }
        };
        socket.on("order:status_update:ack", ackListener);

        org.json.JSONObject payload = new org.json.JSONObject();
        try {
            payload.put("rider_id", riderData.getId());
            payload.put("order_id", orderItem.getId());
            payload.put("status", nodeStatus);
        } catch (org.json.JSONException e) {
            Log.e("OrderDetailsActivity", "Error building order:status_update payload", e);
            custPrograssbar.closePrograssBar();
            return;
        }
        socket.emit("order:status_update", payload);
    }

    /**
     * Advances the local orderItem to the next flow step and redraws the UI —
     * the socket ack carries no equivalent of the legacy REST response's
     * "Next_step" field, so this mirrors what callback(result,"1") used to do
     * by deriving the next step from lastAction via mapNextStepToFlowId("").
     */
    private void advanceLocalOrderFlow() {
        HomeFragment.isUpdateHome = true;
        isUpdate = true;

        String nextFlowId = mapNextStepToFlowId("");
        orderItem = new PDOrderItem(
                orderItem.getId(),
                nextFlowId,
                orderItem.getPickName(),
                orderItem.getDropName(),
                orderItem.getCustomerPaddress(),
                orderItem.getCustomerDaddress(),
                orderItem.getCustomerPmobile(),
                orderItem.getCustomerDmobile(),
                orderItem.getPickType(),
                orderItem.getDropType(),
                orderItem.getPlat(),
                orderItem.getPlong(),
                orderItem.getDlat(),
                orderItem.getDlong(),
                orderItem.getTotal(),
                orderItem.getDistance(),
                orderItem.getTimeDuration(),
                orderItem.getOrderDate(),
                orderItem.getDescription(),
                orderItem.getStatus(),
                orderItem.getOrderUserid(),
                orderItem.getLoadingCharge(),
                orderItem.getUnloadingCharge(),
                orderItem.getServiceCharge(),
                orderItem.getWatingCharge(),
                orderItem.getFreeWaitingTime(),
                orderItem.getRadiusRange(),
                orderItem.getRadiusCharge(),
                orderItem.getPaymentStatus()
        );

        new SessionManager(this).setActiveOrder(orderItem);

        setupUI();
        setupClicks();
        setupMap();
    }

    private void orderCancel(String status, String comment) {
        lastAction = status;
        custPrograssbar.prograssCreate(this);

        JSONObject json = new JSONObject();
        try {
            json.put("order_id", orderItem.getId());
            json.put("rider_id", riderData.getId());
            json.put("comment", comment);
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(
                MediaType.parse("application/json"), json.toString());

        Call<JsonObject> call = APIClient.getInterface().orderCancel(body);

        GetResult result = new GetResult();
        result.setMyListener(this);
        result.callForLogin(call, "1");
    }


    @Override
    public void callback(JsonObject result, String callNo) {
        custPrograssbar.closePrograssBar();

        if ("1".equals(callNo)) {
            try {
                // device_match check — order_status_change.php / cancel_order.php
                if (result.has("device_match") && !result.get("device_match").getAsBoolean()) {
                    Toast.makeText(this, "Logged in from another device", Toast.LENGTH_LONG).show();
                    logoutUser();
                    return;
                }

                RestResponse res = new Gson().fromJson(result, RestResponse.class);

                // Null-safe message
                String msg = (res != null && res.getResponseMsg() != null && !res.getResponseMsg().isEmpty())
                        ? res.getResponseMsg() : "";

                if (res != null && "true".equalsIgnoreCase(res.getResult())) {
                    HomeFragment.isUpdateHome = true;
                    isUpdate = true;
                    if (!msg.isEmpty()) {
                        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
                    }

                    String orderStatus = "";
                    try {
                        if (result.has("order_status") && !result.get("order_status").isJsonNull()) {
                            orderStatus = result.get("order_status").getAsString();
                        }
                    } catch (Exception ignored) {}

                    if ("CANCEL".equalsIgnoreCase(orderStatus)) {
                        new SessionManager(this).clearActiveOrder();
                        new android.app.AlertDialog.Builder(this)
                            .setTitle("Order Canceled")
                            .setMessage("Your order is canceled")
                            .setCancelable(false)
                            .setPositiveButton("OK", (dialog, which) -> {
                                dialog.dismiss();
                                Intent intent = new Intent(OrderDetailsActivity.this, HomeActivity.class);
                                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                                startActivity(intent);
                                finish();
                            })
                            .show();
                        return;
                    }

                    if ("complete".equalsIgnoreCase(lastAction)) {
                        stopAndClearPickupWaitingTimer();
                        fetchCompletedOrderAndShowDialog(orderItem != null ? orderItem.getId() : "");
                    } else if ("cancel".equalsIgnoreCase(lastAction) || "reject".equalsIgnoreCase(lastAction)) {
                        navigateToHomeAndFinish("");
                    } else {
                        // Next_step field se next orderFlowId determine karo
                        // API response: {"Next_step":"Deliverey"} ya {"Next_step":"Pickup"}
                        String nextStep = "";
                        try {
                            if (result.has("Next_step") && !result.get("Next_step").isJsonNull()) {
                                nextStep = result.get("Next_step").getAsString();
                            }
                        } catch (Exception ignored) {}

                        String nextFlowId = mapNextStepToFlowId(nextStep);
                        Log.d("OrderDetails", "Next_step=" + nextStep + " → orderFlowId=" + nextFlowId);

                        // Existing orderItem ke saare data ke saath naya item banao — sirf flowId change
                        orderItem = new PDOrderItem(
                                orderItem.getId(),
                                nextFlowId,
                                orderItem.getPickName(),
                                orderItem.getDropName(),
                                orderItem.getCustomerPaddress(),
                                orderItem.getCustomerDaddress(),
                                orderItem.getCustomerPmobile(),
                                orderItem.getCustomerDmobile(),
                                orderItem.getPickType(),
                                orderItem.getDropType(),
                                orderItem.getPlat(),
                                orderItem.getPlong(),
                                orderItem.getDlat(),
                                orderItem.getDlong(),
                                orderItem.getTotal(),
                                orderItem.getDistance(),
                                orderItem.getTimeDuration(),
                                orderItem.getOrderDate(),
                                orderItem.getDescription(),
                                orderItem.getStatus(),
                                orderItem.getOrderUserid(),
                                orderItem.getLoadingCharge(),
                                orderItem.getUnloadingCharge(),
                                orderItem.getServiceCharge(),
                                orderItem.getWatingCharge(),
                                orderItem.getFreeWaitingTime(),
                                orderItem.getRadiusRange(),
                                orderItem.getRadiusCharge(),
                                orderItem.getPaymentStatus()
                        );

                        // Save updated order with next flow step
                        new SessionManager(this).setActiveOrder(orderItem);

                        // UI aur Map seedha refresh — koi extra API call nahi
                        setupUI();
                        setupClicks();
                        setupMap();
                    }
                } else {
                    String failMsg = msg.isEmpty() ? "Order action failed. Please try again." : msg;
                    Toast.makeText(this, failMsg, Toast.LENGTH_SHORT).show();
                }
            } catch (Exception e) {
                e.printStackTrace();
                Toast.makeText(this, "Error processing response. Please try again.", Toast.LENGTH_SHORT).show();
            }
        }
    }

    /**
     * Next_step string ko orderFlowId mein convert karo
     * "arrived"      → "1"
     * "pickup"       → "2"
     * "arrived_drop" → "3"
     * "delivery"     → "4"
     */
    private String mapNextStepToFlowId(String nextStep) {
        if (nextStep == null || nextStep.isEmpty()) {
            if ("accept".equalsIgnoreCase(lastAction)) return "1";
            if ("arrived".equalsIgnoreCase(lastAction)) return "2";
            if ("pickup".equalsIgnoreCase(lastAction)) return "3";
            if ("arrived_drop".equalsIgnoreCase(lastAction)) return "4";
            if ("complete".equalsIgnoreCase(lastAction)) return "4";
            return orderItem.getOrderFlowId();
        }
        switch (nextStep.trim().toLowerCase()) {
            case "arrived":
                return "1";
            case "pickup":
                return "2";
            case "arrived_drop":
            case "arrived drop":
            case "arriveddrop":
                return "3";
            case "deliverey":   // server ka typo — "Deliverey"
            case "delivery":
            case "complete":
            case "drop":
                return "4";
            default:
                if ("accept".equalsIgnoreCase(lastAction)) return "1";
                if ("arrived".equalsIgnoreCase(lastAction)) return "2";
                if ("pickup".equalsIgnoreCase(lastAction)) return "3";
                if ("arrived_drop".equalsIgnoreCase(lastAction)) return "4";
                Log.w("OrderDetails", "Unknown Next_step: " + nextStep + " — keeping current flowId");
                return orderItem.getOrderFlowId();
        }
    }



    // ------------------------------------------------ REJECT SHEET
    private void showRejectSheet() {
        custPrograssbar.prograssCreate(this);

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("type", "driver");
        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        retrofit2.Call<JsonObject> call = APIClient.getInterface().getCancelReasons(bodyRequest);
        call.enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(retrofit2.Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    try {
                        JsonObject jsonResponse = response.body();
                        if (jsonResponse.has("Result") && "true".equalsIgnoreCase(jsonResponse.get("Result").getAsString())) {
                            com.google.gson.JsonArray reasonList = jsonResponse.getAsJsonArray("reason_list");
                            java.util.List<String> reasons = new java.util.ArrayList<>();
                            for (com.google.gson.JsonElement element : reasonList) {
                                JsonObject obj = element.getAsJsonObject();
                                if (obj.has("reason")) {
                                    reasons.add(obj.get("reason").getAsString());
                                }
                            }
                            if (!reasons.contains("Other")) {
                                reasons.add("Other");
                            }
                            openRejectDialog(reasons);
                            return;
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
                fallbackRejectSheet();
            }

            @Override
            public void onFailure(retrofit2.Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                fallbackRejectSheet();
            }
        });
    }

    private void fallbackRejectSheet() {
        java.util.List<String> reasons = new java.util.ArrayList<>(java.util.Arrays.asList(
                "Earning too low",
                "Location too far",
                "Store not open",
                "Cant find location",
                "Other"
        ));
        openRejectDialog(reasons);
    }

    private void openRejectDialog(java.util.List<String> reasons) {

        BottomSheetDialog dialog = new BottomSheetDialog(this);
        View view = getLayoutInflater().inflate(R.layout.custome_rejectorder, null);
        dialog.setContentView(view);

        RadioGroup group = view.findViewById(R.id.radiogroup);
        EditText edOther = view.findViewById(R.id.ed_other);
        TextView btn = view.findViewById(R.id.txt_continue);

        for (String r : reasons) {
            RadioButton rb = new RadioButton(this);
            rb.setText(r);
            rb.setPadding(20, 20, 20, 20);
            group.addView(rb);
        }

        group.setOnCheckedChangeListener((group1, checkedId) -> {
            RadioButton rb = group1.findViewById(checkedId);
            if (rb != null && rb.getText().toString().equalsIgnoreCase("Other")) {
                edOther.setVisibility(View.VISIBLE);
            } else {
                edOther.setVisibility(View.GONE);
                edOther.setText("");
                edOther.setError(null);
            }
        });

        btn.setOnClickListener(v -> {
            int id = group.getCheckedRadioButtonId();
            if (id == -1) {
                Toast.makeText(this, "Select reason", Toast.LENGTH_SHORT).show();
                return;
            }

            RadioButton rb = group.findViewById(id);
            String reasonToSubmit;
            if (rb.getText().toString().equalsIgnoreCase("Other")) {
                if (TextUtils.isEmpty(edOther.getText().toString().trim())) {
                    edOther.setError("Enter reason");
                    return;
                }
                reasonToSubmit = edOther.getText().toString().trim();
            } else {
                reasonToSubmit = rb.getText().toString();
            }

            orderCancel("cancel", reasonToSubmit);
            dialog.dismiss();
        });

        dialog.show();
    }

    private void logoutUser() {
        try {
            stopService(new Intent(this, com.shifter.driver.locationservice.LocationUpdateService.class));
        } catch (Exception e) {
            e.printStackTrace();
        }
        sessionManager.logoutUser();
        Intent intent = new Intent(this, com.shifter.driver.activity.LoginActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    private void setRowVisibilityAndValue(View row, android.widget.TextView txtView, String currency, String valueStr) {
        if (row == null || txtView == null) return;
        if (valueStr == null || valueStr.trim().isEmpty() || "null".equalsIgnoreCase(valueStr.trim())) {
            row.setVisibility(View.GONE);
        } else {
            row.setVisibility(View.VISIBLE);
            double val = parseDoubleSafe(valueStr);
            txtView.setText(currency + String.format(java.util.Locale.getDefault(), "%.2f", val));
        }
    }

    private double parseDoubleSafe(String val) {
        if (val == null || val.trim().isEmpty()) return 0.0;
        try {
            return Double.parseDouble(val.trim());
        } catch (Exception e) {
            return 0.0;
        }
    }

    private void fetchCompletedOrderAndShowDialog(String orderId) {
        custPrograssbar.prograssCreate(this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("type", "past");
            jsonObject.put("rid", riderData.getId());
        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().pkgHistory(bodyRequest);
        call.enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                PDOrderItem completedItem = null;
                try {
                    if (response.isSuccessful() && response.body() != null) {
                        PDOrder pdOrder = new Gson().fromJson(response.body(), PDOrder.class);
                        if (pdOrder != null && pdOrder.getOrderHistory() != null) {
                            for (PDOrderItem item : pdOrder.getOrderHistory()) {
                                if (item.getId() != null && item.getId().equals(orderId)) {
                                    completedItem = item;
                                    break;
                                }
                            }
                            if (completedItem == null && !pdOrder.getOrderHistory().isEmpty()) {
                                completedItem = pdOrder.getOrderHistory().get(0);
                            }
                        }
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                }

                if (completedItem == null) {
                    completedItem = orderItem;
                }
                showCompletedOrderDialog(completedItem);
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                showCompletedOrderDialog(orderItem);
            }
        });
    }

    private void showCompletedOrderDialog(PDOrderItem orderItem) {
        if (isFinishing() || isDestroyed() || orderItem == null) {
            navigateToHomeAndFinish("");
            return;
        }

        final android.app.Dialog dialog = new android.app.Dialog(this);
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_completed_order_details);

        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.WRAP_CONTENT);
            dialog.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        }

        dialog.setCancelable(false);

        String currency = sessionManager.getStringData(SessionManager.currency);
        if (currency == null || currency.trim().isEmpty()) currency = "₹";

        // 1. FARE BREAKDOWN
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_minimum_charge), dialog.findViewById(R.id.txt_minimum_charge), currency, orderItem.getMinimumCharge());
        
        String actualPickup = orderItem.getActualPickupCharge() != null ? orderItem.getActualPickupCharge() : orderItem.getPickupCharge();
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_actual_pickup_charge), dialog.findViewById(R.id.txt_actual_pickup_charge), currency, actualPickup);
        
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_pickup_to_drop_charge), dialog.findViewById(R.id.txt_pickup_to_drop_charge), currency, orderItem.getPickupToDropCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_add_stop_charge), dialog.findViewById(R.id.txt_add_stop_charge), currency, orderItem.getAddStopCharge());
        
        String waitingChg = orderItem.getExtraWaitingTimeCharge() != null ? orderItem.getExtraWaitingTimeCharge() : orderItem.getWatingCharge();
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_waiting_charge), dialog.findViewById(R.id.txt_waiting_charge), currency, waitingChg);
        
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_night_charge), dialog.findViewById(R.id.txt_night_charge), currency, orderItem.getNightCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_loading_charge), dialog.findViewById(R.id.txt_loading_charge), currency, orderItem.getLoadingCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_unloading_charge), dialog.findViewById(R.id.txt_unloading_charge), currency, orderItem.getUnloadingCharge());

        String finalFareStr = orderItem.getFinalFareAmount() != null ? orderItem.getFinalFareAmount() : (orderItem.getTotalAmountByUser() != null ? orderItem.getTotalAmountByUser() : orderItem.getTotal());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_final_fare), dialog.findViewById(R.id.txt_final_fare_amount), currency, finalFareStr);

        // 2. DEDUCTIONS
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_commission), dialog.findViewById(R.id.txt_commission), currency, orderItem.getCommission());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_per_trip_charge), dialog.findViewById(R.id.txt_per_trip_charge), currency, orderItem.getPerTripCharge());

        String totalDeductionsStr = orderItem.getTotalDeductions();
        if (totalDeductionsStr == null && (orderItem.getCommission() != null || orderItem.getPerTripCharge() != null)) {
            double comm = parseDoubleSafe(orderItem.getCommission());
            double tripChg = parseDoubleSafe(orderItem.getPerTripCharge());
            totalDeductionsStr = String.valueOf(comm + tripChg);
        }
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_total_deductions), dialog.findViewById(R.id.txt_total_deductions), currency, totalDeductionsStr);

        String driverEarningStr = orderItem.getDriverTotalEarning() != null ? orderItem.getDriverTotalEarning() : orderItem.getTotal();
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_driver_earning_strip), dialog.findViewById(R.id.txt_driver_total_earning), currency, driverEarningStr);

        // 3. PAYMENT BY USER
        String totalAmountByUserStr = orderItem.getTotalAmountByUser() != null ? orderItem.getTotalAmountByUser() : finalFareStr;
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_total_amount_by_user), dialog.findViewById(R.id.txt_total_amount_by_user), currency, totalAmountByUserStr);

        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_advance_payment), dialog.findViewById(R.id.txt_advance_payment), currency, orderItem.getAdvancePayment());

        String cashToCollectStr = orderItem.getCashToCollect();
        if (cashToCollectStr == null && totalAmountByUserStr != null) {
            double totalVal = parseDoubleSafe(totalAmountByUserStr);
            double advVal = parseDoubleSafe(orderItem.getAdvancePayment());
            cashToCollectStr = String.valueOf(Math.max(0, totalVal - advVal));
        }
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_cash_to_collect_strip), dialog.findViewById(R.id.txt_cash_to_collect), currency, cashToCollectStr);

        // 4. FINAL SETTLEMENT (TO DRIVER)
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_settlement_earning), dialog.findViewById(R.id.txt_settlement_earning), currency, driverEarningStr);

        String cashCollectedStr = orderItem.getCashCollectedFromUser() != null ? orderItem.getCashCollectedFromUser() : cashToCollectStr;
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_settlement_cash), dialog.findViewById(R.id.txt_settlement_cash), currency, cashCollectedStr);

        String walletAdjStr = orderItem.getWalletAdjustment();
        if (walletAdjStr == null && driverEarningStr != null && cashCollectedStr != null) {
            double earnVal = parseDoubleSafe(driverEarningStr);
            double collVal = parseDoubleSafe(cashCollectedStr);
            walletAdjStr = String.valueOf(Math.abs(earnVal - collVal));
        }
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_wallet_adjustment_strip), dialog.findViewById(R.id.txt_wallet_adjustment), currency, walletAdjStr);

        String note = orderItem.getSettlementNote() != null ? orderItem.getSettlementNote() : orderItem.getWalletAdjustmentNote();
        View noteBox = dialog.findViewById(R.id.layout_settlement_note_box);
        android.widget.TextView txtSettlementNote = dialog.findViewById(R.id.txt_settlement_note);
        if (noteBox != null && txtSettlementNote != null) {
            if (note != null && !note.trim().isEmpty() && !"null".equalsIgnoreCase(note.trim())) {
                noteBox.setVisibility(View.VISIBLE);
                txtSettlementNote.setText(note);
            } else {
                noteBox.setVisibility(View.GONE);
            }
        }

        // Close / Action listeners (Only for OrderDetailsActivity)
        View btnCloseHeader = dialog.findViewById(R.id.btn_close_header);
        if (btnCloseHeader != null) {
            btnCloseHeader.setVisibility(View.GONE); // Hide close (X) icon
        }

        com.google.android.material.button.MaterialButton btnAction = dialog.findViewById(R.id.btn_close_dialog);
        if (btnAction != null) {
            double cashVal = parseDoubleSafe(cashToCollectStr);
            String formattedCash = currency + String.format(java.util.Locale.getDefault(), "%.2f", cashVal);
            String btnText = "Cash to Collect from User: " + formattedCash;
            btnAction.setText(btnText);
            btnAction.setBackgroundTintList(android.content.res.ColorStateList.valueOf(android.graphics.Color.parseColor("#15803D")));
            btnAction.setTextSize(android.util.TypedValue.COMPLEX_UNIT_SP, 14);
            btnAction.setTypeface(null, android.graphics.Typeface.BOLD);
            btnAction.setOnClickListener(v -> {
                showCashCollectionConfirmationDialog(dialog, formattedCash);
            });
        }

        dialog.show();
    }

    private void showCashCollectionConfirmationDialog(android.app.Dialog parentDialog, String formattedCash) {
        new android.app.AlertDialog.Builder(this)
                .setTitle("Confirm Cash Collection")
                .setMessage("Are you sure you have collected " + formattedCash + " cash from the user and want to complete this trip?")
                .setCancelable(false)
                .setPositiveButton("YES, COLLECTED", (confirmDialog, which) -> {
                    confirmDialog.dismiss();
                    if (parentDialog != null && parentDialog.isShowing()) {
                        parentDialog.dismiss();
                    }
                    navigateToHomeAndFinish("");
                })
                .setNegativeButton("NO", (confirmDialog, which) -> {
                    confirmDialog.dismiss();
                })
                .show();
    }

    @Override
    public void onBackPressed() {
        // Back button disable
        if (isWaitingForPayment) {
            Toast.makeText(this, "Please wait for payment or cancel the order.", Toast.LENGTH_SHORT).show();
        } else {
            Toast.makeText(this, "Please complete the ride before going back.", Toast.LENGTH_SHORT).show();
        }
    }
}

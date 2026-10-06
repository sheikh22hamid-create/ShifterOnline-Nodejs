package com.shifter.driver.activity;

import android.app.AlertDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.view.View;
import android.view.Window;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityTripPaymentBinding;
import com.shifter.driver.model.PDOrder;
import com.shifter.driver.model.PDOrderItem;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.SettlementView;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.socket.NodeSocketManager;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.ReceiverPayText;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.SettlementDriverClient;

import org.json.JSONObject;

import java.util.Locale;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class TripPaymentActivity extends LocaleAwareActivity {

    public static final String EXTRA_ORDER_ID = "order_id";
    public static final String EXTRA_ORDER_ITEM = "order_item";
    public static final String EXTRA_SETTLEMENT = "settlement";

    private ActivityTripPaymentBinding binding;
    private SessionManager sessionManager;
    private CustPrograssbar custPrograssbar;
    private RiderData riderData;

    private int orderId = 0;
    private boolean feedbackShown = false;
    private PDOrderItem orderItem;
    private SettlementView settlement;
    private String currency = "₹";

    private final Handler pollHandler = new Handler(Looper.getMainLooper());
    private Runnable pollRunnable;
    private NodeSocketManager.SettlementUpdatedListener socketListener;
    private boolean isFetchingOrderDetails = false;
    private boolean receiverBusy = false;
    private String originalGraceWarning;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityTripPaymentBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        applySafeScreenInsets();

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        riderData = sessionManager.getUserDetails();

        currency = sessionManager.getStringData(SessionManager.currency);
        if (currency == null || currency.trim().isEmpty()) {
            currency = "₹";
        }

        readIntentData();
        setupToolbar();
        setupClickListeners();
        setupSocketListener();

        if ((orderItem == null || (orderItem.getFinalFareAmount() == null && orderItem.getCommission() == null)) && orderId > 0) {
            fetchOrderHistoryDetails(orderId);
        }

        if (settlement != null) {
            updateUI();
        } else {
            loadSettlementState(true);
        }
    }

    private void applySafeScreenInsets() {
        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.WHITE);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat insetsController = WindowCompat.getInsetsController(window, window.getDecorView());
        if (insetsController != null) {
            // Dark navy (#0F172A) toolbar spans status bar: use light status bar icons (white)
            insetsController.setAppearanceLightStatusBars(false);
            // White (#FFFFFF) bottom action bar spans navigation bar: use dark nav buttons (black)
            insetsController.setAppearanceLightNavigationBars(true);
        }

        final int initialToolbarTop = binding.toolbar.getPaddingTop();
        final int initialBottomLeft = binding.layoutBottomActions.getPaddingLeft();
        final int initialBottomTop = binding.layoutBottomActions.getPaddingTop();
        final int initialBottomRight = binding.layoutBottomActions.getPaddingRight();
        final int initialBottomBottom = binding.layoutBottomActions.getPaddingBottom();

        ViewCompat.setOnApplyWindowInsetsListener(binding.getRoot(), (v, windowInsets) -> {
            Insets insets = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );

            // Extend toolbar background behind status bar and shift action bar content down into safe zone
            binding.toolbar.setPadding(0, initialToolbarTop + insets.top, 0, 0);

            // Extend bottom bar background behind navigation bar and lift action buttons into safe zone
            binding.layoutBottomActions.setPadding(
                    initialBottomLeft,
                    initialBottomTop,
                    initialBottomRight,
                    initialBottomBottom + insets.bottom
            );

            return windowInsets;
        });

        ViewCompat.requestApplyInsets(binding.getRoot());
    }

    private void readIntentData() {
        Intent intent = getIntent();
        if (intent == null) return;

        String idStr = intent.getStringExtra(EXTRA_ORDER_ID);
        if (idStr == null && intent.hasExtra("order_id_int")) {
            orderId = intent.getIntExtra("order_id_int", 0);
        } else if (idStr != null) {
            try {
                orderId = Integer.parseInt(idStr);
            } catch (Exception ignored) {}
        }

        if (intent.hasExtra(EXTRA_ORDER_ITEM)) {
            try {
                // PDOrderItem implements Parcelable, not Serializable
                orderItem = intent.getParcelableExtra(EXTRA_ORDER_ITEM);
                if (orderId == 0 && orderItem != null && orderItem.getId() != null) {
                    orderId = Integer.parseInt(orderItem.getId());
                }
            } catch (Exception ignored) {}
        }

        if (intent.hasExtra(EXTRA_SETTLEMENT)) {
            try {
                settlement = (SettlementView) intent.getSerializableExtra(EXTRA_SETTLEMENT);
                if (orderId == 0 && settlement != null) {
                    orderId = settlement.getOrderId();
                }
            } catch (Exception ignored) {}
        }
    }

    private void fetchOrderHistoryDetails(int oId) {
        if (riderData == null || oId <= 0 || isFetchingOrderDetails) return;
        isFetchingOrderDetails = true;
        try {
            org.json.JSONObject jsonObject = new org.json.JSONObject();
            jsonObject.put("type", "past");
            jsonObject.put("rid", riderData.getId());
            RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            NodeApiClient.getInterface().pkgHistory(bodyRequest).enqueue(new retrofit2.Callback<JsonObject>() {
                @Override
                public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                    isFetchingOrderDetails = false;
                    if (isFinishing() || isDestroyed()) return;
                    if (response.isSuccessful() && response.body() != null) {
                        try {
                            PDOrder pdOrder = new Gson().fromJson(response.body(), PDOrder.class);
                            if (pdOrder != null && pdOrder.getOrderHistory() != null) {
                                for (PDOrderItem item : pdOrder.getOrderHistory()) {
                                    if (item.getId() != null && item.getId().equals(String.valueOf(oId))) {
                                        orderItem = item;
                                        updateUI();
                                        break;
                                    }
                                }
                            }
                        } catch (Exception e) {
                            e.printStackTrace();
                        }
                    }
                }

                @Override
                public void onFailure(Call<JsonObject> call, Throwable t) {
                    isFetchingOrderDetails = false;
                }
            });
        } catch (Exception ignored) {
            isFetchingOrderDetails = false;
        }
    }

    private void setupToolbar() {
        binding.toolbar.setTitle("Trip Payment #" + (orderId > 0 ? orderId : ""));
        binding.toolbar.setNavigationOnClickListener(v -> finishOrHome());
    }

    private void setupClickListeners() {
        binding.btnReceived.setOnClickListener(v -> {
            if (settlement == null || !settlement.isPending()) return;
            showConfirmReceivedDialog();
        });

        binding.btnReportProblem.setOnClickListener(v -> {
            if (settlement == null || !settlement.isPending()) return;
            showDisputeDialog();
        });

        binding.btnDone.setOnClickListener(v -> finishOrHome());

        binding.btnReceiverRefused.setOnClickListener(v -> {
            if (receiverBusy || !ReceiverPayText.isReceiverMode(settlement)) return;
            new AlertDialog.Builder(this)
                    .setTitle("Receiver refused")
                    .setMessage("Receiver refused to pay? The customer will be asked to pay instead.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Yes, refused", (dialog, which) -> submitReceiverRefused())
                    .show();
        });

        binding.btnResendLink.setOnClickListener(v -> {
            if (receiverBusy || !ReceiverPayText.isReceiverMode(settlement)) return;
            submitResendLink();
        });
    }

    private void setReceiverBusy(boolean busy) {
        receiverBusy = busy;
        binding.btnReceiverRefused.setEnabled(!busy);
        binding.btnResendLink.setEnabled(!busy);
        binding.btnReceiverRefused.setAlpha(busy ? 0.5f : 1f);
        binding.btnResendLink.setAlpha(busy ? 0.5f : 1f);
    }

    private void showReceiverError(String title, String message) {
        if (isFinishing() || isDestroyed()) return;
        new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("OK", null)
                .show();
    }

    private void submitReceiverRefused() {
        if (riderData == null || orderId <= 0 || receiverBusy) return;
        setReceiverBusy(true);
        SettlementDriverClient.receiverRefused(this, riderData.getId(), orderId, new SettlementDriverClient.ReceiverRefusedCallback() {
            @Override
            public void onSuccess(String phase, SettlementView updated) {
                if (isFinishing() || isDestroyed()) return;
                setReceiverBusy(false);
                if (updated != null) {
                    settlement = updated;
                    updateUI();
                } else {
                    loadSettlementState(false);
                }
            }

            @Override
            public void onError(String code, String message) {
                if (isFinishing() || isDestroyed()) return;
                setReceiverBusy(false);
                showReceiverError("Could Not Update", message);
            }
        });
    }

    private void submitResendLink() {
        if (riderData == null || orderId <= 0 || receiverBusy) return;
        setReceiverBusy(true);
        SettlementDriverClient.resendLink(this, riderData.getId(), orderId, new SettlementDriverClient.ResendLinkCallback() {
            @Override
            public void onSuccess(boolean sent, String link) {
                if (isFinishing() || isDestroyed()) return;
                setReceiverBusy(false);
                if (sent) {
                    Toast.makeText(TripPaymentActivity.this, "Payment link sent to the receiver", Toast.LENGTH_SHORT).show();
                } else if (link == null || link.trim().isEmpty()) {
                    showReceiverError("Could Not Send Link",
                            SettlementDriverClient.getFriendlyErrorMessage("NOT_CONFIGURED", null));
                } else {
                    showShareLinkDialog(link);
                }
            }

            @Override
            public void onError(String code, String message) {
                if (isFinishing() || isDestroyed()) return;
                setReceiverBusy(false);
                showReceiverError("Could Not Send Link", message);
            }
        });
    }

    private void showShareLinkDialog(final String link) {
        final String shown = link == null ? "" : link;
        new AlertDialog.Builder(this)
                .setTitle("Share payment link")
                .setMessage("WhatsApp could not deliver the link. Share it with the receiver.\n\n" + shown)
                .setNegativeButton("Close", null)
                .setPositiveButton("Copy", (dialog, which) -> {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) {
                        cm.setPrimaryClip(ClipData.newPlainText("Payment link", shown));
                        Toast.makeText(TripPaymentActivity.this, "Link copied", Toast.LENGTH_SHORT).show();
                    }
                })
                .show();
    }

    private void setupSocketListener() {
        socketListener = data -> {
            if (data == null || isFinishing() || isDestroyed()) return;
            try {
                int evOrderId = data.optInt("order_id", 0);
                if (evOrderId == orderId) {
                    SettlementView updated = new Gson().fromJson(data.toString(), SettlementView.class);
                    if (updated != null) {
                        settlement = updated;
                        updateUI();
                    }
                }
            } catch (Exception e) {
                e.printStackTrace();
            }
        };
        NodeSocketManager.getInstance().addSettlementUpdatedListener(socketListener);
    }

    private void startPolling() {
        stopPolling();
        pollRunnable = new Runnable() {
            @Override
            public void run() {
                if (isFinishing() || isDestroyed()) return;
                if (settlement == null || settlement.isPending()) {
                    loadSettlementState(false);
                    pollHandler.postDelayed(this, 8000);
                }
            }
        };
        pollHandler.postDelayed(pollRunnable, 8000);
    }

    private void stopPolling() {
        if (pollRunnable != null) {
            pollHandler.removeCallbacks(pollRunnable);
            pollRunnable = null;
        }
    }

    private void loadSettlementState(boolean showProgress) {
        if (orderId <= 0 || riderData == null) return;
        if (showProgress) {
            custPrograssbar.prograssCreate(this);
        }

        SettlementDriverClient.fetchState(this, riderData.getId(), orderId, new SettlementDriverClient.SettlementCallback() {
            @Override
            public void onSuccess(SettlementView view) {
                custPrograssbar.closePrograssBar();
                if (view != null) {
                    settlement = view;
                    updateUI();
                }
            }

            @Override
            public void onError(String code, String message) {
                custPrograssbar.closePrograssBar();
                if (showProgress) {
                    Toast.makeText(TripPaymentActivity.this, message, Toast.LENGTH_SHORT).show();
                }
            }
        });
    }

    private void setRowVisibilityAndValue(View row, TextView txtView, String currency, String valueStr) {
        if (row == null || txtView == null) return;
        if (valueStr == null || valueStr.trim().isEmpty() || "null".equalsIgnoreCase(valueStr.trim())) {
            row.setVisibility(View.GONE);
        } else {
            row.setVisibility(View.VISIBLE);
            double val = parseDoubleSafe(valueStr);
            txtView.setText(currency + String.format(Locale.getDefault(), "%.2f", val));
        }
    }

    private void updateUI() {
        if (settlement == null) return;

        binding.txtOrderHeader.setText("ORDER #" + settlement.getOrderId());

        double amountDue = parseDoubleSafe(ReceiverPayText.collectAmount(settlement));
        String formattedAmount = currency + String.format(Locale.getDefault(), "%.2f", amountDue);
        binding.txtAmountDueValue.setText(formattedAmount);

        // Populate full 4-section breakdown matching legacy dialog exactly
        if (orderItem != null) {
            // 1. FARE BREAKDOWN
            setRowVisibilityAndValue(binding.layoutRowMinimumCharge, binding.txtMinimumCharge, currency, orderItem.getMinimumCharge());

            String actualPickup = orderItem.getActualPickupCharge() != null ? orderItem.getActualPickupCharge() : orderItem.getPickupCharge();
            setRowVisibilityAndValue(binding.layoutRowActualPickupCharge, binding.txtActualPickupCharge, currency, actualPickup);

            setRowVisibilityAndValue(binding.layoutRowPickupToDropCharge, binding.txtPickupToDropCharge, currency, orderItem.getPickupToDropCharge());
            setRowVisibilityAndValue(binding.layoutRowAddStopCharge, binding.txtAddStopCharge, currency, orderItem.getAddStopCharge());

            setRowVisibilityAndValue(binding.layoutRowWaitingCharge, binding.txtWaitingCharge, currency, orderItem.getExtraWaitingTimeCharge());
            setRowVisibilityAndValue(binding.layoutRowNightCharge, binding.txtNightCharge, currency, orderItem.getNightCharge());
            setRowVisibilityAndValue(binding.layoutRowLoadingCharge, binding.txtLoadingCharge, currency, orderItem.getLoadingCharge());
            setRowVisibilityAndValue(binding.layoutRowUnloadingCharge, binding.txtUnloadingCharge, currency, orderItem.getUnloadingCharge());

            String finalFareStr = orderItem.getFinalFareAmount() != null ? orderItem.getFinalFareAmount() : (orderItem.getTotalAmountByUser() != null ? orderItem.getTotalAmountByUser() : orderItem.getTotal());
            if (finalFareStr == null || parseDoubleSafe(finalFareStr) <= 0) {
                finalFareStr = String.valueOf(settlement.getFare());
            }
            setRowVisibilityAndValue(binding.layoutFinalFare, binding.txtFinalFareAmount, currency, finalFareStr);

            // Plan Benefit Strip
            if (orderItem.isPlanBenefitApplied() && orderItem.getPlanName() != null && !orderItem.getPlanName().trim().isEmpty()) {
                double planDiscount = parseDoubleSafe(orderItem.getPlanDiscountApplied());
                double planIncentive = parseDoubleSafe(orderItem.getPlanIncentiveEarned());
                StringBuilder msg = new StringBuilder(orderItem.getPlanName()).append(" applied");
                if (planDiscount > 0) {
                    msg.append(" — ").append(currency)
                            .append(String.format(Locale.getDefault(), "%.2f", planDiscount))
                            .append(" saved on commission");
                }
                if (planIncentive > 0) {
                    msg.append(planDiscount > 0 ? ", plus " : " — ").append(currency)
                            .append(String.format(Locale.getDefault(), "%.2f", planIncentive))
                            .append(" incentive earned");
                }
                binding.txtPlanBenefit.setText(msg.toString());
                binding.layoutPlanBenefitStrip.setVisibility(View.VISIBLE);
            } else {
                binding.layoutPlanBenefitStrip.setVisibility(View.GONE);
            }

            // 2. DEDUCTIONS
            setRowVisibilityAndValue(binding.layoutRowCommission, binding.txtCommission, currency, orderItem.getCommission());
            setRowVisibilityAndValue(binding.layoutRowPerTripCharge, binding.txtPerTripCharge, currency, orderItem.getPerTripCharge());

            String totalDeductionsStr = orderItem.getTotalDeductions();
            if (totalDeductionsStr == null && (orderItem.getCommission() != null || orderItem.getPerTripCharge() != null)) {
                double comm = parseDoubleSafe(orderItem.getCommission());
                double tripChg = parseDoubleSafe(orderItem.getPerTripCharge());
                totalDeductionsStr = String.valueOf(comm + tripChg);
            }
            setRowVisibilityAndValue(binding.layoutRowTotalDeductions, binding.txtTotalDeductions, currency, totalDeductionsStr);

            String driverEarningStr = orderItem.getDriverTotalEarning() != null ? orderItem.getDriverTotalEarning() : orderItem.getTotal();
            setRowVisibilityAndValue(binding.layoutDriverEarningStrip, binding.txtDriverTotalEarning, currency, driverEarningStr);

            // 3. PAYMENT BY USER
            String totalAmountByUserStr = orderItem.getTotalAmountByUser() != null ? orderItem.getTotalAmountByUser() : finalFareStr;
            setRowVisibilityAndValue(binding.layoutRowTotalAmountByUser, binding.txtTotalAmountByUser, currency, totalAmountByUserStr);

            setRowVisibilityAndValue(binding.layoutRowAdvancePayment, binding.txtAdvancePayment, currency, orderItem.getAdvancePayment());

            String cashToCollectStr = orderItem.getCashToCollect();
            if (cashToCollectStr == null && totalAmountByUserStr != null) {
                double totalVal = parseDoubleSafe(totalAmountByUserStr);
                double advVal = parseDoubleSafe(orderItem.getAdvancePayment());
                cashToCollectStr = String.valueOf(Math.max(0, totalVal - advVal));
            }
            setRowVisibilityAndValue(binding.layoutCashToCollectStrip, binding.txtCashToCollect, currency, cashToCollectStr);

            // 4. FINAL SETTLEMENT (TO DRIVER)
            setRowVisibilityAndValue(binding.layoutRowSettlementEarning, binding.txtSettlementEarning, currency, driverEarningStr);

            String cashCollectedStr = orderItem.getCashCollectedFromUser() != null ? orderItem.getCashCollectedFromUser() : cashToCollectStr;
            setRowVisibilityAndValue(binding.layoutRowSettlementCash, binding.txtSettlementCash, currency, cashCollectedStr);

            String walletAdjStr = orderItem.getWalletAdjustment();
            if (walletAdjStr == null && driverEarningStr != null && cashCollectedStr != null) {
                double earnVal = parseDoubleSafe(driverEarningStr);
                double collVal = parseDoubleSafe(cashCollectedStr);
                walletAdjStr = String.valueOf(Math.abs(earnVal - collVal));
            }
            setRowVisibilityAndValue(binding.layoutWalletAdjustmentStrip, binding.txtWalletAdjustment, currency, walletAdjStr);

            String note = orderItem.getSettlementNote() != null ? orderItem.getSettlementNote() : orderItem.getWalletAdjustmentNote();
            if (note != null && !note.trim().isEmpty() && !"null".equalsIgnoreCase(note.trim())) {
                binding.layoutSettlementNoteBox.setVisibility(View.VISIBLE);
                binding.txtSettlementNote.setText(note);
            } else {
                binding.layoutSettlementNoteBox.setVisibility(View.GONE);
            }

            if ((orderItem.getFinalFareAmount() == null && orderItem.getCommission() == null) && orderId > 0 && !isFetchingOrderDetails) {
                fetchOrderHistoryDetails(orderId);
            }
        } else {
            // Fallback while fetching order details
            setRowVisibilityAndValue(binding.layoutFinalFare, binding.txtFinalFareAmount, currency, String.valueOf(settlement.getFare()));
            if (orderId > 0 && !isFetchingOrderDetails) {
                fetchOrderHistoryDetails(orderId);
            }
        }

        String status = settlement.getStatus();
        String choice = settlement.getCustomerChoice();

        if (settlement.isPending()) {
            startPolling();
            binding.btnReceived.setEnabled(true);
            binding.btnReceived.setText("Received " + formattedAmount);
            binding.btnReceived.setBackgroundColor(Color.parseColor("#15803D"));
            binding.btnReportProblem.setVisibility(View.VISIBLE);
            binding.cardDisputeInfo.setVisibility(View.GONE);
            binding.txtGraceWarning.setVisibility(View.VISIBLE);

            boolean receiverMode = ReceiverPayText.isReceiverMode(settlement);
            if (originalGraceWarning == null) {
                originalGraceWarning = binding.txtGraceWarning.getText().toString();
            }
            binding.txtGraceWarning.setText(ReceiverPayText.graceWarning(receiverMode, originalGraceWarning));
            binding.layoutReceiverActions.setVisibility(receiverMode ? View.VISIBLE : View.GONE);
            if (receiverMode) {
                binding.btnReceiverRefused.setEnabled(!receiverBusy);
                binding.btnResendLink.setEnabled(!receiverBusy);
                String feeHint = ReceiverPayText.feeHint(currency, settlement.getReceiverPayTotal(), settlement.getAmountDue());
                binding.txtReceiverOnlineHint.setText(feeHint);
                binding.txtReceiverOnlineHint.setVisibility(feeHint.isEmpty() ? View.GONE : View.VISIBLE);
            } else {
                binding.txtReceiverOnlineHint.setVisibility(View.GONE);
            }

            if (receiverMode) {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#FEF3C7"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_info);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#D97706"));
                binding.txtStatusTitle.setText("Payment Pending");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#92400E"));
                binding.txtStatusDesc.setText(ReceiverPayText.collectLine(
                        currency,
                        ReceiverPayText.collectAmount(settlement),
                        orderItem != null ? orderItem.getDropName() : null,
                        orderItem != null ? orderItem.getCustomerDmobile() : null));
                binding.txtStatusDesc.setTextColor(Color.parseColor("#B45309"));
            } else if ("online".equalsIgnoreCase(choice)) {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#EFF6FF"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_info);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#2563EB"));
                binding.txtStatusTitle.setText("Customer is Paying Online...");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#1E40AF"));
                binding.txtStatusDesc.setText("Customer initiated online payment. Please wait, or collect cash/UPI if customer decides to pay you directly.");
                binding.txtStatusDesc.setTextColor(Color.parseColor("#1D4ED8"));
            } else {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#FEF3C7"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_info);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#D97706"));
                binding.txtStatusTitle.setText("Payment Pending");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#92400E"));
                binding.txtStatusDesc.setText("Collect cash or direct UPI from customer and tap Received.");
                binding.txtStatusDesc.setTextColor(Color.parseColor("#B45309"));
            }
        } else {
            stopPolling();
            binding.btnReportProblem.setVisibility(View.GONE);
            binding.txtGraceWarning.setVisibility(View.GONE);
            binding.layoutReceiverActions.setVisibility(View.GONE);
            binding.txtReceiverOnlineHint.setVisibility(View.GONE);

            if (settlement.isCashReceived()) {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#DCFCE7"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_check_circle_green);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#16A34A"));
                binding.txtStatusTitle.setText("Cash Received ✓");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#166534"));
                binding.txtStatusDesc.setText("Payment collected in cash. Commission debited as standard cash trip.");
                binding.txtStatusDesc.setTextColor(Color.parseColor("#15803D"));

                binding.btnReceived.setEnabled(false);
                binding.btnReceived.setText("Payment Settled (Cash) ✓");
                binding.btnReceived.setBackgroundColor(Color.parseColor("#94A3B8"));
                binding.cardDisputeInfo.setVisibility(View.GONE);
            } else if (settlement.isPaidOnline()) {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#DCFCE7"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_check_circle_green);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#16A34A"));
                binding.txtStatusTitle.setText("Paid Online ✓");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#166534"));
                binding.txtStatusDesc.setText("Paid online " + formattedAmount + " — credited directly to your driver wallet.");
                binding.txtStatusDesc.setTextColor(Color.parseColor("#15803D"));

                binding.btnReceived.setEnabled(false);
                binding.btnReceived.setText("Paid Online — Wallet Credited ✓");
                binding.btnReceived.setBackgroundColor(Color.parseColor("#94A3B8"));
                binding.cardDisputeInfo.setVisibility(View.GONE);
            } else if (settlement.isDisputed()) {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#FEF2F2"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_info);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#DC2626"));
                binding.txtStatusTitle.setText("Payment Under Dispute");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#991B1B"));
                binding.txtStatusDesc.setText("A problem was reported on this payment. Collection is paused while admin support reviews.");
                binding.txtStatusDesc.setTextColor(Color.parseColor("#B91C1C"));

                binding.btnReceived.setEnabled(false);
                binding.btnReceived.setText("Under Review by Support");
                binding.btnReceived.setBackgroundColor(Color.parseColor("#94A3B8"));

                binding.cardDisputeInfo.setVisibility(View.VISIBLE);
                String raisedBy = settlement.getDisputeRaisedBy();
                binding.txtDisputeRaisedBy.setText("Dispute Reported by " + (raisedBy != null ? raisedBy.toUpperCase(Locale.getDefault()) : "CUSTOMER"));
                String reason = settlement.getDisputeReason();
                binding.txtDisputeReason.setText("Reason: " + (reason != null && !reason.isEmpty() ? reason : "No reason specified"));
            } else if ("waived".equalsIgnoreCase(status)) {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#F1F5F9"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_info);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#64748B"));
                binding.txtStatusTitle.setText("Payment Waived by Admin");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#334155"));
                binding.txtStatusDesc.setText("Company absorbed the payment. Driver earnings credited to wallet.");
                binding.txtStatusDesc.setTextColor(Color.parseColor("#475569"));

                binding.btnReceived.setEnabled(false);
                binding.btnReceived.setText("Payment Waived");
                binding.btnReceived.setBackgroundColor(Color.parseColor("#94A3B8"));
                binding.cardDisputeInfo.setVisibility(View.GONE);
            } else if ("customer_owes".equalsIgnoreCase(status)) {
                binding.cardStatusAlert.setCardBackgroundColor(Color.parseColor("#EFF6FF"));
                binding.imgStatusIcon.setImageResource(R.drawable.ic_info);
                binding.imgStatusIcon.setColorFilter(Color.parseColor("#2563EB"));
                binding.txtStatusTitle.setText("Resolved: Customer Owes");
                binding.txtStatusTitle.setTextColor(Color.parseColor("#1E40AF"));
                binding.txtStatusDesc.setText("Admin marked dues on customer account. Driver earnings credited to wallet.");
                binding.txtStatusDesc.setTextColor(Color.parseColor("#1D4ED8"));

                binding.btnReceived.setEnabled(false);
                binding.btnReceived.setText("Resolved (Customer Owes)");
                binding.btnReceived.setBackgroundColor(Color.parseColor("#94A3B8"));
                binding.cardDisputeInfo.setVisibility(View.GONE);
            }
        }

        maybeShowTripFeedback(status);
    }

    // The ride is over once its payment is resolved - ask for the optional
    // trip feedback (previously only the legacy cash dialog in
    // OrderDetailsActivity did, so settlement trips never showed it).
    private void maybeShowTripFeedback(String status) {
        if (feedbackShown || riderData == null || isFinishing() || isDestroyed()) return;
        boolean resolved = "cash_received".equalsIgnoreCase(status)
                || "paid_online".equalsIgnoreCase(status)
                || "waived".equalsIgnoreCase(status)
                || "customer_owes".equalsIgnoreCase(status);
        if (!resolved || orderId <= 0) return;
        feedbackShown = true;
        DriverTripFeedbackDialog.show(this, String.valueOf(orderId), String.valueOf(riderData.getId()), () -> { });
    }

    private void showConfirmReceivedDialog() {
        if (settlement == null) return;
        double amountDue = parseDoubleSafe(ReceiverPayText.collectAmount(settlement));
        String formatted = currency + String.format(Locale.getDefault(), "%.2f", amountDue);

        new AlertDialog.Builder(this)
                .setTitle("Confirm Payment Received")
                .setMessage(ReceiverPayText.receivedConfirmMessage(ReceiverPayText.isReceiverMode(settlement), formatted))
                .setNegativeButton("No, Not Yet", null)
                .setPositiveButton("Yes, Received " + formatted, (dialog, which) -> {
                    submitMarkReceived();
                })
                .show();
    }

    private void submitMarkReceived() {
        if (riderData == null || orderId <= 0) return;
        custPrograssbar.prograssCreate(this);

        SettlementDriverClient.markReceived(this, riderData.getId(), orderId, new SettlementDriverClient.SettlementCallback() {
            @Override
            public void onSuccess(SettlementView view) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(TripPaymentActivity.this, "Payment confirmed received!", Toast.LENGTH_SHORT).show();
                if (view != null) {
                    settlement = view;
                    updateUI();
                }
            }

            @Override
            public void onError(String code, String message) {
                custPrograssbar.closePrograssBar();
                new AlertDialog.Builder(TripPaymentActivity.this)
                        .setTitle("Could Not Confirm")
                        .setMessage(message)
                        .setPositiveButton("OK", null)
                        .show();
            }
        });
    }

    private void showDisputeDialog() {
        final EditText input = new EditText(this);
        input.setHint("Describe what went wrong (e.g. customer refused to pay)...");
        input.setMinLines(3);
        input.setMaxLines(5);

        LinearLayout container = new LinearLayout(this);
        container.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (16 * getResources().getDisplayMetrics().density);
        container.setPadding(pad, pad, pad, 0);
        container.addView(input);

        new AlertDialog.Builder(this)
                .setTitle("Report a Problem")
                .setMessage("Enter the reason for reporting this payment. Support will review the case.")
                .setView(container)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Submit Problem", (dialog, which) -> {
                    String reason = input.getText().toString().trim();
                    if (reason.length() < 3) {
                        Toast.makeText(TripPaymentActivity.this, "Reason must be at least 3 characters", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    submitDispute(reason);
                })
                .show();
    }

    private void submitDispute(String reason) {
        if (riderData == null || orderId <= 0) return;
        custPrograssbar.prograssCreate(this);

        SettlementDriverClient.raiseDispute(this, riderData.getId(), orderId, reason, new SettlementDriverClient.SettlementCallback() {
            @Override
            public void onSuccess(SettlementView view) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(TripPaymentActivity.this, "Problem reported. Admin will review.", Toast.LENGTH_LONG).show();
                if (view != null) {
                    settlement = view;
                    updateUI();
                }
            }

            @Override
            public void onError(String code, String message) {
                custPrograssbar.closePrograssBar();
                new AlertDialog.Builder(TripPaymentActivity.this)
                        .setTitle("Dispute Failed")
                        .setMessage(message)
                        .setPositiveButton("OK", null)
                        .show();
            }
        });
    }

    private void finishOrHome() {
        if (isTaskRoot()) {
            Intent intent = new Intent(this, HomeActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        }
        finish();
    }

    private double parseDoubleSafe(String val) {
        if (val == null || val.trim().isEmpty()) return 0.0;
        try {
            return Double.parseDouble(val.trim());
        } catch (Exception e) {
            return 0.0;
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopPolling();
        if (socketListener != null) {
            NodeSocketManager.getInstance().removeSettlementUpdatedListener(socketListener);
            socketListener = null;
        }
    }
}

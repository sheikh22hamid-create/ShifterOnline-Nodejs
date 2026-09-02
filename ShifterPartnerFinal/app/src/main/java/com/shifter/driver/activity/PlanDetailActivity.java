package com.shifter.driver.activity;

import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.razorpay.Checkout;
import com.razorpay.PaymentData;
import com.razorpay.PaymentResultWithDataListener;
import com.shifter.driver.R;
import com.shifter.driver.model.DriverPremiumPlan;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.model.RiderData;

import org.json.JSONObject;

import android.widget.LinearLayout;
import android.widget.ImageView;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

/**
 * Plan Detail + Payment screen.
 *
 * Flow:
 *  1. Receive DriverPremiumPlan via Intent (as JSON string)
 *  2. Show plan details + Plan Summary
 *  3. Allow user to adjust points with − / + stepper
 *  4. Remaining amount → Razorpay checkout
 *  5. On Razorpay success → call purchaseDriverPremiumPlan API
 *     with payment_txn_id = razorpay payment_id
 */
public class PlanDetailActivity extends AppCompatActivity
        implements GetResult.MyListener, PaymentResultWithDataListener {

    public static final String EXTRA_PLAN_JSON = "plan_json";

    private static final String TAG           = "PlanDetailActivity";
    private static final String CALL_PURCHASE = "PURCHASE_PLAN";

    // Views
    private TextView     txtPopularBadge, txtPlanName, txtValidityLabel;
    private TextView     txtPlanPrice, txtNextRenewal;
    private TextView     txtSummaryPrice, txtSummaryValidity, txtSummaryTripCharge, txtSummaryCommission;
    private LinearLayout layoutTags;
    private TextView     txtSelectedPlan, txtPlanPriceRow;
    private TextView     txtAvailablePoints;
    private LinearLayout layoutPointsStepper, layoutPointsValueRow;
    private TextView     txtUsePoints, txtPointsValue, txtAmountToPay, btnPayNow;
    private TextView     btnPtsMinus, btnPtsPlus;
    private RadioGroup   radioPaymentMethod;

    // Data
    private DriverPremiumPlan plan;
    private SessionManager    sessionManager;
    private RiderData         riderData;
    private CustPrograssbar   custPrograssbar;

    // Points state
    private int    maxUsablePoints   = 0;  // from purchase_info.points_usable
    private int    availablePoints   = 0;  // from purchase_info.points_available
    private double pointValue        = 1;  // 1 point = ₹1 by default
    private int    currentUsePoints  = 0;  // what user chose to use
    private double planPrice         = 0;  // original plan price
    private double payableAmount     = 0;  // after points deduction
    private String currencySymbol    = "₹";

    // Razorpay
    private String razorpayOrderId   = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_plan_detail);

        Checkout.preload(getApplicationContext());

        sessionManager  = new SessionManager(this);
        riderData       = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();

        if (riderData == null) {
            Toast.makeText(this, "Session expired.", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        // Parse plan from intent
        String planJson = getIntent().getStringExtra(EXTRA_PLAN_JSON);
        if (planJson == null) { finish(); return; }
        plan = new Gson().fromJson(planJson, DriverPremiumPlan.class);

        bindViews();
        populatePlanDetails();
        populatePaymentSection();
    }

    // ─────────────────────────── BIND VIEWS ───────────────────────────
    private void bindViews() {
        ImageView imgBack         = findViewById(R.id.img_back);
        imgBack.setOnClickListener(v -> finish());

        txtPopularBadge     = findViewById(R.id.txt_popular_badge);
        txtPlanName         = findViewById(R.id.txt_plan_name);
        txtValidityLabel    = findViewById(R.id.txt_validity_label);
        txtPlanPrice        = findViewById(R.id.txt_plan_price);
        txtNextRenewal      = findViewById(R.id.txt_next_renewal);
        txtSummaryPrice     = findViewById(R.id.txt_summary_price);
        txtSummaryValidity  = findViewById(R.id.txt_summary_validity);
        txtSummaryTripCharge= findViewById(R.id.txt_summary_trip_charge);
        txtSummaryCommission= findViewById(R.id.txt_summary_commission);
        layoutTags          = findViewById(R.id.layout_tags);
        txtSelectedPlan     = findViewById(R.id.txt_selected_plan);
        txtPlanPriceRow     = findViewById(R.id.txt_plan_price_row);
        txtAvailablePoints  = findViewById(R.id.txt_available_points);
        layoutPointsStepper = findViewById(R.id.layout_points_stepper);
        layoutPointsValueRow= findViewById(R.id.layout_points_value_row);
        txtUsePoints        = findViewById(R.id.txt_use_points);
        txtPointsValue      = findViewById(R.id.txt_points_value);
        txtAmountToPay      = findViewById(R.id.txt_amount_to_pay);
        btnPayNow           = findViewById(R.id.btn_pay_now);
        btnPtsMinus         = findViewById(R.id.btn_pts_minus);
        btnPtsPlus          = findViewById(R.id.btn_pts_plus);
        radioPaymentMethod  = findViewById(R.id.radio_payment_method);
    }

    // ─────────────────────────── POPULATE PLAN DETAILS ───────────────────────────
    private void populatePlanDetails() {
        // Toolbar title
        TextView toolbarTitle = findViewById(R.id.txt_toolbar_title);
        if (toolbarTitle != null) toolbarTitle.setText(plan.getPlanName());

        // Popular badge
        txtPopularBadge.setVisibility(plan.isPopular() ? View.VISIBLE : View.GONE);

        // Name + validity
        txtPlanName.setText(plan.getPlanName());
        txtValidityLabel.setText(plan.getValidityLabel() != null ? plan.getValidityLabel() : "");

        // Price
        DriverPremiumPlan.PriceInfo pi = plan.getPriceInfo();
        if (pi != null) {
            currencySymbol = pi.getCurrencySymbol();
            planPrice      = pi.getPrice();
            txtPlanPrice.setText(currencySymbol + (int) planPrice);
        }

        // Summary table
        txtSummaryPrice.setText(currencySymbol + (int) planPrice);
        txtSummaryValidity.setText(
                (plan.getValidityLabel() != null ? plan.getValidityLabel() : "")
                + " (" + plan.getDaysLeft() + " Days)");
        txtSummaryTripCharge.setText("₹" + (int) plan.getPerTripCharge());
        txtSummaryCommission.setText((int) plan.getCommissionPercent() + "%");

        // UI Tags (benefits)
        layoutTags.removeAllViews();
        if (plan.getUiTags() != null) {
            for (String tag : plan.getUiTags()) {
                TextView tv = new TextView(this);
                tv.setText("✅  " + tag);
                tv.setTextColor(0xFF333333);
                tv.setTextSize(13f);
                LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT);
                lp.topMargin = 8;
                tv.setLayoutParams(lp);
                layoutTags.addView(tv);
            }
        }

        // Refer & Earn note
        DriverPremiumPlan.ReferAndEarn ref = plan.getReferAndEarn();
        if (ref != null && ref.getNote() != null && !ref.getNote().isEmpty()) {
            // Separator
            View sep = new View(this);
            sep.setBackgroundColor(0xFFF0EAFF);
            LinearLayout.LayoutParams sepLp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, 1);
            sepLp.topMargin = 12; sepLp.bottomMargin = 10;
            sep.setLayoutParams(sepLp);
            layoutTags.addView(sep);

            TextView noteView = new TextView(this);
            noteView.setText("💡  " + ref.getNote());
            noteView.setTextColor(0xFF7C4DFF);
            noteView.setTextSize(11.5f);
            noteView.setTypeface(null, android.graphics.Typeface.ITALIC);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            noteView.setLayoutParams(lp);
            layoutTags.addView(noteView);
        }
    }

    // ─────────────────────────── POPULATE PAYMENT SECTION ───────────────────────────
    private void populatePaymentSection() {
        DriverPremiumPlan.PurchaseInfo pui = plan.getPurchaseInfo();

        availablePoints  = (pui != null) ? pui.getPointsAvailable() : 0;
        maxUsablePoints  = (pui != null) ? pui.getPointsUsable()    : 0;
        pointValue       = (pui != null && pui.getPointValue() > 0) ? pui.getPointValue() : 1;
        payableAmount    = (pui != null) ? pui.getPayableAmount()   : planPrice;
        currentUsePoints = 0;

        txtSelectedPlan.setText(plan.getPlanName() + "  " + currencySymbol
                + (int) planPrice + "/" + plan.getValidityLabel());
        txtPlanPriceRow.setText(currencySymbol + (int) planPrice);
        txtAvailablePoints.setText(String.valueOf(availablePoints)
                + "  (1 Point = " + currencySymbol + (int) pointValue + ")");

        // Show stepper only if user has usable points
        if (maxUsablePoints > 0) {
            layoutPointsStepper.setVisibility(View.VISIBLE);
            layoutPointsValueRow.setVisibility(View.VISIBLE);
            setupPointsStepper();
        } else {
            layoutPointsStepper.setVisibility(View.GONE);
            layoutPointsValueRow.setVisibility(View.GONE);
        }

        updateAmountDisplay();

        btnPayNow.setOnClickListener(v -> onPayNowClicked());
    }

    // ─────────────────────────── POINTS STEPPER ───────────────────────────
    private void setupPointsStepper() {
        txtUsePoints.setText(String.valueOf(currentUsePoints));

        btnPtsMinus.setOnClickListener(v -> {
            if (currentUsePoints > 0) {
                currentUsePoints--;
                txtUsePoints.setText(String.valueOf(currentUsePoints));
                updateAmountDisplay();
            }
        });

        btnPtsPlus.setOnClickListener(v -> {
            if (currentUsePoints < maxUsablePoints) {
                currentUsePoints++;
                txtUsePoints.setText(String.valueOf(currentUsePoints));
                updateAmountDisplay();
            } else {
                Toast.makeText(this,
                        "Max usable points: " + maxUsablePoints, Toast.LENGTH_SHORT).show();
            }
        });
    }

    // ─────────────────────────── UPDATE AMOUNT DISPLAY ───────────────────────────
    private void updateAmountDisplay() {
        double pointsDeduction = currentUsePoints * pointValue;
        payableAmount = Math.max(0, planPrice - pointsDeduction);

        if (currentUsePoints > 0) {
            txtPointsValue.setText("−" + currencySymbol + (int) pointsDeduction);
            layoutPointsValueRow.setVisibility(View.VISIBLE);
        } else {
            layoutPointsValueRow.setVisibility(
                    maxUsablePoints > 0 ? View.VISIBLE : View.GONE);
            txtPointsValue.setText("−" + currencySymbol + "0");
        }

        txtAmountToPay.setText(currencySymbol + (int) payableAmount);
        btnPayNow.setText("Pay " + currencySymbol + (int) payableAmount);
    }

    // ─────────────────────────── PAY NOW CLICKED ───────────────────────────
    private void onPayNowClicked() {
        if (payableAmount <= 0) {
            // Full amount covered by points — directly purchase
            callPurchaseAPI("points", "POINTS_" + currentUsePoints,
                    String.valueOf((int) planPrice));
            return;
        }
        // Start Razorpay for remaining amount
        startRazorpayCheckout();
    }

    // ─────────────────────────── RAZORPAY CHECKOUT ───────────────────────────
    private void startRazorpayCheckout() {
        Checkout checkout = new Checkout();
        checkout.setKeyID("rzp_test_Rr8n8p41taq6fM");
        try {
            JSONObject options = new JSONObject();
            options.put("name", "Driver Premium Plan");
            options.put("description", plan.getPlanName() + " - " + plan.getValidityLabel());
            options.put("currency", "INR");

            int amountInPaise = (int) (payableAmount * 100);
            options.put("amount", String.valueOf(amountInPaise));

            // If you have a Razorpay order_id from backend, put it here.
            // Currently we open without order_id (direct payment mode).
            if (!razorpayOrderId.isEmpty()) {
                options.put("order_id", razorpayOrderId);
            }

            JSONObject preFill = new JSONObject();
            if (riderData.getMobile() != null) {
                preFill.put("contact", riderData.getMobile());
            }
            options.put("prefill", preFill);

            checkout.open(this, options);

        } catch (Exception e) {
            Log.e(TAG, "Razorpay error: " + e.getMessage());
            Toast.makeText(this, "Payment error. Try again.", Toast.LENGTH_SHORT).show();
        }
    }

    // ─────────────────────────── RAZORPAY CALLBACKS ───────────────────────────
    @Override
    public void onPaymentSuccess(String paymentId, PaymentData paymentData) {
        // Razorpay succeeded → call purchase API with paymentId as txn_id
        String txnId     = paymentData.getPaymentId();   // razorpay payment id
        String amtPaid   = String.valueOf((int) payableAmount);
        callPurchaseAPI("razorpay", txnId, amtPaid);
    }

    @Override
    public void onPaymentError(int code, String response, PaymentData paymentData) {
        Toast.makeText(this, "Payment failed. Please try again.", Toast.LENGTH_SHORT).show();
        Log.e(TAG, "Razorpay error code=" + code + " response=" + response);
    }

    // ─────────────────────────── PURCHASE API ───────────────────────────
    private void callPurchaseAPI(String paymentMethod, String txnId, String amountPaid) {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("driver_id",      riderData.getId());
            json.put("plan_id",        String.valueOf(plan.getPlanId()));
            json.put("payment_txn_id", txnId);
            json.put("payment_method", paymentMethod);
            json.put("amount_paid",    amountPaid);

            RequestBody body = RequestBody.create(
                    MediaType.parse("application/json"), json.toString());

            Call<JsonObject> call = APIClient.getInterface().purchaseDriverPremiumPlan(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, CALL_PURCHASE);

        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            Log.e(TAG, "purchaseAPI error: " + e.getMessage());
        }
    }

    // ─────────────────────────── API CALLBACK ───────────────────────────
    @Override
    public void callback(JsonObject result, String callNo) {
        custPrograssbar.closePrograssBar();
        if (!CALL_PURCHASE.equals(callNo)) return;

        try {
            if (result.has("Result") &&
                    "true".equalsIgnoreCase(result.get("Result").getAsString())) {
                showSuccessDialog(result);
            } else {
                String msg = result.has("ResponseMsg")
                        ? result.get("ResponseMsg").getAsString()
                        : "Purchase failed. Please try again.";
                Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Log.e(TAG, "callback error: " + e.getMessage());
            Toast.makeText(this, "Something went wrong.", Toast.LENGTH_SHORT).show();
        }
    }

    // ─────────────────────────── SUCCESS DIALOG ───────────────────────────
    private void showSuccessDialog(JsonObject result) {
        StringBuilder msg = new StringBuilder();
        try {
            if (result.has("Subscription") && !result.get("Subscription").isJsonNull()) {
                JsonObject sub = result.getAsJsonObject("Subscription");

                String planName   = sub.has("plan_name")         ? sub.get("plan_name").getAsString()          : plan.getPlanName();
                String validity   = sub.has("validity_label")    ? sub.get("validity_label").getAsString()     : plan.getValidityLabel();
                String endDate    = sub.has("end_date")          ? sub.get("end_date").getAsString()           : "";
                int    daysLeft   = sub.has("days_left")         ? sub.get("days_left").getAsInt()             : plan.getDaysLeft();
                boolean isRenewal = sub.has("is_renewal")        && sub.get("is_renewal").getAsBoolean();
                double commission = sub.has("commission_percent") ? sub.get("commission_percent").getAsDouble() : plan.getCommissionPercent();
                double tripCharge = sub.has("per_trip_charge")   ? sub.get("per_trip_charge").getAsDouble()   : plan.getPerTripCharge();
                double amtPaid    = sub.has("amount_paid")       ? sub.get("amount_paid").getAsDouble()       : payableAmount;
                String method     = sub.has("payment_method")    ? sub.get("payment_method").getAsString()    : "";
                String txnId      = sub.has("payment_txn_id")    ? sub.get("payment_txn_id").getAsString()    : "";
                String statusNote = sub.has("status_note")       ? sub.get("status_note").getAsString()       : "";

                msg.append(isRenewal ? "Plan Renewed!" : "Plan Activated!").append("\n\n");
                msg.append("Plan: ").append(planName).append("\n");
                msg.append("Validity: ").append(validity).append("  (").append(daysLeft).append(" days)\n");
                if (!endDate.isEmpty()) msg.append("Valid Till: ").append(endDate).append("\n");
                msg.append("Commission: ").append((int) commission).append("%\n");
                msg.append("Per Trip: ₹").append((int) tripCharge).append("\n");
                msg.append("Paid: ₹").append((int) amtPaid).append(" via ").append(method).append("\n");
                if (!txnId.isEmpty()) msg.append("Txn ID: ").append(txnId).append("\n");
                if (!statusNote.isEmpty()) msg.append("\n").append(statusNote);
            }
        } catch (Exception ignored) {}

        new AlertDialog.Builder(this)
                .setTitle("🎉 Purchase Successful!")
                .setMessage(msg.toString())
                .setPositiveButton("Go to My Plans", (d, w) -> {
                    d.dismiss();
                    setResult(RESULT_OK);
                    finish();
                })
                .setCancelable(false)
                .show();
    }
}

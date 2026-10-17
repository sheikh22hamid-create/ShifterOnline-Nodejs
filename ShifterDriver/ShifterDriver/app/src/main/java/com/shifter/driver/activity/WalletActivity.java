package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.recyclerview.widget.DefaultItemAnimator;
import androidx.recyclerview.widget.GridLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityWalletBinding;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.WalletHistoryData;
import com.shifter.driver.model.WalletHistoryResponse;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONObject;

import java.util.List;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import com.razorpay.Checkout;
import com.razorpay.PaymentData;
import com.razorpay.PaymentResultWithDataListener;

public class WalletActivity extends LocaleAwareActivity implements GetResult.MyListener, PaymentResultWithDataListener {

    private ActivityWalletBinding binding;
    private String amountToAdd = "0";
    private String pendingClearDuePaymentId = "";
    private String pendingDueBeforePoints = "0";
    private SessionManager sessionManager;
    private CustPrograssbar custPrograssbar;
    private RiderData riderData;

    private String fromDate = "";
    private String toDate = "";
    private String txnType = "";
    private WalletHistoryResponse latestResponse;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityWalletBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        Checkout.preload(getApplicationContext());

        // Set default wallet amount and points to 0 to avoid showing "null"
        binding.txtAmount.setText(
                new SessionManager(this).getStringData(SessionManager.currency) + "0");
        binding.txtPoints.setText("Points: 0");

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        riderData = sessionManager.getUserDetails();

        binding.imgBack.setOnClickListener(v -> finish());
        binding.txtPoints.setOnClickListener(v -> startActivity(new Intent(this, PointsHistoryActivity.class)));
        binding.lvlWithdraw.setOnClickListener(v -> bottomWithdraw());
        binding.lvlAddMoney.setOnClickListener(v -> showClearDueOptions());
        // Hidden by default until getEarning()'s response tells us whether
        // this driver actually has a due to clear or a balance to withdraw -
        // never guess from a stale/default balance of "0".
        binding.lvlAddMoney.setVisibility(View.GONE);
        binding.lvlWithdraw.setVisibility(View.GONE);

        ImageView imgFilter = findViewById(R.id.img_filter);
        if (imgFilter != null) {
            imgFilter.setOnClickListener(v -> showFilterDialog());
        }

        binding.recyTransaction.setLayoutManager(new GridLayoutManager(this, 1));
        binding.recyTransaction.setItemAnimator(new DefaultItemAnimator());

        getEarning();
    }

    @Override
    protected void onResume() {
        super.onResume();
        getEarning();
    }

    private String getRiderMobile() {
        if (riderData == null) return "";
        if (!TextUtils.isEmpty(riderData.getMobile())) {
            return riderData.getMobile();
        }
        return "";
    }

    // ---------------- API : EARNING ----------------
    private void getEarning() {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("mobile", getRiderMobile());
            json.put("wallet_type", "driver");
            json.put("from_date", fromDate);
            json.put("to_date", toDate);
            json.put("txn_type", txnType);

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = NodeApiClient.getInterface().getWalletHistory(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "3");

        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
        }
    }

    // ---------------- FILTER DIALOG ----------------
    private void showFilterDialog() {
        BottomSheetDialog dialog = new BottomSheetDialog(this);
        View view = getLayoutInflater().inflate(R.layout.bottom_sheet_filter, null);
        dialog.setContentView(view);

        TextView txtFromDate = view.findViewById(R.id.txt_from_date);
        TextView txtToDate = view.findViewById(R.id.txt_to_date);
        RadioGroup radioTxnType = view.findViewById(R.id.radio_txn_type);
        TextView btnApply = view.findViewById(R.id.btn_apply);
        TextView btnClear = view.findViewById(R.id.btn_clear);

        if (!TextUtils.isEmpty(fromDate)) txtFromDate.setText(fromDate);
        if (!TextUtils.isEmpty(toDate)) txtToDate.setText(toDate);

        if ("credit".equals(txnType)) {
            radioTxnType.check(R.id.rb_credit);
        } else if ("debit".equals(txnType)) {
            radioTxnType.check(R.id.rb_debit);
        } else {
            radioTxnType.check(R.id.rb_all);
        }

        txtFromDate.setOnClickListener(v -> showDatePicker(txtFromDate));
        txtToDate.setOnClickListener(v -> showDatePicker(txtToDate));

        btnApply.setOnClickListener(v -> {
            fromDate = txtFromDate.getText().toString().equals("Select Date") ? "" : txtFromDate.getText().toString();
            toDate = txtToDate.getText().toString().equals("Select Date") ? "" : txtToDate.getText().toString();

            int selectedId = radioTxnType.getCheckedRadioButtonId();
            if (selectedId == R.id.rb_credit) {
                txnType = "credit";
            } else if (selectedId == R.id.rb_debit) {
                txnType = "debit";
            } else {
                txnType = "";
            }

            dialog.dismiss();
            getEarning();
        });

        btnClear.setOnClickListener(v -> {
            fromDate = "";
            toDate = "";
            txnType = "";
            dialog.dismiss();
            getEarning();
        });

        dialog.show();
    }

    private void showDatePicker(TextView textView) {
        final java.util.Calendar c = java.util.Calendar.getInstance();
        int mYear = c.get(java.util.Calendar.YEAR);
        int mMonth = c.get(java.util.Calendar.MONTH);
        int mDay = c.get(java.util.Calendar.DAY_OF_MONTH);

        android.app.DatePickerDialog datePickerDialog = new android.app.DatePickerDialog(this,
                (view, year, monthOfYear, dayOfMonth) -> {
                    String formattedDate = year + "-" + String.format("%02d", (monthOfYear + 1)) + "-" + String.format("%02d", dayOfMonth);
                    textView.setText(formattedDate);
                }, mYear, mMonth, mDay);
        datePickerDialog.show();
    }

    // ---------------- WITHDRAW BOTTOM SHEET ----------------
    private void bottomWithdraw() {

        BottomSheetDialog dialog = new BottomSheetDialog(this);
        View view = getLayoutInflater().inflate(R.layout.bottom_withdraw, null);
        dialog.setContentView(view);

        // Ensure bottom sheet moves above the keyboard instead of being hidden
        if (dialog.getWindow() != null) {
            dialog.getWindow().setSoftInputMode(
                    WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE
                            | WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        }

        // Expand to full height up front (not just the collapsed peek
        // height) - the amount + UPI/bank fields form no longer fits in the
        // default peek, and a collapsed sheet leaves ADJUST_RESIZE nothing
        // to actually resize into, which is what was hiding the focused
        // field behind the keyboard.
        dialog.setOnShowListener(d -> {
            try {
                android.widget.FrameLayout bottomSheet = dialog.findViewById(com.google.android.material.R.id.design_bottom_sheet);
                if (bottomSheet != null) {
                    com.google.android.material.bottomsheet.BottomSheetBehavior<android.widget.FrameLayout> behavior =
                            com.google.android.material.bottomsheet.BottomSheetBehavior.from(bottomSheet);
                    behavior.setState(com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED);
                    behavior.setSkipCollapsed(true);
                }
            } catch (Exception ignored) {}
        });

        TextView btnSubmit = view.findViewById(R.id.btn_submit);
        TextView txtReject = view.findViewById(R.id.txt_reject);
        EditText edAmount = view.findViewById(R.id.ed_amount);
        TextView txtMaxWithdrawable = view.findViewById(R.id.txt_max_withdrawable);
        RadioGroup radioPayoutMethod = view.findViewById(R.id.radio_payout_method);
        RadioButton rbUpi = view.findViewById(R.id.rb_payout_upi);
        RadioButton rbBank = view.findViewById(R.id.rb_payout_bank);
        TextView txtSavedDetail = view.findViewById(R.id.txt_saved_payout_detail);
        TextView txtChangeDetail = view.findViewById(R.id.txt_change_payout_detail);
        LinearLayout layoutNewUpi = view.findViewById(R.id.layout_new_upi);
        LinearLayout layoutNewBank = view.findViewById(R.id.layout_new_bank);
        EditText edUpiId = view.findViewById(R.id.ed_upi_id);
        EditText edAccountName = view.findViewById(R.id.ed_account_name);
        EditText edAccountNumber = view.findViewById(R.id.ed_account_number);
        EditText edIfscCode = view.findViewById(R.id.ed_ifsc_code);
        EditText edBankName = view.findViewById(R.id.ed_bank_name);

        String currency = sessionManager.getStringData(SessionManager.currency);
        if (TextUtils.isEmpty(currency)) currency = "₹";
        String availableToWithdraw = latestResponse != null ? latestResponse.getAvailableToWithdraw() : null;
        if (!TextUtils.isEmpty(availableToWithdraw)) {
            txtMaxWithdrawable.setText("You can withdraw up to " + currency + availableToWithdraw + ". The rest stays in your ledger.");
        }

        WalletHistoryResponse.PayoutMethods payoutMethods = latestResponse != null ? latestResponse.getPayoutMethods() : null;
        String savedUpiId = payoutMethods != null ? payoutMethods.getUpiId() : null;
        WalletHistoryResponse.BankAccount savedBank = payoutMethods != null ? payoutMethods.getBankAccount() : null;

        // Default to whichever method the driver already has saved; UPI wins if both exist.
        boolean hasSavedUpi = !TextUtils.isEmpty(savedUpiId);
        boolean hasSavedBank = savedBank != null;
        rbUpi.setChecked(hasSavedUpi || !hasSavedBank);
        rbBank.setChecked(!hasSavedUpi && hasSavedBank);

        final boolean[] usingFreshDetail = {false};
        Runnable renderSelectedMethod = () -> {
            boolean upiSelected = rbUpi.isChecked();
            boolean hasSaved = upiSelected ? hasSavedUpi : hasSavedBank;
            if (hasSaved && !usingFreshDetail[0]) {
                txtSavedDetail.setVisibility(View.VISIBLE);
                txtSavedDetail.setText(upiSelected
                        ? "Saved UPI: " + savedUpiId
                        : "Saved bank: " + (savedBank.getBankName() != null ? savedBank.getBankName() : "") + " " + (savedBank.getAccountNumberMasked() != null ? savedBank.getAccountNumberMasked() : ""));
                txtChangeDetail.setVisibility(View.VISIBLE);
                txtChangeDetail.setText(upiSelected ? "Use a different UPI ID" : "Use a different bank account");
                layoutNewUpi.setVisibility(View.GONE);
                layoutNewBank.setVisibility(View.GONE);
            } else {
                txtSavedDetail.setVisibility(View.GONE);
                txtChangeDetail.setVisibility(View.GONE);
                layoutNewUpi.setVisibility(upiSelected ? View.VISIBLE : View.GONE);
                layoutNewBank.setVisibility(upiSelected ? View.GONE : View.VISIBLE);
            }
        };
        renderSelectedMethod.run();

        radioPayoutMethod.setOnCheckedChangeListener((group, checkedId) -> {
            usingFreshDetail[0] = false;
            renderSelectedMethod.run();
        });
        txtChangeDetail.setOnClickListener(v -> {
            usingFreshDetail[0] = true;
            renderSelectedMethod.run();
        });

        txtReject.setOnClickListener(v -> dialog.dismiss());

        btnSubmit.setOnClickListener(v -> {
            if (TextUtils.isEmpty(edAmount.getText())) {
                edAmount.setError("Enter amount");
                return;
            }

            boolean upiSelected = rbUpi.isChecked();
            String payoutMethod = upiSelected ? "upi" : "bank";
            boolean needsFreshDetail = usingFreshDetail[0] || (upiSelected ? !hasSavedUpi : !hasSavedBank);

            String upiIdToSend = null, accountNameToSend = null, accountNumberToSend = null, ifscCodeToSend = null, bankNameToSend = null;
            if (needsFreshDetail) {
                if (upiSelected) {
                    if (TextUtils.isEmpty(edUpiId.getText())) {
                        edUpiId.setError("Enter UPI ID");
                        return;
                    }
                    upiIdToSend = edUpiId.getText().toString().trim();
                } else {
                    if (TextUtils.isEmpty(edAccountName.getText()) || TextUtils.isEmpty(edAccountNumber.getText()) || TextUtils.isEmpty(edBankName.getText())) {
                        Toast.makeText(this, "Enter account name, account number and bank name", Toast.LENGTH_SHORT).show();
                        return;
                    }
                    accountNameToSend = edAccountName.getText().toString().trim();
                    accountNumberToSend = edAccountNumber.getText().toString().trim();
                    ifscCodeToSend = edIfscCode.getText().toString().trim();
                    bankNameToSend = edBankName.getText().toString().trim();
                }
            }

            dialog.dismiss();
            sendWithdraw(edAmount.getText().toString(), payoutMethod, upiIdToSend, accountNameToSend, accountNumberToSend, ifscCodeToSend, bankNameToSend);
        });

        dialog.show();
    }

    // ---------------- CLEAR OUTSTANDING DUE : METHOD CHOOSER ----------------
    // Lets the driver choose UPI (existing Razorpay flow) or their own
    // referral_points balance to clear the due, mirroring bottomWithdraw()'s
    // radio-group pattern. Points can only partially cover the due -
    // clearDueWithPoints() below reports remaining_due so the driver knows
    // to pay the rest via UPI afterwards.
    private void showClearDueOptions() {
        BottomSheetDialog dialog = new BottomSheetDialog(this);
        View view = getLayoutInflater().inflate(R.layout.bottom_clear_due, null);
        dialog.setContentView(view);

        TextView txtAmount = view.findViewById(R.id.txt_clear_due_amount);
        RadioGroup radioMethod = view.findViewById(R.id.radio_clear_due_method);
        RadioButton rbPoints = view.findViewById(R.id.rb_clear_due_points);
        TextView txtPointsInfo = view.findViewById(R.id.txt_clear_due_points_info);
        TextView btnSubmit = view.findViewById(R.id.btn_clear_due_submit);
        TextView txtReject = view.findViewById(R.id.txt_clear_due_reject);

        String currency = sessionManager.getStringData(SessionManager.currency);
        if (TextUtils.isEmpty(currency)) currency = "₹";
        String due = latestResponse != null ? latestResponse.getOutstandingDue() : null;
        if (TextUtils.isEmpty(due)) due = "0";
        txtAmount.setText("Outstanding due: " + currency + due);

        String points = latestResponse != null ? latestResponse.getWalletPoints() : null;
        if (TextUtils.isEmpty(points) || "null".equalsIgnoreCase(points)) points = "0";
        String finalPoints = points;
        rbPoints.setText("Referral Points (" + finalPoints + " available)");

        Runnable renderSelectedMethod = () -> {
            boolean pointsSelected = rbPoints.isChecked();
            if (pointsSelected) {
                txtPointsInfo.setVisibility(View.VISIBLE);
                txtPointsInfo.setText("If your points don't fully cover the due, the remaining amount can be paid via UPI.");
            } else {
                txtPointsInfo.setVisibility(View.GONE);
            }
        };
        renderSelectedMethod.run();
        radioMethod.setOnCheckedChangeListener((group, checkedId) -> renderSelectedMethod.run());

        txtReject.setOnClickListener(v -> dialog.dismiss());

        String finalDue = due;
        btnSubmit.setOnClickListener(v -> {
            dialog.dismiss();
            if (rbPoints.isChecked()) {
                pendingDueBeforePoints = finalDue;
                startClearDueWithPoints();
            } else {
                startClearOutstandingDue();
            }
        });

        dialog.show();
    }

    // ---------------- CLEAR OUTSTANDING DUE ----------------
    // Drivers cannot add money to their ledger - this replaces the old
    // self-recharge "Add Money" flow entirely. The due amount is always
    // computed server-side (createClearDueOrder) and never editable here,
    // matching the backend's own refusal to trust a client-supplied amount.
    private void startClearOutstandingDue() {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("mobile", getRiderMobile());

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = NodeApiClient.getInterface().createClearDueOrder(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "21");
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
        }
    }

    private void startRazorpayCheckout(String orderId) {
        Checkout checkout = new Checkout();
        checkout.setKeyID(com.shifter.driver.BuildConfig.RAZORPAY_KEY);
        try {
            JSONObject options = new JSONObject();
            options.put("name", riderData.getFullName());
            options.put("description", "Clear Outstanding Due");
            options.put("currency", "INR");

            double amountDouble = Double.parseDouble(amountToAdd);
            int amountInPaise = (int) (amountDouble * 100);
            options.put("amount", String.valueOf(amountInPaise));
            options.put("order_id", orderId);

            JSONObject preFill = new JSONObject();
            preFill.put("contact", getRiderMobile());
            options.put("prefill", preFill);

            checkout.open(this, options);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "Error in starting Razorpay Checkout", Toast.LENGTH_SHORT).show();
        }
    }

    private void verifyClearOutstandingDue(String razorpayPaymentId, String razorpayOrderId, String razorpaySignature) {
        custPrograssbar.prograssCreate(this);
        pendingClearDuePaymentId = razorpayPaymentId;
        try {
            JSONObject json = new JSONObject();
            json.put("mobile", getRiderMobile());
            json.put("razorpay_payment_id", razorpayPaymentId);
            json.put("razorpay_order_id", razorpayOrderId);
            json.put("razorpay_signature", razorpaySignature);

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = NodeApiClient.getInterface().clearOutstandingDue(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "22");
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
        }
    }

    // ---------------- CLEAR OUTSTANDING DUE WITH REFERRAL POINTS ----------------
    private void startClearDueWithPoints() {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("mobile", getRiderMobile());

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = NodeApiClient.getInterface().clearDueWithPoints(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "24");
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
        }
    }

    // ---------------- SEND WITHDRAW ----------------
    // Creates a pending request (customerWalletController.withdrawWallet) -
    // the wallet is NOT debited here. An admin approves it from the Payouts
    // screen (payoutController.approve), which is what actually decrements
    // the ledger and pays out. getEarning() below just refreshes the
    // pending-amount/available-to-withdraw figures, not a completed payout.
    private void sendWithdraw(String amt, String payoutMethod, String upiId, String accountName, String accountNumber, String ifscCode, String bankName) {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("mobile", getRiderMobile());
            json.put("amount", amt);
            json.put("wallet_type", "driver");
            json.put("payout_method", payoutMethod);
            if (!TextUtils.isEmpty(upiId)) json.put("upi_id", upiId);
            if (!TextUtils.isEmpty(accountName)) json.put("account_name", accountName);
            if (!TextUtils.isEmpty(accountNumber)) json.put("account_number", accountNumber);
            if (!TextUtils.isEmpty(ifscCode)) json.put("ifsc_code", ifscCode);
            if (!TextUtils.isEmpty(bankName)) json.put("bank_name", bankName);

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = NodeApiClient.getInterface().withdrawWallet(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "23");

        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
        }
    }

    private String getMsgFromJson(JsonObject json) {
        if (json == null) return "";
        if (json.has("ResponseMsg") && !json.get("ResponseMsg").isJsonNull()) {
            return json.get("ResponseMsg").getAsString();
        } else if (json.has("msg") && !json.get("msg").isJsonNull()) {
            return json.get("msg").getAsString();
        } else if (json.has("message") && !json.get("message").isJsonNull()) {
            return json.get("message").getAsString();
        }
        return "";
    }

    // ---------------- API CALLBACK ----------------
    @Override
    public void callback(JsonObject result, String callNo) {

        custPrograssbar.closePrograssBar();

        try {
            if ("21".equals(callNo)) { // Clear-due order created
                if (result != null) {
                    String orderId = null;
                    if (result.has("OrderId") && !result.get("OrderId").isJsonNull()) {
                        orderId = result.get("OrderId").getAsString();
                    } else if (result.has("order_id") && !result.get("order_id").isJsonNull()) {
                        orderId = result.get("order_id").getAsString();
                    }
                    String dueAmount = null;
                    if (result.has("due_amount") && !result.get("due_amount").isJsonNull()) {
                        dueAmount = result.get("due_amount").getAsString();
                    }

                    if (!TextUtils.isEmpty(orderId) && !TextUtils.isEmpty(dueAmount)) {
                        amountToAdd = dueAmount;
                        startRazorpayCheckout(orderId);
                    } else {
                        String msg = getMsgFromJson(result);
                        if (!TextUtils.isEmpty(msg)) {
                            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
                        }
                    }
                }
            } else if ("22".equals(callNo)) { // Clear-due payment verified
                boolean cleared = result != null && result.has("Result") && !result.get("Result").isJsonNull()
                        && result.get("Result").getAsBoolean();
                if (cleared) {
                    Intent intent = new Intent(this, ClearDueSuccessActivity.class);
                    intent.putExtra(ClearDueSuccessActivity.EXTRA_AMOUNT, amountToAdd);
                    intent.putExtra(ClearDueSuccessActivity.EXTRA_TRANSACTION_ID, pendingClearDuePaymentId);
                    startActivity(intent);
                } else {
                    String msg = getMsgFromJson(result);
                    if (!TextUtils.isEmpty(msg)) {
                        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                    }
                    getEarning();
                }

            } else if ("23".equals(callNo)) { // Withdraw request submitted (pending admin approval)
                String msg = getMsgFromJson(result);
                if (!TextUtils.isEmpty(msg)) {
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                }
                getEarning();

            } else if ("24".equals(callNo)) { // Clear-due-with-points result
                boolean cleared = result != null && result.has("Result") && !result.get("Result").isJsonNull()
                        && result.get("Result").getAsBoolean();
                if (cleared) {
                    String remainingDue = "0";
                    if (result.has("remaining_due") && !result.get("remaining_due").isJsonNull()) {
                        remainingDue = result.get("remaining_due").getAsString();
                    }
                    String pointsUsed = "0";
                    if (result.has("points_used") && !result.get("points_used").isJsonNull()) {
                        pointsUsed = result.get("points_used").getAsString();
                    }
                    double amountCleared = Math.max(0, parseDoubleSafe(pendingDueBeforePoints) - parseDoubleSafe(remainingDue));

                    Intent intent = new Intent(this, ClearDueSuccessActivity.class);
                    intent.putExtra(ClearDueSuccessActivity.EXTRA_AMOUNT, String.valueOf(amountCleared));
                    intent.putExtra(ClearDueSuccessActivity.EXTRA_TRANSACTION_ID, pointsUsed + " Points Redeemed");
                    startActivity(intent);

                    // Points only partially covered the due - let the driver
                    // know they still owe the rest before they land back on
                    // the wallet screen (which will show the UPI option again).
                    if (parseDoubleSafe(remainingDue) > 0) {
                        String currency = sessionManager.getStringData(SessionManager.currency);
                        if (TextUtils.isEmpty(currency)) currency = "₹";
                        Toast.makeText(this, "Points covered part of your due. " + currency + remainingDue + " still outstanding - pay via UPI to clear it.", Toast.LENGTH_LONG).show();
                    }
                } else {
                    String msg = getMsgFromJson(result);
                    if (!TextUtils.isEmpty(msg)) {
                        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                    }
                    getEarning();
                }

            } else if ("3".equals(callNo)) {

                WalletHistoryResponse response = new Gson().fromJson(result, WalletHistoryResponse.class);
                latestResponse = response;

                if (response != null && response.getResult() != null && response.getResult()) {

                    String balance = response.getWalletBalance();
                    if (TextUtils.isEmpty(balance) || "null".equalsIgnoreCase(balance)) {
                        balance = "0";
                    }

                    String points = response.getWalletPoints();
                    if (TextUtils.isEmpty(points) || "null".equalsIgnoreCase(points)) {
                        points = "0";
                    }

                    String currency = sessionManager.getStringData(SessionManager.currency);
                    if (TextUtils.isEmpty(currency)) currency = "₹";

                    binding.txtAmount.setText(currency + balance);

                    // Keep the cached balance fresh so the Home "negative wallet" banner
                    // updates as soon as the driver returns from this screen.
                    if (riderData != null) {
                        riderData.setWalletBalance(balance);
                        sessionManager.setUserDetails(riderData);
                    }

                    double balanceNum = parseDoubleSafe(balance);
                    boolean canClearDue = response.getCanClearDue();
                    boolean canWithdraw = response.getCanWithdraw();

                    // Card colour, Points/Due-amount badge, and the warning
                    // banner all key off canClearDue (backend's own
                    // "balance < 0" signal), not the raw sign of balanceNum
                    // directly - keeps this in lockstep with whatever rule
                    // the server is actually enforcing.
                    if (canClearDue) {
                        binding.lvlBalanceCard.setBackgroundResource(R.drawable.bg_wallet_gradient_negative);
                        String due = response.getOutstandingDue();
                        binding.txtPoints.setText("Due Amount: " + currency + (TextUtils.isEmpty(due) ? "0" : due));

                        binding.lvlDueWarning.setVisibility(View.VISIBLE);
                        if (response.getDueLimitReached()) {
                            String limit = formatAmount(response.getMaxDueLimit());
                            binding.txtDueWarning.setText("You have reached the maximum due limit of " + currency + limit
                                    + ". Please clear your dues to continue receiving new rides.");
                        } else {
                            binding.txtDueWarning.setText("You have outstanding dues of " + currency + (TextUtils.isEmpty(due) ? "0" : due)
                                    + ". Please clear the dues to start receiving new rides.");
                        }

                        binding.txtAddMoneyLabel.setText(
                                TextUtils.isEmpty(due) ? "Clear Outstanding" : "Clear Outstanding " + currency + due);
                        binding.lvlAddMoney.setVisibility(View.VISIBLE);
                    } else {
                        binding.lvlBalanceCard.setBackgroundResource(R.drawable.bg_wallet_gradient);
                        binding.txtPoints.setText("Points: " + points);
                        binding.lvlDueWarning.setVisibility(View.GONE);
                        binding.lvlAddMoney.setVisibility(View.GONE);
                    }

                    // Withdraw: fully enabled only when the backend says so;
                    // otherwise shown-but-disabled at balance >= 0 (nothing
                    // to withdraw yet, or below the admin's minimum) and
                    // hidden entirely once the balance is negative.
                    if (canWithdraw) {
                        binding.lvlWithdraw.setVisibility(View.VISIBLE);
                        binding.lvlWithdraw.setEnabled(true);
                        binding.lvlWithdraw.setAlpha(1f);
                    } else if (balanceNum >= 0) {
                        binding.lvlWithdraw.setVisibility(View.VISIBLE);
                        binding.lvlWithdraw.setEnabled(false);
                        binding.lvlWithdraw.setAlpha(0.5f);
                    } else {
                        binding.lvlWithdraw.setVisibility(View.GONE);
                    }

                    if (response.getData() != null && !response.getData().isEmpty()) {
                        binding.recyTransaction.setVisibility(View.VISIBLE);
                        binding.lvlNotfound.setVisibility(View.GONE);
                        binding.recyTransaction.setAdapter(
                                new HistryAdp(response.getData()));
                    } else {
                        binding.recyTransaction.setVisibility(View.GONE);
                        binding.lvlNotfound.setVisibility(View.VISIBLE);
                    }
                } else {
                    binding.lvlBalanceCard.setBackgroundResource(R.drawable.bg_wallet_gradient);
                    binding.lvlDueWarning.setVisibility(View.GONE);
                    binding.lvlAddMoney.setVisibility(View.GONE);
                    binding.lvlWithdraw.setVisibility(View.GONE);
                    binding.recyTransaction.setVisibility(View.GONE);
                    binding.lvlNotfound.setVisibility(View.VISIBLE);
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onPaymentSuccess(String s, PaymentData paymentData) {
        verifyClearOutstandingDue(paymentData.getPaymentId(), paymentData.getOrderId(), paymentData.getSignature());
    }

    @Override
    public void onPaymentError(int i, String s, PaymentData paymentData) {
        Toast.makeText(this, "Payment Failed", Toast.LENGTH_SHORT).show();
    }

    // ---------------- ADAPTER ----------------
    class HistryAdp extends RecyclerView.Adapter<HistryAdp.MyViewHolder> {

        private final List<WalletHistoryData> list;

        HistryAdp(List<WalletHistoryData> list) {
            this.list = list;
        }

        class MyViewHolder extends RecyclerView.ViewHolder {
            View lvlIconBg;
            ImageView imgTxnIcon, imgProof;
            TextView txtStatus, txtRequst, txtAmt, txtPayby, txtRDate;

            MyViewHolder(View v) {
                super(v);
                lvlIconBg = v.findViewById(R.id.lvl_icon_bg);
                imgTxnIcon = v.findViewById(R.id.img_txn_icon);
                imgProof = v.findViewById(R.id.img_proof);
                txtStatus = v.findViewById(R.id.txt_status);
                txtRequst = v.findViewById(R.id.txt_requst);
                txtAmt = v.findViewById(R.id.txt_amt);
                txtPayby = v.findViewById(R.id.txt_payby);
                txtRDate = v.findViewById(R.id.txt_r_date);
            }
        }

        @Override
        public MyViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
            View v = LayoutInflater.from(parent.getContext())
                    .inflate(R.layout.item_histry, parent, false);
            return new MyViewHolder(v);
        }

        @Override
        public void onBindViewHolder(MyViewHolder h, int p) {
            WalletHistoryData d = list.get(p);

            if (h.imgProof != null) {
                h.imgProof.setVisibility(View.GONE);
            }

            String currency = sessionManager.getStringData(SessionManager.currency);
            if (currency == null) currency = "₹";

            String type = d.getType() != null ? d.getType().trim().toLowerCase() : "";
            boolean isCredit = "credit".equals(type) || "cr".equals(type);
            boolean isDebit = "debit".equals(type) || "dr".equals(type);

            String amount = d.getAmount() != null ? d.getAmount() : "0";

            if (isCredit) {
                h.txtAmt.setText("+ " + currency + amount);
                h.txtAmt.setTextColor(android.graphics.Color.parseColor("#00C853")); // Green
                h.txtStatus.setText("CREDIT");
                h.txtStatus.setTextColor(android.graphics.Color.parseColor("#00C853"));
                h.txtStatus.setBackgroundResource(R.drawable.bg_pill_credit);
                if (h.lvlIconBg != null) h.lvlIconBg.setBackgroundResource(R.drawable.bg_pill_credit);
                if (h.imgTxnIcon != null) h.imgTxnIcon.setImageResource(R.drawable.ic_wallet_credit);
            } else if (isDebit) {
                h.txtAmt.setText("- " + currency + amount);
                h.txtAmt.setTextColor(android.graphics.Color.parseColor("#E53935")); // Red
                h.txtStatus.setText("DEBIT");
                h.txtStatus.setTextColor(android.graphics.Color.parseColor("#E53935"));
                h.txtStatus.setBackgroundResource(R.drawable.bg_pill_debit);
                if (h.lvlIconBg != null) h.lvlIconBg.setBackgroundResource(R.drawable.bg_pill_debit);
                if (h.imgTxnIcon != null) h.imgTxnIcon.setImageResource(R.drawable.ic_wallet_debit);
            } else {
                h.txtAmt.setText(currency + amount);
                h.txtAmt.setTextColor(android.graphics.Color.parseColor("#1E293B"));
                h.txtStatus.setText(d.getType() != null ? d.getType().toUpperCase() : "PENDING");
                h.txtStatus.setTextColor(android.graphics.Color.parseColor("#B78103"));
                h.txtStatus.setBackgroundResource(R.drawable.bg_pill_pending);
                if (h.lvlIconBg != null) h.lvlIconBg.setBackgroundResource(R.drawable.bg_pill_pending);
                if (h.imgTxnIcon != null) h.imgTxnIcon.setImageResource(R.drawable.ic_wallet_credit);
            }

            // Remark / Title
            String remark = d.getRemark();
            if (TextUtils.isEmpty(remark)) {
                remark = isCredit ? "Added to Ledger" : "Payout / Withdrawal";
            }
            h.txtPayby.setText(remark);

            // Txn ID
            String txnId = d.getId() != null ? d.getId() : "";
            if (!TextUtils.isEmpty(txnId)) {
                h.txtRequst.setText("Txn #" + txnId);
                h.txtRequst.setVisibility(View.VISIBLE);
            } else {
                h.txtRequst.setVisibility(View.GONE);
            }

            // Date Formatting
            String rawDate = d.getCreatedAt();
            h.txtRDate.setText(formatTxnDate(rawDate));

            // Tapping a transaction that's tied to a ride opens that ride's
            // full payment breakdown (fare, commission, plan benefit, wallet
            // adjustment) — previously a transaction row was a dead end, the
            // driver had no way to see which ride a debit/credit came from.
            String orderId = d.getOrderId();
            boolean hasOrder = orderId != null && !orderId.trim().isEmpty() && !"0".equals(orderId.trim()) && !"null".equalsIgnoreCase(orderId.trim());
            h.itemView.setOnClickListener(hasOrder ? v -> openRideDetail(orderId) : null);
            h.itemView.setClickable(hasOrder);
        }

        @Override
        public int getItemCount() {
            return list.size();
        }

        private String formatTxnDate(String rawDate) {
            if (TextUtils.isEmpty(rawDate)) return "";
            try {
                java.text.SimpleDateFormat inputFormat = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.getDefault());
                java.util.Date date = inputFormat.parse(rawDate);
                if (date != null) {
                    java.text.SimpleDateFormat outputFormat = new java.text.SimpleDateFormat("dd MMM yyyy, hh:mm a", java.util.Locale.getDefault());
                    return outputFormat.format(date);
                }
            } catch (Exception ignored) {}
            return rawDate;
        }
    }

    // ---------------- RIDE DETAIL FROM WALLET TRANSACTION ----------------

    private void openRideDetail(String orderId) {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("type", "past");
            jsonObject.put("rid", riderData.getId());

            RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            Call<JsonObject> call = NodeApiClient.getInterface().pkgHistory(bodyRequest);
            call.enqueue(new retrofit2.Callback<JsonObject>() {
                @Override
                public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                    try {
                        custPrograssbar.closePrograssBar();
                    } catch (Exception ignored) {}
                    com.shifter.driver.model.PDOrderItem found = null;
                    try {
                        if (response.isSuccessful() && response.body() != null) {
                            Gson gson = new Gson();
                            com.shifter.driver.model.PDOrder pdOrder = gson.fromJson(response.body(), com.shifter.driver.model.PDOrder.class);
                            if (pdOrder != null && pdOrder.getOrderHistory() != null) {
                                for (com.shifter.driver.model.PDOrderItem item : pdOrder.getOrderHistory()) {
                                    if (item.getId() != null && item.getId().equals(orderId)) {
                                        found = item;
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                    if (found != null) {
                        showRideDetailDialog(found);
                    } else {
                        Toast.makeText(WalletActivity.this, "Ride details not found", Toast.LENGTH_SHORT).show();
                    }
                }

                @Override
                public void onFailure(Call<JsonObject> call, Throwable t) {
                    try {
                        custPrograssbar.closePrograssBar();
                    } catch (Exception ignored) {}
                    Toast.makeText(WalletActivity.this, "Network error", Toast.LENGTH_SHORT).show();
                }
            });
        } catch (Exception e) {
            try {
                custPrograssbar.closePrograssBar();
            } catch (Exception ignored) {}
            e.printStackTrace();
        }
    }

    // Read-only "Trip Payment Details" popup, same layout/fields as
    // OrderPDFragment's history-tab version (Close button just dismisses —
    // this isn't the live-trip "confirm cash collected" flow that
    // OrderDetailsActivity uses).
    private void showRideDetailDialog(com.shifter.driver.model.PDOrderItem orderItem) {
        if (isFinishing() || isDestroyed() || orderItem == null) return;

        final android.app.Dialog dialog = new android.app.Dialog(this);
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_completed_order_details);

        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            dialog.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        }

        String currency = sessionManager.getStringData(SessionManager.currency);
        if (currency == null || currency.trim().isEmpty()) currency = "₹";

        // 1. FARE BREAKDOWN
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_minimum_charge), dialog.findViewById(R.id.txt_minimum_charge), currency, orderItem.getMinimumCharge());

        String actualPickup = orderItem.getActualPickupCharge() != null ? orderItem.getActualPickupCharge() : orderItem.getPickupCharge();
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_actual_pickup_charge), dialog.findViewById(R.id.txt_actual_pickup_charge), currency, actualPickup);

        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_pickup_to_drop_charge), dialog.findViewById(R.id.txt_pickup_to_drop_charge), currency, orderItem.getPickupToDropCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_add_stop_charge), dialog.findViewById(R.id.txt_add_stop_charge), currency, orderItem.getAddStopCharge());

        // getWatingCharge() is the package's raw per-minute RATE, not an
        // amount - it used to be used as a fallback here whenever
        // extra_waiting_time_charge came back null, which showed the rate
        // itself (e.g. "₹2.00") as if it were the actual waiting charge
        // billed on this trip. Backend now always computes and sends
        // extra_waiting_time_charge (0 when no waiting charge applied), so
        // the fallback is dropped rather than risk it firing again.
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_waiting_charge), dialog.findViewById(R.id.txt_waiting_charge), currency, orderItem.getExtraWaitingTimeCharge());

        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_night_charge), dialog.findViewById(R.id.txt_night_charge), currency, orderItem.getNightCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_loading_charge), dialog.findViewById(R.id.txt_loading_charge), currency, orderItem.getLoadingCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_unloading_charge), dialog.findViewById(R.id.txt_unloading_charge), currency, orderItem.getUnloadingCharge());

        String finalFareStr = orderItem.getFinalFareAmount() != null ? orderItem.getFinalFareAmount() : (orderItem.getTotalAmountByUser() != null ? orderItem.getTotalAmountByUser() : orderItem.getTotal());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_final_fare), dialog.findViewById(R.id.txt_final_fare_amount), currency, finalFareStr);

        // Premium plan benefit actually applied to this ride.
        View planBenefitStrip = dialog.findViewById(R.id.layout_plan_benefit_strip);
        TextView txtPlanBenefit = dialog.findViewById(R.id.txt_plan_benefit);
        if (planBenefitStrip != null && txtPlanBenefit != null) {
            if (orderItem.isPlanBenefitApplied() && orderItem.getPlanName() != null && !orderItem.getPlanName().trim().isEmpty()) {
                double planDiscount = parseDoubleSafe(orderItem.getPlanDiscountApplied());
                double planIncentive = parseDoubleSafe(orderItem.getPlanIncentiveEarned());
                StringBuilder msg = new StringBuilder(orderItem.getPlanName()).append(" applied");
                if (planDiscount > 0) {
                    msg.append(" — ").append(currency)
                            .append(String.format(java.util.Locale.getDefault(), "%.2f", planDiscount))
                            .append(" saved on commission");
                }
                if (planIncentive > 0) {
                    msg.append(planDiscount > 0 ? ", plus " : " — ").append(currency)
                            .append(String.format(java.util.Locale.getDefault(), "%.2f", planIncentive))
                            .append(" incentive earned");
                }
                txtPlanBenefit.setText(msg.toString());
                planBenefitStrip.setVisibility(View.VISIBLE);
            } else {
                planBenefitStrip.setVisibility(View.GONE);
            }
        }

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
        TextView txtSettlementNote = dialog.findViewById(R.id.txt_settlement_note);
        if (noteBox != null && txtSettlementNote != null) {
            if (note != null && !note.trim().isEmpty() && !"null".equalsIgnoreCase(note.trim())) {
                noteBox.setVisibility(View.VISIBLE);
                txtSettlementNote.setText(note);
            } else {
                noteBox.setVisibility(View.GONE);
            }
        }

        View btnCloseHeader = dialog.findViewById(R.id.btn_close_header);
        if (btnCloseHeader != null) btnCloseHeader.setOnClickListener(v -> dialog.dismiss());

        View btnClose = dialog.findViewById(R.id.btn_close_dialog);
        if (btnClose != null) btnClose.setOnClickListener(v -> dialog.dismiss());

        dialog.show();
    }

    private void setRowVisibilityAndValue(View row, TextView txtView, String currency, String valueStr) {
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

    private String formatAmount(Double val) {
        if (val == null) return "0";
        if (val == Math.floor(val) && !val.isInfinite()) {
            return String.valueOf(val.longValue());
        }
        return String.format(java.util.Locale.getDefault(), "%.2f", val);
    }
}

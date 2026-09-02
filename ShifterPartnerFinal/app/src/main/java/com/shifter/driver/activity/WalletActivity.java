package com.shifter.driver.activity;

import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
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
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
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

public class WalletActivity extends AppCompatActivity implements GetResult.MyListener, PaymentResultWithDataListener {

    private ActivityWalletBinding binding;
    private String amountToAdd = "0";
    private SessionManager sessionManager;
    private CustPrograssbar custPrograssbar;
    private RiderData riderData;

    private String fromDate = "";
    private String toDate = "";
    private String txnType = "";

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
        binding.lvlWithdraw.setOnClickListener(v -> bottomWithdraw());
        binding.lvlAddMoney.setOnClickListener(v -> bottomAddMoney());

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

            Call<JsonObject> call = APIClient.getInterface().getWalletHistory(body);
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

        RadioGroup radio = view.findViewById(R.id.radio);
        TextView btnSubmit = view.findViewById(R.id.btn_submit);
        TextView txtReject = view.findViewById(R.id.txt_reject);

        EditText edAmount = view.findViewById(R.id.ed_amount);
        EditText edBank = view.findViewById(R.id.ed_bankname);
        EditText edAccNo = view.findViewById(R.id.ed_accountno);
        EditText edAccName = view.findViewById(R.id.ed_accountname);
        EditText edIfsc = view.findViewById(R.id.ed_accountifsc);
        EditText edUpi = view.findViewById(R.id.ed_accountupi);
        EditText edPaypal = view.findViewById(R.id.ed_accountpaypal);

        radio.setOnCheckedChangeListener((group, checkedId) -> {
            RadioButton rb = view.findViewById(checkedId);
            if (rb == null)
                return;

            String type = rb.getText().toString().toLowerCase();

            setVisibility(
                    edBank, edAccNo, edAccName, edIfsc, edUpi, edPaypal,
                    type.equals("bank transfer"),
                    type.equals("bank transfer"),
                    type.equals("bank transfer"),
                    type.equals("bank transfer"),
                    type.equals("upi"),
                    type.equals("paypal"));
        });

        txtReject.setOnClickListener(v -> dialog.dismiss());

        btnSubmit.setOnClickListener(v -> {

            if (TextUtils.isEmpty(edAmount.getText())) {
                edAmount.setError("Enter amount");
                return;
            }

            if (radio.getCheckedRadioButtonId() == -1) {
                Toast.makeText(this, "Select payment method", Toast.LENGTH_SHORT).show();
                return;
            }

            RadioButton rb = view.findViewById(radio.getCheckedRadioButtonId());
            String type = rb.getText().toString().toLowerCase();

            dialog.dismiss();

            sendWithdraw(
                    edAmount.getText().toString(),
                    type,
                    edBank.getText().toString(),
                    edAccNo.getText().toString(),
                    edAccName.getText().toString(),
                    edIfsc.getText().toString(),
                    edUpi.getText().toString(),
                    edPaypal.getText().toString());
        });

        dialog.show();
    }

    // ---------------- ADD MONEY ----------------
    private void bottomAddMoney() {
        android.app.AlertDialog.Builder builder = new android.app.AlertDialog.Builder(this);
        builder.setTitle("Add Money");

        final EditText input = new EditText(this);
        input.setInputType(android.text.InputType.TYPE_CLASS_NUMBER | android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL);
        input.setHint("Enter Amount");
        builder.setView(input);

        builder.setPositiveButton("Add", (dialog, which) -> {
            String amount = input.getText().toString();
            if (TextUtils.isEmpty(amount)) {
                Toast.makeText(WalletActivity.this, "Enter amount", Toast.LENGTH_SHORT).show();
                return;
            }
            amountToAdd = amount;
            createRazorpayOrder(amount);
        });

        builder.setNegativeButton("Cancel", (dialog, which) -> dialog.cancel());

        builder.show();
    }

    private void createRazorpayOrder(String amount) {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("mobile", getRiderMobile());
            json.put("amount", amount);

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = APIClient.getInterface().createOrder(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "11");
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
        }
    }

    private void startRazorpayCheckout(String orderId) {
        Checkout checkout = new Checkout();
        checkout.setKeyID("rzp_test_Rr8n8p41taq6fM");
        try {
            JSONObject options = new JSONObject();
            options.put("name", riderData.getFullName());
            options.put("description", "Wallet Top-up");
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

    private void addWalletAmount(String amount, String razorpayPaymentId, String razorpayOrderId, String razorpaySignature) {
        custPrograssbar.prograssCreate(this);
        try {
            JSONObject json = new JSONObject();
            json.put("mobile", getRiderMobile());
            json.put("amount", amount);
            json.put("remark", "Ride Payment");
            json.put("wallet_type", "driver");
            json.put("razorpay_payment_id", razorpayPaymentId);
            json.put("razorpay_order_id", razorpayOrderId);
            json.put("razorpay_signature", razorpaySignature);

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = APIClient.getInterface().addWallet(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "4");

        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            e.printStackTrace();
        }
    }

    private void setVisibility(View v1, View v2, View v3, View v4, View v5, View v6,
            boolean b1, boolean b2, boolean b3, boolean b4, boolean b5, boolean b6) {

        v1.setVisibility(b1 ? View.VISIBLE : View.GONE);
        v2.setVisibility(b2 ? View.VISIBLE : View.GONE);
        v3.setVisibility(b3 ? View.VISIBLE : View.GONE);
        v4.setVisibility(b4 ? View.VISIBLE : View.GONE);
        v5.setVisibility(b5 ? View.VISIBLE : View.GONE);
        v6.setVisibility(b6 ? View.VISIBLE : View.GONE);
    }

    // ---------------- SEND WITHDRAW ----------------
    private void sendWithdraw(String amt, String type, String bank, String accNo,
            String accName, String ifsc, String upi, String paypal) {

        custPrograssbar.prograssCreate(this);

        try {
            JSONObject json = new JSONObject();
            json.put("rider_id", riderData.getId());
            json.put("amount", amt);

            RequestBody body = RequestBody.create(
                    json.toString(), MediaType.parse("application/json"));

            Call<JsonObject> call = APIClient.getInterface().requestWithdraw(body);
            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "2");

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
            if ("11".equals(callNo)) {
                if (result != null) {
                    String orderId = null;
                    if (result.has("OrderId") && !result.get("OrderId").isJsonNull()) {
                        orderId = result.get("OrderId").getAsString();
                    } else if (result.has("order_id") && !result.get("order_id").isJsonNull()) {
                        orderId = result.get("order_id").getAsString();
                    }

                    if (!TextUtils.isEmpty(orderId)) {
                        startRazorpayCheckout(orderId);
                    } else {
                        String msg = getMsgFromJson(result);
                        if (!TextUtils.isEmpty(msg)) {
                            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
                        }
                    }
                }
            } else if ("2".equals(callNo)) {
                String msg = getMsgFromJson(result);
                if (!TextUtils.isEmpty(msg)) {
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                }
                getEarning();

            } else if ("3".equals(callNo)) {

                WalletHistoryResponse response = new Gson().fromJson(result, WalletHistoryResponse.class);

                if (response != null && response.getResult() != null && response.getResult()) {

                    String balance = response.getWalletBalance();
                    if (TextUtils.isEmpty(balance) || "null".equalsIgnoreCase(balance)) {
                        balance = "0";
                    }

                    String points = response.getWalletPoints();
                    if (TextUtils.isEmpty(points) || "null".equalsIgnoreCase(points)) {
                        points = "0";
                    }

                    binding.txtAmount.setText(
                            sessionManager.getStringData(SessionManager.currency)
                                    + balance);

                    binding.txtPoints.setText("Points: " + points);

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
                    binding.recyTransaction.setVisibility(View.GONE);
                    binding.lvlNotfound.setVisibility(View.VISIBLE);
                }
            } else if ("4".equals(callNo)) { // Add Money Callback
                String msg = getMsgFromJson(result);
                if (!TextUtils.isEmpty(msg)) {
                    Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
                }
                getEarning(); // Refresh balance and transaction list
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public void onPaymentSuccess(String s, PaymentData paymentData) {
        addWalletAmount(amountToAdd, paymentData.getPaymentId(), paymentData.getOrderId(), paymentData.getSignature());
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
                remark = isCredit ? "Added to Wallet" : "Payout / Withdrawal";
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
}

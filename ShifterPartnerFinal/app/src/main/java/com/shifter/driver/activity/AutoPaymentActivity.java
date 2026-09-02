package com.shifter.driver.activity;

import android.content.Intent;
import android.graphics.Paint;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.razorpay.Checkout;
import com.razorpay.PaymentResultListener;
import com.shifter.driver.R;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONObject;

public class AutoPaymentActivity extends AppCompatActivity implements PaymentResultListener {

    private static final String TAG = "AutoPaymentActivity";

    private SessionManager sessionManager;
    private double chargeAmount = 0;
    private String mobileNumber = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_auto_payment);

        sessionManager = new SessionManager(this);

        chargeAmount   = getIntent().getDoubleExtra("auto_verification_charge", 0);
        double chargeOld = getIntent().getDoubleExtra("auto_verification_charge_old", 0);
        String chargeMsg  = getIntent().getStringExtra("auto_verification_msg");
        mobileNumber    = getIntent().getStringExtra("mobile");
        if (mobileNumber == null) mobileNumber = "";
        if (chargeMsg == null) chargeMsg = "";

        Checkout.preload(getApplicationContext());

        TextView tvOldPrice   = findViewById(R.id.tv_old_price);
        TextView tvNewPrice   = findViewById(R.id.tv_new_price);
        TextView tvPayMsg     = findViewById(R.id.tv_pay_msg);
        TextView btnPay       = findViewById(R.id.btn_pay_razorpay);

        if (chargeOld > 0) {
            tvOldPrice.setVisibility(View.VISIBLE);
            tvOldPrice.setText("\u20b9" + formatAmount(chargeOld));
            tvOldPrice.setPaintFlags(tvOldPrice.getPaintFlags() | Paint.STRIKE_THRU_TEXT_FLAG);
        } else {
            tvOldPrice.setVisibility(View.GONE);
        }

        tvNewPrice.setText("\u20b9" + formatAmount(chargeAmount));

        if (!chargeMsg.isEmpty()) {
            tvPayMsg.setVisibility(View.VISIBLE);
            tvPayMsg.setText(chargeMsg);
        } else {
            tvPayMsg.setVisibility(View.GONE);
        }

        btnPay.setText("Pay \u20b9" + formatAmount(chargeAmount) + " via Razorpay");
        btnPay.setOnClickListener(v -> startRazorpayPayment());
    }

    private String formatAmount(double amount) {
        if (amount == (long) amount) return String.valueOf((long) amount);
        return String.format("%.2f", amount);
    }

    private void startRazorpayPayment() {
        Checkout checkout = new Checkout();
        // TODO: Replace with your live Razorpay Key ID before going to production
        checkout.setKeyID("rzp_test_Rr8n8p41taq6fM");
        try {
            int amountInPaise = (int) (chargeAmount * 100);
            JSONObject options = new JSONObject();
            options.put("name", "Shifter Online");
            options.put("description", "Automatic Verification Charge");
            options.put("currency", "INR");
            options.put("amount", amountInPaise);
            JSONObject prefill = new JSONObject();
            prefill.put("contact", mobileNumber);
            options.put("prefill", prefill);
            JSONObject theme = new JSONObject();
            theme.put("color", "#1E88E5");
            options.put("theme", theme);
            checkout.open(this, options);
        } catch (Exception e) {
            Log.e(TAG, "Razorpay Error: " + e.getMessage(), e);
            Toast.makeText(this, "Payment failed to start: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public void onPaymentSuccess(String razorpayPaymentId) {
        Log.d(TAG, "Payment Success: " + razorpayPaymentId);
        Toast.makeText(this, "Payment Successful! Welcome to Shifter.", Toast.LENGTH_LONG).show();
        sessionManager.setBooleanData(SessionManager.login, true);
        Intent intent = new Intent(AutoPaymentActivity.this, HomeActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    @Override
    public void onPaymentError(int code, String response) {
        Log.e(TAG, "Payment Error [" + code + "]: " + response);
        String msg;
        switch (code) {
            case Checkout.PAYMENT_CANCELED:
                msg = "Payment cancelled. Please try again.";
                break;
            case Checkout.NETWORK_ERROR:
                msg = "Network error. Check your connection and retry.";
                break;
            default:
                msg = "Payment failed. Please try again.";
                break;
        }
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    @Override
    public void onBackPressed() {
        Toast.makeText(this, "Please complete payment to continue.", Toast.LENGTH_SHORT).show();
    }
}

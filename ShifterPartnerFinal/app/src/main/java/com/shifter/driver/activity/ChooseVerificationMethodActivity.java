package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;

import retrofit2.Call;

public class ChooseVerificationMethodActivity extends AppCompatActivity implements GetResult.MyListener {

    private LinearLayout llAutomatic, llManual;
    private View rbAutomatic, rbManual;
    private TextView btnNext;
    private String selectedMethod = "automatic";

    private int manualRegistration = 0;
    private int autoVerification = 0;
    private String mobileNumber;
    private CustPrograssbar custPrograssbar;

    // Payment values from API — passed to next screens
    private double autoVerificationCharge = 0;
    private double autoVerificationChargeOld = 0;
    private String autoVerificationMsg = "";
    private boolean pendingPayment = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_choose_verification_method);
        mobileNumber = getIntent().getStringExtra("mobile");

        custPrograssbar = new CustPrograssbar();

        initViews();
        setupClickListeners();
        fetchRegistrationSettings();
    }

    private void initViews() {
        llAutomatic = findViewById(R.id.ll_automatic);
        llManual = findViewById(R.id.ll_manual);
        rbAutomatic = findViewById(R.id.rb_automatic);
        rbManual = findViewById(R.id.rb_manual);
        btnNext = findViewById(R.id.btn_next);
    }

    private void setupClickListeners() {
        llAutomatic.setOnClickListener(v -> selectMethod("automatic"));
        llManual.setOnClickListener(v -> selectMethod("manual"));
        btnNext.setOnClickListener(v -> navigateToNextScreen());
    }

    private void navigateToNextScreen() {
        Intent intent = new Intent(ChooseVerificationMethodActivity.this, NewRegistrationActivity.class);
        intent.putExtra("verification_method", selectedMethod);
        intent.putExtra("mobile", mobileNumber);
        intent.putExtra("auto_verification_charge", autoVerificationCharge);
        intent.putExtra("auto_verification_charge_old", autoVerificationChargeOld);
        intent.putExtra("auto_verification_msg", autoVerificationMsg);
        startActivity(intent);
        finish();
    }

    private void navigateToPaymentScreen() {
        Intent intent = new Intent(ChooseVerificationMethodActivity.this, AutoPaymentActivity.class);
        intent.putExtra("mobile", mobileNumber);
        intent.putExtra("auto_verification_charge", autoVerificationCharge);
        intent.putExtra("auto_verification_charge_old", autoVerificationChargeOld);
        intent.putExtra("auto_verification_msg", autoVerificationMsg);
        startActivity(intent);
        finish();
    }

    private void selectMethod(String method) {
        selectedMethod = method;
        if (method.equals("automatic")) {
            llAutomatic.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_card_selectable));
            llManual.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_card_normal));
            rbAutomatic.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_radio_selected));
            rbManual.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_radio_unselected));
        } else {
            llAutomatic.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_card_normal));
            llManual.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_card_selectable));
            rbAutomatic.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_radio_unselected));
            rbManual.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_radio_selected));
        }
    }

    private void fetchRegistrationSettings() {
        custPrograssbar.prograssCreate(this);
        okhttp3.RequestBody body = okhttp3.RequestBody.create(
                okhttp3.MediaType.parse("application/json; charset=utf-8"),
                "{\"rid\":\"1\"}"
        );
        Call<JsonObject> call = APIClient.getInterface().getRegistrationSettings(body);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

    private void applyVisibility() {
        // If pending_payment is true → directly go to payment screen
        if (pendingPayment) {
            navigateToPaymentScreen();
            return;
        }

        llAutomatic.setVisibility(autoVerification == 1 ? View.VISIBLE : View.GONE);
        llManual.setVisibility(manualRegistration == 1 ? View.VISIBLE : View.GONE);

        if (autoVerification == 1 && manualRegistration == 0) {
            selectMethod("automatic");
            navigateToNextScreen();
        } else if (autoVerification == 0 && manualRegistration == 1) {
            selectMethod("manual");
            navigateToNextScreen();
        } else if (autoVerification == 1 && manualRegistration == 1) {
            selectMethod("automatic");
        } else {
            showMessage("No verification method available");
            btnNext.setEnabled(false);
            btnNext.setAlpha(0.5f);
        }
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        custPrograssbar.closePrograssBar();
        try {
            if (callNo.equalsIgnoreCase("1")) {
                String apiResult = result.has("Result") ? result.get("Result").getAsString() : "false";

                if (apiResult.equalsIgnoreCase("true")) {
                    manualRegistration = result.has("manual_registration")
                            ? result.get("manual_registration").getAsInt() : 0;
                    autoVerification = result.has("auto_verification")
                            ? result.get("auto_verification").getAsInt() : 0;
                    autoVerificationCharge = result.has("auto_verification_charge")
                            ? result.get("auto_verification_charge").getAsDouble() : 0;
                    autoVerificationChargeOld = result.has("auto_verification_charge_old")
                            ? result.get("auto_verification_charge_old").getAsDouble() : 0;
                    autoVerificationMsg = result.has("auto_verification_msg")
                            ? result.get("auto_verification_msg").getAsString() : "";
                    pendingPayment = result.has("pending_payment")
                            && result.get("pending_payment").getAsBoolean();

                    Log.d("SETTINGS", "manual=" + manualRegistration + ", auto=" + autoVerification
                            + ", charge=" + autoVerificationCharge + ", pending=" + pendingPayment);
                    applyVisibility();
                } else {
                    showMessage("Failed to load settings");
                }
            }
        } catch (Exception e) {
            Log.e("SETTINGS_ERROR", e.getMessage());
            e.printStackTrace();
        }
    }

    private void showMessage(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }
}

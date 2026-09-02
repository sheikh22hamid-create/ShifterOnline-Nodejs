package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.os.CountDownTimer;
import android.text.Editable;
import android.text.TextWatcher;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityOtpBinding;
import com.shifter.driver.model.Login;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class SendOTPActivity extends AppCompatActivity implements GetResult.MyListener {

    private ActivityOtpBinding binding;
    private String mobile, code;
    private CountDownTimer countDownTimer;
    private CustPrograssbar custPrograssbar;
    private static final long TIMER_DURATION = 45000; // 45 seconds
    private static final long TIMER_INTERVAL = 1000; // 1 second
    private String fcmTokenStr = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityOtpBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        custPrograssbar = new CustPrograssbar();
        getFCMToken();

        // Get data from Intent
        mobile = getIntent().getStringExtra("mobile");
        code = getIntent().getStringExtra("code");

        // Set mobile number text
        binding.txtMob.setText("Enter the OTP sent to\n" + code + " " + formatMobile(mobile));

        // Setup OTP auto-focus logic
        setupOtpInputs();

        // Start resend timer
        startResendTimer();

        // Click listeners
        binding.imgBack.setOnClickListener(v -> finish());
        binding.btnSend.setOnClickListener(v -> verifyOtp());
        binding.btnReenter.setOnClickListener(v -> resendOtp());
    }

    private void getFCMToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                fcmTokenStr = task.getResult();
            }
        });
    }

    /**
     * 🔥 Auto-focus: ek box fill hone pe next pe jump
     */
    private void setupOtpInputs() {
        EditText[] otpBoxes = {
                binding.edOtp1, binding.edOtp2, binding.edOtp3,
                binding.edOtp4, binding.edOtp5, binding.edOtp6
        };

        for (int i = 0; i < otpBoxes.length; i++) {
            final int index = i;

            otpBoxes[i].addTextChangedListener(new TextWatcher() {
                @Override
                public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

                @Override
                public void onTextChanged(CharSequence s, int start, int before, int count) {
                    if (s.length() == 1 && index < otpBoxes.length - 1) {
                        // Next box pe focus
                        otpBoxes[index + 1].requestFocus();
                    } else if (s.length() == 0 && index > 0) {
                        // Backspace pe previous box
                        otpBoxes[index - 1].requestFocus();
                    }

                    // Auto-verify jab 6 digits ho jaye
                    if (getOtp().length() == 6) {
                        verifyOtp();
                    }
                }

                @Override
                public void afterTextChanged(Editable s) {}
            });
        }
    }

    /**
     * 🔥 OTP string banata hai 6 boxes se
     */
    private String getOtp() {
        return binding.edOtp1.getText().toString().trim()
                + binding.edOtp2.getText().toString().trim()
                + binding.edOtp3.getText().toString().trim()
                + binding.edOtp4.getText().toString().trim()
                + binding.edOtp5.getText().toString().trim()
                + binding.edOtp6.getText().toString().trim();
    }

    /**
     * 🔥 OTP verify karta hai
     */
    private void verifyOtp() {
        String otp = getOtp();

        if (otp.length() != 6) {
            showMessage("Please enter complete 6-digit OTP");
            return;
        }

        // API call: verify OTP
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("mobile", mobile);
            jsonObject.put("otp", otp);
            jsonObject.put("fcm_token", fcmTokenStr);
            jsonObject.put("device_id", com.shifter.driver.utility.Utility.getDeviceId(SendOTPActivity.this));

        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(
                MediaType.parse("application/json"), jsonObject.toString());

        custPrograssbar.prograssCreate(this);
        Call<JsonObject> call = APIClient.getInterface().verifyOtp(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "2");
    }

    /**
     * 🔥 OTP resend karta hai
     */
    private void resendOtp() {
        // Reset timer
        startResendTimer();

        // API call: resend OTP
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("mobile", mobile);
            jsonObject.put("ccode", code);
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(
                MediaType.parse("application/json"), jsonObject.toString());

        custPrograssbar.prograssCreate(this);
        Call<JsonObject> call = APIClient.getInterface().sendOTP(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");

        showMessage("OTP resent successfully!");
    }

    /**
     * 🔥 45 second countdown timer
     */
    private void startResendTimer() {
        binding.btnReenter.setVisibility(View.GONE);
        binding.btnTimer.setVisibility(View.VISIBLE);

        if (countDownTimer != null) {
            countDownTimer.cancel();
        }

        countDownTimer = new CountDownTimer(TIMER_DURATION, TIMER_INTERVAL) {
            @Override
            public void onTick(long millisUntilFinished) {
                long seconds = millisUntilFinished / 1000;
                binding.btnTimer.setText("Resend in 00:" + String.format("%02d", seconds));
            }

            @Override
            public void onFinish() {
                binding.btnTimer.setVisibility(View.GONE);
                binding.btnReenter.setVisibility(View.VISIBLE);
            }
        }.start();
    }

    /**
     * 🔥 Mobile number format: 98765 43210
     */
    private String formatMobile(String mobile) {
        if (mobile == null || mobile.length() != 10) return mobile;
        return mobile.substring(0, 5) + " " + mobile.substring(5);
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        custPrograssbar.closePrograssBar();
        try {
            // ===============================
            // "1" = OTP RESENT
            // ===============================
            if (callNo.equalsIgnoreCase("1")) {
                String apiResult = "false";
                if (result.has("Result") && !result.get("Result").isJsonNull()) apiResult = result.get("Result").getAsString();
                else if (result.has("result") && !result.get("result").isJsonNull()) apiResult = result.get("result").getAsString();

                String msg = "Failed";
                if (result.has("ResponseMsg") && !result.get("ResponseMsg").isJsonNull()) msg = result.get("ResponseMsg").getAsString();
                else if (result.has("message") && !result.get("message").isJsonNull()) msg = result.get("message").getAsString();

                if (!apiResult.equalsIgnoreCase("true")) {
                    showMessage(msg);
                }
            }

            // ===============================
            // "2" = OTP VERIFIED
            // ===============================
            else if (callNo.equalsIgnoreCase("2")) {
                String apiResult = "false";
                if (result.has("Result") && !result.get("Result").isJsonNull()) apiResult = result.get("Result").getAsString();
                else if (result.has("result") && !result.get("result").isJsonNull()) apiResult = result.get("result").getAsString();

                String msg = "OTP verification failed";
                if (result.has("ResponseMsg") && !result.get("ResponseMsg").isJsonNull()) msg = result.get("ResponseMsg").getAsString();
                else if (result.has("message") && !result.get("message").isJsonNull()) msg = result.get("message").getAsString();

                if (!apiResult.equalsIgnoreCase("true")) {
                    showMessage(msg);
                    return;
                }

                // ✅ OTP verified - ab check karo user registered hai ya nahi
                String isNewUser = result.has("Is_New_User")
                        ? result.get("Is_New_User").getAsString() : "0";

                if ("0".equals(isNewUser)) {
                    // ✅ EXISTING DRIVER - Login data parse karo
                    handleExistingUser(result);
                } else {
                    // ❌ NEW DRIVER - Registration pe bhejo
                    openChooseVerificationMethod();
                }
            }

        } catch (Exception e) {
            e.printStackTrace();
            showMessage("Something went wrong");
        }
    }

    /**
     * 🔥 Existing user ka data parse karke session save karta hai aur
     * verification status ke hisaab se Home ya Verification screen pe bhejta hai.
     * API Response: {"Is_New_User":"0", "rider_data":{...}}
     */
    private void handleExistingUser(JsonObject result) {
        try {
            Gson gson = new Gson();
            Login loginData = gson.fromJson(result.toString(), Login.class);

            if (loginData == null) {
                showMessage("Login data error");
                return;
            }

            // 🔥 Check Is_New_User first
            String isNewUser = loginData.getIsNewUser();

            // ❌ Is_New_User = "1" means NEW driver (no RiderData) — safety net,
            // callback() already routes new users here without calling this method,
            // but guard again in case Login model disagrees with the raw JSON.
            if ("1".equals(isNewUser)) {
                openChooseVerificationMethod();
                return;
            }

            // ✅ Is_New_User = "0" means EXISTING driver
            com.shifter.driver.model.RiderData riderData = loginData.getRiderData();

            if (riderData == null) {
                showMessage("Rider data not found");
                return;
            }

            // 🔥 Save session
            SessionManager sessionManager = new SessionManager(this);
            sessionManager.setUserDetails(riderData);  // ✅ NEW method
            sessionManager.setBooleanData(SessionManager.login, true);

            // 🔥 Check verification status
            String allVerify = riderData.getVerificationStatus();

            if (allVerify != null && "approved".equalsIgnoreCase(allVerify)) {
                // Training skipped for now -> directly navigate to HomeActivity
                openHome();
            } else {
                // ⚠️ Verification pending
                openChooseVerificationMethod();
            }

        } catch (Exception e) {
            e.printStackTrace();
            showMessage("Failed to process login data");
        }
    }

    private void checkTrainingGateAndProceed(int riderId) {
        if (custPrograssbar != null) {
            custPrograssbar.prograssCreate(this);
        }

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", String.valueOf(riderId));
            jsonObject.put("rid", String.valueOf(riderId));
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getTrainingStatus(body);

        call.enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(@androidx.annotation.NonNull Call<JsonObject> call, @androidx.annotation.NonNull retrofit2.Response<JsonObject> response) {
                if (custPrograssbar != null) {
                    custPrograssbar.closePrograssBar();
                }
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject res = response.body();
                    if (res.has("Result") && res.get("Result").getAsString().equalsIgnoreCase("true")) {
                        Gson gson = new Gson();
                        com.shifter.driver.model.TrainingData data = gson.fromJson(res.toString(), com.shifter.driver.model.TrainingData.class);

                        // If training is optional or already completed -> Home
                        if (data != null && (data.getTrainingRequired() == 0 || data.isCompleted())) {
                            openHome();
                            return;
                        } else if (data != null) {
                            // Open Mandatory Training Video Screen
                            Intent trainingIntent = new Intent(SendOTPActivity.this, TrainingVideoActivity.class);
                            trainingIntent.putExtra("video_url", data.getVideoUrl());
                            trainingIntent.putExtra("video_id", data.getVideoId());
                            trainingIntent.putExtra("video_title", data.getVideoTitle());
                            trainingIntent.putExtra("current_position_seconds", data.getCurrentPositionSeconds());
                            trainingIntent.putExtra("watch_progress", data.getWatchProgress());
                            trainingIntent.putExtra("is_completed", data.isCompleted());
                            trainingIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                            startActivity(trainingIntent);
                            finish();
                            return;
                        }
                    }
                }
                // Fallback: Open Training Screen
                Intent trainingIntent = new Intent(SendOTPActivity.this, TrainingVideoActivity.class);
                trainingIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(trainingIntent);
                finish();
            }

            @Override
            public void onFailure(@androidx.annotation.NonNull Call<JsonObject> call, @androidx.annotation.NonNull Throwable t) {
                if (custPrograssbar != null) {
                    custPrograssbar.closePrograssBar();
                }
                Intent trainingIntent = new Intent(SendOTPActivity.this, TrainingVideoActivity.class);
                trainingIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                startActivity(trainingIntent);
                finish();
            }
        });
    }

    private void openHome() {
        Intent i = new Intent(this, HomeActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(i);
        finish();
    }

    private void openChooseVerificationMethod() {
        Intent i = new Intent(this, ChooseVerificationMethodActivity.class);
        i.putExtra("mobile", mobile);
        i.putExtra("code", code);
        startActivity(i);
        finish();
    }

    private void showMessage(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (countDownTimer != null) {
            countDownTimer.cancel();
        }
    }
}
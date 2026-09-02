package com.shifter.driver.activity;

import static androidx.constraintlayout.helper.widget.MotionEffect.TAG;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.annotation.RequiresApi;
import androidx.appcompat.app.AppCompatActivity;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityLoginBinding;
import com.shifter.driver.model.Login;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class LoginActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityLoginBinding binding;
    String codeSelect;
    SessionManager sessionManager;
    CustPrograssbar custPrograssbar;

    @RequiresApi(api = Build.VERSION_CODES.M)
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityLoginBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        getCountryCode();



        // Button click - ab sirf OTP bhejega
        binding.btnSendOtp.setOnClickListener(this::onBindClick);
    }

    public void onBindClick(View view) {
        if (view.getId() == R.id.btn_send_otp) {
            // Validate mobile number
            String mobile = binding.edMobile.getText().toString().trim();
            if (mobile.isEmpty()) {
                showMessage("Please enter mobile number");
                return;
            }
            if (mobile.length() != 10) {
                showMessage("Please enter valid 10 digit mobile number");
                return;
            }
            // Direct OTP bhejo - password check nahi hoga
            sendOtp(mobile);
        }
    }

    /**
     * 🔥 NEW: Direct OTP bhejta hai - password check nahi karta
     */
    private void sendOtp(String mobile) {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("mobile", mobile);
            jsonObject.put("ccode", "+91");
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(
                MediaType.parse("application/json"), jsonObject.toString());

        custPrograssbar.prograssCreate(this);
        Call<JsonObject> call = APIClient.getInterface().sendOTP(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1"); // "1" = OTP sent
    }

    /**
     * 🔥 NEW: OTP verify karne ke baad user check karega
     */
    private void verifyOtpAndCheckUser(String mobile, String otp) {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("mobile", mobile);
            jsonObject.put("ccode", "+91");
            jsonObject.put("otp", otp);
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(
                MediaType.parse("application/json"), jsonObject.toString());

        custPrograssbar.prograssCreate(this);
        Call<JsonObject> call = APIClient.getInterface().sendOTP(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "2"); // "2" = OTP verified, now check user
    }

    /**
     * 🔥 NEW: OTP verify hone ke baad login karega (FCM token ke saath)
     */
    private void loginAfterOtp(String mobile) {
        FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    String fcmToken = "";
                    if (!task.isSuccessful()) {
                    } else {
                        fcmToken = task.getResult();
                    }

                    JSONObject jsonObject = new JSONObject();
                    try {
                        jsonObject.put("mobile", mobile);
                        jsonObject.put("ccode", "+91");
                        jsonObject.put("fcm_token", fcmToken != null ? fcmToken : "");
                        jsonObject.put("device_id", com.shifter.driver.utility.Utility.getDeviceId(LoginActivity.this));
                        // ❌ NO PASSWORD - OTP se verify ho chuka hai
                    } catch (JSONException e) {
                        e.printStackTrace();
                    }

                    RequestBody bodyRequest = RequestBody.create(
                            MediaType.parse("application/json"), jsonObject.toString());

                    custPrograssbar.prograssCreate(LoginActivity.this);
                    Call<JsonObject> call = APIClient.getInterface().riderLogin(bodyRequest);
                    GetResult getResult = new GetResult();
                    getResult.setMyListener(LoginActivity.this);
                    getResult.callForLogin(call, "4"); // "4" = Login
                });
    }

    private void getCountryCode() {
        List<String> countryCodes = new ArrayList<>();
        countryCodes.add("+91");

        ArrayAdapter<String> dataAdapter = new ArrayAdapter<>(this,
                android.R.layout.simple_spinner_dropdown_item, countryCodes);
        dataAdapter.setDropDownViewResource(android.R.layout.simple_spinner_item);
        //binding.spinner.setAdapter(dataAdapter);
        codeSelect = "+91";
    }

    Login loginData;

    @Override
    public void callback(JsonObject result, String callNo) {
        custPrograssbar.closePrograssBar();
        try {

            // ===============================
            // "1" = OTP SENT SUCCESSFULLY
            // ===============================
            if (callNo.equalsIgnoreCase("1")) {
                String apiResult = "false";
                if (result.has("Result") && !result.get("Result").isJsonNull()) apiResult = result.get("Result").getAsString();
                else if (result.has("result") && !result.get("result").isJsonNull()) apiResult = result.get("result").getAsString();

                String msg = "Failed to send OTP";
                if (result.has("ResponseMsg") && !result.get("ResponseMsg").isJsonNull()) msg = result.get("ResponseMsg").getAsString();
                else if (result.has("message") && !result.get("message").isJsonNull()) msg = result.get("message").getAsString();

                if (apiResult.equalsIgnoreCase("true")) {
                    showMessage("OTP sent successfully!");
                    // OTP screen pe le jao
                    openOtpScreen();
                } else {
                    showMessage(msg);
                }
            }

            // ===============================
            // "2" = OTP VERIFIED - CHECK USER
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

                // ✅ OTP sahi hai - ab dekho user registered hai ya nahi
                String isRegistered = result.has("is_registered")
                        ? result.get("is_registered").getAsString() : "0";

                String mobile = binding.edMobile.getText().toString().trim();

                if ("1".equals(isRegistered)) {
                    // ✅ User already registered hai - login karo
                    loginAfterOtp(mobile);
                } else {
                    // ❌ Naya user hai - registration pe bhejo
                    openPersonalInfo(mobile);
                }
            }

            // ===============================
            // "4" = LOGIN SUCCESS
            // ===============================
            else if (callNo.equalsIgnoreCase("4")) {
                String apiResult = "false";
                if (result.has("Result") && !result.get("Result").isJsonNull()) apiResult = result.get("Result").getAsString();
                else if (result.has("result") && !result.get("result").isJsonNull()) apiResult = result.get("result").getAsString();

                String msg = "Login failed";
                if (result.has("ResponseMsg") && !result.get("ResponseMsg").isJsonNull()) msg = result.get("ResponseMsg").getAsString();
                else if (result.has("message") && !result.get("message").isJsonNull()) msg = result.get("message").getAsString();

                if (!apiResult.equalsIgnoreCase("true")) {
                    showMessage(msg);
                    return;
                }

                if (!result.has("rider_data") || result.get("rider_data").isJsonNull()) {
                    showMessage("Invalid user data. Please contact support.");
                    return;
                }

                Gson gson = new Gson();
                loginData = gson.fromJson(result.toString(), Login.class);

                if (loginData == null || loginData.getRiderData() == null) {
                    showMessage("User data error");
                    return;
                }

                sessionManager.setUserDetails(loginData.getRiderData());
                sessionManager.setBooleanData(SessionManager.login, true);

                String allVerify = loginData.getRiderData().getVerificationStatus();
                if (allVerify != null && allVerify.equals("approved")) {
                    openHome();
                } else {
                    Intent intent = new Intent(LoginActivity.this, ChooseVerificationMethodActivity.class);
                    intent.putExtra("mobile", loginData.getRiderData().getMobile());
                    intent.putExtra("code", "+91");
                    startActivity(intent);
                    finish();
                }
            }

        } catch (Exception e) {
            showMessage("Unexpected error occurred");
        }
    }

    // ===============================
    // NAVIGATION METHODS
    // ===============================

    private void openOtpScreen() {
        Intent i = new Intent(this, SendOTPActivity.class);
        i.putExtra("code", "+91");
        i.putExtra("mobile", binding.edMobile.getText().toString().trim());
        startActivityForResult(i, 100); // Request code 100 for OTP result
    }

    private void openPersonalInfo(String mobile) {
        Intent i = new Intent(this, PersonalInfoActivity.class);
        i.putExtra("code", "+91");
        i.putExtra("mobile", mobile);
        startActivity(i);
        finish();
    }

    /*private void openVerification() {
        Intent i = new Intent(this, VerificationProcessActivity.class);
        startActivity(i);
        finish();
    }*/

    private void openHome() {
        if (loginData != null && loginData.getRiderData() != null) {
            int riderId = loginData.getRiderData().getId();
            JSONObject jsonObject = new JSONObject();
            try {
                jsonObject.put("rider_id", String.valueOf(riderId));
                jsonObject.put("rid", String.valueOf(riderId));
            } catch (Exception ignored) {}

            RequestBody body = RequestBody.create(
                    MediaType.parse("application/json"), jsonObject.toString());

            custPrograssbar.prograssCreate(this);
            APIClient.getInterface().getTrainingStatus(body).enqueue(new retrofit2.Callback<JsonObject>() {
                @Override
                public void onResponse(@androidx.annotation.NonNull Call<JsonObject> call, @androidx.annotation.NonNull retrofit2.Response<JsonObject> response) {
                    custPrograssbar.closePrograssBar();
                    if (response.isSuccessful() && response.body() != null) {
                        JsonObject res = response.body();
                        if (res.has("Result") && res.get("Result").getAsString().equalsIgnoreCase("true")) {
                            com.shifter.driver.model.TrainingData tData = new Gson().fromJson(res.toString(), com.shifter.driver.model.TrainingData.class);
                            if (tData != null && (tData.getTrainingRequired() == 0 || tData.isCompleted())) {
                                Intent i = new Intent(LoginActivity.this, HomeActivity.class);
                                startActivity(i);
                                finish();
                                return;
                            } else if (tData != null) {
                                Intent trainingIntent = new Intent(LoginActivity.this, TrainingVideoActivity.class);
                                trainingIntent.putExtra("video_url", tData.getVideoUrl());
                                trainingIntent.putExtra("video_id", tData.getVideoId());
                                trainingIntent.putExtra("video_title", tData.getVideoTitle());
                                trainingIntent.putExtra("current_position_seconds", tData.getCurrentPositionSeconds());
                                trainingIntent.putExtra("watch_progress", tData.getWatchProgress());
                                trainingIntent.putExtra("is_completed", tData.isCompleted());
                                startActivity(trainingIntent);
                                finish();
                                return;
                            }
                        }
                    }
                    // Fallback to TrainingVideoActivity
                    Intent i = new Intent(LoginActivity.this, TrainingVideoActivity.class);
                    startActivity(i);
                    finish();
                }

                @Override
                public void onFailure(@androidx.annotation.NonNull Call<JsonObject> call, @androidx.annotation.NonNull Throwable t) {
                    custPrograssbar.closePrograssBar();
                    Intent i = new Intent(LoginActivity.this, TrainingVideoActivity.class);
                    startActivity(i);
                    finish();
                }
            });
            return;
        }

        Intent i = new Intent(this, HomeActivity.class);
        startActivity(i);
        finish();
    }

    private void showMessage(String msg) {
        android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_LONG).show();
    }

    // ===============================
    // OTP Activity se result receive
    // ===============================
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 100 && resultCode == RESULT_OK && data != null) {
            String otp = data.getStringExtra("otp");
            String mobile = binding.edMobile.getText().toString().trim();
            if (otp != null) {
                verifyOtpAndCheckUser(mobile, otp);
            }
        }
    }
}
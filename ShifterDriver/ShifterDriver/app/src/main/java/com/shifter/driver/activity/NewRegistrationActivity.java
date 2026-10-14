package com.shifter.driver.activity;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.Editable;
import android.text.InputFilter;
import android.text.Spanned;
import android.text.TextWatcher;
import android.util.Log;
import android.util.Patterns;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.ScrollView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import com.google.gson.Gson;
import com.shifter.driver.model.RiderData;

import java.util.HashMap;
import java.util.Map;

import java.io.File;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class NewRegistrationActivity extends LocaleAwareActivity {

    private String verificationMethod;
    private String mobileNumber;
    private LinearLayout llFullName, llModeIndicator, llAadhaarBackContainer;
    private TextView tvSubtitle, tvModeTitle, tvModeText, tvFooterNote, btnNextDetails, tvAadhaarLabel;
    private ImageView imgModeIcon, btnDobCalendar;
    private Spinner spinnerVehicleType, spinnerCity;
    private List<String> cityIds = new ArrayList<>();
    private EditText edFullName, edEmail, edDob, edAccName, edAccNumber, edIfsc, edVehicleNo, edReferralCode;
    private TextView btnAadhaar, btnAadhaarBack, btnDl, btnRc, btnPan;
    private TextView tvAadhaarStatus, tvAadhaarBackStatus, tvDlStatus, tvRcStatus, tvPanStatus;

    private CustPrograssbar custPrograssbar;
    private SessionManager sessionManager;
    private ImagePicker imagePicker;
    private static final int REQ_LIVE_FACE = 808;

    private boolean isAadhaarAutoVerified = false;
    private boolean isPanAutoVerified = false;
    private boolean isDlAutoVerified = false;
    private boolean isRcAutoVerified = false;
    private String aadhaarNumber = "";
    private String panNumber = "";
    private String rcNumber = "";
    private String dlNumber = "";
    // Only set when the RC's registered owner isn't the driver - the app ran
    // a separate UIDAI eKYC OTP check against this name before letting the
    // driver proceed (see AutoVerificationManager.startOwnerAadhaarVerification),
    // but that result never left the RC dialog before now.
    private String rcOwnerName = "";
    private String rcOwnerAadhaarNumber = "";
    private com.shifter.driver.utility.AutoVerificationManager autoVerificationManager;

    private String currentDocType = "";
    private String profilePhotoPath = "";
    private String pucImagePath = "";
    private String bimaImagePath = "";
    private String fcmTokenStr = "";
    // RC front/back picked via the "Upload RC Images Instead" fallback
    // before the driver account exists - vehicle_detail_save can't be
    // called yet (no rider_id), so these are uploaded right after
    // registerUserAutomatic() succeeds (see its success callback).
    private String rcFrontManualPath = "";
    private String rcBackManualPath = "";

    // Payment values received from ChooseVerificationMethodActivity
    private double autoVerificationCharge = 0;
    private double autoVerificationChargeOld = 0;
    private String autoVerificationMsg = "";
    // True when driver has already submitted details but payment is still pending
    private boolean pendingPaymentMode = false;

    // IFSC format: 4 letters + 0 + 6 alphanumeric (e.g. SBIN0000466)
    private static final Pattern IFSC_PATTERN = Pattern.compile("^[A-Z]{4}0[A-Z0-9]{6}$");
    // Bank account number: 9 to 18 digits (covers most Indian banks)
    private static final Pattern ACCOUNT_NUMBER_PATTERN = Pattern.compile("^\\d{9,18}$");
    // Only letters and spaces for names
    private static final Pattern NAME_PATTERN = Pattern.compile("^[a-zA-Z ]{2,50}$");

    /**
     * 🔥 UI-level filter: type karte hi space block ho jata hai aur
     * har character upper-case mein convert ho jata hai (sirf display
     * ke liye "textAllCaps" kaafi nahi tha kyunki underlying value
     * lowercase hi rehti thi — ye filter actual EditText value ko
     * upper-case + space-free rakhta hai).
     */
    private static final InputFilter NO_SPACE_UPPERCASE_FILTER = new InputFilter() {
        @Override
        public CharSequence filter(CharSequence source, int start, int end, Spanned dest, int dstart, int dend) {
            StringBuilder result = new StringBuilder();
            for (int i = start; i < end; i++) {
                char c = source.charAt(i);
                if (!Character.isWhitespace(c)) {
                    result.append(Character.toUpperCase(c));
                }
            }
            // Agar kuch filter/change nahi hua to null return karo (original behaviour)
            if (result.length() == (end - start)) {
                boolean unchanged = true;
                for (int i = 0; i < result.length(); i++) {
                    if (result.charAt(i) != source.charAt(start + i)) {
                        unchanged = false;
                        break;
                    }
                }
                if (unchanged) return null;
            }
            return result.toString();
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Safe View Edge-to-Edge setup
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().setStatusBarColor(Color.TRANSPARENT);
        getWindow().setNavigationBarColor(Color.TRANSPARENT);

        setContentView(R.layout.activity_new_registration);

        // Apply Window Insets for Safe View top & bottom padding
        View rootLayout = findViewById(R.id.root_layout);
        View topBar = findViewById(R.id.ll_top_bar);
        View bottomAction = findViewById(R.id.ll_bottom_action);

        if (rootLayout != null) {
            ViewCompat.setOnApplyWindowInsetsListener(rootLayout, (v, windowInsets) -> {
                Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
                if (topBar != null) {
                    topBar.setPadding(
                            topBar.getPaddingLeft(),
                            insets.top + (int) (12 * getResources().getDisplayMetrics().density),
                            topBar.getPaddingRight(),
                            (int) (12 * getResources().getDisplayMetrics().density)
                    );
                }
                if (bottomAction != null) {
                    bottomAction.setPadding(
                            bottomAction.getPaddingLeft(),
                            (int) (12 * getResources().getDisplayMetrics().density),
                            bottomAction.getPaddingRight(),
                            insets.bottom + (int) (16 * getResources().getDisplayMetrics().density)
                    );
                }
                return WindowInsetsCompat.CONSUMED;
            });
        }

        View btnBack = findViewById(R.id.btn_back);
        if (btnBack != null) {
            btnBack.setOnClickListener(v -> getOnBackPressedDispatcher().onBackPressed());
        }

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        imagePicker = new ImagePicker();

        verificationMethod = getIntent().getStringExtra("verification_method");
        mobileNumber = getIntent().getStringExtra("mobile");

        if (verificationMethod == null) verificationMethod = "automatic";
        if (mobileNumber == null) mobileNumber = "";

        // Read payment values passed from ChooseVerificationMethodActivity
        autoVerificationCharge    = getIntent().getDoubleExtra("auto_verification_charge", 0);
        autoVerificationChargeOld = getIntent().getDoubleExtra("auto_verification_charge_old", 0);
        autoVerificationMsg       = getIntent().getStringExtra("auto_verification_msg");
        pendingPaymentMode        = getIntent().getBooleanExtra("pending_payment", false);
        if (autoVerificationMsg == null) autoVerificationMsg = "";

        // If pending payment mode and charge > 0, skip straight to payment once loaded
        // (driver already submitted details before — no need to block them on the form)
        // Removed: we now always show the form so driver can review/update before paying.

        autoVerificationManager = new com.shifter.driver.utility.AutoVerificationManager(this, (docType, docNumber, dataJson) -> {
            switch (docType) {
                case "aadhaar":
                    isAadhaarAutoVerified = true;
                    aadhaarNumber = docNumber;
                    tvAadhaarStatus.setText("Verified ✓ (" + docNumber + ")");
                    tvAadhaarStatus.setTextColor(Color.parseColor("#4CAF50"));
                    btnAadhaar.setText("Verified");
                    btnAadhaar.setEnabled(false);
                    btnAadhaar.setAlpha(0.6f);
                    // Name + DOB were just cryptographically confirmed against the
                    // Aadhaar PDF - lock them so they can't drift from what was
                    // actually verified before the driver submits registration.
                    lockNameAndDobFields();
                    saveVerifiedDocsLocal();
                    break;
                case "pan":
                    isPanAutoVerified = true;
                    panNumber = docNumber;
                    tvPanStatus.setText("Verified ✓ (" + docNumber + ")");
                    tvPanStatus.setTextColor(Color.parseColor("#4CAF50"));
                    btnPan.setText("Verified");
                    btnPan.setEnabled(false);
                    btnPan.setAlpha(0.6f);
                    saveVerifiedDocsLocal();
                    break;
                case "rc":
                    isRcAutoVerified = true;
                    rcNumber = docNumber;
                    if (edVehicleNo != null && edVehicleNo.getText().toString().trim().isEmpty()) {
                        edVehicleNo.setText(docNumber);
                    }
                    // Two very different outcomes share this "rc" callback:
                    // an instant Acko owner-name match ("Verified"), or the
                    // name-mismatch fallback's RC-photo pick, which is only
                    // queued for admin review - never claim "Verified" for
                    // that one, and stash the local paths so
                    // uploadManualRcPhotos() can send them once
                    // registerUserAutomatic() has a rider_id to attach them to.
                    boolean pendingManualReview = false;
                    if (dataJson != null && !dataJson.trim().isEmpty()) {
                        try {
                            JSONObject rcJson = new JSONObject(dataJson);
                            rcOwnerName = rcJson.optString("owner_verified_name", "");
                            rcOwnerAadhaarNumber = rcJson.optString("owner_aadhar_number", "");
                            pendingManualReview = rcJson.optBoolean("manual_review", false);
                            if (rcJson.optBoolean("pending_local_only", false)) {
                                rcFrontManualPath = rcJson.optString("rc_front_path", "");
                                rcBackManualPath = rcJson.optString("rc_back_path", "");
                            }
                        } catch (JSONException e) {
                            Log.e("REG_DEBUG", "Failed to parse RC owner data: " + e.getMessage());
                        }
                    }
                    if (pendingManualReview) {
                        tvRcStatus.setText("Submitted for review ✓");
                        tvRcStatus.setTextColor(Color.parseColor("#1E88E5"));
                        btnRc.setText("Submitted");
                    } else {
                        tvRcStatus.setText("Verified ✓ (" + docNumber + ")");
                        tvRcStatus.setTextColor(Color.parseColor("#4CAF50"));
                        btnRc.setText("Verified");
                    }
                    btnRc.setEnabled(false);
                    btnRc.setAlpha(0.6f);
                    saveVerifiedDocsLocal();
                    break;
                case "dl":
                    isDlAutoVerified = true;
                    dlNumber = docNumber;
                    tvDlStatus.setText("Verified ✓ (" + docNumber + ")");
                    tvDlStatus.setTextColor(Color.parseColor("#4CAF50"));
                    btnDl.setText("Verified");
                    btnDl.setEnabled(false);
                    btnDl.setAlpha(0.6f);
                    saveVerifiedDocsLocal();
                    break;
            }
        });

        initViews();
        setupUIForMethod(verificationMethod);
        restoreVerifiedDocsLocal();
        fetchCityList();
        fetchVehicleTypes();
        getFCMToken();

        btnNextDetails.setOnClickListener(v -> validateAndRegister());
    }

    private void getFCMToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (task.isSuccessful()) {
                fcmTokenStr = task.getResult();
                Log.e("REG_DEBUG", "FCM Token: " + fcmTokenStr);
            }
        });
    }

    private void initViews() {
        llFullName = findViewById(R.id.ll_full_name);
        tvSubtitle = findViewById(R.id.tv_subtitle);
        llModeIndicator = findViewById(R.id.ll_mode_indicator);
        imgModeIcon = findViewById(R.id.img_mode_icon);
        tvModeTitle = findViewById(R.id.tv_mode_title);
        tvModeText = findViewById(R.id.tv_mode_text);
        tvFooterNote = findViewById(R.id.tv_footer_note);
        btnNextDetails = findViewById(R.id.btn_next_details);
        tvAadhaarLabel = findViewById(R.id.tv_aadhaar_label);
        llAadhaarBackContainer = findViewById(R.id.ll_aadhaar_back_container);

        spinnerCity = findViewById(R.id.spinner_city);
        spinnerVehicleType = findViewById(R.id.spinner_vehicle_type);
        edFullName = findViewById(R.id.ed_full_name);
        edEmail = findViewById(R.id.ed_email);
        edDob = findViewById(R.id.ed_dob);
        edAccName = findViewById(R.id.ed_acc_name);
        edAccNumber = findViewById(R.id.ed_acc_number);
        edIfsc = findViewById(R.id.ed_ifsc);
        edVehicleNo = findViewById(R.id.ed_vehicle_no);
        edReferralCode = findViewById(R.id.ed_referral_code);
        if (edReferralCode != null) {
            edReferralCode.setFilters(new InputFilter[]{NO_SPACE_UPPERCASE_FILTER, new InputFilter.LengthFilter(15)});
            edReferralCode.setOnFocusChangeListener((v, hasFocus) -> {
                if (!hasFocus) {
                    String code = edReferralCode.getText().toString().trim().toUpperCase(Locale.US);
                    if (!code.isEmpty()) {
                        validateReferralCodeRealtime(code);
                    } else {
                        edReferralCode.setError(null);
                    }
                }
            });
        }

        btnDobCalendar = findViewById(R.id.btn_dob_calendar);
        if (btnDobCalendar != null) {
            btnDobCalendar.setOnClickListener(v -> showDobPicker());
        }
        setupDobAutoFormatter();

        // 🔥 IFSC: type karte hi space block + auto capital, max 11 characters
        edIfsc.setFilters(new InputFilter[]{NO_SPACE_UPPERCASE_FILTER, new InputFilter.LengthFilter(11)});

        // 🔥 Account Number: numeric keyboard already blocks letters, ye sirf space/paste-safety ke liye
        edAccNumber.setFilters(new InputFilter[]{NO_SPACE_UPPERCASE_FILTER, new InputFilter.LengthFilter(18)});

        btnAadhaar = findViewById(R.id.btn_aadhaar);
        btnAadhaarBack = findViewById(R.id.btn_aadhaar_back);
        btnDl = findViewById(R.id.btn_dl);
        btnRc = findViewById(R.id.btn_rc);
        btnPan = findViewById(R.id.btn_pan);

        tvAadhaarStatus = findViewById(R.id.tv_aadhaar_status);
        tvAadhaarBackStatus = findViewById(R.id.tv_aadhaar_back_status);
        tvDlStatus = findViewById(R.id.tv_dl_status);
        tvRcStatus = findViewById(R.id.tv_rc_status);
        tvPanStatus = findViewById(R.id.tv_pan_status);

        findViewById(R.id.btn_profile_photo).setOnClickListener(v -> {
            Intent intent = new Intent(this, LiveFaceVerificationActivity.class);
            startActivityForResult(intent, REQ_LIVE_FACE);
        });

        setupImagePickers();
    }

    private boolean validateNameAndDobFirst() {
        String fullName = edFullName != null ? edFullName.getText().toString().trim() : "";
        String dobStr = edDob != null ? edDob.getText().toString().trim() : "";

        if (fullName.isEmpty()) {
            if (edFullName != null) {
                edFullName.setError("Please enter Full Name (as per Aadhaar) first");
                edFullName.requestFocus();
            }
            Toast.makeText(this, "Please enter your Full Name (as per Aadhaar) in Personal Details first!", Toast.LENGTH_LONG).show();
            return false;
        }

        if (dobStr.isEmpty()) {
            if (edDob != null) {
                edDob.setError("Please select Date of Birth (as per Aadhaar) first");
                edDob.requestFocus();
            }
            Toast.makeText(this, "Please select Date of Birth (as per Aadhaar) in Personal Details first!", Toast.LENGTH_LONG).show();
            return false;
        }

        return true;
    }

    private void setupImagePickers() {
        btnAadhaar.setOnClickListener(v -> {
            if (isAadhaarAutoVerified) return;
            if (!validateNameAndDobFirst()) return;
            autoVerificationManager.startAadhaarVerification();
        });
        btnAadhaarBack.setOnClickListener(v -> {
            if (isAadhaarAutoVerified) return;
            if (!validateNameAndDobFirst()) return;
            autoVerificationManager.startAadhaarVerification();
        });
        btnDl.setOnClickListener(v -> {
            if (isDlAutoVerified) return;
            if (!validateNameAndDobFirst()) return;
            String dobStr = edDob != null ? edDob.getText().toString().trim() : "";
            autoVerificationManager.startDlVerification(dobStr);
        });
        btnRc.setOnClickListener(v -> {
            if (isRcAutoVerified) return;
            if (!validateNameAndDobFirst()) return;
            String vehNo = edVehicleNo != null ? edVehicleNo.getText().toString().trim() : "";
            String fullName = edFullName != null ? edFullName.getText().toString().trim() : "";
            autoVerificationManager.startRcVerification(vehNo, fullName);
        });
        btnPan.setOnClickListener(v -> {
            if (isPanAutoVerified) return;
            if (!validateNameAndDobFirst()) return;
            String fullName = edFullName != null ? edFullName.getText().toString().trim() : "";
            String dobStr = edDob != null ? edDob.getText().toString().trim() : "";
            autoVerificationManager.startPanVerification(mobileNumber, fullName, dobStr);
        });

        // PUC and Bima are plain optional photo uploads — no government
        // verification API for either, unlike Aadhaar/PAN/DL/RC above.
        findViewById(R.id.btn_puc).setOnClickListener(v -> {
            currentDocType = "puc_image";
            Utility.bottonConfirm(this, imagePicker);
        });
        findViewById(R.id.btn_bima).setOnClickListener(v -> {
            currentDocType = "bima_image";
            Utility.bottonConfirm(this, imagePicker);
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_LIVE_FACE && resultCode == RESULT_OK && data != null) {
            String filePath = data.getStringExtra(LiveFaceVerificationActivity.EXTRA_IMAGE_PATH);
            if (filePath != null) {
                profilePhotoPath = filePath;
                ImageView imgPhoto = findViewById(R.id.img_profile_photo);
                if (imgPhoto != null) {
                    imgPhoto.setImageURI(android.net.Uri.fromFile(new File(filePath)));
                }
                TextView tvStatus = findViewById(R.id.tv_profile_photo_status);
                if (tvStatus != null) {
                    tvStatus.setText("Live Face Verified ✓");
                    tvStatus.setTextColor(Color.parseColor("#16A34A"));
                }
                TextView btnPhoto = findViewById(R.id.btn_profile_photo);
                if (btnPhoto != null) {
                    btnPhoto.setText("Re-verify");
                }
                // profilePhotoPath was never persisted, unlike the
                // Aadhaar/PAN/DL/RC steps - a later heavyweight Activity
                // (e.g. VehicleDetailsActivity's RC photo upload) getting
                // backgrounded could cause Android to kill this Activity's
                // process to reclaim memory, and on return the live-photo
                // step silently reset to "Not Verified" while everything
                // else survived via SharedPreferences. Confirmed live.
                saveVerifiedDocsLocal();
            }
            return;
        }

        // The RC dialog's own front/back photo pickers (name-mismatch
        // fallback) share this same ImagePicker.SELECT_IMAGE request code -
        // let AutoVerificationManager claim it first when one of its picks
        // is actually pending, so it isn't misrouted to this activity's own
        // profile_photo/puc_image/bima_image handling below.
        if (autoVerificationManager != null && autoVerificationManager.handleActivityResult(requestCode, resultCode, data)) {
            return;
        }

        if (requestCode == ImagePicker.SELECT_IMAGE && resultCode == RESULT_OK) {
            imagePicker.addOnCompressListener(new ImageCompressionListener() {
                @Override
                public void onStart() {}
                @Override
                public void onCompressed(String filePath) {
                    runOnUiThread(() -> handleImagePicked(filePath));
                }
                @Override
                public void onError(String error) {}
            });
            String filePath = imagePicker.getImageFilePath(data);
            if (filePath != null) handleImagePicked(filePath);
        }
    }

    private void handleImagePicked(String filePath) {
        if ("profile_photo".equals(currentDocType)) {
            profilePhotoPath = filePath;
            ((ImageView) findViewById(R.id.img_profile_photo)).setImageURI(android.net.Uri.fromFile(new File(filePath)));
            ((TextView) findViewById(R.id.tv_profile_photo_status)).setText("Uploaded ✓");
            ((TextView) findViewById(R.id.btn_profile_photo)).setText("Change");
        } else if ("puc_image".equals(currentDocType)) {
            pucImagePath = filePath;
            TextView status = findViewById(R.id.tv_puc_status);
            status.setText("Uploaded ✓");
            status.setTextColor(Color.parseColor("#16A34A"));
            ((TextView) findViewById(R.id.btn_puc)).setText("Change");
        } else if ("bima_image".equals(currentDocType)) {
            bimaImagePath = filePath;
            TextView status = findViewById(R.id.tv_bima_status);
            status.setText("Uploaded ✓");
            status.setTextColor(Color.parseColor("#16A34A"));
            ((TextView) findViewById(R.id.btn_bima)).setText("Change");
        }
        saveVerifiedDocsLocal();
    }

    private void fetchVehicleTypes() {
        custPrograssbar.prograssCreate(this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", "0");
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = NodeApiClient.getInterface().vehicleType(bodyRequest);
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resObj = response.body();
                    if (resObj.has("Result") && resObj.get("Result").getAsString().equals("true")) {
                        JsonArray resultData = resObj.getAsJsonArray("ResultData");
                        if (resultData != null && resultData.size() > 0) {
                            List<String> typeNames = new ArrayList<>();
                            // Position 0 is a blank placeholder so no vehicle is preselected.
                            typeNames.add("Select Vehicle Type");
                            for (int i = 0; i < resultData.size(); i++) {
                                typeNames.add(resultData.get(i).getAsJsonObject().get("cat_name").getAsString());
                            }
                            ArrayAdapter<String> adapter = new ArrayAdapter<>(NewRegistrationActivity.this,
                                    android.R.layout.simple_spinner_dropdown_item, typeNames);
                            spinnerVehicleType.setAdapter(adapter);
                            spinnerVehicleType.setSelection(0);
                        }
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
            }
        });
    }

    private void fetchCityList() {
        custPrograssbar.prograssCreate(this);
        Call<JsonObject> call = NodeApiClient.getInterface().getCityList();
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resObj = response.body();
                    if (resObj.has("Result") && resObj.get("Result").getAsString().equals("true")) {
                        // Node's driverContentController.cityList returns "CityList" (tbl_city rows
                        // with id/title, same shape) - the old PHP endpoint called it "CityData".
                        JsonArray resultData = resObj.getAsJsonArray("CityList");
                        if (resultData != null && resultData.size() > 0) {
                            List<String> typeNames = new ArrayList<>();
                            cityIds.clear();
                            for (int i = 0; i < resultData.size(); i++) {
                                JsonObject obj = resultData.get(i).getAsJsonObject();
                                typeNames.add(obj.get("title").getAsString());
                                cityIds.add(obj.get("id").getAsString());
                            }
                            ArrayAdapter<String> adapter = new ArrayAdapter<>(NewRegistrationActivity.this,
                                    android.R.layout.simple_spinner_dropdown_item, typeNames);
                            spinnerCity.setAdapter(adapter);
                        }
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
            }
        });
    }

    /** Once Aadhaar auto-verification confirms name+DOB, they must stay exactly what was
     * verified - otherwise the driver could verify with real details then edit them back
     * to something else before final submit. */
    private void lockNameAndDobFields() {
        // Never lock a field that's still empty - if restoring the saved value above
        // somehow failed/raced, an empty+disabled field would leave the driver with
        // no way to type a name/DOB at all and no way to proceed with registration.
        if (edFullName != null && !edFullName.getText().toString().trim().isEmpty()) {
            edFullName.setEnabled(false);
            edFullName.setAlpha(0.7f);
        }
        if (edDob != null && !edDob.getText().toString().trim().isEmpty()) {
            edDob.setEnabled(false);
            edDob.setAlpha(0.7f);
            if (btnDobCalendar != null) {
                btnDobCalendar.setEnabled(false);
                btnDobCalendar.setOnClickListener(null);
                btnDobCalendar.setAlpha(0.4f);
            }
        }
    }

    private void showDobPicker() {
        // Locked post-verification (see lockNameAndDobFields()) - but only once a value
        // actually got restored into the field; an empty field must stay pickable so a
        // driver whose saved DOB failed to restore isn't stuck unable to enter one.
        if (isAadhaarAutoVerified && edDob != null && !edDob.getText().toString().trim().isEmpty()) return;

        Calendar c = Calendar.getInstance();
        int year = c.get(Calendar.YEAR) - 20;
        int month = c.get(Calendar.MONTH);
        int day = c.get(Calendar.DAY_OF_MONTH);

        String currentText = edDob != null ? edDob.getText().toString().trim() : "";
        if (currentText.matches("^\\d{2}/\\d{2}/\\d{4}$")) {
            try {
                String[] parts = currentText.split("/");
                int d = Integer.parseInt(parts[0]);
                int m = Integer.parseInt(parts[1]) - 1;
                int y = Integer.parseInt(parts[2]);
                int currentYear = Calendar.getInstance().get(Calendar.YEAR);
                if (d >= 1 && d <= 31 && m >= 0 && m <= 11 && y >= 1940 && y <= currentYear - 18) {
                    day = d;
                    month = m;
                    year = y;
                }
            } catch (Exception ignored) {}
        }

        android.app.DatePickerDialog datePickerDialog = new android.app.DatePickerDialog(
                this,
                android.R.style.Theme_Holo_Light_Dialog_NoActionBar_MinWidth,
                (view, selectedYear, selectedMonth, selectedDay) -> {
                    String formattedDate = String.format(Locale.US, "%02d/%02d/%04d", selectedDay, selectedMonth + 1, selectedYear);
                    if (edDob != null) {
                        edDob.setText(formattedDate);
                        edDob.setError(null);
                    }
                },
                year, month, day
        );

        if (datePickerDialog.getWindow() != null) {
            datePickerDialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
        }

        Calendar maxCal = Calendar.getInstance();
        maxCal.add(Calendar.YEAR, -18);
        datePickerDialog.getDatePicker().setMaxDate(maxCal.getTimeInMillis());

        Calendar minCal = Calendar.getInstance();
        minCal.add(Calendar.YEAR, -80);
        datePickerDialog.getDatePicker().setMinDate(minCal.getTimeInMillis());

        datePickerDialog.show();
    }

    private void setupDobAutoFormatter() {
        if (edDob == null) return;
        edDob.addTextChangedListener(new TextWatcher() {
            private boolean isFormatting = false;
            private boolean isDeleting = false;

            @Override
            public void beforeTextChanged(CharSequence s, int start, int count, int after) {
                isDeleting = count > after;
            }

            @Override
            public void onTextChanged(CharSequence s, int start, int before, int count) {}

            @Override
            public void afterTextChanged(Editable s) {
                if (isFormatting || s == null) return;
                isFormatting = true;

                String clean = s.toString().replaceAll("[^0-9]", "");
                if (clean.length() > 8) {
                    clean = clean.substring(0, 8);
                }

                StringBuilder sb = new StringBuilder();
                int len = clean.length();
                if (len > 0) {
                    if (len < 2) {
                        sb.append(clean);
                    } else if (len == 2) {
                        sb.append(clean);
                        if (!isDeleting) sb.append("/");
                    } else if (len < 4) {
                        sb.append(clean.substring(0, 2)).append("/").append(clean.substring(2));
                    } else if (len == 4) {
                        sb.append(clean.substring(0, 2)).append("/").append(clean.substring(2, 4));
                        if (!isDeleting) sb.append("/");
                    } else {
                        sb.append(clean.substring(0, 2)).append("/").append(clean.substring(2, 4)).append("/").append(clean.substring(4));
                    }
                }

                String formatted = sb.toString();
                if (!formatted.equals(s.toString())) {
                    s.replace(0, s.length(), formatted);
                }
                isFormatting = false;
            }
        });
    }

    /**
     * 🔥 Saari mandatory fields ki validation.
     * Email aur bank details (Account Holder Name, Account Number, IFSC)
     * OPTIONAL hain — agar user ne bhara hai to hi format check hoga.
     * Baaki sab fields (Full Name, Date of Birth, Vehicle Type, Documents)
     * MANDATORY hain.
     */
    private void validateAndRegister() {
        // 1) Full Name - mandatory for all verification modes
        String fullName = edFullName.getText().toString().trim();
        if (fullName.isEmpty()) {
            edFullName.setError("Full Name is required");
            edFullName.requestFocus();
            Toast.makeText(this, "Full Name is required", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!NAME_PATTERN.matcher(fullName).matches()) {
            edFullName.setError("Enter a valid name");
            edFullName.requestFocus();
            Toast.makeText(this, "Please enter a valid Full Name", Toast.LENGTH_SHORT).show();
            return;
        }

        // 1.5) Date of Birth - mandatory as per Aadhaar
        String dobStr = edDob != null ? edDob.getText().toString().trim() : "";
        if (dobStr.isEmpty()) {
            if (edDob != null) edDob.setError("Date of Birth is required");
            Toast.makeText(this, "Date of Birth (as per Aadhaar) is required", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!dobStr.matches("^\\d{2}/\\d{2}/\\d{4}$")) {
            if (edDob != null) {
                edDob.setError("Enter complete Date of Birth in DD/MM/YYYY format");
                edDob.requestFocus();
            }
            Toast.makeText(this, "Please enter valid Date of Birth (DD/MM/YYYY)", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            String[] p = dobStr.split("/");
            int d = Integer.parseInt(p[0]);
            int m = Integer.parseInt(p[1]);
            int y = Integer.parseInt(p[2]);
            int currentYear = Calendar.getInstance().get(Calendar.YEAR);
            if (d < 1 || d > 31 || m < 1 || m > 12 || y < 1940 || y > currentYear - 18) {
                if (edDob != null) edDob.setError("Driver must be at least 18 years old");
                Toast.makeText(this, "Driver age must be at least 18 years", Toast.LENGTH_SHORT).show();
                return;
            }
        } catch (Exception ignored) {}

        // 2) Email - OPTIONAL, but validate format if provided
        String email = edEmail.getText().toString().trim();
        if (!email.isEmpty() && !Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            edEmail.setError("Enter a valid email address");
            edEmail.requestFocus();
            Toast.makeText(this, "Please enter a valid Email ID", Toast.LENGTH_SHORT).show();
            return;
        }

        // 3) Account Holder Name - OPTIONAL, but validate format if provided
        String accName = edAccName.getText().toString().trim();
        if (!accName.isEmpty() && !NAME_PATTERN.matcher(accName).matches()) {
            edAccName.setError("Enter a valid account holder name");
            edAccName.requestFocus();
            Toast.makeText(this, "Please enter a valid Account Holder Name", Toast.LENGTH_SHORT).show();
            return;
        }

        // 4) Account Number - OPTIONAL, digits only, 9-18 length if provided
        String accNumber = edAccNumber.getText().toString().trim();
        if (!accNumber.isEmpty() && !ACCOUNT_NUMBER_PATTERN.matcher(accNumber).matches()) {
            edAccNumber.setError("Enter a valid account number");
            edAccNumber.requestFocus();
            Toast.makeText(this, "Please enter a valid Account Number (9-18 digits)", Toast.LENGTH_SHORT).show();
            return;
        }

        // 5) IFSC Code - OPTIONAL, must match bank IFSC format if provided (e.g. SBIN0000466)
        String ifsc = edIfsc.getText().toString().trim().toUpperCase();
        if (!ifsc.isEmpty() && !IFSC_PATTERN.matcher(ifsc).matches()) {
            edIfsc.setError("Enter a valid IFSC code");
            edIfsc.requestFocus();
            Toast.makeText(this, "Please enter a valid IFSC Code (e.g. SBIN0000466)", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!ifsc.isEmpty()) edIfsc.setText(ifsc);

        // 5.5) Vehicle Number - mandatory
        String vehicleNo = edVehicleNo.getText().toString().trim();
        if (vehicleNo.isEmpty()) {
            edVehicleNo.setError("Vehicle Number is required");
            edVehicleNo.requestFocus();
            Toast.makeText(this, "Vehicle Number is required", Toast.LENGTH_SHORT).show();
            return;
        }

        if (profilePhotoPath.isEmpty()) {
            Toast.makeText(this, "Driver Live Face Verification is required", Toast.LENGTH_SHORT).show();
            return;
        }

        // 6) City - mandatory
        if (spinnerCity.getSelectedItem() == null) {
            Toast.makeText(this, "Please select a City", Toast.LENGTH_SHORT).show();
            return;
        }

        // 7) Vehicle Type - mandatory
        if (spinnerVehicleType.getSelectedItem() == null || spinnerVehicleType.getSelectedItemPosition() <= 0) {
            final ScrollView scrollView = findViewById(R.id.scroll_view);
            if (scrollView != null) {
                scrollView.post(() -> {
                    // Spinner sits nested inside cards, so sum offsets up to the ScrollView.
                    int top = 0;
                    View v = spinnerVehicleType;
                    while (v != null && v != scrollView) {
                        top += v.getTop();
                        v = (View) v.getParent();
                    }
                    scrollView.smoothScrollTo(0, Math.max(0, top - 120));
                });
            }
            spinnerVehicleType.requestFocus();
            Toast.makeText(this, "Please select your vehicle type.", Toast.LENGTH_SHORT).show();
            return;
        }

        // 8) Documents - Aadhaar, DL, RC mandatory; PAN optional
        if (!isAadhaarAutoVerified) {
            Toast.makeText(this, "Aadhaar eKYC Verification is required", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!isDlAutoVerified) {
            Toast.makeText(this, "Driving License Verification is required", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!isRcAutoVerified) {
            Toast.makeText(this, "Vehicle RC Verification is required", Toast.LENGTH_SHORT).show();
            return;
        }
        // PAN is optional - driver can submit without it and add it later;
        // admin can follow up for it from the docs review in the admin panel.

        registerUserAutomatic();
    }

    /**
     * Uploads the RC front/back photos picked via the name-mismatch fallback
     * (before the rider account existed) now that registration has just
     * produced a real rider_id - same endpoint/shape as
     * VehicleDetailsActivity.uploadVehicleDetailsToAPI, just fired
     * programmatically instead of from that screen.
     */
    private void uploadManualRcPhotos(int riderId) {
        String vehicleType = spinnerVehicleType.getSelectedItem() != null ? spinnerVehicleType.getSelectedItem().toString() : "";
        String typeId = "1";
        switch (vehicleType.toLowerCase(Locale.US)) {
            case "motorcycle_(मोटरसाइकिल)":
            case "motorcycle":
                typeId = "1";
                break;
            case "e_loader_(ई-लोडर)":
            case "e_loader":
                typeId = "2";
                break;
            case "three_wheeler_(थ्री_व्हीलर)":
            case "three_wheeler":
                typeId = "3";
                break;
            case "tata_ace_(टाटा_एस)":
            case "tata_ace":
                typeId = "4";
                break;
            default:
                typeId = "1";
                break;
        }

        java.util.List<MultipartBody.Part> parts = new java.util.ArrayList<>();
        if (rcFrontManualPath != null && new File(rcFrontManualPath).exists()) {
            parts.add(com.shifter.driver.utility.FileUtils.prepareFilePart("image0", rcFrontManualPath));
        }
        if (rcBackManualPath != null && new File(rcBackManualPath).exists()) {
            parts.add(com.shifter.driver.utility.FileUtils.prepareFilePart("image1", rcBackManualPath));
        }
        if (parts.isEmpty()) return;

        RequestBody riderIdPart = com.shifter.driver.utility.FileUtils.createPartFromString(String.valueOf(riderId));
        RequestBody typePart = com.shifter.driver.utility.FileUtils.createPartFromString(typeId);
        RequestBody regNumPart = com.shifter.driver.utility.FileUtils.createPartFromString(rcNumber.isEmpty() ? edVehicleNo.getText().toString().trim() : rcNumber);
        RequestBody sizePart = com.shifter.driver.utility.FileUtils.createPartFromString(String.valueOf(parts.size()));
        RequestBody nameMismatchPart = com.shifter.driver.utility.FileUtils.createPartFromString("1");

        NodeApiClient.getInterface().vehicalVerification(riderIdPart, typePart, regNumPart, sizePart, nameMismatchPart, parts)
                .enqueue(new Callback<JsonObject>() {
                    @Override
                    public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                        Log.d("REG_DEBUG", "Manual RC photos uploaded post-registration: " + (response.body() != null ? response.body().toString() : "empty"));
                    }

                    @Override
                    public void onFailure(Call<JsonObject> call, Throwable t) {
                        // Non-fatal - registration itself already succeeded. Driver
                        // can still re-upload from Account > Documents if this fails.
                        Log.e("REG_DEBUG", "Manual RC photo upload failed: " + t.getMessage());
                    }
                });
    }

    private MultipartBody.Part createImagePart(String path, String fieldName) {
        if (path == null || path.isEmpty()) return null;
        File file = new File(path);
        return MultipartBody.Part.createFormData(fieldName, file.getName(),
                RequestBody.create(MediaType.parse(imageMimeTypeFor(file.getName())), file));
    }

    private String imageMimeTypeFor(String fileName) {
        String lower = fileName.toLowerCase();
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        return "image/jpeg";
    }


    private void setupUIForMethod(String method) {
        llFullName.setVisibility(View.VISIBLE);
        tvSubtitle.setText("Instant eKYC & RTO API Document Verification");
        llModeIndicator.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_card_blue));
        imgModeIcon.setImageResource(R.drawable.ic_password);
        imgModeIcon.setColorFilter(Color.parseColor("#1E88E5"));
        tvModeTitle.setText("Automatic Verification Mode (eKYC)");
        tvModeTitle.setTextColor(Color.parseColor("#1E88E5"));
        tvModeText.setText("Click 'Verify' to verify Aadhaar via OTP, Income Tax PAN & RTO RC");
        tvFooterNote.setText("✓ Instant eKYC verification via UIDAI, Income Tax & RTO");
        tvFooterNote.setTextColor(Color.parseColor("#2E7D32"));

        if (llAadhaarBackContainer != null) llAadhaarBackContainer.setVisibility(View.GONE);
        if (tvAadhaarLabel != null) tvAadhaarLabel.setText("Aadhaar Card *");

        btnAadhaar.setText("Verify eKYC");
        btnAadhaarBack.setText("Verify eKYC");
        btnDl.setText("Verify DL");
        btnRc.setText("Verify RC");
        btnPan.setText("Verify PAN");

        if (!isAadhaarAutoVerified) {
            tvAadhaarStatus.setText("Click to verify via Aadhaar OTP");
            tvAadhaarBackStatus.setText("Click to verify via Aadhaar OTP");
        }
        if (!isDlAutoVerified) {
            tvDlStatus.setText("Click to verify Driving License");
        }
        if (!isRcAutoVerified) {
            tvRcStatus.setText("Click to verify Vehicle RC");
        }
        if (!isPanAutoVerified) {
            tvPanStatus.setText("Click to verify Income Tax PAN (Optional)");
        }
    }

    private void registerUserAutomatic() {
        custPrograssbar.prograssCreate(this);
        JSONObject reqJson = new JSONObject();
        try {
            String fname = edFullName.getText().toString().trim();
            String dobVal = edDob != null ? edDob.getText().toString().trim() : "";
            String selectedCityId = cityIds.isEmpty() || spinnerCity.getSelectedItemPosition() < 0 ?
                    "1" : cityIds.get(spinnerCity.getSelectedItemPosition());
            String vehicleType = spinnerVehicleType.getSelectedItem() != null ?
                    spinnerVehicleType.getSelectedItem().toString() : "";

            reqJson.put("full_name", fname);
            reqJson.put("email", edEmail.getText().toString().trim());
            reqJson.put("dob", dobVal);
            reqJson.put("mobile", mobileNumber);
            reqJson.put("account_name", edAccName.getText().toString().trim());
            reqJson.put("account_number", edAccNumber.getText().toString().trim());
            reqJson.put("ifsc", edIfsc.getText().toString().trim().toUpperCase(Locale.US));
            reqJson.put("vehicle", vehicleType);
            reqJson.put("vehicle_no", edVehicleNo.getText().toString().trim().toUpperCase(Locale.US));
            reqJson.put("device_id", Utility.getDeviceId(this));
            reqJson.put("city_id", selectedCityId);
            reqJson.put("fcm_token", fcmTokenStr);
            reqJson.put("registration_type", "automatic");

            JSONArray docArray = new JSONArray();

            JSONObject aadharObj = new JSONObject();
            aadharObj.put("DocumentName", "Aadhar");
            aadharObj.put("DocumentNumber", aadhaarNumber);
            aadharObj.put("isVerified", true);
            docArray.put(aadharObj);

            JSONObject panObj = new JSONObject();
            panObj.put("DocumentName", "Pan");
            panObj.put("DocumentNumber", panNumber);
            panObj.put("isVerified", isPanAutoVerified);
            docArray.put(panObj);

            JSONObject rcObj = new JSONObject();
            rcObj.put("DocumentName", "Rc");
            rcObj.put("DocumentNumber", rcNumber.isEmpty() ? edVehicleNo.getText().toString().trim().toUpperCase(Locale.US) : rcNumber);
            rcObj.put("isVerified", true);
            docArray.put(rcObj);

            JSONObject dlObj = new JSONObject();
            dlObj.put("DocumentName", "Dl");
            dlObj.put("DocumentNumber", dlNumber);
            dlObj.put("isVerified", true);
            docArray.put(dlObj);

            reqJson.put("documents", docArray);

            // Referral Code (optional)
            String referralCode = edReferralCode.getText().toString().trim();
            if (!referralCode.isEmpty()) {
                reqJson.put("referral_code", referralCode);
            }
        } catch (JSONException e) {
            e.printStackTrace();
        }

        Log.e("REG_DEBUG", "Automatic Reg Payload: " + reqJson.toString());

        RequestBody documents = RequestBody.create(MediaType.parse("text/plain"), reqJson.optString("documents", "[]"));
        Call<ResponseBody> call = NodeApiClient.getInterface().registerAutomatic(
                textPart(mobileNumber), textPart(reqJson.optString("full_name")),
                textPart(reqJson.optString("email")), textPart(reqJson.optString("dob")),
                textPart(reqJson.optString("account_name")),
                textPart(reqJson.optString("account_number")), textPart(reqJson.optString("ifsc")),
                textPart(reqJson.optString("vehicle")), textPart(reqJson.optString("vehicle_no")),
                textPart(reqJson.optString("city_id")), textPart("automatic"), documents,
                createImagePart(profilePhotoPath, "profile_photo"), textPart(fcmTokenStr),
                textPart(Utility.getDeviceId(this)), textPart(reqJson.optString("referral_code")),
                textPart(rcOwnerName), textPart(rcOwnerAadhaarNumber),
                createImagePart(pucImagePath, "puc_image"), createImagePart(bimaImagePath, "bima_image"),
                textPart(getSharedPreferences("kyc_otp", MODE_PRIVATE).getString("otp_token", "")));

        call.enqueue(new Callback<ResponseBody>() {
            @Override
            public void onResponse(Call<ResponseBody> call, Response<ResponseBody> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    try {
                        String respString = response.body().string();
                        Log.e("REG_DEBUG", "Automatic Reg Response: " + respString);

                        JSONObject jsonObject = new JSONObject(respString);
                        String resultStr = jsonObject.optString("Result", "false");
                        String respCode = jsonObject.optString("ResponseCode", "");

                        if ("true".equalsIgnoreCase(resultStr) || "200".equals(respCode)) {
                            String msg = jsonObject.optString("ResponseMsg", "Registration successful!");
                            Toast.makeText(NewRegistrationActivity.this, msg, Toast.LENGTH_LONG).show();

                            clearVerifiedDocsLocal();

                            int registeredRiderId = 0;
                            if (jsonObject.has("rider_data") && !jsonObject.isNull("rider_data")) {
                                JSONObject riderObj = jsonObject.getJSONObject("rider_data");
                                registeredRiderId = riderObj.optInt("id", 0);
                                Gson gson = new Gson();
                                RiderData riderData = gson.fromJson(riderObj.toString(), RiderData.class);
                                sessionManager.setUserDetails(riderData);
                                sessionManager.setBooleanData(SessionManager.login, true);
                            }

                            // The RC name-mismatch fallback (picked before this
                            // rider_id existed) is uploaded now that it does -
                            // see VehicleDetailsActivity's "pending_local_only"
                            // result and this activity's REQ_RC_PHOTO_UPLOAD handling.
                            if (registeredRiderId > 0 && !rcFrontManualPath.isEmpty() && !rcBackManualPath.isEmpty()) {
                                uploadManualRcPhotos(registeredRiderId);
                            }

                            // The verification charge depends on the vehicle type picked on this
                            // form, which the server priced - the value passed in from
                            // ChooseVerificationMethodActivity predates that choice.
                            if (jsonObject.has("auto_verification_charge")) {
                                autoVerificationCharge = jsonObject.optDouble("auto_verification_charge", autoVerificationCharge);
                                autoVerificationChargeOld = jsonObject.optDouble("auto_verification_charge_old", 0);
                                autoVerificationMsg = jsonObject.optString("auto_verification_msg", autoVerificationMsg);
                            }

                            // Automatic flow: if charge > 0 → payment screen, else → direct Home
                            if (autoVerificationCharge > 0) {
                                Intent intent = new Intent(NewRegistrationActivity.this, AutoPaymentActivity.class);
                                intent.putExtra("mobile", mobileNumber);
                                intent.putExtra("rider_id", registeredRiderId);
                                intent.putExtra("auto_verification_charge", autoVerificationCharge);
                                intent.putExtra("auto_verification_charge_old", autoVerificationChargeOld);
                                intent.putExtra("auto_verification_msg", autoVerificationMsg);
                                // Pass rider_data JSON so AutoPaymentActivity can restore session after payment
                                if (jsonObject.has("rider_data") && !jsonObject.isNull("rider_data")) {
                                    intent.putExtra("rider_data_json", jsonObject.getJSONObject("rider_data").toString());
                                }
                                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                                startActivity(intent);
                            } else {
                                // Charge is 0 — direct login
                                Intent intent = new Intent(NewRegistrationActivity.this, HomeActivity.class);
                                intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                                startActivity(intent);
                            }
                            finish();
                        } else {
                            String msg = jsonObject.optString("ResponseMsg", "Registration Failed");
                            Toast.makeText(NewRegistrationActivity.this, msg, Toast.LENGTH_LONG).show();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        Toast.makeText(NewRegistrationActivity.this, "Error parsing response", Toast.LENGTH_SHORT).show();
                    }
                } else {
                    Toast.makeText(NewRegistrationActivity.this, "Server Error: " + response.code(), Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<ResponseBody> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(NewRegistrationActivity.this, "Network Error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
                Log.e("REG_DEBUG", "Network Error: ", t);
            }
        });
    }

    private RequestBody textPart(String value) {
        return RequestBody.create(MediaType.parse("text/plain"), value == null ? "" : value);
    }

    private void saveVerifiedDocsLocal() {
        if (mobileNumber == null || mobileNumber.trim().isEmpty()) return;
        SharedPreferences sp = getSharedPreferences("auto_doc_prefs", MODE_PRIVATE);
        sp.edit()
                .putBoolean("aadhaar_verified_" + mobileNumber, isAadhaarAutoVerified)
                .putString("aadhaar_num_" + mobileNumber, aadhaarNumber)
                .putBoolean("pan_verified_" + mobileNumber, isPanAutoVerified)
                .putString("pan_num_" + mobileNumber, panNumber)
                .putBoolean("rc_verified_" + mobileNumber, isRcAutoVerified)
                .putString("rc_num_" + mobileNumber, rcNumber)
                .putString("rc_owner_name_" + mobileNumber, rcOwnerName)
                .putString("rc_owner_aadhaar_" + mobileNumber, rcOwnerAadhaarNumber)
                .putBoolean("dl_verified_" + mobileNumber, isDlAutoVerified)
                .putString("dl_num_" + mobileNumber, dlNumber)
                // The verified Full Name/DOB text itself, not just the verified flag -
                // without this, reopening the app after a verified Aadhaar restores
                // isAadhaarAutoVerified=true (and locks the fields) with nothing to
                // show in them, leaving the driver stuck unable to type or proceed.
                .putString("full_name_" + mobileNumber, edFullName != null ? edFullName.getText().toString().trim() : "")
                .putString("dob_" + mobileNumber, edDob != null ? edDob.getText().toString().trim() : "")
                .putString("profile_photo_" + mobileNumber, profilePhotoPath)
                .putString("rc_front_manual_" + mobileNumber, rcFrontManualPath)
                .putString("rc_back_manual_" + mobileNumber, rcBackManualPath)
                .apply();
    }

    private void restoreVerifiedDocsLocal() {
        if (mobileNumber == null || mobileNumber.trim().isEmpty()) return;
        SharedPreferences sp = getSharedPreferences("auto_doc_prefs", MODE_PRIVATE);

        if (!isAadhaarAutoVerified) {
            isAadhaarAutoVerified = sp.getBoolean("aadhaar_verified_" + mobileNumber, false);
            if (isAadhaarAutoVerified) {
                aadhaarNumber = sp.getString("aadhaar_num_" + mobileNumber, "");
            }
        }

        if (!isPanAutoVerified) {
            isPanAutoVerified = sp.getBoolean("pan_verified_" + mobileNumber, false);
            if (isPanAutoVerified) {
                panNumber = sp.getString("pan_num_" + mobileNumber, "");
            }
        }

        if (!isRcAutoVerified) {
            isRcAutoVerified = sp.getBoolean("rc_verified_" + mobileNumber, false);
            if (isRcAutoVerified) {
                rcNumber = sp.getString("rc_num_" + mobileNumber, "");
                rcOwnerName = sp.getString("rc_owner_name_" + mobileNumber, "");
                rcOwnerAadhaarNumber = sp.getString("rc_owner_aadhaar_" + mobileNumber, "");
            }
        }

        if (!isDlAutoVerified) {
            isDlAutoVerified = sp.getBoolean("dl_verified_" + mobileNumber, false);
            if (isDlAutoVerified) {
                dlNumber = sp.getString("dl_num_" + mobileNumber, "");
            }
        }

        if (rcFrontManualPath.isEmpty()) {
            String savedFront = sp.getString("rc_front_manual_" + mobileNumber, "");
            if (!savedFront.isEmpty() && new File(savedFront).exists()) rcFrontManualPath = savedFront;
        }
        if (rcBackManualPath.isEmpty()) {
            String savedBack = sp.getString("rc_back_manual_" + mobileNumber, "");
            if (!savedBack.isEmpty() && new File(savedBack).exists()) rcBackManualPath = savedBack;
        }

        if (profilePhotoPath.isEmpty()) {
            String savedPhotoPath = sp.getString("profile_photo_" + mobileNumber, "");
            if (!savedPhotoPath.isEmpty() && new File(savedPhotoPath).exists()) {
                profilePhotoPath = savedPhotoPath;
                ImageView imgPhoto = findViewById(R.id.img_profile_photo);
                if (imgPhoto != null) {
                    imgPhoto.setImageURI(android.net.Uri.fromFile(new File(savedPhotoPath)));
                }
                TextView tvPhotoStatus = findViewById(R.id.tv_profile_photo_status);
                if (tvPhotoStatus != null) {
                    tvPhotoStatus.setText("Live Face Verified ✓");
                    tvPhotoStatus.setTextColor(Color.parseColor("#16A34A"));
                }
                TextView btnPhoto = findViewById(R.id.btn_profile_photo);
                if (btnPhoto != null) {
                    btnPhoto.setText("Re-verify");
                }
            }
        }

        if ("automatic".equals(verificationMethod)) {
            if (isAadhaarAutoVerified && !aadhaarNumber.isEmpty()) {
                tvAadhaarStatus.setText("Verified ✓ (" + aadhaarNumber + ")");
                tvAadhaarStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnAadhaar.setText("Verified");
                btnAadhaar.setEnabled(false);
                btnAadhaar.setAlpha(0.6f);

                String savedFullName = sp.getString("full_name_" + mobileNumber, "");
                String savedDob = sp.getString("dob_" + mobileNumber, "");
                if (edFullName != null && edFullName.getText().toString().trim().isEmpty() && !savedFullName.isEmpty()) {
                    edFullName.setText(savedFullName);
                }
                if (edDob != null && edDob.getText().toString().trim().isEmpty() && !savedDob.isEmpty()) {
                    edDob.setText(savedDob);
                }
                lockNameAndDobFields();
            }
            if (isPanAutoVerified && !panNumber.isEmpty()) {
                tvPanStatus.setText("Verified ✓ (" + panNumber + ")");
                tvPanStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnPan.setText("Verified");
                btnPan.setEnabled(false);
                btnPan.setAlpha(0.6f);
            }
            if (isRcAutoVerified && !rcNumber.isEmpty()) {
                tvRcStatus.setText("Verified ✓ (" + rcNumber + ")");
                tvRcStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnRc.setText("Verified");
                btnRc.setEnabled(false);
                btnRc.setAlpha(0.6f);
                if (edVehicleNo != null && edVehicleNo.getText().toString().trim().isEmpty()) {
                    edVehicleNo.setText(rcNumber);
                }
            }
            if (isDlAutoVerified && !dlNumber.isEmpty()) {
                tvDlStatus.setText("Verified ✓ (" + dlNumber + ")");
                tvDlStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnDl.setText("Verified");
                btnDl.setEnabled(false);
                btnDl.setAlpha(0.6f);
            }
        }
    }

    private void clearVerifiedDocsLocal() {
        if (mobileNumber == null || mobileNumber.trim().isEmpty()) return;
        SharedPreferences sp = getSharedPreferences("auto_doc_prefs", MODE_PRIVATE);
        sp.edit()
                .remove("aadhaar_verified_" + mobileNumber)
                .remove("aadhaar_num_" + mobileNumber)
                .remove("pan_verified_" + mobileNumber)
                .remove("pan_num_" + mobileNumber)
                .remove("rc_verified_" + mobileNumber)
                .remove("rc_num_" + mobileNumber)
                .remove("rc_owner_name_" + mobileNumber)
                .remove("rc_owner_aadhaar_" + mobileNumber)
                .remove("dl_verified_" + mobileNumber)
                .remove("dl_num_" + mobileNumber)
                .remove("full_name_" + mobileNumber)
                .remove("dob_" + mobileNumber)
                .remove("profile_photo_" + mobileNumber)
                .remove("rc_front_manual_" + mobileNumber)
                .remove("rc_back_manual_" + mobileNumber)
                .apply();
    }

    private void validateReferralCodeRealtime(String code) {
        Map<String, Object> body = new HashMap<>();
        body.put("referral_code", code);
        NodeApiClient.getInterface().checkReferral(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resp = response.body();
                    String result = resp.has("Result") ? resp.get("Result").getAsString() : "false";
                    if ("true".equalsIgnoreCase(result)) {
                        String refName = resp.has("referrer_name") ? resp.get("referrer_name").getAsString() : "Referrer";
                        Toast.makeText(NewRegistrationActivity.this, "✓ Valid Referral: " + refName, Toast.LENGTH_SHORT).show();
                        edReferralCode.setError(null);
                    } else {
                        edReferralCode.setError("Invalid referral code");
                        Toast.makeText(NewRegistrationActivity.this, "Invalid Referral Code!", Toast.LENGTH_SHORT).show();
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                // Network error on typing can be ignored
            }
        });
    }
}

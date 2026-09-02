package com.shifter.driver.activity;

import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputFilter;
import android.text.Spanned;
import android.util.Log;
import android.util.Patterns;
import android.view.View;
import android.widget.ArrayAdapter;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.firebase.messaging.FirebaseMessaging;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import com.google.gson.Gson;
import com.shifter.driver.model.RiderData;

import java.io.File;
import java.util.ArrayList;
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

public class NewRegistrationActivity extends AppCompatActivity {

    private String verificationMethod;
    private String mobileNumber;
    private LinearLayout llFullName, llModeIndicator, llAadhaarBackContainer;
    private TextView tvSubtitle, tvModeTitle, tvModeText, tvFooterNote, btnNextDetails, tvAadhaarLabel;
    private ImageView imgModeIcon;
    private Spinner spinnerVehicleType, spinnerCity;
    private List<String> cityIds = new ArrayList<>();
    private EditText edFullName, edEmail, edAccName, edAccNumber, edIfsc, edVehicleNo, edReferralCode;
    private TextView btnAadhaar, btnAadhaarBack, btnDl, btnRc, btnPan;
    private TextView tvAadhaarStatus, tvAadhaarBackStatus, tvDlStatus, tvRcStatus, tvPanStatus;

    private CustPrograssbar custPrograssbar;
    private SessionManager sessionManager;
    private ImagePicker imagePicker;

    private boolean isAadhaarAutoVerified = false;
    private boolean isPanAutoVerified = false;
    private boolean isDlAutoVerified = false;
    private boolean isRcAutoVerified = false;
    private String aadhaarNumber = "";
    private String panNumber = "";
    private String rcNumber = "";
    private String dlNumber = "";
    private com.shifter.driver.utility.AutoVerificationManager autoVerificationManager;

    private String currentDocType = "";
    private String aadhaarPath = "", aadhaarBackPath = "", dlPath = "", rcPath = "", panPath = "";
    private String fcmTokenStr = "";

    // Payment values received from ChooseVerificationMethodActivity
    private double autoVerificationCharge = 0;
    private double autoVerificationChargeOld = 0;
    private String autoVerificationMsg = "";

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
        setContentView(R.layout.activity_new_registration);

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
        if (autoVerificationMsg == null) autoVerificationMsg = "";

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
                    tvRcStatus.setText("Verified ✓ (" + docNumber + ")");
                    tvRcStatus.setTextColor(Color.parseColor("#4CAF50"));
                    btnRc.setText("Verified");
                    btnRc.setEnabled(false);
                    btnRc.setAlpha(0.6f);
                    if (edVehicleNo != null && edVehicleNo.getText().toString().trim().isEmpty()) {
                        edVehicleNo.setText(docNumber);
                    }
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
        edAccName = findViewById(R.id.ed_acc_name);
        edAccNumber = findViewById(R.id.ed_acc_number);
        edIfsc = findViewById(R.id.ed_ifsc);
        edVehicleNo = findViewById(R.id.ed_vehicle_no);
        edReferralCode = findViewById(R.id.ed_referral_code);

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

        setupImagePickers();
    }

    private void setupImagePickers() {
        btnAadhaar.setOnClickListener(v -> {
            if ("automatic".equals(verificationMethod)) {
                if (isAadhaarAutoVerified) return;
                autoVerificationManager.startAadhaarVerification();
            } else {
                currentDocType = "aadhaar";
                Utility.bottonConfirm(this, imagePicker);
            }
        });
        btnAadhaarBack.setOnClickListener(v -> {
            if ("automatic".equals(verificationMethod)) {
                if (isAadhaarAutoVerified) return;
                autoVerificationManager.startAadhaarVerification();
            } else {
                currentDocType = "aadhaar_back";
                Utility.bottonConfirm(this, imagePicker);
            }
        });
        btnDl.setOnClickListener(v -> {
            if ("automatic".equals(verificationMethod)) {
                if (isDlAutoVerified) return;
                autoVerificationManager.startDlVerification();
            } else {
                currentDocType = "dl";
                Utility.bottonConfirm(this, imagePicker);
            }
        });
        btnRc.setOnClickListener(v -> {
            if ("automatic".equals(verificationMethod)) {
                if (isRcAutoVerified) return;
                String vehNo = edVehicleNo != null ? edVehicleNo.getText().toString().trim() : "";
                autoVerificationManager.startRcVerification(vehNo);
            } else {
                currentDocType = "rc";
                Utility.bottonConfirm(this, imagePicker);
            }
        });
        btnPan.setOnClickListener(v -> {
            if ("automatic".equals(verificationMethod)) {
                if (isPanAutoVerified) return;
                autoVerificationManager.startPanVerification(mobileNumber);
            } else {
                currentDocType = "pan";
                Utility.bottonConfirm(this, imagePicker);
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
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
        switch (currentDocType) {
            case "aadhaar":
                aadhaarPath = filePath;
                tvAadhaarStatus.setText("Uploaded ✓");
                tvAadhaarStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnAadhaar.setText("Change");
                break;
            case "aadhaar_back":
                aadhaarBackPath = filePath;
                tvAadhaarBackStatus.setText("Uploaded ✓");
                tvAadhaarBackStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnAadhaarBack.setText("Change");
                break;
            case "dl":
                dlPath = filePath;
                tvDlStatus.setText("Uploaded ✓");
                tvDlStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnDl.setText("Change");
                break;
            case "rc":
                rcPath = filePath;
                tvRcStatus.setText("Uploaded ✓");
                tvRcStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnRc.setText("Change");
                break;
            case "pan":
                panPath = filePath;
                tvPanStatus.setText("Uploaded ✓");
                tvPanStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnPan.setText("Change");
                break;
        }
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
        Call<JsonObject> call = APIClient.getInterface().vehicleType(bodyRequest);
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
                            for (int i = 0; i < resultData.size(); i++) {
                                typeNames.add(resultData.get(i).getAsJsonObject().get("cat_name").getAsString());
                            }
                            ArrayAdapter<String> adapter = new ArrayAdapter<>(NewRegistrationActivity.this,
                                    android.R.layout.simple_spinner_dropdown_item, typeNames);
                            spinnerVehicleType.setAdapter(adapter);
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
        Call<JsonObject> call = APIClient.getInterface().getCityList();
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resObj = response.body();
                    if (resObj.has("Result") && resObj.get("Result").getAsString().equals("true")) {
                        JsonArray resultData = resObj.getAsJsonArray("CityData");
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

    /**
     * 🔥 Saari mandatory fields ki validation.
     * Email OPTIONAL hai — agar user ne bhara hai to hi format check hoga.
     * Baaki sab fields (Full Name [manual mode], Vehicle Type, Documents,
     * Account Holder Name, Account Number, IFSC) MANDATORY hain.
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

        // 2) Email - OPTIONAL, but validate format if provided
        String email = edEmail.getText().toString().trim();
        if (!email.isEmpty() && !Patterns.EMAIL_ADDRESS.matcher(email).matches()) {
            edEmail.setError("Enter a valid email address");
            edEmail.requestFocus();
            Toast.makeText(this, "Please enter a valid Email ID", Toast.LENGTH_SHORT).show();
            return;
        }

        // 3) Account Holder Name - mandatory
        String accName = edAccName.getText().toString().trim();
        if (accName.isEmpty()) {
            edAccName.setError("Account Holder Name is required");
            edAccName.requestFocus();
            Toast.makeText(this, "Account Holder Name is required", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!NAME_PATTERN.matcher(accName).matches()) {
            edAccName.setError("Enter a valid account holder name");
            edAccName.requestFocus();
            Toast.makeText(this, "Please enter a valid Account Holder Name", Toast.LENGTH_SHORT).show();
            return;
        }

        // 4) Account Number - mandatory, digits only, 9-18 length
        String accNumber = edAccNumber.getText().toString().trim();
        if (accNumber.isEmpty()) {
            edAccNumber.setError("Account Number is required");
            edAccNumber.requestFocus();
            Toast.makeText(this, "Account Number is required", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!ACCOUNT_NUMBER_PATTERN.matcher(accNumber).matches()) {
            edAccNumber.setError("Enter a valid account number");
            edAccNumber.requestFocus();
            Toast.makeText(this, "Please enter a valid Account Number (9-18 digits)", Toast.LENGTH_SHORT).show();
            return;
        }

        // 5) IFSC Code - mandatory, must match bank IFSC format (e.g. SBIN0000466)
        String ifsc = edIfsc.getText().toString().trim().toUpperCase();
        if (ifsc.isEmpty()) {
            edIfsc.setError("IFSC Code is required");
            edIfsc.requestFocus();
            Toast.makeText(this, "IFSC Code is required", Toast.LENGTH_SHORT).show();
            return;
        }
        if (!IFSC_PATTERN.matcher(ifsc).matches()) {
            edIfsc.setError("Enter a valid IFSC code");
            edIfsc.requestFocus();
            Toast.makeText(this, "Please enter a valid IFSC Code (e.g. SBIN0000466)", Toast.LENGTH_SHORT).show();
            return;
        }
        edIfsc.setText(ifsc);

        // 5.5) Vehicle Number - mandatory
        String vehicleNo = edVehicleNo.getText().toString().trim();
        if (vehicleNo.isEmpty()) {
            edVehicleNo.setError("Vehicle Number is required");
            edVehicleNo.requestFocus();
            Toast.makeText(this, "Vehicle Number is required", Toast.LENGTH_SHORT).show();
            return;
        }

        // 6) City - mandatory
        if (spinnerCity.getSelectedItem() == null) {
            Toast.makeText(this, "Please select a City", Toast.LENGTH_SHORT).show();
            return;
        }

        // 7) Vehicle Type - mandatory
        if (spinnerVehicleType.getSelectedItem() == null) {
            Toast.makeText(this, "Please select a Vehicle Type", Toast.LENGTH_SHORT).show();
            return;
        }

        // 8) Documents - Aadhaar, DL, RC mandatory; PAN optional
        if ("automatic".equalsIgnoreCase(verificationMethod)) {
            if (!isAadhaarAutoVerified && aadhaarPath.isEmpty()) {
                Toast.makeText(this, "Aadhaar eKYC Verification is required", Toast.LENGTH_SHORT).show();
                return;
            }
            if (!isDlAutoVerified && dlPath.isEmpty()) {
                Toast.makeText(this, "Driving License Verification is required", Toast.LENGTH_SHORT).show();
                return;
            }
            if (!isRcAutoVerified && rcPath.isEmpty()) {
                Toast.makeText(this, "Vehicle RC Verification is required", Toast.LENGTH_SHORT).show();
                return;
            }
            if (!isPanAutoVerified && panPath.isEmpty()) {
                Toast.makeText(this, "PAN Verification is required", Toast.LENGTH_SHORT).show();
                return;
            }
        } else {
            if (aadhaarPath.isEmpty()) {
                Toast.makeText(this, "Aadhaar Card Front is required", Toast.LENGTH_SHORT).show();
                return;
            }
            if (aadhaarBackPath.isEmpty()) {
                Toast.makeText(this, "Aadhaar Card Back is required", Toast.LENGTH_SHORT).show();
                return;
            }
            if (dlPath.isEmpty()) {
                Toast.makeText(this, "Driving License is required", Toast.LENGTH_SHORT).show();
                return;
            }
            if (rcPath.isEmpty()) {
                Toast.makeText(this, "Vehicle RC is required", Toast.LENGTH_SHORT).show();
                return;
            }
        }

        if ("automatic".equalsIgnoreCase(verificationMethod)) {
            registerUserAutomatic();
        } else {
            registerUserManual();
        }
    }

    private void registerUserManual() {
        custPrograssbar.prograssCreate(this);

        String fname = edFullName.getText().toString().trim();
        String email = edEmail.getText().toString().trim();
        String vehicleType = spinnerVehicleType.getSelectedItem() != null ?
                spinnerVehicleType.getSelectedItem().toString() : "";

        RequestBody reqMobile = RequestBody.create(MediaType.parse("text/plain"), mobileNumber);
        RequestBody reqFullName = RequestBody.create(MediaType.parse("text/plain"), fname);
        RequestBody reqEmail = RequestBody.create(MediaType.parse("text/plain"), email);
        RequestBody reqAccountName = RequestBody.create(MediaType.parse("text/plain"), edAccName.getText().toString().trim());
        RequestBody reqAccountNumber = RequestBody.create(MediaType.parse("text/plain"), edAccNumber.getText().toString().trim());
        RequestBody reqIfsc = RequestBody.create(MediaType.parse("text/plain"), edIfsc.getText().toString().trim());
        RequestBody reqVehicle = RequestBody.create(MediaType.parse("text/plain"), vehicleType);
        RequestBody reqRegisterType = RequestBody.create(MediaType.parse("text/plain"), "manual");
        RequestBody reqFcmToken = RequestBody.create(MediaType.parse("text/plain"), fcmTokenStr);

        MultipartBody.Part aadhaarPart = null;
        MultipartBody.Part aadhaarBackPart = null;
        MultipartBody.Part dlPart = null;
        MultipartBody.Part rcPart = null;
        MultipartBody.Part panPart = null;

        if (!aadhaarPath.isEmpty()) {
            File file = new File(aadhaarPath);
            RequestBody requestFile = RequestBody.create(MediaType.parse("image/*"), file);
            aadhaarPart = MultipartBody.Part.createFormData("aadhaar", file.getName(), requestFile);
        }

        if (!aadhaarBackPath.isEmpty()) {
            File file = new File(aadhaarBackPath);
            RequestBody requestFile = RequestBody.create(MediaType.parse("image/*"), file);
            aadhaarBackPart = MultipartBody.Part.createFormData("aadhaar_back", file.getName(), requestFile);
        }

        if (!dlPath.isEmpty()) {
            File file = new File(dlPath);
            RequestBody requestFile = RequestBody.create(MediaType.parse("image/*"), file);
            dlPart = MultipartBody.Part.createFormData("dl", file.getName(), requestFile);
        }

        if (!rcPath.isEmpty()) {
            File file = new File(rcPath);
            RequestBody requestFile = RequestBody.create(MediaType.parse("image/*"), file);
            rcPart = MultipartBody.Part.createFormData("rc", file.getName(), requestFile);
        }

        if (!panPath.isEmpty()) {
            File file = new File(panPath);
            RequestBody requestFile = RequestBody.create(MediaType.parse("image/*"), file);
            panPart = MultipartBody.Part.createFormData("pan", file.getName(), requestFile);
        }

        String selectedCityId = cityIds.isEmpty() || spinnerCity.getSelectedItemPosition() < 0 ?
                "1" : cityIds.get(spinnerCity.getSelectedItemPosition());
        RequestBody reqCityId = RequestBody.create(MediaType.parse("text/plain"), selectedCityId);

        String vehicleNoStr = edVehicleNo.getText().toString().trim();
        RequestBody reqVehicleNo = RequestBody.create(MediaType.parse("text/plain"), vehicleNoStr);

        RequestBody reqDeviceId = RequestBody.create(MediaType.parse("text/plain"), Utility.getDeviceId(this));

        String referralCodeStr = edReferralCode.getText().toString().trim();
        RequestBody reqReferralCode = RequestBody.create(MediaType.parse("text/plain"), referralCodeStr);

        Call<ResponseBody> call = APIClient.getInterface().regUserNew(
                reqMobile, reqFullName, reqEmail, reqAccountName, reqAccountNumber,
                reqIfsc, reqVehicle, reqVehicleNo, reqCityId, reqRegisterType,
                aadhaarPart, aadhaarBackPart, dlPart, rcPart, panPart,
                reqFcmToken, reqDeviceId, reqReferralCode
        );

        call.enqueue(new Callback<ResponseBody>() {
            @Override
            public void onResponse(Call<ResponseBody> call, Response<ResponseBody> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    try {
                        String respString = response.body().string();
                        Log.e("REG_DEBUG", "Response: " + respString);

                        JSONObject jsonObject = new JSONObject(respString);
                        if (jsonObject.has("Result") && jsonObject.getString("Result").equalsIgnoreCase("true")) {
                            Toast.makeText(NewRegistrationActivity.this, "Registration Successful", Toast.LENGTH_SHORT).show();
                            Intent intent = new Intent(NewRegistrationActivity.this, UnderReviewActivity.class);
                            startActivity(intent);
                            finish();
                        } else {
                            String msg = jsonObject.has("ResponseMsg") ? jsonObject.getString("ResponseMsg") : "Registration Failed";
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


    private void addPartIfValid(List<MultipartBody.Part> parts, String path, String name) {
        if (path != null && !path.isEmpty()) {
            File file = new File(path);
            RequestBody reqFile = RequestBody.create(MediaType.parse("image/*"), file);
            MultipartBody.Part body = MultipartBody.Part.createFormData("image[]", file.getName(), reqFile);
            parts.add(body);
        }
    }

    private void setupUIForMethod(String method) {
        if (method.equals("manual")) {
            llFullName.setVisibility(View.VISIBLE);
            tvSubtitle.setText("Manual verification requires full name & photo uploads *");
            llModeIndicator.setBackground(ContextCompat.getDrawable(this, R.drawable.bg_card_orange));
            imgModeIcon.setImageResource(R.drawable.ic_baseline_person_24);
            imgModeIcon.setColorFilter(Color.parseColor("#FF9800"));
            tvModeTitle.setText("Manual Verification Mode");
            tvModeTitle.setTextColor(Color.parseColor("#FF9800"));
            tvModeText.setText("Upload document photos. Our team will review within 24 hours.");
            tvFooterNote.setText("✓ Clear photos help our team verify faster");
            tvFooterNote.setTextColor(Color.parseColor("#FF9800"));

            if (llAadhaarBackContainer != null) llAadhaarBackContainer.setVisibility(View.VISIBLE);
            if (tvAadhaarLabel != null) tvAadhaarLabel.setText("Aadhaar Card Front *");

            btnAadhaar.setText("Upload");
            btnAadhaarBack.setText("Upload");
            btnDl.setText("Upload");
            btnRc.setText("Upload");
            btnPan.setText("Upload");

            tvAadhaarStatus.setText("Not uploaded");
            tvAadhaarBackStatus.setText("Not uploaded");
            tvDlStatus.setText("Not uploaded");
            tvRcStatus.setText("Not uploaded");
            tvPanStatus.setText("Optional");
        } else {
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
                tvPanStatus.setText("Click to verify Income Tax PAN");
            }
        }
    }

    private void registerUserAutomatic() {
        custPrograssbar.prograssCreate(this);
        JSONObject reqJson = new JSONObject();
        try {
            String fname = edFullName.getText().toString().trim();
            String selectedCityId = cityIds.isEmpty() || spinnerCity.getSelectedItemPosition() < 0 ?
                    "1" : cityIds.get(spinnerCity.getSelectedItemPosition());
            String vehicleType = spinnerVehicleType.getSelectedItem() != null ?
                    spinnerVehicleType.getSelectedItem().toString() : "";

            reqJson.put("full_name", fname);
            reqJson.put("email", edEmail.getText().toString().trim());
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

        RequestBody body = RequestBody.create(MediaType.parse("application/json; charset=utf-8"), reqJson.toString());
        Call<ResponseBody> call = APIClient.getInterface().regUserJson(body);

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

                            if (jsonObject.has("rider_data") && !jsonObject.isNull("rider_data")) {
                                JSONObject riderObj = jsonObject.getJSONObject("rider_data");
                                Gson gson = new Gson();
                                RiderData riderData = gson.fromJson(riderObj.toString(), RiderData.class);
                                sessionManager.setUserDetails(riderData);
                                sessionManager.setBooleanData(SessionManager.login, true);
                            }

                            // Automatic flow: if charge > 0 → payment screen, else → direct Home
                            if (autoVerificationCharge > 0) {
                                Intent intent = new Intent(NewRegistrationActivity.this, AutoPaymentActivity.class);
                                intent.putExtra("mobile", mobileNumber);
                                intent.putExtra("auto_verification_charge", autoVerificationCharge);
                                intent.putExtra("auto_verification_charge_old", autoVerificationChargeOld);
                                intent.putExtra("auto_verification_msg", autoVerificationMsg);
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
                .putBoolean("dl_verified_" + mobileNumber, isDlAutoVerified)
                .putString("dl_num_" + mobileNumber, dlNumber)
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
            }
        }

        if (!isDlAutoVerified) {
            isDlAutoVerified = sp.getBoolean("dl_verified_" + mobileNumber, false);
            if (isDlAutoVerified) {
                dlNumber = sp.getString("dl_num_" + mobileNumber, "");
            }
        }

        if ("automatic".equals(verificationMethod)) {
            if (isAadhaarAutoVerified && !aadhaarNumber.isEmpty()) {
                tvAadhaarStatus.setText("Verified ✓ (" + aadhaarNumber + ")");
                tvAadhaarStatus.setTextColor(Color.parseColor("#4CAF50"));
                btnAadhaar.setText("Verified");
                btnAadhaar.setEnabled(false);
                btnAadhaar.setAlpha(0.6f);
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
                .remove("dl_verified_" + mobileNumber)
                .remove("dl_num_" + mobileNumber)
                .apply();
    }
}
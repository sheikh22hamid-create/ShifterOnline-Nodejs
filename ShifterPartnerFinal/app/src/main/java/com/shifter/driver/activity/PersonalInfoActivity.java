package com.shifter.driver.activity;

import static com.shifter.driver.utility.FileUtils.createPartFromString;
import static com.shifter.driver.utility.FileUtils.prepareFilePart;

import android.Manifest;
import android.app.DatePickerDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.bumptech.glide.Glide;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.gson.Gson;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityPersonalInfoBinding;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.model.City;
import com.shifter.driver.model.CityListItem;
import com.shifter.driver.model.Login;
import com.shifter.driver.model.TampAddress;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import org.json.JSONObject;

import java.io.File;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.Map;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;
import android.widget.NumberPicker;
import android.widget.TextView;

public class PersonalInfoActivity extends AppCompatActivity implements GetResult.MyListener {

    private ActivityPersonalInfoBinding binding;
    private SessionManager sessionManager;
    private CustPrograssbar custPrograssbar;
    private ImagePicker imagePicker;

    private final List<CityListItem> cityList = new ArrayList<>();
    private String cityId = "";
    private String selectedCity = "";
    private String selectedDob = "";
    private String selectedImagePath = "";
    private String fcmToken = "";
    private String selectedLanguage = "";

    private TampAddress address;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityPersonalInfoBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        imagePicker = new ImagePicker();

        requestPermissions();

        setupClicks();
        setupDobPicker();
        setupLanguageSpinner(); // 🔥 Add this line
        getCityList();

        binding.edPrimmobile.setText(getIntent().getStringExtra("mobile"));
    }

    // ---------------- LANGUAGE SPINNER ----------------
    // ---------------- LANGUAGE SPINNER ----------------
    private void setupLanguageSpinner() {
        // Get array from resources
        String[] languagesArray = getResources().getStringArray(R.array.language_options);

        List<String> languages = new ArrayList<>();
        for (String lang : languagesArray) {
            languages.add(lang);
        }

        ArrayAdapter<String> adapter = new ArrayAdapter<>(
                this,
                android.R.layout.simple_spinner_dropdown_item,
                languages
        );

        binding.spinnerLanguages.setAdapter(adapter);

        binding.spinnerLanguages.setOnItemSelectedListener(
                new android.widget.AdapterView.OnItemSelectedListener() {
                    @Override
                    public void onItemSelected(android.widget.AdapterView<?> parent,
                                               android.view.View view,
                                               int position,
                                               long id) {
                        if (position > 0) { // Ignore first option (Select Language)
                            selectedLanguage = languages.get(position);
                        } else {
                            selectedLanguage = "";
                        }
                    }

                    @Override
                    public void onNothingSelected(android.widget.AdapterView<?> parent) {
                        selectedLanguage = "";
                    }
                });
    }

    // ---------------- CLICK HANDLING ----------------
    private void setupClicks() {

        binding.imgBack.setOnClickListener(v -> finish());

        binding.edAddress.setOnClickListener(v -> openMap());

       // binding.imgProfile.setOnClickListener(v -> pickImage());
      //  binding.txtUpload.setOnClickListener(v -> pickImage());

        binding.imgProfile.setOnClickListener(v -> {
            Utility.bottonConfirm(this, imagePicker);
        });

        binding.txtUpload.setOnClickListener(v -> {
            Utility.bottonConfirm(this, imagePicker);
        });


        binding.txtContinue.setOnClickListener(v -> {
            if (validateForm()) {
                getFCMTokenAndUpload();
            }
        });
    }

    // ---------------- DOB ----------------
   /* private void setupDobPicker() {
        binding.edDob.setOnClickListener(v -> {
            Calendar c = Calendar.getInstance();
            new DatePickerDialog(this,
                    (view, y, m, d) -> {
                        selectedDob = d + "-" + (m + 1) + "-" + y;
                        binding.edDob.setText(selectedDob);
                    },
                    c.get(Calendar.YEAR),
                    c.get(Calendar.MONTH),
                    c.get(Calendar.DAY_OF_MONTH)
            ).show();
        });
    }*/

    // ---------------- DOB ----------------
    // ---------------- DOB ----------------
    // ---------------- DOB ----------------
    private void setupDobPicker() {
        binding.edDob.setOnClickListener(v -> showCustomDobPicker());
    }

    private void showCustomDobPicker() {

        View view = getLayoutInflater().inflate(R.layout.dialog_dob_picker, null);

        NumberPicker pickerDay = view.findViewById(R.id.pickerDay);
        NumberPicker pickerMonth = view.findViewById(R.id.pickerMonth);
        NumberPicker pickerYear = view.findViewById(R.id.pickerYear);
        TextView txtCancel = view.findViewById(R.id.txtCancel);
        TextView txtDone = view.findViewById(R.id.txtDone);

        String[] months = new String[]{
                "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        };

        Calendar c = Calendar.getInstance();
        int currentYear = c.get(Calendar.YEAR);
        int currentMonth = c.get(Calendar.MONTH);
        int currentDay = c.get(Calendar.DAY_OF_MONTH);

        pickerDay.setMinValue(1);
        pickerDay.setMaxValue(31);
        pickerDay.setValue(currentDay);

        pickerMonth.setMinValue(0);
        pickerMonth.setMaxValue(11);
        pickerMonth.setDisplayedValues(months);
        pickerMonth.setValue(currentMonth);

        pickerYear.setMinValue(1950);
        pickerYear.setMaxValue(currentYear);
        pickerYear.setValue(currentYear);

        // Style pickers to look clean (bigger text)
        stylePicker(pickerDay);
        stylePicker(pickerMonth);
        stylePicker(pickerYear);

        androidx.appcompat.app.AlertDialog dialog =
                new androidx.appcompat.app.AlertDialog.Builder(this)
                        .setView(view)
                        .create();

        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(R.drawable.bg_dialog_rounded);
        }

        txtCancel.setOnClickListener(v -> dialog.dismiss());

        txtDone.setOnClickListener(v -> {
            int day = pickerDay.getValue();
            int month = pickerMonth.getValue() + 1;
            int year = pickerYear.getValue();

            selectedDob = day + "-" + month + "-" + year;
            binding.edDob.setText(selectedDob);
            dialog.dismiss();
        });

        dialog.show();
    }

    // Optional: increase font size of NumberPicker text for cleaner look
    private void stylePicker(NumberPicker picker) {
        for (int i = 0; i < picker.getChildCount(); i++) {
            View child = picker.getChildAt(i);
            if (child instanceof android.widget.EditText) {
                ((android.widget.EditText) child).setTextSize(20);
            }
        }
    }

    // ---------------- MAP ----------------
    private void openMap() {
        if (selectedCity.isEmpty()) {
            Toast.makeText(this, "Please select city first", Toast.LENGTH_SHORT).show();
            return;
        }
        Intent i = new Intent(this, MapActivity.class);
        i.putExtra("city", selectedCity);
        startActivityForResult(i, 100);
    }

    // ---------------- IMAGE ----------------
   /* private void pickImage() {
        if (checkPermission()) {
            imagePicker.pickImage(this);
        } else {
            requestPermissions();
        }
    }*/

    // ---------------- VALIDATION ----------------
    private boolean validateForm() {

        if (TextUtils.isEmpty(binding.edFirstname.getText()))
            return error(getString(R.string.error_first_name));
        if (TextUtils.isEmpty(binding.edLastname.getText()))
            return error(getString(R.string.error_last_name));
        if (TextUtils.isEmpty(binding.edNationnality.getText()))
            return error(getString(R.string.error_nationality));
        if (TextUtils.isEmpty(selectedDob))
            return error(getString(R.string.error_dob));
        if (TextUtils.isEmpty(binding.edPassword.getText()))
            return error(getString(R.string.error_password));
        if (TextUtils.isEmpty(binding.edAddress.getText()))
            return error(getString(R.string.error_address));
        if (selectedImagePath.isEmpty())
            return error(getString(R.string.error_profile_image));
        if (selectedLanguage.isEmpty() || selectedLanguage.equals(getString(R.string.select_language)))
            return error(getString(R.string.error_language));

        return true;
    }

    private boolean error(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
        return false;
    }

    // ---------------- API : CITY ----------------
    private void getCityList() {
        custPrograssbar.prograssCreate(this);
        JSONObject obj = new JSONObject();
        RequestBody body = RequestBody.create(
                MediaType.parse("application/json"), obj.toString());

        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(APIClient.getInterface().city(body), "1");
    }

    @Override
    public void callback(JsonObject result, String callNo) {

        custPrograssbar.closePrograssBar();

        if (callNo.equals("1")) {
            City city = new Gson().fromJson(result, City.class);
            cityList.clear();

            for (CityListItem item : city.getCityList()) {
                if ("1".equals(item.getStatus())) {
                    cityList.add(item);
                }
            }

            List<String> names = new ArrayList<>();
            for (CityListItem c : cityList) names.add(c.getTitle());

            ArrayAdapter<String> adapter = new ArrayAdapter<>(
                    this, android.R.layout.simple_spinner_dropdown_item, names);

            binding.spinnercity.setAdapter(adapter);

            binding.spinnercity.setOnItemSelectedListener(
                    new android.widget.AdapterView.OnItemSelectedListener() {
                        @Override
                        public void onItemSelected(android.widget.AdapterView<?> parent, android.view.View view, int position, long id) {
                            selectedCity = cityList.get(position).getTitle();
                            cityId = cityList.get(position).getId();
                        }

                        @Override
                        public void onNothingSelected(android.widget.AdapterView<?> parent) {}
                    });
        }
    }

    // ---------------- FCM TOKEN & UPLOAD ----------------
    private void getFCMTokenAndUpload() {
        FirebaseMessaging.getInstance().getToken()
                .addOnCompleteListener(task -> {
                    if (!task.isSuccessful()) {
                        Log.e("FCM", "Fetching FCM token failed", task.getException());
                        fcmToken = "";
                    } else {
                        fcmToken = task.getResult();
                        Log.d("FCM", "Token: " + fcmToken);
                    }
                    uploadData();
                });
    }

    // ---------------- UPLOAD ----------------
    private void uploadData() {

        if (!isNetworkAvailable()) {
            Toast.makeText(this, "No internet", Toast.LENGTH_SHORT).show();
            return;
        }

        custPrograssbar.prograssCreate(this);

        List<MultipartBody.Part> parts = new ArrayList<>();
        parts.add(prepareFilePart("image0", selectedImagePath));

        Call<ResponseBody> call = APIClient.getInterface().regUser(
                createPartFromString(binding.edFirstname.getText().toString()),
                createPartFromString(binding.edLastname.getText().toString()),
                createPartFromString(binding.edPrimmobile.getText().toString()),
                createPartFromString(selectedDob),
                createPartFromString(binding.edNationnality.getText().toString()),
                createPartFromString(cityId),
                createPartFromString(binding.edAddress.getText().toString()),
                createPartFromString(selectedLanguage), // 🔥 Changed from binding.edLanguages
                createPartFromString(binding.edSecoundmobile.getText().toString()),
                createPartFromString(address != null ? String.valueOf(address.getLatitude()) : "0"),
                createPartFromString(address != null ? String.valueOf(address.getLongitude()) : "0"),
                createPartFromString("1"),
                parts,
                createPartFromString(binding.edPassword.getText().toString()),
                createPartFromString(fcmToken != null ? fcmToken : ""),
                createPartFromString(Utility.getDeviceId(this))
        );

        call.enqueue(new Callback<ResponseBody>() {
            @Override
            public void onResponse(Call<ResponseBody> call, Response<ResponseBody> response) {
                custPrograssbar.closePrograssBar();
                startActivity(new Intent(PersonalInfoActivity.this, VerificationProcessActivity.class));
                finish();
            }

            @Override
            public void onFailure(Call<ResponseBody> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(PersonalInfoActivity.this, "Upload failed", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();

        TampAddress address = sessionManager.getAddress();

        if (address != null) {

            this.address = address;

            String fullAddress =
                    address.getHno() + ", " +
                            address.getAddress() +
                            (TextUtils.isEmpty(address.getLandmark()) ? "" :
                                    ", " + address.getLandmark()) +
                            ", " + address.getCity();

            binding.edAddress.setText(fullAddress);
        }
    }


    // ---------------- IMAGE RESULT ----------------
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == ImagePicker.SELECT_IMAGE && resultCode == RESULT_OK) {

            imagePicker.addOnCompressListener(new ImageCompressionListener() {
                @Override
                public void onStart() {}

                @Override
                public void onCompressed(String filePath) {
                    if (filePath != null) {
                        selectedImagePath = filePath;

                        Glide.with(PersonalInfoActivity.this)
                                .load(filePath)
                                .into(binding.imgProfile);
                    }
                }

                @Override
                public void onError(String errorMessage) {
                    Log.e("IMAGE_ERROR", errorMessage);
                }
            });

            imagePicker.getImageFilePath(data);
        }
    }


    // ---------------- PERMISSIONS ----------------
    private boolean checkPermission() {
        return ContextCompat.checkSelfPermission(this,
                Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
    }

    private void requestPermissions() {
        ActivityCompat.requestPermissions(this,
                new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,
                        Manifest.permission.ACCESS_FINE_LOCATION},
                101);
    }

    private boolean isNetworkAvailable() {
        ConnectivityManager cm =
                (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        NetworkInfo ni = cm != null ? cm.getActiveNetworkInfo() : null;
        return ni != null && ni.isConnected();
    }
}

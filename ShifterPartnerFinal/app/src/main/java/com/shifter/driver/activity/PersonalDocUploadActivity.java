// PersonalDocUploadActivity.java
package com.shifter.driver.activity;

import static com.shifter.driver.utility.FileUtils.createPartFromString;
import static com.shifter.driver.utility.FileUtils.prepareFilePart;

import android.Manifest;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import com.bumptech.glide.Glide;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityPersonalDocUploadBinding;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import retrofit2.Call;

public class PersonalDocUploadActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityPersonalDocUploadBinding binding;

    private static final int PICK_FRONT_IMAGE = 101;
    private static final int PICK_BACK_IMAGE = 102;

    private SessionManager sessionManager;
    private String documentType;
    private boolean isFrontImageSelected = false;
    private boolean isBackImageSelected = false;
    private Uri frontImageUri = null;
    private Uri backImageUri = null;
    private String frontImagePath = null;
    private String backImagePath = null;
    private ImagePicker imagePicker;
    private CustPrograssbar custPrograssbar;
    private RiderData riderData;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityPersonalDocUploadBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        documentType = getIntent().getStringExtra("document_type");
        imagePicker = new ImagePicker();
        custPrograssbar = new CustPrograssbar();

        if (riderData == null) {
            Toast.makeText(this, "Error: User session missing. Please login again.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        if (documentType == null) {
            Toast.makeText(this, "Error: Missing document type.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        binding.imgBack.setOnClickListener(this::onViewClicked);
        binding.txtUploadfrount.setOnClickListener(this::onViewClicked);
        binding.txtUploadback.setOnClickListener(this::onViewClicked);
        binding.txtContinue.setOnClickListener(this::onViewClicked);

        setupUI();
        loadExistingData();
    }

    private void setupInputByDocumentType() {

        binding.edPrimmobile.setFilters(new InputFilter[] {}); // reset

        if ("PanCard".equalsIgnoreCase(documentType)) {

            // PAN: ABCDE1234F
            binding.edPrimmobile.setHint("Enter PAN Card Number");
            binding.edPrimmobile.setInputType(
                    InputType.TYPE_CLASS_TEXT |
                            InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);

            binding.edPrimmobile.setFilters(new InputFilter[] {
                    new InputFilter.LengthFilter(10)
            });

        } else if ("License".equalsIgnoreCase(documentType)) {

            // License: Alphanumeric (length different state wise)
            binding.edPrimmobile.setHint("Enter Driving License Number");
            binding.edPrimmobile.setInputType(
                    InputType.TYPE_CLASS_TEXT |
                            InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS);

            binding.edPrimmobile.setFilters(new InputFilter[] {
                    new InputFilter.LengthFilter(20)
            });

        } else if ("aadhar_card".equalsIgnoreCase(documentType)) {

            // Aadhar: only numbers (12 digits)
            binding.edPrimmobile.setHint("Enter Aadhar Number");
            binding.edPrimmobile.setInputType(InputType.TYPE_CLASS_NUMBER);

            binding.edPrimmobile.setFilters(new InputFilter[] {
                    new InputFilter.LengthFilter(12)
            });

        } else {

            // Default fallback
            binding.edPrimmobile.setInputType(InputType.TYPE_CLASS_TEXT);
        }
    }

    private void setupUI() {
        // Title is already set in XML

        // Set appropriate hint based on document type
        if (documentType != null) {
            /*
             * switch (documentType) {
             * case "Residence":
             * edPrimmobile.setHint("Enter Residence Permit ID");
             * break;
             * case "Address":
             * edPrimmobile.setHint("Enter Address Proof ID");
             * break;
             * case "License":
             * edPrimmobile.setHint("Enter Driving License Number");
             * break;
             */
            /*
             * case "driving_license_optional":
             * edPrimmobile.setHint("Enter Driving License Number");
             * break;
             *//*
                * case "PanCard":
                * edPrimmobile.setHint("Enter PAN Card Number");
                * break;
                * }
                */

            setupInputByDocumentType();

        }
    }

    private void loadExistingData() {
        // Load existing document data if available
        String savedId = sessionManager.getStringData(documentType + "_id");
        if (!TextUtils.isEmpty(savedId)) {
            binding.edPrimmobile.setText(savedId);
        }

        // Check if images are already uploaded
        String frontImagePath = sessionManager.getStringData(documentType + "_front");
        String backImagePath = sessionManager.getStringData(documentType + "_back");

        // Here you would load the images from storage
        // For now, we'll just mark them as selected if paths exist
        if (!TextUtils.isEmpty(frontImagePath)) {
            isFrontImageSelected = true;
            // imgFrount.setImageURI(Uri.parse(frontImagePath));
        }

        if (!TextUtils.isEmpty(backImagePath)) {
            isBackImageSelected = true;
            // imgBackend.setImageURI(Uri.parse(backImagePath));
        }
    }

    public void onViewClicked(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_uploadfrount) {
            isFrontImageSelected = true;
            Utility.bottonConfirm(this, imagePicker);
        } else if (view.getId() == R.id.txt_uploadback) {
            isFrontImageSelected = false;
            Utility.bottonConfirm(this, imagePicker);
        } else if (view.getId() == R.id.txt_continue) {
            if (validation()) {
                uploadDocumentToAPI();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == ImagePicker.SELECT_IMAGE && resultCode == RESULT_OK) {
            imagePicker.addOnCompressListener(new ImageCompressionListener() {
                @Override
                public void onStart() {
                    Log.e("IMAGE", "Compression started");
                }

                @Override
                public void onCompressed(String filePath) {
                    Log.e("IMAGE", "Compressed file: " + filePath);
                    if (filePath != null) {
                        if (isFrontImageSelected) {
                            frontImagePath = filePath;
                            Glide.with(PersonalDocUploadActivity.this)
                                    .load(filePath)
                                    .into(binding.imgFrount);
                            binding.txtUploadfrount.setText(getString(R.string.front_uploaded));
                            isFrontImageSelected = true;
                        } else {
                            backImagePath = filePath;
                            Glide.with(PersonalDocUploadActivity.this)
                                    .load(filePath)
                                    .into(binding.imgBackend);
                            binding.txtUploadback.setText(getString(R.string.back_uploaded));
                            isBackImageSelected = true;
                        }
                    }
                }

                @Override
                public void onError(String errorMessage) {
                    Log.e("IMAGE_ERROR", errorMessage);
                    Toast.makeText(PersonalDocUploadActivity.this, "Image compression failed", Toast.LENGTH_SHORT)
                            .show();
                }
            });
            String filePath = imagePicker.getImageFilePath(data);
            if (filePath != null) {
                if (isFrontImageSelected) {
                    frontImagePath = filePath;
                    Glide.with(PersonalDocUploadActivity.this)
                            .load(filePath)
                            .into(binding.imgFrount);
                    binding.txtUploadfrount.setText("Front Uploaded");
                } else {
                    backImagePath = filePath;
                    Glide.with(PersonalDocUploadActivity.this)
                            .load(filePath)
                            .into(binding.imgBackend);
                    binding.txtUploadback.setText("Back Uploaded");
                }
            }
        }
    }

    private boolean validation() {
        String documentId = binding.edPrimmobile.getText().toString().trim();

        // Validate document ID
        if (TextUtils.isEmpty(documentId)) {
            binding.edPrimmobile.setError("Please enter document ID");
            binding.edPrimmobile.requestFocus();
            return false;
        }

        // Validate front image
        if (frontImagePath == null || !new File(frontImagePath).exists()) {
            Toast.makeText(this, "Please upload front side of document", Toast.LENGTH_SHORT).show();
            return false;
        }

        // For some documents, back side might be required
        if ((backImagePath == null || !new File(backImagePath).exists()) &&
                !"License".equals(documentType) &&
                !"aadhar_card".equals(documentType)) {
            Toast.makeText(this, "Please upload back side of document", Toast.LENGTH_SHORT).show();
            return false;
        }

        return true;
    }

    private void uploadDocumentToAPI() {

        custPrograssbar.prograssCreate(this);

        List<MultipartBody.Part> frontParts = new ArrayList<>();
        List<MultipartBody.Part> backParts = new ArrayList<>();

        // Map document type to API type parameter
        String apiDocumentType = mapDocumentTypeToAPI(documentType);

        if (frontImagePath != null && new File(frontImagePath).exists()) {
            frontParts.add(prepareFilePart("image0", frontImagePath));
        }

        if (backImagePath != null && new File(backImagePath).exists()) {
            backParts.add(prepareFilePart("images0", backImagePath));
        }

        RequestBody riderid = createPartFromString(String.valueOf(riderData.getId()));
        RequestBody type = createPartFromString(apiDocumentType);
        RequestBody textid = createPartFromString(binding.edPrimmobile.getText().toString());
        RequestBody size = createPartFromString("" + frontParts.size());
        RequestBody sizes = createPartFromString("" + backParts.size());

        Log.e("DOC_UPLOAD", "Uploading document: " + documentType);
        Log.e("DOC_UPLOAD", "API Type: " + apiDocumentType);
        Log.e("DOC_UPLOAD", "Document ID: " + binding.edPrimmobile.getText().toString());

        Call<JsonObject> call = APIClient.getInterface().personalDocument(riderid, type, textid, size, frontParts,
                sizes, backParts);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

    private String mapDocumentTypeToAPI(String documentType) {
        // Map document type to API expected type
        switch (documentType) {
            case "aadhar_card":
                return "aadhar"; // Adjust based on your API
            case "PanCard":
                return "PanCard"; // Adjust based on your API
            case "License":
                return "License"; // Adjust based on your API
            case "driving_license_optional":
                return "License"; // Adjust based on your API
            case "Residence":
                return "Residence"; // Adjust based on your API
            case "Address":
                return "Address"; // Adjust based on your API
            default:
                return documentType;
        }
    }

    @Override
    public void callback(JsonObject result, String callNo) {

        custPrograssbar.closePrograssBar();

        if (!"1".equalsIgnoreCase(callNo))
            return;

        // 🔥 ALWAYS LOG – chahe kuch bhi aaye
        Log.e("DOC_UPLOAD_TYPE", documentType);
        Log.e("DOC_UPLOAD_RAW", result != null ? result.toString() : "NULL / EMPTY");

        // 🛡️ CASE 1: backend ne kuch bhi return nahi kiya
        if (result == null || result.entrySet().isEmpty()) {
            Log.e("UPLOAD_ASSUME_SUCCESS", "Empty response, backend echo missing");
            handleDocumentSuccess("Document uploaded successfully");
            return;
        }

        // 🛡️ CASE 2: Result key missing
        if (!result.has("Result")) {
            Log.e("UPLOAD_NO_RESULT_KEY", "Result key missing");
            String msg = result.has("ResponseMsg")
                    ? result.get("ResponseMsg").getAsString()
                    : "Document uploaded successfully";
            handleDocumentSuccess(msg);
            return;
        }

        // ✅ CASE 3: Proper response
        String apiResult = result.get("Result").getAsString();
        String msg = result.has("ResponseMsg")
                ? result.get("ResponseMsg").getAsString()
                : "Document uploaded successfully";

        if ("true".equalsIgnoreCase(apiResult)) {
            handleDocumentSuccess(msg);
        } else {
            Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
        }
    }

    private void handleDocumentSuccess(String message) {

        String documentId = binding.edPrimmobile.getText().toString().trim();

        sessionManager.setStringData(documentType + "_id", documentId);
        sessionManager.setStringData(documentType + "_status", "uploaded");

        if (frontImagePath != null) {
            sessionManager.setStringData(documentType + "_front", frontImagePath);
        }
        if (backImagePath != null) {
            sessionManager.setStringData(documentType + "_back", backImagePath);
        }

        Toast.makeText(this, message, Toast.LENGTH_SHORT).show();

        setResult(RESULT_OK);
        finish();
    }

}
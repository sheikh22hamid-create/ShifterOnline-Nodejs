// VehicleDetailsActivity.java
package com.shifter.driver.activity;

import static com.shifter.driver.utility.FileUtils.createPartFromString;
import static com.shifter.driver.utility.FileUtils.prepareFilePart;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.text.TextUtils;

import com.bumptech.glide.Glide;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.utility.Utility;
import android.util.Log;
import android.view.View;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityVehicleDetailsBinding;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.FileUtils;
import com.shifter.driver.utility.SessionManager;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

import okhttp3.MultipartBody;
import retrofit2.Call;

public class VehicleDetailsActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityVehicleDetailsBinding binding;

    private static final int PICK_RC_FRONT_IMAGE = 201;
    private static final int PICK_RC_BACK_IMAGE = 202;
    private static final int PICK_PUC_IMAGE = 203;

    private SessionManager sessionManager;
    private RiderData riderData;
    private CustPrograssbar custPrograssbar;
    private boolean isRcFrontSelected = false;
    private boolean isRcBackSelected = false;
    private boolean isPucSelected = false;
    private String rcFrontImagePath = null;
    private String rcBackImagePath = null;
    private String pucImagePath = null;
    private ImagePicker imagePicker;
    private int currentUploadType = 0; // 1 for RC Front, 2 for RC Back, 3 for PUC

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityVehicleDetailsBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();
        imagePicker = new ImagePicker();

        binding.imgBack.setOnClickListener(this::onViewClicked);
        binding.txtUploadRcFront.setOnClickListener(this::onViewClicked);
        binding.txtUploadRcBack.setOnClickListener(this::onViewClicked);
        binding.txtUploadPuc.setOnClickListener(this::onViewClicked);
        binding.txtContinue.setOnClickListener(this::onViewClicked);

        setupUI();
        loadExistingData();
    }

    private void setupUI() {
        // Set up PUC optional checkbox
        binding.chkPucOptional.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (isChecked) {
                // PUC is optional, so make it non-mandatory
                binding.txtUploadPuc.setEnabled(false);
                binding.imgPuc.setEnabled(false);
            } else {
                binding.txtUploadPuc.setEnabled(true);
                binding.imgPuc.setEnabled(true);
            }
        });
    }

    private void loadExistingData() {
        // Load existing vehicle RC data if available
        String savedRcNumber = sessionManager.getStringData("vehicle_rc_number");
        if (!TextUtils.isEmpty(savedRcNumber)) {
            binding.edVehicleRcNumber.setText(savedRcNumber);
        }

        // Check if images are already uploaded
        String rcFrontPath = sessionManager.getStringData("vehicle_rc_front");
        String rcBackPath = sessionManager.getStringData("vehicle_rc_back");
        String pucPath = sessionManager.getStringData("vehicle_puc");

        if (!TextUtils.isEmpty(rcFrontPath)) {
            isRcFrontSelected = true;
            rcFrontImagePath = rcFrontPath;
            binding.txtUploadRcFront.setText(getString(R.string.rc_front_uploaded));
        }

        if (!TextUtils.isEmpty(rcBackPath)) {
            isRcBackSelected = true;
            rcBackImagePath = rcBackPath;
            binding.txtUploadRcBack.setText(getString(R.string.rc_back_uploaded));
        }

        if (!TextUtils.isEmpty(pucPath)) {
            isPucSelected = true;
            pucImagePath = pucPath;
            binding.txtUploadPuc.setText(getString(R.string.puc_uploaded));
        }

        // Check if PUC was marked as optional
        boolean pucOptional = sessionManager.getBooleanData("puc_optional");
        binding.chkPucOptional.setChecked(pucOptional);
    }

    public void onViewClicked(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_upload_rc_front) {
            currentUploadType = 1;
            Utility.bottonConfirm(this, imagePicker);
        } else if (view.getId() == R.id.txt_upload_rc_back) {
            currentUploadType = 2;
            Utility.bottonConfirm(this, imagePicker);
        } else if (view.getId() == R.id.txt_upload_puc) {
            if (!binding.chkPucOptional.isChecked()) {
                currentUploadType = 3;
                Utility.bottonConfirm(this, imagePicker);
            }
        } else if (view.getId() == R.id.txt_continue) {
            submitVehicleDetails();
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
                        if (currentUploadType == 1) {
                            rcFrontImagePath = filePath;
                            Glide.with(VehicleDetailsActivity.this)
                                    .load(filePath)
                                    .into(binding.imgVehicleRcFront);
                            binding.txtUploadRcFront.setText(getString(R.string.rc_front_uploaded));
                            isRcFrontSelected = true;
                        } else if (currentUploadType == 2) {
                            rcBackImagePath = filePath;
                            Glide.with(VehicleDetailsActivity.this)
                                    .load(filePath)
                                    .into(binding.imgVehicleRcBack);
                            binding.txtUploadRcBack.setText(getString(R.string.rc_back_uploaded));
                            isRcBackSelected = true;
                        } else if (currentUploadType == 3) {
                            pucImagePath = filePath;
                            Glide.with(VehicleDetailsActivity.this)
                                    .load(filePath)
                                    .into(binding.imgPuc);
                            binding.txtUploadPuc.setText(getString(R.string.puc_uploaded));
                            isPucSelected = true;
                        }
                    }
                }

                @Override
                public void onError(String errorMessage) {
                    Log.e("IMAGE_ERROR", errorMessage);
                    Toast.makeText(VehicleDetailsActivity.this, "Image compression failed", Toast.LENGTH_SHORT).show();
                }
            });
            String filePath = imagePicker.getImageFilePath(data);
            if (filePath != null) {
                if (currentUploadType == 1) {
                    rcFrontImagePath = filePath;
                    Glide.with(VehicleDetailsActivity.this)
                            .load(filePath)
                            .into(binding.imgVehicleRcFront);
                    binding.txtUploadRcFront.setText(getString(R.string.rc_front_uploaded));
                    isRcFrontSelected = true;
                } else if (currentUploadType == 2) {
                    rcBackImagePath = filePath;
                    Glide.with(VehicleDetailsActivity.this)
                            .load(filePath)
                            .into(binding.imgVehicleRcBack);
                    binding.txtUploadRcBack.setText(getString(R.string.rc_back_uploaded));
                    isRcBackSelected = true;
                } else if (currentUploadType == 3) {
                    pucImagePath = filePath;
                    Glide.with(VehicleDetailsActivity.this)
                            .load(filePath)
                            .into(binding.imgPuc);
                    binding.txtUploadPuc.setText(getString(R.string.puc_uploaded));
                    isPucSelected = true;
                }
            }
        }
    }

    private void submitVehicleDetails() {
        String rcNumber = binding.edVehicleRcNumber.getText().toString().trim();

        // Validate RC Number
        if (TextUtils.isEmpty(rcNumber)) {
            binding.edVehicleRcNumber.setError("Please enter Vehicle RC Number");
            binding.edVehicleRcNumber.requestFocus();
            return;
        }

        // Validate RC Front image
        if (!isRcFrontSelected) {
            Toast.makeText(this, "Please upload Vehicle RC Front", Toast.LENGTH_SHORT).show();
            return;
        }

        // Validate RC Back image
        if (!isRcBackSelected) {
            Toast.makeText(this, "Please upload Vehicle RC Back", Toast.LENGTH_SHORT).show();
            return;
        }

        // PUC is optional if checkbox is checked
        boolean pucOptional = binding.chkPucOptional.isChecked();
        if (!pucOptional && !isPucSelected) {
            Toast.makeText(this, "Please upload PUC or mark it as optional", Toast.LENGTH_SHORT).show();
            return;
        }

        // Upload to API
        uploadVehicleDetailsToAPI(rcNumber, pucOptional);
    }

    private void uploadVehicleDetailsToAPI(String rcNumber, boolean pucOptional) {
        /*
         * if (riderData == null) {
         * Toast.makeText(this, "Please login first", Toast.LENGTH_SHORT).show();
         * return;
         * }
         */

        custPrograssbar.prograssCreate(this);

        // Get vehicle type ID from session (should be set in AdditionalInfoActivity)
        String vehicleType = sessionManager.getStringData("vehicle_type");
        String typeId = "1"; // Default to 1 (Bicycle) if not set
        if (vehicleType != null) {
            // Map vehicle type string to ID
            switch (vehicleType.toLowerCase()) {
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
        }

        // Prepare image parts
        List<MultipartBody.Part> parts = new ArrayList<>();

        if (rcFrontImagePath != null && new File(rcFrontImagePath).exists()) {
            parts.add(prepareFilePart("image0", rcFrontImagePath));
        }

        if (rcBackImagePath != null && new File(rcBackImagePath).exists()) {
            parts.add(prepareFilePart("image1", rcBackImagePath));
        }

        // PUC is optional, so only add if selected
        if (pucImagePath != null && !pucOptional && new File(pucImagePath).exists()) {
            parts.add(prepareFilePart("image2", pucImagePath));
        }

        // Create request bodies
        okhttp3.RequestBody riderid = createPartFromString(String.valueOf(riderData.getId()));
        okhttp3.RequestBody type = createPartFromString(typeId);
        okhttp3.RequestBody regNum = createPartFromString(rcNumber);
        okhttp3.RequestBody size = createPartFromString(String.valueOf(parts.size()));

        Log.e("VEHICLE_UPLOAD", "Uploading vehicle details: RC=" + rcNumber + ", TypeID=" + typeId);

        Call<JsonObject> call = APIClient.getInterface().vehicalVerification(riderid, type, regNum, size, parts);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        try {
            custPrograssbar.closePrograssBar();
            if (callNo.equalsIgnoreCase("1")) {
                Gson gson = new Gson();
                RestResponse response = gson.fromJson(result.toString(), RestResponse.class);

                if (response.getResult().equalsIgnoreCase("true")) {
                    String rcNumber = binding.edVehicleRcNumber.getText().toString().trim();
                    boolean pucOptional = binding.chkPucOptional.isChecked();

                    // Save vehicle details locally
                    sessionManager.setStringData("vehicle_rc_number", rcNumber);
                    sessionManager.setStringData("vehicle_rc_status", "uploaded");
                    sessionManager.setBooleanData("puc_optional", pucOptional);

                    if (rcFrontImagePath != null) {
                        sessionManager.setStringData("vehicle_rc_front", rcFrontImagePath);
                    }

                    if (rcBackImagePath != null) {
                        sessionManager.setStringData("vehicle_rc_back", rcBackImagePath);
                    }

                    if (pucImagePath != null) {
                        sessionManager.setStringData("vehicle_puc", pucImagePath);
                        sessionManager.setStringData("vehicle_puc_status", "uploaded");
                    } else if (pucOptional) {
                        sessionManager.setStringData("vehicle_puc_status", "optional");
                    }

                    // Mark vehicle details as complete
                    sessionManager.setStringData("vehicle_details_complete", "true");

                    Toast.makeText(this, response.getResponseMsg() != null ? response.getResponseMsg()
                            : "Vehicle details uploaded successfully", Toast.LENGTH_SHORT).show();

                    // Set result and finish
                    setResult(RESULT_OK);
                    finish();
                } else {
                    String errorMsg = response.getResponseMsg() != null ? response.getResponseMsg()
                            : "Failed to upload vehicle details";
                    Toast.makeText(this, errorMsg, Toast.LENGTH_LONG).show();
                }
            }
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            Log.e("VEHICLE_UPLOAD_ERROR", "Error: " + e.getMessage());
            Toast.makeText(this, "Error uploading vehicle details: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }
}

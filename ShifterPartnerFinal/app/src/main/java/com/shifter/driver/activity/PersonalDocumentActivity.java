// PersonalDocumentActivity.java
package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.CheckBox;
import android.widget.ImageView;

import androidx.appcompat.app.AppCompatActivity;

import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityPersonalDocumentBinding;
import com.shifter.driver.utility.SessionManager;

public class PersonalDocumentActivity extends AppCompatActivity {
    private ActivityPersonalDocumentBinding binding;

    private SessionManager sessionManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityPersonalDocumentBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);

        binding.imgBack.setOnClickListener(this::onViewClicked);
        binding.imgResidancepermit.setOnClickListener(this::onViewClicked);
        binding.imgAddressProof.setOnClickListener(this::onViewClicked);
        binding.imgDrivingLicense.setOnClickListener(this::onViewClicked);
        binding.imgPanCard.setOnClickListener(this::onViewClicked);
        binding.btnNext.setOnClickListener(this::onViewClicked);

        setupUI();
        checkDocumentStatus();
    }

    private void setupUI() {
        // Title is already set in XML

        // Set up checkbox listener
        binding.chkBycycle.setOnCheckedChangeListener((buttonView, isChecked) -> {
            if (isChecked) {
                // If bicycle is selected, make driving license optional
                sessionManager.setStringData("vehicle_type", "bicycle");
            } else {
                sessionManager.setStringData("vehicle_type", "motor_vehicle");
            }
        });
    }

    private void checkDocumentStatus() {
        // Check and update document upload status icons
        updateDocumentIcon(binding.imgResidancepermit, "Residence");
        updateDocumentIcon(binding.imgAddressProof, "Address");
        updateDocumentIcon(binding.imgDrivingLicense, "License");
        updateDocumentIcon(binding.imgPanCard, "PanCard");
    }

    private void updateDocumentIcon(ImageView imageView, String documentType) {
        String status = sessionManager.getStringData(documentType + "_status");
        if ("uploaded".equals(status)) {
            imageView.setImageResource(R.drawable.baseline_check_circle_24); // Change to check icon
        } else {
            imageView.setImageResource(R.drawable.ic_back_left); // Default arrow icon
        }
    }

    public void onViewClicked(View view) {
        String documentType = "";

        if (view.getId() == R.id.img_back) {
            finish();
            return;
        } else if (view.getId() == R.id.img_residancepermit) {
            documentType = "Residence";
        } else if (view.getId() == R.id.img_address_proof) {
            documentType = "Address";
        } else if (view.getId() == R.id.img_driving_license) {
            documentType = "License";
        } else if (view.getId() == R.id.img_pan_card) {
            documentType = "PanCard";
        } else if (view.getId() == R.id.btn_next) {
            finish();
            return;
        }

        if (!documentType.isEmpty()) {
            openDocumentUpload(documentType);
        }
    }

    private void openDocumentUpload(String documentType) {
        Intent intent = new Intent(this, PersonalDocUploadActivity.class);
        intent.putExtra("document_type", documentType);
        startActivityForResult(intent, 101);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == 101 && resultCode == RESULT_OK) {
            // Refresh document status after returning from upload
            checkDocumentStatus();

            // Check if all documents are uploaded
            checkAllDocumentsComplete();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        checkDocumentStatus();
        checkAllDocumentsComplete();
    }

    private void checkAllDocumentsComplete() {

        boolean residenceComplete = "uploaded".equals(sessionManager.getStringData("Residence_status"));

        boolean addressComplete = "uploaded".equals(sessionManager.getStringData("Address_status"));

        boolean panCardComplete = "uploaded".equals(sessionManager.getStringData("PanCard_status"));

        boolean drivingLicenseComplete = true;
        if (!binding.chkBycycle.isChecked()) {
            drivingLicenseComplete = "uploaded".equals(sessionManager.getStringData("License_status"));
        }

        Log.e("DOC_COMPLETE_CHECK",
                "Residence=" + residenceComplete +
                        ", Address=" + addressComplete +
                        ", License=" + drivingLicenseComplete +
                        ", PanCard=" + panCardComplete);

        if (residenceComplete && addressComplete && drivingLicenseComplete && panCardComplete) {
            sessionManager.setStringData("documents_complete", "true");
            Log.e("DOC_COMPLETE_CHECK", "✔ documents_complete = true");
        } else {
            sessionManager.setStringData("documents_complete", "false");
            Log.e("DOC_COMPLETE_CHECK", "✖ documents incomplete");
        }

        if (sessionManager.getStringData("documents_complete").equals("true")) {
            binding.btnNext.setVisibility(View.VISIBLE);
        } else {
            binding.btnNext.setVisibility(View.GONE);
        }
    }

    /*
     * private void checkAllDocumentsComplete() {
     * boolean residenceComplete =
     * "uploaded".equals(sessionManager.getStringData("residence_permit_status"));
     * boolean addressComplete =
     * "uploaded".equals(sessionManager.getStringData("address_proof_status"));
     * boolean panCardComplete =
     * "uploaded".equals(sessionManager.getStringData("pan_card_status"));
     * 
     * // Driving license is required only for motor vehicles
     * boolean drivingLicenseComplete = true; // default to true for bicycle
     * if (!chkBycycle.isChecked()) {
     * drivingLicenseComplete =
     * "uploaded".equals(sessionManager.getStringData("driving_license_status"));
     * }
     * 
     * if (residenceComplete && addressComplete && drivingLicenseComplete &&
     * panCardComplete) {
     * sessionManager.setStringData("documents_complete", "true");
     * }
     * }
     */
}
package com.shifter.driver.activity;

import android.app.Dialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityVerificationProcessBinding;
import com.shifter.driver.model.DocumentV;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import java.util.ArrayList;

public class VerificationProcessActivity extends AppCompatActivity
        implements GetResult.MyListener {

    private ActivityVerificationProcessBinding binding;
    private SessionManager sessionManager;
    private RiderData riderData;
    private CustPrograssbar custPrograssbar;

    private int completedSteps = 0;
    private final int totalSteps = 5;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityVerificationProcessBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();

        if (riderData == null) {
            Toast.makeText(this, "Session expired. Please login again.", Toast.LENGTH_SHORT).show();
            startActivity(new Intent(this, LoginActivity.class));
            finish();
            return;
        }
        custPrograssbar = new CustPrograssbar();

        setupClicks();
        checkVerificationProgress();
    }

    private void updateDocumentIcon(ImageView imageView, String key) {
        String status = sessionManager.getStringData(key + "_complete");
        if ("true".equalsIgnoreCase(status)) {
            imageView.setImageResource(R.drawable.ic_other_pickup);
        } else {
            imageView.setImageResource(R.drawable.ic_back_left);
        }
    }

    private void refreshUI() {
        completedSteps = 0;

        if ("true".equals(sessionManager.getStringData("documents_complete"))) {
            completedSteps++;
            updateDocumentIcon(binding.imgPersonald, "documents");
        }
        if ("true".equals(sessionManager.getStringData("emergency_contact_complete"))) {
            completedSteps++;
            updateDocumentIcon(binding.imgEmercontec, "emergency_contact");
        }
        if ("true".equals(sessionManager.getStringData("additional_info_complete"))) {
            completedSteps++;
            updateDocumentIcon(binding.imgAdditioninfo, "additional_info");
        }
        if ("true".equals(sessionManager.getStringData("vehicle_details_complete"))) {
            completedSteps++;
            updateDocumentIcon(binding.imgVehicledetails, "vehicle_details");
        }
        if ("true".equals(sessionManager.getStringData("bank_account_complete"))) {
            completedSteps++;
            updateDocumentIcon(binding.imgBankaccount, "bank_account");
        }

        updateVerificationStatus();
    }

    @Override
    protected void onResume() {
        super.onResume();
        refreshUI();
    }

    // ------------------------------------------------ CLICKS
    private void setupClicks() {
        binding.imgBack.setOnClickListener(v -> finish());

        binding.imgPersonald.setOnClickListener(v ->
                startActivity(new Intent(this, PersonalDocumentActivity.class)));

        binding.imgEmercontec.setOnClickListener(v ->
                startActivity(new Intent(this, EmergencyContactActivity.class)));

        binding.imgAdditioninfo.setOnClickListener(v -> {
            Intent i = new Intent(this, AdditionalInfoActivity.class);
            i.putExtra("doc", new DocumentV());
            i.putParcelableArrayListExtra("doclist", new ArrayList<>());
            i.putExtra("other", (String) null);
            startActivityForResult(i, 203);
        });

        binding.imgVehicledetails.setOnClickListener(v ->
                startActivityForResult(new Intent(this, VehicleDetailsActivity.class), 201));

        binding.imgBankaccount.setOnClickListener(v ->
                startActivityForResult(new Intent(this, BankAccountActivity.class), 202));

        binding.chkTermsConditions.setOnCheckedChangeListener(
                (buttonView, isChecked) -> updateVerificationStatus());

        binding.txtContinue.setOnClickListener(v -> handleContinue());

        binding.swipeContainer.setOnRefreshListener(() -> {
            checkVerificationProgress();
            binding.swipeContainer.setRefreshing(false);
        });
    }

    // ------------------------------------------------ CONTINUE
    private void handleContinue() {
        if (!binding.chkTermsConditions.isChecked()) {
            Toast.makeText(this, "Please accept Terms & Conditions", Toast.LENGTH_SHORT).show();
            return;
        }
        completeVerification();
    }

    // ------------------------------------------------ VERIFICATION CHECK
    private void checkVerificationProgress() {
        completedSteps = 0;

        if ("true".equalsIgnoreCase(sessionManager.getStringData("documents_complete")))
            completedSteps++;
        if ("true".equalsIgnoreCase(sessionManager.getStringData("emergency_contact_complete")))
            completedSteps++;
        if ("true".equalsIgnoreCase(sessionManager.getStringData("additional_info_complete")))
            completedSteps++;
        if ("true".equalsIgnoreCase(sessionManager.getStringData("vehicle_details_complete")))
            completedSteps++;
        if ("true".equalsIgnoreCase(sessionManager.getStringData("bank_account_complete")))
            completedSteps++;

        updateVerificationStatus();
    }

    private void updateVerificationStatus() {
        if (completedSteps == totalSteps) {
            binding.layoutTermsFees.setVisibility(View.VISIBLE);
            // Show Continue only when terms accepted
            if (binding.chkTermsConditions.isChecked()) {
                binding.txtContinue.setVisibility(View.VISIBLE);
            } else {
                binding.txtContinue.setVisibility(View.GONE);
            }
        } else {
            binding.layoutTermsFees.setVisibility(View.GONE);
            binding.txtContinue.setVisibility(View.GONE);
        }
    }

    // ------------------------------------------------ API CALLBACKS (no-op – kept for interface)
    @Override
    public void callback(JsonObject result, String callNo) {
        // No API calls made from this screen
    }

    // ------------------------------------------------ COMPLETE VERIFICATION
    private void completeVerification() {
        sessionManager.setBooleanData("terms_accepted", true);
        sessionManager.setStringData("verification_complete", "true");

        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_waiting_for_approval);
        dialog.getWindow().setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        dialog.getWindow().setLayout(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.WRAP_CONTENT);

        Button btnOk = dialog.findViewById(R.id.btn_ok);
        btnOk.setOnClickListener(v -> {
            sessionManager.setBooleanData(SessionManager.login, false);
            dialog.dismiss();
            Toast.makeText(this,
                    "Verification In Process. Login again after some time.", Toast.LENGTH_LONG).show();
            finish();
        });

        dialog.show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode == RESULT_OK) {
            refreshUI();
            checkVerificationProgress();
        }
    }
}

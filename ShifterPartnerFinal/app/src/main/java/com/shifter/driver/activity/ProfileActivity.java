package com.shifter.driver.activity;

import android.os.Bundle;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.bumptech.glide.Glide;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityProfileBinding;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.SessionManager;

import de.hdodenhof.circleimageview.CircleImageView;

public class ProfileActivity extends AppCompatActivity {
    private ActivityProfileBinding binding;

    SessionManager sessionManager;
    RiderData riderData;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityProfileBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();

        binding.editFullName.setText(riderData.getFullName());
        binding.editMobile.setText(riderData.getMobile());
        // Nationality, Dob, Address, Language fields removed from API
        binding.verificationStatus.setText(riderData.getVerificationStatus() != null ? riderData.getVerificationStatus() : "Not Verified");

        // Load Profile Picture using Glide
        Glide.with(this).load(APIClient.baseUrl + "/" + riderData.getProfilePicture()).thumbnail(Glide.with(this).load(R.drawable.user)).into(binding.profilePicture);
        binding.txtContinue.setOnClickListener(view -> finish());
    }

    public void logoutUser() {
        try {
            stopService(new android.content.Intent(this, com.shifter.driver.locationservice.LocationUpdateService.class));
        } catch (Exception e) {
            e.printStackTrace();
        }

        if (riderData != null) {
            try {
                org.json.JSONObject statusObj = new org.json.JSONObject();
                statusObj.put("rider_id", String.valueOf(riderData.getId()));
                statusObj.put("status", "0");
                okhttp3.RequestBody statusBody = okhttp3.RequestBody.create(okhttp3.MediaType.parse("application/json"), statusObj.toString());
                APIClient.getInterface().riderStatus(statusBody).enqueue(new retrofit2.Callback<com.google.gson.JsonObject>() {
                    @Override public void onResponse(retrofit2.Call<com.google.gson.JsonObject> call, retrofit2.Response<com.google.gson.JsonObject> response) {}
                    @Override public void onFailure(retrofit2.Call<com.google.gson.JsonObject> call, Throwable t) {}
                });
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        sessionManager.logoutUser();
        android.content.Intent intent = new android.content.Intent(this, LoginActivity.class);
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }
}
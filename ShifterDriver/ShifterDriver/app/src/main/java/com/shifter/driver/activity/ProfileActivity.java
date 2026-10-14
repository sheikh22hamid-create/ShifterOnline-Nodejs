package com.shifter.driver.activity;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.Toast;


import com.bumptech.glide.Glide;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityProfileBinding;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import java.util.HashMap;
import java.util.Map;

import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class ProfileActivity extends LocaleAwareActivity {
    private static final String TAG = "ProfileActivity";
    private ActivityProfileBinding binding;

    private SessionManager sessionManager;
    private RiderData riderData;
    private boolean saving;
    private boolean resumedOnce;
    private CustPrograssbar custPrograssbar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityProfileBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        com.shifter.driver.utility.ProfileScreenInsets.apply(this);
        binding.imgBack.setOnClickListener(v -> finish());
        binding.editDob.setFocusable(false);
        binding.editDob.setOnClickListener(v -> {
            java.util.Calendar date = java.util.Calendar.getInstance();
            date.add(java.util.Calendar.YEAR, -18);
            try {
                java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US);
                f.setLenient(false);
                java.util.Date old = f.parse(binding.editDob.getText().toString());
                if (old != null) date.setTime(old);
            } catch (Exception ignored) {}
            android.app.DatePickerDialog picker = new android.app.DatePickerDialog(this,
                    (view, year, month, day) -> binding.editDob.setText(String.format(java.util.Locale.US, "%04d-%02d-%02d", year, month + 1, day)),
                    date.get(java.util.Calendar.YEAR), date.get(java.util.Calendar.MONTH), date.get(java.util.Calendar.DAY_OF_MONTH));
            picker.getDatePicker().setMaxDate(System.currentTimeMillis());
            picker.show();
        });

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        riderData = sessionManager.getUserDetails();

        // Populate instantly with cached session data
        if (riderData != null) {
            populateUi(riderData);
            // Fetch fresh profile from backend to get any updated fields
            fetchProfileFromServer(riderData.getId());
        } else {
            Toast.makeText(this, "Session expired, please login again", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        binding.txtContinue.setOnClickListener(view -> saveProfile());
    }

    private void populateUi(RiderData data) {
        if (data == null) return;

        binding.editFullName.setText(data.getFullName() != null ? data.getFullName() : "");
        binding.editMobile.setText(data.getMobile() != null ? data.getMobile() : "");
        binding.editMobile.setFocusable(false);
        binding.editMobile.setClickable(false);

        String nationality = data.getNationality();
        binding.editNationality.setText(nationality != null && !nationality.trim().isEmpty() ? nationality : "Indian");

        binding.editDob.setText(data.getDob() != null ? data.getDob() : "");
        binding.editAddress.setText(data.getFullAddress() != null ? data.getFullAddress() : "");

        String lang = data.getKnowLanguage();
        binding.editLanguage.setText(lang != null && !lang.trim().isEmpty() ? lang : "Hindi, English");

        String status = data.getVerificationStatus() != null ? data.getVerificationStatus() : "Not Verified";
        binding.verificationStatus.setText(status);
        if ("approved".equalsIgnoreCase(status) || "verified".equalsIgnoreCase(status)) {
            binding.verificationStatus.setTextColor(getResources().getColor(R.color.green));
        } else {
            binding.verificationStatus.setTextColor(android.graphics.Color.parseColor("#FF9800"));
        }

        // Load profile picture
        String pic = data.getProfilePicture();
        if (pic != null && !pic.trim().isEmpty()) {
            String url = pic.trim();
            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                if (url.startsWith("/")) {
                    url = NodeApiClient.baseUrl + url.substring(1);
                } else {
                    url = NodeApiClient.baseUrl + url;
                }
            }
            Glide.with(this)
                    .load(url)
                    .placeholder(R.drawable.user)
                    .error(R.drawable.user)
                    .into(binding.profilePicture);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from Complete Registration: re-read what is still pending.
        if (resumedOnce && riderData != null) fetchProfileFromServer(riderData.getId());
        resumedOnce = true;
    }

    /**
     * Lists what registration still lacks ("PAN Card - Pending") with a Complete
     * Registration button. A trial driver goes through the full KYC registration
     * (OTP first, like the Trial Ended screen); a normal driver only fills the
     * remaining details/documents.
     */
    private void renderRegistration(JsonObject registration) {
        boolean complete = registration.has("is_complete") && registration.get("is_complete").getAsBoolean();
        if (complete) {
            binding.cardRegistration.setVisibility(View.GONE);
            return;
        }
        binding.llRegItems.removeAllViews();
        com.google.gson.JsonArray items = registration.getAsJsonArray("items");
        if (items != null) {
            for (com.google.gson.JsonElement e : items) {
                JsonObject item = e.getAsJsonObject();
                String status = item.get("status").getAsString();
                if ("done".equals(status)) continue;
                int label;
                int color = android.graphics.Color.parseColor("#FF9800");
                switch (status) {
                    case "not_uploaded": label = R.string.reg_status_not_uploaded; break;
                    case "under_review": label = R.string.reg_status_under_review; color = android.graphics.Color.parseColor("#1E88E5"); break;
                    case "required_pending": label = R.string.reg_status_required; color = android.graphics.Color.parseColor("#E53935"); break;
                    default: label = R.string.reg_status_pending;
                }
                android.widget.TextView row = new android.widget.TextView(this);
                row.setText(item.get("label").getAsString() + " – " + getString(label));
                row.setTextColor(color);
                row.setTextSize(14);
                row.setPadding(0, 6, 0, 6);
                binding.llRegItems.addView(row);
            }
        }
        boolean fullFlow = "full_registration".equals(registration.has("flow") ? registration.get("flow").getAsString() : "");
        binding.btnCompleteRegistration.setOnClickListener(v -> {
            if (fullFlow) {
                // The server only lets a trial driver take over their account for KYC
                // after a fresh OTP on their mobile (same as the Trial Ended screen).
                binding.btnCompleteRegistration.setEnabled(false);
                android.content.Intent intent = new android.content.Intent(this, SendOTPActivity.class);
                intent.putExtra("mobile", riderData != null ? riderData.getMobile() : "");
                intent.putExtra("code", "+91");
                intent.putExtra("trial_kyc", true);
                startActivity(intent);
            } else {
                startActivity(new android.content.Intent(this, CompleteRegistrationActivity.class));
            }
        });
        binding.btnCompleteRegistration.setEnabled(true);
        binding.cardRegistration.setVisibility(View.VISIBLE);
    }

    private void fetchProfileFromServer(int riderId) {
        if (riderId <= 0) return;

        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderId);

        NodeApiClient.getInterface().getProfile(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject res = response.body();
                    if (res.has("registration") && res.get("registration").isJsonObject()) {
                        renderRegistration(res.getAsJsonObject("registration"));
                    }
                    if (res.has("Result") && res.get("Result").getAsString().equalsIgnoreCase("true")
                            && res.has("rider_data") && !res.get("rider_data").isJsonNull()) {
                        try {
                            RiderData fresh = new Gson().fromJson(res.get("rider_data"), RiderData.class);
                            if (fresh != null) {
                                riderData = fresh;
                                sessionManager.setUserDetails(fresh);
                                populateUi(fresh);
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing profile rider_data: " + e.getMessage());
                        }
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                Log.e(TAG, "fetchProfileFromServer failed: " + t.getMessage());
            }
        });
    }

    private void saveProfile() {
        if (saving) return;
        if (riderData == null || riderData.getId() <= 0) {
            finish();
            return;
        }

        String fullName = binding.editFullName.getText().toString().trim();
        if (fullName.isEmpty()) {
            binding.editFullName.setError("Full name is required");
            binding.editFullName.requestFocus();
            return;
        }

        String dob = binding.editDob.getText().toString().trim();
        String nationality = binding.editNationality.getText().toString().trim();
        String address = binding.editAddress.getText().toString().trim();
        String language = binding.editLanguage.getText().toString().trim();

        saving = true;
        binding.txtContinue.setEnabled(false);
        binding.txtContinue.setText("Saving…");
        custPrograssbar.prograssCreate(this);

        Map<String, Object> body = new HashMap<>();
        body.put("rider_id", riderData.getId());
        body.put("full_name", fullName);
        body.put("dob", dob);
        body.put("nationality", nationality);
        body.put("full_address", address);
        body.put("know_language", language);

        NodeApiClient.getInterface().updateProfile(body).enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                saving = false;
                binding.txtContinue.setEnabled(true);
                binding.txtContinue.setText(R.string.save_changes);
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject res = response.body();
                    boolean ok = res.has("Result") && res.get("Result").getAsString().equalsIgnoreCase("true");
                    if (ok) {
                        if (res.has("rider_data") && !res.get("rider_data").isJsonNull()) {
                            try {
                                RiderData fresh = new Gson().fromJson(res.get("rider_data"), RiderData.class);
                                if (fresh != null) {
                                    riderData = fresh;
                                    sessionManager.setUserDetails(fresh);
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Error parsing updated rider_data: " + e.getMessage());
                            }
                        } else {
                            riderData.setFullName(fullName);
                            riderData.setDob(dob);
                            riderData.setNationality(nationality);
                            riderData.setFullAddress(address);
                            riderData.setKnowLanguage(language);
                            sessionManager.setUserDetails(riderData);
                        }
                        Toast.makeText(ProfileActivity.this, "Profile updated successfully!", Toast.LENGTH_SHORT).show();
                        finish();
                        return;
                    }
                }
                Toast.makeText(ProfileActivity.this, "Failed to update profile", Toast.LENGTH_SHORT).show();
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                saving = false;
                binding.txtContinue.setEnabled(true);
                binding.txtContinue.setText(R.string.save_changes);
                Toast.makeText(ProfileActivity.this, "Network error: " + t.getMessage(), Toast.LENGTH_SHORT).show();
            }
        });
    }

    public void logoutUser() {
        try {
            stopService(new android.content.Intent(this, com.shifter.driver.locationservice.LocationUpdateService.class));
        } catch (Exception e) {
            e.printStackTrace();
        }

        if (riderData != null) {
            try {
                Map<String, Object> statusBody = new HashMap<>();
                statusBody.put("rider_id", riderData.getId());
                statusBody.put("a_status", 0);
                NodeApiClient.getInterface().setStatus(statusBody).enqueue(new Callback<JsonObject>() {
                    @Override public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {}
                    @Override public void onFailure(Call<JsonObject> call, Throwable t) {}
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

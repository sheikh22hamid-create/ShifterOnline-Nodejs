package com.shifter.driver.activity;

import static com.shifter.driver.utility.SessionManager.login;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.databinding.ActivityFirstBinding;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.TrainingData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class FirstActivity extends AppCompatActivity {
    private ActivityFirstBinding binding;
    private static final int NOTIFICATION_PERMISSION_CODE = 200;

    private SessionManager sessionManager;
    private RiderData riderData;
    private boolean isNavigating = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityFirstBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        sessionManager = new SessionManager(FirstActivity.this);
        riderData = sessionManager.getUserDetails();

        // Android 13+ notification permission
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this,
                    Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this,
                        new String[] { Manifest.permission.POST_NOTIFICATIONS },
                        NOTIFICATION_PERMISSION_CODE);
                return;
            }
        }

        scheduleNavigation();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions,
                                           @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        scheduleNavigation();
    }

    private void scheduleNavigation() {
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                checkAndNavigate();
            }
        }, 2000);
    }

    private void checkAndNavigate() {
        if (isNavigating) return;

        if (sessionManager.getBooleanData(login)) {
            if (riderData != null && riderData.getVerificationStatus() != null
                    && riderData.getVerificationStatus().equalsIgnoreCase("approved")) {
                // If active order exists in local storage, open OrderDetailsActivity immediately
                com.shifter.driver.model.PDOrderItem activeOrder = sessionManager.getActiveOrder();
                if (activeOrder != null) {
                    Intent homeIntent = new Intent(FirstActivity.this, HomeActivity.class);
                    Intent detailsIntent = new Intent(FirstActivity.this, OrderDetailsActivity.class);
                    detailsIntent.putExtra("myclass", activeOrder);
                    startActivities(new Intent[]{homeIntent, detailsIntent});
                    finish();
                    return;
                }
                // Training skipped for now -> directly navigate to HomeActivity
                proceedToIntent(new Intent(FirstActivity.this, HomeActivity.class));
            } else if (riderData != null) {
                proceedToIntent(new Intent(FirstActivity.this, ChooseVerificationMethodActivity.class));
            } else {
                proceedToIntent(new Intent(FirstActivity.this, LoginActivity.class));
            }
        } else {
            proceedToIntent(new Intent(FirstActivity.this, LoginActivity.class));
        }
    }

    private void checkTrainingGate(int riderId) {
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", String.valueOf(riderId));
            jsonObject.put("rid", String.valueOf(riderId));
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getTrainingStatus(body);

        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(@NonNull Call<JsonObject> call, @NonNull Response<JsonObject> response) {
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject res = response.body();
                    if (res.has("Result") && res.get("Result").getAsString().equalsIgnoreCase("true")) {
                        Gson gson = new Gson();
                        TrainingData data = gson.fromJson(res.toString(), TrainingData.class);

                        // If training is optional or already completed -> Home
                        if (data != null && (data.getTrainingRequired() == 0 || data.isCompleted())) {
                            proceedToIntent(new Intent(FirstActivity.this, HomeActivity.class));
                            return;
                        } else if (data != null) {
                            // Open Mandatory Training Video Screen
                            Intent trainingIntent = new Intent(FirstActivity.this, TrainingVideoActivity.class);
                            trainingIntent.putExtra("video_url", data.getVideoUrl());
                            trainingIntent.putExtra("video_id", data.getVideoId());
                            trainingIntent.putExtra("video_title", data.getVideoTitle());
                            trainingIntent.putExtra("current_position_seconds", data.getCurrentPositionSeconds());
                            trainingIntent.putExtra("watch_progress", data.getWatchProgress());
                            trainingIntent.putExtra("is_completed", data.isCompleted());
                            proceedToIntent(trainingIntent);
                            return;
                        }
                    }
                }
                // Fallback: Open Training Screen to load with retry
                proceedToIntent(new Intent(FirstActivity.this, TrainingVideoActivity.class));
            }

            @Override
            public void onFailure(@NonNull Call<JsonObject> call, @NonNull Throwable t) {
                // If offline or network error, open TrainingVideoActivity to handle state
                proceedToIntent(new Intent(FirstActivity.this, TrainingVideoActivity.class));
            }
        });
    }

    private void proceedToIntent(Intent destIntent) {
        if (isNavigating) return;
        isNavigating = true;

        Intent inputIntent = getIntent();
        if (inputIntent != null && inputIntent.getExtras() != null) {
            destIntent.putExtras(inputIntent.getExtras());
        }

        startActivity(destIntent);
        finish();
    }

    @Override
    public void onBackPressed() {
        super.onBackPressed();
    }
}
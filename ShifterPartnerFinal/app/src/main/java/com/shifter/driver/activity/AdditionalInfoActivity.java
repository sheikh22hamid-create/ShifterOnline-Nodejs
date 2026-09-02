package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.ImageView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityAdditionalInfoBinding;
import com.shifter.driver.model.VehicleListItem;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.google.gson.JsonObject;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class AdditionalInfoActivity extends AppCompatActivity {
    private ActivityAdditionalInfoBinding binding;

    private SessionManager sessionManager;
    private ArrayList<VehicleListItem> vehicleList = new ArrayList<>();
    private CustPrograssbar custPrograssbar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityAdditionalInfoBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();

        // Get vehicle list from intent
        vehicleList = getIntent().getParcelableArrayListExtra("doclist");
        if (vehicleList == null)
            vehicleList = new ArrayList<>();

        // Log current status
        Log.e("ADDITIONAL_INFO", "========== ACTIVITY STARTED ==========");
        Log.e("ADDITIONAL_INFO", "Vehicle list size: " + vehicleList.size());
        Log.e("ADDITIONAL_INFO", "Vehicle Type from session: " +
                sessionManager.getStringData("vehicle_type"));
        Log.e("ADDITIONAL_INFO", "Rider Kit status: " +
                (isRiderKitComplete() ? "COMPLETE" : "INCOMPLETE"));

        binding.imgBack.setOnClickListener(this::onClick);
        binding.imgRiderKit.setOnClickListener(this::onClick);
        binding.imgVehicleType.setOnClickListener(this::onClick);
        binding.btnNext.setOnClickListener(this::onClick);

        refreshUI();
        checkAdditionalInfoComplete();
    }

    // ================= UI METHODS =================

    private void refreshUI() {
        // Update rider kit icon
        if (isRiderKitComplete()) {
            binding.imgRiderKit.setImageResource(R.drawable.ic_other_pickup);
            Log.e("UI_UPDATE", "Rider Kit icon: ✅ (Completed)");
        } else {
            binding.imgRiderKit.setImageResource(R.drawable.ic_rounded_right);
            Log.e("UI_UPDATE", "Rider Kit icon: 🔄 (Pending)");
        }

        // Update vehicle type icon
        String vehicleType = sessionManager.getStringData("vehicle_type");
        if (vehicleType != null && !vehicleType.isEmpty()) {
            binding.imgVehicleType.setImageResource(R.drawable.ic_other_pickup);
            Log.e("UI_UPDATE", "Vehicle Type icon: ✅ (" + vehicleType + ")");
        } else {
            binding.imgVehicleType.setImageResource(R.drawable.ic_rounded_right);
            Log.e("UI_UPDATE", "Vehicle Type icon: 🔄 (Not selected)");
        }
    }

    // ================= STATUS CHECK METHODS =================

    private boolean isRiderKitComplete() {
        // Check from session manager instead of local variable
        String riderKitStatus = sessionManager.getStringData("rider_kit_complete");
        return "true".equals(riderKitStatus);
    }

    private boolean isVehicleTypeSelected() {
        String vehicleType = sessionManager.getStringData("vehicle_type");
        return vehicleType != null && !vehicleType.isEmpty();
    }

    // ================= STATUS UPDATE =================

    /**
     * Called from RiderKitActivity when rider kit is completed
     */
    public void statusUpdate(String type) {
        Log.e("STATUS_UPDATE", "Received update for: " + type);

        if ("rider".equals(type)) {
            // Save to session manager for persistence
            sessionManager.setStringData("rider_kit_complete", "true");
            Log.e("STATUS_UPDATE", "✅ Rider Kit marked as complete in session");

            // Show success message
            Toast.makeText(this, "Rider Kit Completed Successfully!", Toast.LENGTH_SHORT).show();
        }

        // Update UI
        refreshUI();

        // Check if all conditions are met
        checkAdditionalInfoComplete();
    }

    /**
     * FINAL CONDITION: Rider Kit + Vehicle Type
     */
    private void checkAdditionalInfoComplete() {
        boolean riderKitDone = isRiderKitComplete();
        boolean vehicleDone = isVehicleTypeSelected();

        Log.e("COMPLETION_CHECK", "==========================================");
        Log.e("COMPLETION_CHECK", "Rider Kit Status: " +
                (riderKitDone ? "✅ COMPLETE" : "❌ PENDING"));
        Log.e("COMPLETION_CHECK", "Vehicle Type: " +
                (vehicleDone ? "✅ SELECTED" : "❌ NOT SELECTED"));

        if (riderKitDone && vehicleDone) {
            // All conditions met
            sessionManager.setStringData("additional_info_complete", "true");
            Log.e("COMPLETION_CHECK", "🎉 ALL ADDITIONAL INFO COMPLETE!");

            setResult(RESULT_OK);

            // Show completion message
            // Toast.makeText(this, "All Additional Information Complete!",
            // Toast.LENGTH_SHORT).show();
            binding.btnNext.setVisibility(View.VISIBLE);
        } else {
            // Mark as incomplete
            sessionManager.setStringData("additional_info_complete", "false");
            binding.btnNext.setVisibility(View.GONE);

            // Show what's missing
            if (!riderKitDone && !vehicleDone) {
                Log.e("COMPLETION_CHECK", "Missing: Rider Kit & Vehicle Type");
            } else if (!riderKitDone) {
                Log.e("COMPLETION_CHECK", "Missing: Rider Kit");
            } else if (!vehicleDone) {
                Log.e("COMPLETION_CHECK", "Missing: Vehicle Type");
            }
        }
        Log.e("COMPLETION_CHECK", "==========================================");
    }

    // ================= CLICK HANDLERS =================

    public void onClick(View view) {
        if (view.getId() == R.id.img_back) {
            Log.e("CLICK", "Back button pressed");
            finish();
        } else if (view.getId() == R.id.img_rider_kit) {
            Log.e("CLICK", "Opening Rider Kit Activity");
            openRiderKitActivity();
        } else if (view.getId() == R.id.img_vehicle_type) {
            Log.e("CLICK", "Opening Vehicle Type Selection");
            openVehicleTypeSelection();
        } else if (view.getId() == R.id.btn_next) {
            finish();
        }
    }

    private void openRiderKitActivity() {
        Intent kitIntent = new Intent(this, RiderKitActivity.class);
        kitIntent.putParcelableArrayListExtra("doclist", vehicleList);
        Log.e("ACTIVITY_START", "Starting RiderKitActivity with " + vehicleList.size() + " vehicle items");
        startActivity(kitIntent);
    }

    private void openVehicleTypeSelection() {
        custPrograssbar.prograssCreate(this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", sessionManager.getUserDetails().getId());
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
                        if (resObj.has("ResultData") && resObj.get("ResultData").isJsonArray()) {
                            com.google.gson.JsonArray resultData = resObj.getAsJsonArray("ResultData");
                            if (resultData != null && resultData.size() > 0) {
                                List<String> typeNames = new ArrayList<>();
                                for (int i = 0; i < resultData.size(); i++) {
                                    typeNames.add(resultData.get(i).getAsJsonObject().get("cat_name").getAsString());
                                }
                                showVehicleTypeDialog(typeNames.toArray(new String[0]));
                            } else {
                                Toast.makeText(AdditionalInfoActivity.this, "No vehicle types found",
                                        Toast.LENGTH_SHORT).show();
                            }
                        }
                    } else {
                        String errMsg = resObj.has("ResponseMsg") ? resObj.get("ResponseMsg").getAsString()
                                : "Failed to get vehicle types";
                        Toast.makeText(AdditionalInfoActivity.this, errMsg, Toast.LENGTH_SHORT).show();
                    }
                } else {
                    Toast.makeText(AdditionalInfoActivity.this, "Server Error", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(AdditionalInfoActivity.this, "Network Error", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void showVehicleTypeDialog(String[] vehicleTypes) {
        new android.app.AlertDialog.Builder(this)
                .setTitle("Select Your Vehicle Type")
                .setItems(vehicleTypes, (dialog, which) -> {
                    String selectedType = vehicleTypes[which];
                    updateVehicleOnServer(selectedType);
                })
                .setNegativeButton("Cancel", (dialog, which) -> {
                    Log.e("VEHICLE_SELECT", "Selection cancelled");
                    dialog.dismiss();
                })
                .show();
    }

    private void updateVehicleOnServer(String selectedType) {
        custPrograssbar.prograssCreate(this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", sessionManager.getUserDetails().getId());
            jsonObject.put("vehicle_type", selectedType);
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().riderVehicleUpdate(bodyRequest);
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                custPrograssbar.closePrograssBar();
                if (response.isSuccessful() && response.body() != null) {
                    JsonObject resObj = response.body();
                    if (resObj.has("Result") && resObj.get("Result").getAsString().equals("true")) {
                        String savedType = selectedType.toLowerCase().replace(" ", "_");

                        // Save to session
                        sessionManager.setStringData("vehicle_type", savedType);

                        Log.e("VEHICLE_SELECT", "Selected: " + selectedType + " (Saved as: " + savedType + ")");

                        // Show confirmation
                        Toast.makeText(AdditionalInfoActivity.this, "Vehicle Type Selected: " + selectedType,
                                Toast.LENGTH_SHORT).show();

                        // Update UI and check completion
                        refreshUI();
                        checkAdditionalInfoComplete();
                    } else {
                        String errMsg = resObj.has("ResponseMsg") ? resObj.get("ResponseMsg").getAsString()
                                : "Failed to update vehicle type";
                        Toast.makeText(AdditionalInfoActivity.this, errMsg, Toast.LENGTH_SHORT).show();
                    }
                } else {
                    Toast.makeText(AdditionalInfoActivity.this, "Server Error", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();
                Toast.makeText(AdditionalInfoActivity.this, "Network Error", Toast.LENGTH_SHORT).show();
            }
        });
    }

    // ================= ACTIVITY LIFECYCLE =================

    @Override
    protected void onResume() {
        super.onResume();
        Log.e("ACTIVITY_LIFE", "AdditionalInfoActivity resumed");

        // Refresh UI when returning from other activities
        refreshUI();

        // Check completion status
        checkAdditionalInfoComplete();

        // Show current status as toast
        String status = getCurrentStatusMessage();
        Toast.makeText(this, status, Toast.LENGTH_SHORT).show();
    }

    private String getCurrentStatusMessage() {
        boolean riderKitDone = isRiderKitComplete();
        boolean vehicleDone = isVehicleTypeSelected();

        if (riderKitDone && vehicleDone) {
            return "Additional Info: Complete ✓";
        } else if (riderKitDone) {
            return "Additional Info: Select Vehicle Type";
        } else if (vehicleDone) {
            return "Additional Info: Complete Rider Kit";
        } else {
            return "Additional Info: Start Verification";
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        Log.e("ACTIVITY_LIFE", "AdditionalInfoActivity destroyed");
    }
}
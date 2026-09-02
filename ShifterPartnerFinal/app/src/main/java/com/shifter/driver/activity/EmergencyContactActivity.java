// EmergencyContactActivity.java
package com.shifter.driver.activity;

import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityEmergencyContactBinding;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class EmergencyContactActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityEmergencyContactBinding binding;

    private SessionManager sessionManager;
    private RiderData riderData;
    private CustPrograssbar custPrograssbar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityEmergencyContactBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();
        
        binding.imgBack.setOnClickListener(this::onViewClicked);
        binding.txtContinue.setOnClickListener(this::onViewClicked);

        setupUI();
        loadExistingData();
    }

    private void setupUI() {
        // Title is already set in XML
    }

    private void loadExistingData() {
        // Load existing emergency contact data if available
        String savedName = sessionManager.getStringData("emergency_name");
        String savedRelation = sessionManager.getStringData("emergency_relation");
        String savedPhone = sessionManager.getStringData("emergency_phone");

        if (!TextUtils.isEmpty(savedName)) {
            binding.edCname.setText(savedName);
        }

        if (!TextUtils.isEmpty(savedRelation)) {
            binding.edRelationship.setText(savedRelation);
        }

        if (!TextUtils.isEmpty(savedPhone)) {
            binding.edPrimmobile.setText(savedPhone);
        }
    }

    public void onViewClicked(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_continue) {
            saveEmergencyContact();
        }
    }

    private void saveEmergencyContact() {
        String name = binding.edCname.getText().toString().trim();
        String relation = binding.edRelationship.getText().toString().trim();
        String phone = binding.edPrimmobile.getText().toString().trim();

        // Validation
        if (TextUtils.isEmpty(name)) {
            binding.edCname.setError("Please enter contact name");
            binding.edCname.requestFocus();
            return;
        }

        if (TextUtils.isEmpty(relation)) {
            binding.edRelationship.setError("Please enter relationship");
            binding.edRelationship.requestFocus();
            return;
        }

        if (TextUtils.isEmpty(phone)) {
            binding.edPrimmobile.setError("Please enter contact number");
            binding.edPrimmobile.requestFocus();
            return;
        }

        if (phone.length() < 10) {
            binding.edPrimmobile.setError("Please enter valid contact number");
            binding.edPrimmobile.requestFocus();
            return;
        }

        // Upload to API
        uploadEmergencyContactToAPI(name, relation, phone);
    }

    private void uploadEmergencyContactToAPI(String name, String relation, String phone) {
        /*if (riderData == null) {
            Toast.makeText(this, "Please login first", Toast.LENGTH_SHORT).show();
            return;
        }*/

        custPrograssbar.prograssCreate(this);

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("name", name);
            jsonObject.put("relation", relation);
            jsonObject.put("mobile", phone);
        } catch (JSONException e) {
            e.printStackTrace();
            custPrograssbar.closePrograssBar();
            Toast.makeText(this, "Error preparing data", Toast.LENGTH_SHORT).show();
            return;
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().emeContact(bodyRequest);
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
                    // Save data to shared preferences
                    String name = binding.edCname.getText().toString().trim();
                    String relation = binding.edRelationship.getText().toString().trim();
                    String phone = binding.edPrimmobile.getText().toString().trim();

                    sessionManager.setStringData("emergency_name", name);
                    sessionManager.setStringData("emergency_relation", relation);
                    sessionManager.setStringData("emergency_phone", phone);
                    sessionManager.setStringData("emergency_contact_complete", "true");

                    Toast.makeText(this, response.getResponseMsg() != null ? response.getResponseMsg() : "Emergency contact saved successfully", Toast.LENGTH_SHORT).show();

                    // Navigate back
                    setResult(RESULT_OK);
                    finish();
                } else {
                    String errorMsg = response.getResponseMsg() != null ? response.getResponseMsg() : "Failed to save emergency contact";
                    Toast.makeText(this, errorMsg, Toast.LENGTH_LONG).show();
                }
            }
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            Log.e("EMERGENCY_CONTACT_ERROR", "Error: " + e.getMessage());
            Toast.makeText(this, "Error saving emergency contact: " + e.getMessage(), Toast.LENGTH_SHORT).show();
        }
    }
}
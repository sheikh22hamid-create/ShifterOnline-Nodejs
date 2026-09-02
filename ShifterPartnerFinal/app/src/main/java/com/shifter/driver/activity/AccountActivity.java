package com.shifter.driver.activity;

import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityAccountBinding;
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

public class AccountActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityAccountBinding binding;
    RiderData riderData;
    CustPrograssbar custPrograssbar;
    SessionManager sessionManager;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityAccountBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        
        sessionManager = new SessionManager(this);
        custPrograssbar = new CustPrograssbar();
        //riderData = sessionManager.getUserDetails();
        
        binding.imgBack.setOnClickListener(this::onBindClick);
        binding.txtContinue.setOnClickListener(this::onBindClick);
    }

    private void accountsend() {
        custPrograssbar.prograssCreate(this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("a_name", binding.edAccountholder.getText().toString());
            jsonObject.put("bank_name", binding.edBankname.getText().toString());
            jsonObject.put("iban_num", binding.edIbannumber.getText().toString());
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("vat_id", binding.edVatid.getText().toString());

        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().bankAccount(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

        public void onBindClick(View view) {
        int id = view.getId();
        if (id == R.id.img_back) {
            finish();
        } else if (id == R.id.txt_continue && validationCreate()) {

            accountsend();

        }
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        try {
            custPrograssbar.closePrograssBar();
            if (callNo.equalsIgnoreCase("1")) {
                Gson gson = new Gson();
                RestResponse response = gson.fromJson(result.toString(), RestResponse.class);
                if ("true".equalsIgnoreCase(response.getResult())) {
                    setResult(RESULT_OK);
                    finish();
                }

            }
        } catch (Exception e) {
            Log.e("Error", String.valueOf(e));
        }
    }

    public boolean validationCreate() {
        if (TextUtils.isEmpty(binding.edIbannumber.getText().toString())) {
            binding.edIbannumber.setError("");
            return false;
        }
        if (TextUtils.isEmpty(binding.edBankname.getText().toString())) {
            binding.edBankname.setError("");
            return false;
        }
        if (TextUtils.isEmpty(binding.edAccountholder.getText().toString())) {
            binding.edAccountholder.setError("");
            return false;
        }

        if (TextUtils.isEmpty(binding.edVatid.getText().toString())) {
            binding.edVatid.setError("");
            return false;
        }
        return true;
    }
}
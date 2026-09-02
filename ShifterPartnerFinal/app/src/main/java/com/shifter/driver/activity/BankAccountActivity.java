// BankAccountActivity.java
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
import com.shifter.driver.databinding.ActivityBankAccountBinding;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Objects;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class BankAccountActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityBankAccountBinding binding;

    private SessionManager sessionManager;
    private RiderData riderData;
    private CustPrograssbar custPrograssbar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityBankAccountBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        

        sessionManager = new SessionManager(this);
       // riderData = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();
        
        binding.imgBack.setOnClickListener(this::onViewClicked);
        binding.txtContinue.setOnClickListener(this::onViewClicked);
        
        loadExistingData();
    }

    private String getSessionString(String key) {
        return Objects.requireNonNullElse(sessionManager.getStringData(key), "");
    }

    private void loadExistingData() {
        // Load existing bank account data if available
        //String accountHolderName = sessionManager.getStringData("bank_account_holder_name");
        String accountHolderName = getSessionString("bank_account_holder_name");
        String accountNumber = getSessionString("bank_account_number");
        String ifscCode = getSessionString("bank_ifsc_code");
        String bankName = getSessionString("bank_name");
        String branchName = getSessionString("bank_branch_name");
       // String accountNumber = sessionManager.getStringData("bank_account_number");
       // String ifscCode = sessionManager.getStringData("bank_ifsc_code");
        //String bankName = sessionManager.getStringData("bank_name");
        //String branchName = sessionManager.getStringData("bank_branch_name");

        if (!accountHolderName.isEmpty()) {
            binding.edAccountHolderName.setText(accountHolderName);
        }
        if (!accountNumber.isEmpty()) {
            binding.edAccountNumber.setText(accountNumber);
        }
        if (!ifscCode.isEmpty()) {
            binding.edIfscCode.setText(ifscCode);
        }
        if (!bankName.isEmpty()) {
            binding.edBankName.setText(bankName);
        }
        if (!branchName.isEmpty()) {
            binding.edBranchName.setText(branchName);
        }
    }

    public void onViewClicked(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_continue) {
            submitBankDetails();
        }
    }

    private void submitBankDetails() {
        String accountHolderName = binding.edAccountHolderName.getText().toString().trim();
        String accountNumber = binding.edAccountNumber.getText().toString().trim();
        String ifscCode = binding.edIfscCode.getText().toString().trim();
        String bankName = binding.edBankName.getText().toString().trim();
        String branchName = binding.edBranchName.getText().toString().trim();

        // Validate all fields
        if (TextUtils.isEmpty(accountHolderName)) {
            binding.edAccountHolderName.setError(getString(R.string.enter_account_holder_name));
            binding.edAccountHolderName.requestFocus();
            return;
        }

        if (TextUtils.isEmpty(accountNumber)) {
            binding.edAccountNumber.setError(getString(R.string.enter_account_number));
            binding.edAccountNumber.requestFocus();
            return;
        }

        if (TextUtils.isEmpty(ifscCode)) {
            binding.edIfscCode.setError(getString(R.string.enter_ifsc_code));
            binding.edIfscCode.requestFocus();
            return;
        }

        if (TextUtils.isEmpty(bankName)) {
            binding.edBankName.setError(getString(R.string.enter_bank_name));
            binding.edBankName.requestFocus();
            return;
        }

        if (TextUtils.isEmpty(branchName)) {
            binding.edBranchName.setError(getString(R.string.enter_branch_name));
            binding.edBranchName.requestFocus();
            return;
        }

        // Validate IFSC Code format (should be 11 characters: 4 letters + 0 + 6 alphanumeric)
        if (ifscCode.length() != 11) {
            binding.edIfscCode.setError(getString(R.string.ifsc_length_error));
            binding.edIfscCode.requestFocus();
            return;
        }

        // Validate Account Number (should be numeric and at least 9 digits)
        if (!accountNumber.matches("\\d+") || accountNumber.length() < 9) {
            binding.edAccountNumber.setError(getString(R.string.invalid_account_number));
            binding.edAccountNumber.requestFocus();
            return;
        }

        // Upload to API
        uploadBankAccountToAPI(accountHolderName, accountNumber, ifscCode, bankName, branchName);
    }

    private void uploadBankAccountToAPI(String accountHolderName, String accountNumber, String ifscCode, String bankName, String branchName) {
       /* if (riderData == null) {
            Toast.makeText(this, getString(R.string.login_first), Toast.LENGTH_SHORT).show();
            return;
        }*/

        custPrograssbar.prograssCreate(this);

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("account__name", accountHolderName);
            jsonObject.put("account_number", accountNumber);
            jsonObject.put("ifsc_code", ifscCode);
            jsonObject.put("bank_name", bankName);
            jsonObject.put("branch_name", branchName);
        } catch (JSONException e) {
            e.printStackTrace();
            custPrograssbar.closePrograssBar();
            Toast.makeText(this, getString(R.string.error_preparing_data), Toast.LENGTH_SHORT).show();
            return;
        }

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().bankAccount(bodyRequest);
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
                    // Save bank account data locally
                    String accountHolderName = binding.edAccountHolderName.getText().toString().trim();
                    String accountNumber = binding.edAccountNumber.getText().toString().trim();
                    String ifscCode = binding.edIfscCode.getText().toString().trim();
                    String bankName = binding.edBankName.getText().toString().trim();
                    String branchName = binding.edBranchName.getText().toString().trim();

                    sessionManager.setStringData("bank_account_holder_name", accountHolderName);
                    sessionManager.setStringData("bank_account_number", accountNumber);
                    sessionManager.setStringData("bank_ifsc_code", ifscCode);
                    sessionManager.setStringData("bank_name", bankName);
                    sessionManager.setStringData("bank_branch_name", branchName);
                    sessionManager.setStringData("bank_account_status", getString(R.string.completed));
                    sessionManager.setStringData("bank_account_complete", "true");

                    Toast.makeText(
                            this,
                            response.getResponseMsg() != null
                                    ? response.getResponseMsg()
                                    : getString(R.string.bank_saved_success),
                            Toast.LENGTH_SHORT
                    ).show();

                    // Notify parent activity (VerificationProcessActivity)
                    setResult(RESULT_OK);
                    finish();
                } else {
                    String errorMsg = response.getResponseMsg() != null
                            ? response.getResponseMsg()
                            : getString(R.string.bank_save_failed);

                    Toast.makeText(this, errorMsg, Toast.LENGTH_LONG).show();

                }
            }
        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
            Log.e("BANK_ACCOUNT_ERROR", "Error: " + e.getMessage());
            Toast.makeText(
                    this,
                    getString(R.string.bank_save_error) + ": " + e.getMessage(),
                    Toast.LENGTH_SHORT
            ).show();
        }
    }
}


package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.widget.LinearLayout;

import com.shifter.driver.R;
import com.shifter.driver.utility.SessionManager;

public class TrialEndedActivity extends LocaleAwareActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_trial_ended);
        LinearLayout btnCompleteKyc = findViewById(R.id.btn_complete_kyc);
        btnCompleteKyc.setOnClickListener(v -> {
            SessionManager sessionManager = new SessionManager(TrialEndedActivity.this);
            com.shifter.driver.model.RiderData riderData = sessionManager.getUserDetails();
            Intent intent = new Intent(TrialEndedActivity.this, ChooseVerificationMethodActivity.class);
            if (riderData != null) {
                intent.putExtra("mobile", riderData.getMobile());
                intent.putExtra("code", "+91");
            }
            startActivity(intent);
            finish();
        });
    }
}

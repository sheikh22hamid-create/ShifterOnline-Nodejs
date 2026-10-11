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
            // A double tap would open the OTP screen twice and send two OTPs.
            btnCompleteKyc.setEnabled(false);
            SessionManager sessionManager = new SessionManager(TrialEndedActivity.this);
            com.shifter.driver.model.RiderData riderData = sessionManager.getUserDetails();
            // The server only lets a trial driver take over their account for KYC
            // after a fresh OTP on their mobile, so verify it first.
            Intent intent = new Intent(TrialEndedActivity.this, SendOTPActivity.class);
            if (riderData != null) {
                intent.putExtra("mobile", riderData.getMobile());
            }
            intent.putExtra("code", "+91");
            intent.putExtra("trial_kyc", true);
            startActivity(intent);
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Back from the OTP screen: allow the button again.
        findViewById(R.id.btn_complete_kyc).setEnabled(true);
    }
}

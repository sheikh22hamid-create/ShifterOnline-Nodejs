package com.shifter.driver.activity;

import android.content.Intent;
import android.os.Bundle;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.shifter.driver.R;

public class PaymentActivity extends AppCompatActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_payment);

        TextView btnPay = findViewById(R.id.btn_pay);
        btnPay.setOnClickListener(v -> {
            Intent intent = new Intent(PaymentActivity.this, VerificationCompleteActivity.class);
            startActivity(intent);
            finish(); // Finish payment so user can't go back
        });
    }
}

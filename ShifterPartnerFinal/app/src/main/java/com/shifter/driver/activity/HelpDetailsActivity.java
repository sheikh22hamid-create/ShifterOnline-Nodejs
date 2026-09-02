package com.shifter.driver.activity;

import android.os.Build;
import android.os.Bundle;
import android.text.Html;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityHelpDetailsBinding;

public class HelpDetailsActivity extends AppCompatActivity {
    private ActivityHelpDetailsBinding binding;

        public void onClick() {
        finish();
    }
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityHelpDetailsBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        binding.txtTitle.setText(getIntent().getExtras().getString("title"));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            binding.txtDesc.setText(Html.fromHtml(getIntent().getExtras().getString("desc"), Html.FROM_HTML_MODE_COMPACT));
        } else {
            binding.txtDesc.setText(Html.fromHtml(getIntent().getExtras().getString("desc")));
        }
    }
}
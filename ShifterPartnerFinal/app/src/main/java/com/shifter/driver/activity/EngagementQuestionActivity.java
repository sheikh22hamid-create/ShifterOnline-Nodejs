package com.shifter.driver.activity;

import android.os.Bundle;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;

import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityEngagementQuestionBinding;
import com.shifter.driver.model.SurveyModel;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONArray;

public class EngagementQuestionActivity extends AppCompatActivity {
    private ActivityEngagementQuestionBinding binding;
    private SessionManager sessionManager;

    // ❗ REQUIRED BY QustionFragment
    public static JSONArray jsonArray = new JSONArray();
    public static SurveyModel survery;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityEngagementQuestionBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        
        sessionManager = new SessionManager(this);

        // ✅ VERY IMPORTANT FIX
        if (survery == null) {
            survery = new SurveyModel();
            survery.setSurveryList(new java.util.ArrayList<>());
        }

        binding.txtSubmit.setVisibility(View.VISIBLE);
        binding.imgBack.setOnClickListener(this::onClick);
        binding.txtSubmit.setOnClickListener(this::onClick);
    }

    public void onClick(View view) {

        if (view.getId() == R.id.img_back) {
            finish();
            return;
        }

        // SUBMIT
        Toast.makeText(this, "Survey submitted successfully", Toast.LENGTH_SHORT).show();

        // Mark survey completion and finish with OK
        sessionManager.setStringData("survey_complete", "true");
        setResult(RESULT_OK);

        finish();
    }
}

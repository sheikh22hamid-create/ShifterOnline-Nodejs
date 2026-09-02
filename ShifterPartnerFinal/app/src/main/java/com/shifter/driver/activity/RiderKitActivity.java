package com.shifter.driver.activity;

import static com.shifter.driver.utility.FileUtils.createPartFromString;
import static com.shifter.driver.utility.FileUtils.prepareFilePart;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.widget.CheckBox;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import com.bumptech.glide.Glide;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityRiderKitBinding;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.VehicleListItem;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import java.util.ArrayList;
import java.util.List;

import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import retrofit2.Call;

public class RiderKitActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityRiderKitBinding binding;

    ArrayList<VehicleListItem> vehicleListItems;
    ImagePicker imagePicker;
    CustPrograssbar custPrograssbar;
    SessionManager sessionManager;
    RiderData riderData;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityRiderKitBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        custPrograssbar = new CustPrograssbar();
        sessionManager = new SessionManager(RiderKitActivity.this);
        riderData = sessionManager.getUserDetails();
        vehicleListItems = getIntent().getParcelableArrayListExtra("doclist");
        imagePicker = new ImagePicker();

        binding.imgBack.setOnClickListener(this::onBindClick);
        binding.txtUploadfrount.setOnClickListener(this::onBindClick);
        binding.txtContinue.setOnClickListener(this::onBindClick);

        LayoutInflater layoutInflater = getLayoutInflater();
        for (int i = 0; i < vehicleListItems.size(); i++) {
            View view1 = layoutInflater.inflate(R.layout.custom_rider_kit, binding.lvlBicycle, false);
            TextView txt_title = view1.findViewById(R.id.txt_title);
            LinearLayout lvl_bicycle = view1.findViewById(R.id.lvl_bicycle);
            txt_title.setText(vehicleListItems.get(i).getTitle());
            String[] strArray = null;
            strArray = vehicleListItems.get(i).getVRquired().split(",");
            bike(lvl_bicycle, strArray);
            binding.lvlBicycle.addView(view1);
        }

        binding.radiogroup.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
            public void onCheckedChanged(RadioGroup group, int checkedId) {
                // checkedId is the RadioButton selected
                RadioButton rb = findViewById(checkedId);
                if (rb.getText().toString().equalsIgnoreCase("Yes")) {
                    binding.lvlUpload.setVisibility(View.VISIBLE);
                } else {
                    binding.lvlUpload.setVisibility(View.GONE);

                }
            }
        });
    }

    public void bike(LinearLayout linearLayout, String[] strArray) {
        try {

            LayoutInflater layoutInflater = getLayoutInflater();
            for (int i = 0; i < strArray.length; i++) {

                // Add the text layout to the parent layout
                View view1 = layoutInflater.inflate(R.layout.item_qustionlist1, linearLayout, false);
                CheckBox textView = view1.findViewById(R.id.ch_option4);
                textView.setText(strArray[i]);
                linearLayout.addView(view1);
            }

        } catch (Exception e) {
            Log.e("Error", "--->" + e.getMessage());
        }
    }

    public void onBindClick(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_continue) {
            uploadMultiFile();
        } else if (view.getId() == R.id.txt_uploadfrount) {
            Utility.bottonConfirm(this, imagePicker);
        }
    }

    private void uploadMultiFile() {
        custPrograssbar.prograssCreate(this);

        int radioButtonID = binding.radiogroup.getCheckedRadioButtonId();
        RadioButton radioButton = binding.radiogroup.findViewById(radioButtonID);
        int at = -1;
        List<MultipartBody.Part> parts = new ArrayList<>();
        if (radioButton.getText().toString().equalsIgnoreCase("Yes")) {
            at = 1;
            parts.add(prepareFilePart("image" + 0, frontImg));
        } else {
            at = 0;
        }

        RequestBody riderid = createPartFromString(String.valueOf(riderData.getId()));
        RequestBody qu_answer = createPartFromString(String.valueOf(at));

        RequestBody size = createPartFromString("" + parts.size());

        Call<JsonObject> call = APIClient.getInterface().riderkit(riderid, qu_answer, size, parts);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");

    }

    String frontImg;

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == ImagePicker.SELECT_IMAGE && resultCode == RESULT_OK) {
            imagePicker.addOnCompressListener(new ImageCompressionListener() {
                @Override
                public void onStart() {

                }

                @Override
                public void onCompressed(String filePath) {
                    if (filePath != null) {

                        frontImg = filePath;
                        Glide.with(RiderKitActivity.this)
                                .load(filePath)
                                .into(binding.imgFrount);

                    }
                }

                @Override
                public void onError(String errorMessage) {

                }
            });
            String filePath = imagePicker.getImageFilePath(data);
            if (filePath != null) {

                frontImg = filePath;
                Glide.with(RiderKitActivity.this)
                        .load(filePath)
                        .into(binding.imgFrount);

            }

        }
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        try {
            custPrograssbar.closePrograssBar();
            if (callNo.equalsIgnoreCase("1")) {
                Gson gson = new Gson();
                RestResponse response = gson.fromJson(result.toString(), RestResponse.class);
                Toast.makeText(RiderKitActivity.this, response.getResponseMsg(), Toast.LENGTH_LONG).show();
                if (response.getResult().equalsIgnoreCase("true")) {
                    // Mark rider kit complete in session and return OK
                    sessionManager.setStringData("rider_kit_complete", "true");
                    setResult(RESULT_OK);
                    finish();
                }
            }
        } catch (Exception e) {

        }
    }
}
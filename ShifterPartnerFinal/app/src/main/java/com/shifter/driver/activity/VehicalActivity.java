package com.shifter.driver.activity;

import static com.shifter.driver.utility.FileUtils.createPartFromString;
import static com.shifter.driver.utility.FileUtils.prepareFilePart;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.widget.EditText;
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
import com.shifter.driver.databinding.ActivityVehicalBinding;
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

public class VehicalActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityVehicalBinding binding;
    SessionManager sessionManager;
    CustPrograssbar custPrograssbar;

    ImagePicker imagePicker;
    ArrayList<VehicleListItem> vehicleListItems;
    RiderData riderData;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityVehicalBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        imagePicker = new ImagePicker();

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();
        vehicleListItems = getIntent().getParcelableArrayListExtra("doclist");

        binding.imgBack.setOnClickListener(this::onBindClick);
        binding.txtUploadfrount.setOnClickListener(this::onBindClick);
        binding.txtContinue.setOnClickListener(this::onBindClick);

        createRadioButton();

    }

    private void uploadMultiFile() {

        int radioButtonID = binding.radiogroup.getCheckedRadioButtonId();
        View radioButton = binding.radiogroup.findViewById(radioButtonID);
        int idx = binding.radiogroup.indexOfChild(radioButton);
        custPrograssbar.prograssCreate(this);
        List<MultipartBody.Part> parts = new ArrayList<>();
        if (frontImg != null) {
            parts.add(prepareFilePart("image" + 0, frontImg));
        }
        RequestBody riderid = createPartFromString(String.valueOf(riderData.getId()));
        RequestBody typeid = createPartFromString(vehicleListItems.get(idx).getId());
        RequestBody regnum = createPartFromString(binding.edQustion.getText().toString());
        RequestBody size = createPartFromString("" + parts.size());

        Call<JsonObject> call = APIClient.getInterface().vehicalVerification(riderid, typeid, regnum, size, parts);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");

    }

    private void createRadioButton() {
        final RadioButton[] rb = new RadioButton[vehicleListItems.size()];
        binding.radiogroup.setOrientation(RadioGroup.VERTICAL);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);

        params.setMargins(0, 0, 20, 0);

        params.gravity = Gravity.CENTER;
        for (int i = 0; i < vehicleListItems.size(); i++) {
            rb[i] = new RadioButton(this);
            rb[i].setText(" " + vehicleListItems.get(i).getTitle());
            rb[i].setId(i + 100);
            rb[i].setWidth(480);
            rb[i].setGravity(Gravity.CENTER_VERTICAL);
            rb[i].setLayoutParams(params);
            rb[i].setPadding(0, 0, 10, 0);
            rb[i].setBackground(getResources().getDrawable(R.drawable.box_boder));
            switch (vehicleListItems.get(i).getTitle()) {
                case "Car":
                    rb[i].setCompoundDrawablesWithIntrinsicBounds(null, null,
                            getResources().getDrawable(R.drawable.ic_car), null);
                    break;
                case "Bike":
                    rb[i].setCompoundDrawablesWithIntrinsicBounds(null, null,
                            getResources().getDrawable(R.drawable.ic_bike), null);
                    break;
                case "Bicycle":
                    rb[i].setCompoundDrawablesWithIntrinsicBounds(null, null,
                            getResources().getDrawable(R.drawable.ic_bicycle), null);
                    break;
            }

            binding.radiogroup.addView(rb[i]);
        }
    }

    public void onBindClick(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_uploadfrount) {
            Utility.bottonConfirm(this, imagePicker);
        } else if (view.getId() == R.id.txt_continue) {
            uploadMultiFile();
        }
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
                        Glide.with(VehicalActivity.this)
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
                Glide.with(VehicalActivity.this)
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
                Toast.makeText(VehicalActivity.this, response.getResponseMsg(), Toast.LENGTH_LONG).show();
                if (response.getResult().equalsIgnoreCase("true")) {

                    // ✅ mark vehicle step complete
                    sessionManager.setStringData("vehicle_details_complete", "true");

                    Toast.makeText(
                            VehicalActivity.this,
                            response.getResponseMsg(),
                            Toast.LENGTH_LONG).show();

                    // ✅ notify parent (VerificationProcessActivity)
                    setResult(RESULT_OK);
                    finish();
                }

            }
        } catch (Exception e) {

        }
    }
}
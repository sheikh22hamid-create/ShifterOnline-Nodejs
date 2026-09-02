package com.shifter.driver.activity;

import static com.shifter.driver.utility.FileUtils.createPartFromString;
import static com.shifter.driver.utility.FileUtils.prepareFilePart;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;

import com.bumptech.glide.Glide;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityOtherinfoBinding;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.model.DynamicQuestion;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
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

public class OtherinfoActivity extends AppCompatActivity implements GetResult.MyListener {
    private ActivityOtherinfoBinding binding;
    ImagePicker imagePicker;
    boolean isFrount = false;
    DynamicQuestion dynamicQuestion;
    CustPrograssbar custPrograssbar;
    SessionManager sessionManager;
    RiderData riderData;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityOtherinfoBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        imagePicker = new ImagePicker();
        custPrograssbar = new CustPrograssbar();
        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        dynamicQuestion = getIntent().getParcelableExtra("other");

        if (dynamicQuestion == null) {
            Toast.makeText(this, "Invalid data", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        binding.imgBack.setOnClickListener(this::onBindClick);
        binding.txtUploadfrount.setOnClickListener(this::onBindClick);
        binding.txtUploadback.setOnClickListener(this::onBindClick);
        binding.txtContinue.setOnClickListener(this::onBindClick);

        binding.txtOther.setText(dynamicQuestion.getTitle());
        binding.txtTile.setText(dynamicQuestion.getQuestion());
        switch (dynamicQuestion.getDynamicType()) {
            case "File":
                binding.edQustion.setVisibility(View.GONE);
                binding.lvlUpload.setVisibility(View.VISIBLE);
                break;
            case "Text":
                binding.edQustion.setVisibility(View.VISIBLE);
                binding.lvlUpload.setVisibility(View.GONE);

                break;
        }

    }

    public void onBindClick(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_uploadfrount) {
            isFrount = true;
            Utility.bottonConfirm(this, imagePicker);
        } else if (view.getId() == R.id.txt_uploadback) {
            isFrount = false;
            Utility.bottonConfirm(this, imagePicker);
        } else if (view.getId() == R.id.txt_continue) {
            uploadMultiFile();
        }
    }

    String frontImg, backImg;

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
                        if (isFrount) {
                            frontImg = filePath;
                            Glide.with(OtherinfoActivity.this)
                                    .load(filePath)
                                    .into(binding.imgFrount);
                        } else {
                            backImg = filePath;
                            Glide.with(OtherinfoActivity.this)
                                    .load(filePath)
                                    .into(binding.imgBackend);
                        }

                    }
                }

                @Override
                public void onError(String errorMessage) {

                }
            });
            String filePath = imagePicker.getImageFilePath(data);
            if (filePath != null) {
                if (isFrount) {
                    frontImg = filePath;
                    Glide.with(OtherinfoActivity.this)
                            .load(filePath)
                            .into(binding.imgFrount);
                } else {
                    backImg = filePath;
                    Glide.with(OtherinfoActivity.this)
                            .load(filePath)
                            .into(binding.imgBackend);
                }
            }

        }
    }

    private void uploadMultiFile() {
        custPrograssbar.prograssCreate(OtherinfoActivity.this);

        List<MultipartBody.Part> parts = new ArrayList<>();
        if (frontImg != null) {
            parts.add(prepareFilePart("image" + 0, frontImg));
        }

        List<MultipartBody.Part> partss = new ArrayList<>();
        if (backImg != null) {
            partss.add(prepareFilePart("images" + 0, backImg));
        }

        RequestBody riderid = createPartFromString(String.valueOf(riderData.getId()));
        RequestBody type = createPartFromString(dynamicQuestion.getDynamicType());
        RequestBody idnum = createPartFromString(binding.edQustion.getText().toString());

        RequestBody size = createPartFromString("" + parts.size());
        RequestBody sizes = createPartFromString("" + partss.size());

        Call<JsonObject> call = APIClient.getInterface().dyAnswer(riderid, type, idnum, size, parts, sizes, partss);
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
                Toast.makeText(this, response.getResponseMsg(), Toast.LENGTH_LONG).show();
                if (response.getResult().equalsIgnoreCase("true")) {
                    // Persist completion and notify caller via result
                    sessionManager.setStringData("additional_info_complete", "true");
                    setResult(RESULT_OK);
                    finish();
                }
            } else if (callNo.equalsIgnoreCase("2")) {

            }
        } catch (Exception e) {

        }
    }
}
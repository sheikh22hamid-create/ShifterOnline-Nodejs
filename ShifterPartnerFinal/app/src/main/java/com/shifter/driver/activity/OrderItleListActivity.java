package com.shifter.driver.activity;

import static com.shifter.driver.utility.FileUtils.createPartFromString;
import static com.shifter.driver.utility.FileUtils.prepareFilePart;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.ImageView;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.recyclerview.widget.DefaultItemAnimator;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.adepter.ItemMainAdepter;
import com.shifter.driver.databinding.ActivityOrderItleListBinding;
import com.shifter.driver.imagepicker.ImageCompressionListener;
import com.shifter.driver.imagepicker.ImagePicker;
import com.shifter.driver.model.BuyOrderHistoryItem;
import com.shifter.driver.model.Itemimg;
import com.shifter.driver.model.OrderImage;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import retrofit2.Call;

public class OrderItleListActivity extends AppCompatActivity
        implements ItemMainAdepter.RecyclerTouchListener, GetResult.MyListener {
    private ActivityOrderItleListBinding binding;
    List<Itemimg> orderMainItems = new ArrayList<>();
    ItemMainAdepter itemMainAdepter;

    ImagePicker imagePicker;
    CustPrograssbar custPrograssbar;
    BuyOrderHistoryItem orderItem;
    SessionManager sessionManager;
    RiderData riderData;
    String status = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityOrderItleListBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        custPrograssbar = new CustPrograssbar();
        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        imagePicker = new ImagePicker();
        orderItem = getIntent().getParcelableExtra("myclass");

        binding.imgBack.setOnClickListener(this::onBindClick);
        binding.txtProceed.setOnClickListener(this::onBindClick);

        binding.txtOrderid.setText(getString(R.string.orderid) + " " + orderItem.getId());

        binding.recyclerItmelist.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.VERTICAL, false));
        binding.recyclerItmelist.setItemAnimator(new DefaultItemAnimator());

        getItemList();
    }

    private void getItemList() {
        custPrograssbar.prograssCreate(OrderItleListActivity.this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("orderid", orderItem.getId());
        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().itemList(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");

    }

    private void uploadMultiFile(Itemimg itemimg) {
        custPrograssbar.prograssCreate(this);

        List<MultipartBody.Part> parts = new ArrayList<>();
        for (int i = 0; i < itemimg.getItemImg().size(); i++) {
            parts.add(prepareFilePart("image" + i, itemimg.getItemImg().get(i)));

        }
        RequestBody riderid = createPartFromString(String.valueOf(riderData.getId()));
        RequestBody itemId = createPartFromString(String.valueOf(itemimg.getItemId()));
        RequestBody orderId = createPartFromString(orderItem.getId());
        RequestBody itemTotal = createPartFromString(String.valueOf(itemimg.getItemTotal()));
        RequestBody size = createPartFromString("" + parts.size());

        Call<JsonObject> call = APIClient.getInterface().itemUpload(riderid, itemId, orderId, itemTotal, size, parts);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "2");
    }

    private void orderstatus(String status, String coment) {
        custPrograssbar.prograssCreate(OrderItleListActivity.this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("oid", orderItem.getId());
            jsonObject.put("status", status);
            jsonObject.put("rid", riderData.getId());
            jsonObject.put("comment", coment);

        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().bOrderStatusChange(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "3");
    }

    private void itmeCencle(String itmeid) {
        custPrograssbar.prograssCreate(OrderItleListActivity.this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("order_id", orderItem.getId());
            jsonObject.put("itmeid", itmeid);

        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().itemCencle(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "3");
    }

    @Override
    public void onClickChooseImag(String titel, int pos) {
        Utility.bottonConfirm(this, imagePicker);

        position = pos;
    }

    @Override
    public void onClickimageUpload(Itemimg itemimg, int pos) {
        uploadMultiFile(itemimg);

    }

    @Override
    public void onClickItmeUnavalible(Itemimg itemimg, int position) {
        itmeCencle(itemimg.getItemId());

    }

    int position = -1;

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

                        Itemimg itemMain = orderMainItems.get(position);
                        List<String> itmeimageslist = itemMain.getItemImg();
                        itmeimageslist.add(filePath);

                        itemMain.setItemImg(itmeimageslist);
                        orderMainItems.set(position, itemMain);
                        itemMainAdepter.notifyDataSetChanged();

                    }
                }

                @Override
                public void onError(String errorMessage) {

                }
            });
            String filePath = imagePicker.getImageFilePath(data);
            if (filePath != null) {
                Itemimg itemMain = orderMainItems.get(position);
                List<String> itmeimageslist = itemMain.getItemImg();
                itmeimageslist.add(filePath);

                itemMain.setItemImg(itmeimageslist);
                orderMainItems.set(position, itemMain);
                itemMainAdepter.notifyDataSetChanged();
            }

        }
    }

    OrderImage orderImage;

    @Override
    public void callback(JsonObject result, String callNo) {
        try {
            custPrograssbar.closePrograssBar();
            if (callNo.equalsIgnoreCase("1")) {
                Gson gson = new Gson();
                orderImage = gson.fromJson(result.toString(), OrderImage.class);
                orderMainItems = orderImage.getItemList().getItemList();
                itemMainAdepter = new ItemMainAdepter(orderImage.getItemList().getItemList(), this, this);
                binding.recyclerItmelist.setAdapter(itemMainAdepter);
                for (int i = 0; i < orderImage.getItemList().getItemList().size(); i++) {
                    if (orderImage.getItemList().getItemList().get(i).getItemImg().size() == 0
                            && orderImage.getItemList().getItemList().get(i).getItemConfirm().equalsIgnoreCase("0")) {
                        binding.txtProceed.setVisibility(View.GONE);
                        break;
                    } else {
                        binding.txtProceed.setVisibility(View.VISIBLE);

                    }
                }
                if (orderItem.getOrderFlowId().equalsIgnoreCase("3")) {
                    binding.txtProceed.setText(getString(R.string.proceed_for_confirmation));
                    status = "proceed_img";
                } else if (orderItem.getOrderFlowId().equalsIgnoreCase("5")) {
                    binding.txtProceed.setText(getString(R.string.proceed_service_bill));
                    status = "proceed";

                }

            } else if (callNo.equalsIgnoreCase("2")) {
                Gson gson = new Gson();
                RestResponse response = gson.fromJson(result.toString(), RestResponse.class);
                Toast.makeText(this, response.getResponseMsg(), Toast.LENGTH_LONG).show();
                if (response.getResult().equalsIgnoreCase("true")) {
                    getItemList();
                }

            } else if (callNo.equalsIgnoreCase("3")) {
                Gson gson = new Gson();
                RestResponse response = gson.fromJson(result, RestResponse.class);
                Toast.makeText(this, response.getResponseMsg(), Toast.LENGTH_SHORT).show();
                if (response.getResult().equalsIgnoreCase("true")) {
                    OrderAnyDetailsActivity.isUpdate = true; // ✅ only static flag
                    finish();
                } else {
                    finish();
                }
            }
        } catch (Exception e) {

        }
    }

    public void onBindClick(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        } else if (view.getId() == R.id.txt_proceed) {
            if (orderImage != null && orderItem.getOrderFlowId().equalsIgnoreCase("5")) {
                boolean tmp = false;
                for (int i = 0; i < orderImage.getItemList().getItemList().size(); i++) {
                    if (orderImage.getItemList().getItemList().get(i).getItemConfirm().equalsIgnoreCase("0")
                            || orderImage.getItemList().getItemList().get(i).getItemConfirm().equalsIgnoreCase("2")) {
                        tmp = false;
                        break;
                    } else {
                        tmp = true;
                    }
                }
                if (tmp) {
                    orderstatus(status, "");
                } else {
                    Toast.makeText(this, "wait for customer decision", Toast.LENGTH_LONG).show();

                }

            } else {
                orderstatus(status, "");
            }
        }
    }

}
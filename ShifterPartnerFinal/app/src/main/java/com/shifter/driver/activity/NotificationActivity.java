package com.shifter.driver.activity;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;

import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.DefaultItemAnimator;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.adepter.NotificationAdp;
import com.shifter.driver.databinding.ActivityNotificationBinding;
import com.shifter.driver.model.Notification;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class NotificationActivity extends AppCompatActivity implements NotificationAdp.RecyclerTouchListener {
    private ActivityNotificationBinding binding;
    CustPrograssbar custPrograssbar;
    SessionManager sessionManager;
    RiderData riderData;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityNotificationBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        
        custPrograssbar=new CustPrograssbar();
        sessionManager=new SessionManager(this);
        riderData=sessionManager.getUserDetails();
        
        binding.imgBack.setOnClickListener(this::onBindClick);
        binding.recyclerView.setLayoutManager(new LinearLayoutManager(this, LinearLayoutManager.VERTICAL, false));
        binding.recyclerView.setItemAnimator(new DefaultItemAnimator());

        getNotification();
    }



    private void getNotification() {
        custPrograssbar.prograssCreate(this);
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rid", riderData.getId());

        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().notification(bodyRequest);
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                Log.e("message", " : " + response.message());
                Log.e("body", " : " + response.body());
                custPrograssbar.closePrograssBar();

                Gson gson = new Gson();
                Notification pdOrder = gson.fromJson(response.body(), Notification.class);
                if (pdOrder.getResult().equalsIgnoreCase("true")) {
                    if (pdOrder.getNotificationData().size() != 0) {
                        binding.recyclerView.setVisibility(View.VISIBLE);
                        binding.lvlNotfound.setVisibility(View.GONE);
                        NotificationAdp notificationAdp = new NotificationAdp(NotificationActivity.this, pdOrder.getNotificationData(), NotificationActivity.this);
                        binding.recyclerView.setAdapter(notificationAdp);
                    } else {
                        binding.recyclerView.setVisibility(View.GONE);
                        binding.lvlNotfound.setVisibility(View.VISIBLE);
                    }
                } else {
                    binding.recyclerView.setVisibility(View.GONE);
                    binding.lvlNotfound.setVisibility(View.VISIBLE);

                }


            }
            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                custPrograssbar.closePrograssBar();

                call.cancel();
                t.printStackTrace();
            }
        });

    }




    public void onBindClick(View view) {
        if (view.getId() == R.id.img_back) {
            finish();
        }
    }

    @Override
    public void onNotiItem(String storeResult) {

    }
}
package com.shifter.driver.fragment;

import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.LinearLayout;
import android.widget.Toast;

import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.DefaultItemAnimator;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

import com.google.gson.Gson;
import com.google.gson.JsonObject;

import org.json.JSONException;
import org.json.JSONObject;

import com.shifter.driver.R;
import com.shifter.driver.activity.OrderAnyDetailsActivity;
import com.shifter.driver.adepter.OrderAnyAdapter;
import com.shifter.driver.databinding.FragmentMyOrderBinding;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.model.BuyOrderHistoryItem;
import com.shifter.driver.model.ByOrder;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;


public class OrderAnyFragment extends Fragment implements OrderAnyAdapter.RecyclerTouchListener, SwipeRefreshLayout.OnRefreshListener {
    private FragmentMyOrderBinding binding;
    CustPrograssbar custPrograssbar;
    SessionManager sessionManager;
    RiderData riderData;

    String myInt;
    public OrderAnyFragment() {
        // Required empty public constructor
    }

    public static OrderAnyFragment newInstance(String sectionNumber) {
        OrderAnyFragment fragment = new OrderAnyFragment();
        Bundle args = new Bundle();
        args.putString("ARG_SECTION_NUMBER", sectionNumber);
        fragment.setArguments(args);
        return fragment;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        binding = FragmentMyOrderBinding.inflate(inflater, container, false);

        custPrograssbar = new CustPrograssbar();
        sessionManager = new SessionManager(getActivity());
        riderData = sessionManager.getUserDetails();
        binding.recyclerRecentorders.setLayoutManager(new LinearLayoutManager(getActivity(), LinearLayoutManager.VERTICAL, false));
        binding.recyclerRecentorders.setItemAnimator(new DefaultItemAnimator());
        Bundle bundle = this.getArguments();
        myInt = bundle.getString("ARG_SECTION_NUMBER", "defaultValue");
        binding.refares.setColorSchemeResources(R.color.purple_700,
                android.R.color.holo_green_dark,
                android.R.color.holo_orange_dark,
                android.R.color.holo_blue_dark);

        binding.refares.setOnRefreshListener(this);
        binding.refares.post(new Runnable() {

            @Override
            public void run() {

                binding.refares.setRefreshing(true);


                // Fetching data from server
            }
        });

        getOrder(myInt);
        return binding.getRoot();
    }
    @Override
    public void onRefresh() {
        getOrder(myInt);
    }

    @Override
    public void onClickOrderItem(BuyOrderHistoryItem orderItem, int position) {
        if (!isServiceRunning(LocationUpdateService.class)) {
            Toast.makeText(getActivity(),"Your status is offline, Please make it online.",Toast.LENGTH_LONG).show();
        }else {
            startActivity(new Intent(getActivity(), OrderAnyDetailsActivity.class).putExtra("myclass",orderItem));
        }
    }

    private void getOrder(String type) {
        custPrograssbar.prograssCreate(getActivity());
        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("type", type);
            jsonObject.put("rid", riderData.getId());

        } catch (JSONException e) {
            e.printStackTrace();
        }
        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().buyHistory(bodyRequest);
        call.enqueue(new Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (custPrograssbar != null) {
                    try {
                        custPrograssbar.closePrograssBar();
                    } catch (Exception ignored) {}
                }

                if (!isAdded() || getContext() == null || binding == null) {
                    return;
                }

                Log.e("message", " : " + response.message());
                Log.e("body", " : " + response.body());
                try {
                    if (binding.refares != null) {
                        binding.refares.setRefreshing(false);
                    }
                    Gson gson = new Gson();
                    ByOrder pdOrder = gson.fromJson(response.body(), ByOrder.class);
                    if (pdOrder != null && pdOrder.getResult() != null && pdOrder.getResult().equalsIgnoreCase("true")) {
                        if (pdOrder.getBuyOrderHistory() != null && pdOrder.getBuyOrderHistory().size() != 0) {
                            if (binding.refares != null) binding.refares.setVisibility(View.VISIBLE);
                            if (binding.lvlNotfound != null) binding.lvlNotfound.setVisibility(View.GONE);
                            OrderAnyAdapter categoryAdapter = new OrderAnyAdapter(getActivity(), pdOrder.getBuyOrderHistory(), OrderAnyFragment.this);
                            if (binding.recyclerRecentorders != null) binding.recyclerRecentorders.setAdapter(categoryAdapter);
                        } else {
                            if (binding.refares != null) binding.refares.setVisibility(View.GONE);
                            if (binding.lvlNotfound != null) binding.lvlNotfound.setVisibility(View.VISIBLE);
                        }
                    } else {
                        if (binding.refares != null) binding.refares.setVisibility(View.GONE);
                        if (binding.lvlNotfound != null) binding.lvlNotfound.setVisibility(View.VISIBLE);
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                    if (binding != null) {
                        if (binding.refares != null) binding.refares.setVisibility(View.GONE);
                        if (binding.lvlNotfound != null) binding.lvlNotfound.setVisibility(View.VISIBLE);
                    }
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                if (custPrograssbar != null) {
                    try {
                        custPrograssbar.closePrograssBar();
                    } catch (Exception ignored) {}
                }

                if (!isAdded() || getContext() == null || binding == null) {
                    return;
                }

                try {
                    if (binding.refares != null) {
                        binding.refares.setRefreshing(false);
                        binding.refares.setVisibility(View.GONE);
                    }
                    if (binding.lvlNotfound != null) {
                        binding.lvlNotfound.setVisibility(View.VISIBLE);
                    }
                } catch (Exception ignored) {}

                call.cancel();
                t.printStackTrace();
            }
        });

    }

    private boolean isServiceRunning(Class<?> serviceClass) {
        ActivityManager manager = (ActivityManager) getActivity().getSystemService(Context.ACTIVITY_SERVICE);
        for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
            if (serviceClass.getName().equals(service.service.getClassName())) {
                return true;
            }
        }
        return false;
    }


    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }
}

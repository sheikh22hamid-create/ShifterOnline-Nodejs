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
import com.shifter.driver.activity.OrderDetailsActivity;
import com.shifter.driver.adepter.OrderAdapter;
import com.shifter.driver.databinding.FragmentMyOrderBinding;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.model.PDOrder;
import com.shifter.driver.model.PDOrderItem;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;


public class OrderPDFragment extends Fragment implements OrderAdapter.RecyclerTouchListener, SwipeRefreshLayout.OnRefreshListener {
    private FragmentMyOrderBinding binding;
    CustPrograssbar custPrograssbar;
    SessionManager sessionManager;
    RiderData riderData;

    String myInt;
    public OrderPDFragment() {
        // Required empty public constructor
    }

    public static OrderPDFragment newInstance(String sectionNumber) {
        OrderPDFragment fragment = new OrderPDFragment();
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
       /* binding.refares.post(new Runnable() {

            @Override
            public void run() {

                binding.refares.setRefreshing(true);


                // Fetching data from server
            }
        });*/
        //binding.refares.setRefreshing(true);

        binding.refares.post(() -> {
            if (binding != null) {
                binding.refares.setRefreshing(true);
            }
        });


        getOrder(myInt);
        return binding.getRoot();
    }

    @Override
    public void onClickOrderItem(PDOrderItem orderItem, int position) {
        if ("past".equalsIgnoreCase(myInt)) {
            showCompletedOrderDialog(orderItem);
        } else {
            if (!isServiceRunning(LocationUpdateService.class)) {
                Toast.makeText(getActivity(),"Your status is offline, Please make it online.",Toast.LENGTH_LONG).show();
            } else {
                new SessionManager(getActivity()).setActiveOrder(orderItem);
                startActivity(new Intent(getActivity(), OrderDetailsActivity.class).putExtra("myclass", orderItem));
            }
        }
    }

    /**
     * Formats API date string "2026-07-18 09:28:40" to readable format "18 Jul, 09:28 AM"
     */
    private String formatOrderDate(String apiDate) {
        if (apiDate == null || apiDate.isEmpty()) return "N/A";
        try {
            SimpleDateFormat inputFormat = new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.getDefault());
            SimpleDateFormat outputFormat = new SimpleDateFormat("dd MMM, hh:mm a", Locale.getDefault());
            Date date = inputFormat.parse(apiDate);
            return outputFormat.format(date);
        } catch (ParseException e) {
            e.printStackTrace();
            return apiDate; // fallback to original
        }
    }

    private void setRowVisibilityAndValue(View row, android.widget.TextView txtView, String currency, String valueStr) {
        if (row == null || txtView == null) return;
        if (valueStr == null || valueStr.trim().isEmpty() || "null".equalsIgnoreCase(valueStr.trim())) {
            row.setVisibility(View.GONE);
        } else {
            row.setVisibility(View.VISIBLE);
            double val = parseDoubleSafe(valueStr);
            txtView.setText(currency + String.format(Locale.getDefault(), "%.2f", val));
        }
    }

    private double parseDoubleSafe(String val) {
        if (val == null || val.trim().isEmpty()) return 0.0;
        try {
            return Double.parseDouble(val.trim());
        } catch (Exception e) {
            return 0.0;
        }
    }

    private void showCompletedOrderDialog(PDOrderItem orderItem) {
        if (getActivity() == null || orderItem == null) return;

        final android.app.Dialog dialog = new android.app.Dialog(getActivity());
        dialog.requestWindowFeature(android.view.Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_completed_order_details);

        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            dialog.getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        }

        String currency = sessionManager.getStringData(SessionManager.currency);
        if (currency == null || currency.trim().isEmpty()) currency = "₹";

        // 1. FARE BREAKDOWN
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_minimum_charge), dialog.findViewById(R.id.txt_minimum_charge), currency, orderItem.getMinimumCharge());
        
        String actualPickup = orderItem.getActualPickupCharge() != null ? orderItem.getActualPickupCharge() : orderItem.getPickupCharge();
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_actual_pickup_charge), dialog.findViewById(R.id.txt_actual_pickup_charge), currency, actualPickup);
        
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_pickup_to_drop_charge), dialog.findViewById(R.id.txt_pickup_to_drop_charge), currency, orderItem.getPickupToDropCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_add_stop_charge), dialog.findViewById(R.id.txt_add_stop_charge), currency, orderItem.getAddStopCharge());
        
        String waitingChg = orderItem.getExtraWaitingTimeCharge() != null ? orderItem.getExtraWaitingTimeCharge() : orderItem.getWatingCharge();
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_waiting_charge), dialog.findViewById(R.id.txt_waiting_charge), currency, waitingChg);
        
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_night_charge), dialog.findViewById(R.id.txt_night_charge), currency, orderItem.getNightCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_loading_charge), dialog.findViewById(R.id.txt_loading_charge), currency, orderItem.getLoadingCharge());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_unloading_charge), dialog.findViewById(R.id.txt_unloading_charge), currency, orderItem.getUnloadingCharge());

        String finalFareStr = orderItem.getFinalFareAmount() != null ? orderItem.getFinalFareAmount() : (orderItem.getTotalAmountByUser() != null ? orderItem.getTotalAmountByUser() : orderItem.getTotal());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_final_fare), dialog.findViewById(R.id.txt_final_fare_amount), currency, finalFareStr);

        // 2. DEDUCTIONS
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_commission), dialog.findViewById(R.id.txt_commission), currency, orderItem.getCommission());
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_per_trip_charge), dialog.findViewById(R.id.txt_per_trip_charge), currency, orderItem.getPerTripCharge());

        String totalDeductionsStr = orderItem.getTotalDeductions();
        if (totalDeductionsStr == null && (orderItem.getCommission() != null || orderItem.getPerTripCharge() != null)) {
            double comm = parseDoubleSafe(orderItem.getCommission());
            double tripChg = parseDoubleSafe(orderItem.getPerTripCharge());
            totalDeductionsStr = String.valueOf(comm + tripChg);
        }
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_total_deductions), dialog.findViewById(R.id.txt_total_deductions), currency, totalDeductionsStr);

        String driverEarningStr = orderItem.getDriverTotalEarning() != null ? orderItem.getDriverTotalEarning() : orderItem.getTotal();
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_driver_earning_strip), dialog.findViewById(R.id.txt_driver_total_earning), currency, driverEarningStr);

        // 3. PAYMENT BY USER
        String totalAmountByUserStr = orderItem.getTotalAmountByUser() != null ? orderItem.getTotalAmountByUser() : finalFareStr;
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_total_amount_by_user), dialog.findViewById(R.id.txt_total_amount_by_user), currency, totalAmountByUserStr);

        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_advance_payment), dialog.findViewById(R.id.txt_advance_payment), currency, orderItem.getAdvancePayment());

        String cashToCollectStr = orderItem.getCashToCollect();
        if (cashToCollectStr == null && totalAmountByUserStr != null) {
            double totalVal = parseDoubleSafe(totalAmountByUserStr);
            double advVal = parseDoubleSafe(orderItem.getAdvancePayment());
            cashToCollectStr = String.valueOf(Math.max(0, totalVal - advVal));
        }
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_cash_to_collect_strip), dialog.findViewById(R.id.txt_cash_to_collect), currency, cashToCollectStr);

        // 4. FINAL SETTLEMENT (TO DRIVER)
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_settlement_earning), dialog.findViewById(R.id.txt_settlement_earning), currency, driverEarningStr);

        String cashCollectedStr = orderItem.getCashCollectedFromUser() != null ? orderItem.getCashCollectedFromUser() : cashToCollectStr;
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_row_settlement_cash), dialog.findViewById(R.id.txt_settlement_cash), currency, cashCollectedStr);

        String walletAdjStr = orderItem.getWalletAdjustment();
        if (walletAdjStr == null && driverEarningStr != null && cashCollectedStr != null) {
            double earnVal = parseDoubleSafe(driverEarningStr);
            double collVal = parseDoubleSafe(cashCollectedStr);
            walletAdjStr = String.valueOf(Math.abs(earnVal - collVal));
        }
        setRowVisibilityAndValue(dialog.findViewById(R.id.layout_wallet_adjustment_strip), dialog.findViewById(R.id.txt_wallet_adjustment), currency, walletAdjStr);

        String note = orderItem.getSettlementNote() != null ? orderItem.getSettlementNote() : orderItem.getWalletAdjustmentNote();
        View noteBox = dialog.findViewById(R.id.layout_settlement_note_box);
        android.widget.TextView txtSettlementNote = dialog.findViewById(R.id.txt_settlement_note);
        if (noteBox != null && txtSettlementNote != null) {
            if (note != null && !note.trim().isEmpty() && !"null".equalsIgnoreCase(note.trim())) {
                noteBox.setVisibility(View.VISIBLE);
                txtSettlementNote.setText(note);
            } else {
                noteBox.setVisibility(View.GONE);
            }
        }

        // Close listeners
        View btnCloseHeader = dialog.findViewById(R.id.btn_close_header);
        if (btnCloseHeader != null) btnCloseHeader.setOnClickListener(v -> dialog.dismiss());

        View btnClose = dialog.findViewById(R.id.btn_close_dialog);
        if (btnClose != null) btnClose.setOnClickListener(v -> dialog.dismiss());

        dialog.show();
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
        Call<JsonObject> call = APIClient.getInterface().pkgHistory(bodyRequest);
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
                    PDOrder pdOrder = gson.fromJson(response.body(), PDOrder.class);
                    if (pdOrder != null && "true".equalsIgnoreCase(pdOrder.getResult())) {
                        if (pdOrder.getOrderHistory() != null && pdOrder.getOrderHistory().size() != 0) {
                            if (binding.refares != null) binding.refares.setVisibility(View.VISIBLE);
                            if (binding.lvlNotfound != null) binding.lvlNotfound.setVisibility(View.GONE);
                            OrderAdapter categoryAdapter = new OrderAdapter(getActivity(), pdOrder.getOrderHistory(), OrderPDFragment.this);
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


    @Override
    public void onRefresh() {
        getOrder(myInt);
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

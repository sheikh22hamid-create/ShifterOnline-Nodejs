package com.shifter.driver.activity;

import android.app.Dialog;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.adepter.CustomOrderAdapter;
import com.shifter.driver.model.CustomOrder;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class CustomOrderListActivity extends AppCompatActivity implements GetResult.MyListener {

    private static final String TAG = "CustomOrderList";
    private static final String CALL_GET_ORDERS = "1";
    private static final String CALL_PLACE_BID = "2";

    private RecyclerView rvCustomOrders;
    private LinearLayout layoutEmpty;
    private ProgressBar progressBar;
    private TextView txtCategoryInfo;
    private TextView txtOrderCount;

    private SessionManager sessionManager;
    private RiderData riderData;
    private CustomOrderAdapter adapter;
    private List<CustomOrder> orderList = new ArrayList<>();

    // Currently selected order for bidding
    private CustomOrder selectedOrder;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_custom_order_list);

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();

        initViews();
        fetchCustomOrders();
    }

    private void initViews() {
        rvCustomOrders = findViewById(R.id.rv_custom_orders);
        layoutEmpty = findViewById(R.id.layout_empty);
        progressBar = findViewById(R.id.progress_bar);
        txtCategoryInfo = findViewById(R.id.txt_category_info);
        txtOrderCount = findViewById(R.id.txt_order_count);

        ImageButton btnBack = findViewById(R.id.btn_back);
        btnBack.setOnClickListener(v -> onBackPressed());

        // Show driver's vehicle category
        if (riderData != null && riderData.getVehicle() != null) {
            txtCategoryInfo.setText("Showing orders for: " + riderData.getVehicle());
        }

        // Setup RecyclerView
        rvCustomOrders.setLayoutManager(new LinearLayoutManager(this));
        adapter = new CustomOrderAdapter(this, orderList, this::showBidDialog);
        rvCustomOrders.setAdapter(adapter);
    }

    private void fetchCustomOrders() {
        showLoading(true);

        String category = (riderData != null && riderData.getVehicle() != null)
                ? riderData.getVehicle()
                : "2 wheeler";

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("category", category);
            Log.d(TAG, "Fetch custom orders: " + jsonObject.toString());
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getCustomOrderList(body);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, CALL_GET_ORDERS);
    }

    private void showBidDialog(CustomOrder order) {
        selectedOrder = order;

        Dialog dialog = new Dialog(this);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(R.layout.dialog_place_bid);
        dialog.setCancelable(true);

        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawableResource(android.R.color.transparent);
            dialog.getWindow().setLayout(
                    (int) (getResources().getDisplayMetrics().widthPixels * 0.9),
                    android.view.WindowManager.LayoutParams.WRAP_CONTENT
            );
        }

        TextView tvOrderId = dialog.findViewById(R.id.tv_bid_order_id);
        EditText etAmount = dialog.findViewById(R.id.et_bid_amount);
        Button btnSubmitBid = dialog.findViewById(R.id.btn_submit_bid);
        Button btnCancel = dialog.findViewById(R.id.btn_cancel_bid);

        tvOrderId.setText("Order #" + order.getOrderId());

        btnCancel.setOnClickListener(v -> dialog.dismiss());

        btnSubmitBid.setOnClickListener(v -> {
            String amountStr = etAmount.getText().toString().trim();
            if (amountStr.isEmpty()) {
                etAmount.setError("Please enter your bid amount");
                return;
            }
            int amount;
            try {
                amount = Integer.parseInt(amountStr);
                if (amount <= 0) {
                    etAmount.setError("Amount must be greater than 0");
                    return;
                }
            } catch (NumberFormatException e) {
                etAmount.setError("Invalid amount");
                return;
            }
            dialog.dismiss();
            placeBid(order, amount);
        });

        dialog.show();
    }

    private void placeBid(CustomOrder order, int amount) {
        showLoading(true);

        JSONObject jsonObject = new JSONObject();
        try {
            String orderId = order.getOrderId();
            jsonObject.put("order_id", orderId != null ? Integer.parseInt(orderId) : 0);
            jsonObject.put("rider_id", riderData != null ? riderData.getId() : 0);
            jsonObject.put("amount", amount);
            Log.d(TAG, "Place bid request: " + jsonObject.toString());
        } catch (JSONException | NumberFormatException e) {
            e.printStackTrace();
            showLoading(false);
            Toast.makeText(this, "Error preparing bid request", Toast.LENGTH_SHORT).show();
            return;
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().placeCustomOrderBid(body);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, CALL_PLACE_BID);
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        showLoading(false);
        Log.d(TAG, "Callback [" + callNo + "]: " + result.toString());

        if (callNo.equals(CALL_GET_ORDERS)) {
            handleOrderListResponse(result);
        } else if (callNo.equals(CALL_PLACE_BID)) {
            handleBidResponse(result);
        }
    }

    private void handleOrderListResponse(JsonObject result) {
        try {
            boolean isSuccess = false;
            if (result.has("Result")) {
                isSuccess = result.get("Result").getAsBoolean();
            }

            if (isSuccess) {
                orderList.clear();
                if (result.has("orders") && !result.get("orders").isJsonNull()) {
                    JsonArray ordersArray = result.getAsJsonArray("orders");
                    Gson gson = new Gson();
                    for (int i = 0; i < ordersArray.size(); i++) {
                        CustomOrder order = gson.fromJson(ordersArray.get(i), CustomOrder.class);
                        orderList.add(order);
                    }
                }

                adapter.notifyDataSetChanged();
                txtOrderCount.setText(orderList.size() + " Orders");

                if (orderList.isEmpty()) {
                    showEmptyState(true);
                } else {
                    showEmptyState(false);
                }
            } else {
                showEmptyState(true);
                String msg = "No orders found";
                if (result.has("msg") && !result.get("msg").isJsonNull()) {
                    msg = result.get("msg").getAsString();
                }
                Log.w(TAG, "API returned false: " + msg);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing order list: " + e.getMessage());
            e.printStackTrace();
            showEmptyState(true);
            Toast.makeText(this, "Error loading orders", Toast.LENGTH_SHORT).show();
        }
    }

    private void handleBidResponse(JsonObject result) {
        try {
            boolean isSuccess = false;
            if (result.has("Result")) {
                isSuccess = result.get("Result").getAsBoolean();
            }

            String msg = isSuccess ? "Bid placed successfully!" : "Failed to place bid";
            if (result.has("msg") && !result.get("msg").isJsonNull()) {
                msg = result.get("msg").getAsString();
            }

            Toast.makeText(this, msg, Toast.LENGTH_LONG).show();

            if (isSuccess) {
                // Refresh the list after a successful bid
                fetchCustomOrders();
            } else {
                showLoading(false);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing bid response: " + e.getMessage());
            Toast.makeText(this, "Error processing response", Toast.LENGTH_SHORT).show();
        }
    }

    private void showLoading(boolean show) {
        progressBar.setVisibility(show ? View.VISIBLE : View.GONE);
        if (show) {
            rvCustomOrders.setVisibility(View.GONE);
            layoutEmpty.setVisibility(View.GONE);
        }
    }

    private void showEmptyState(boolean show) {
        layoutEmpty.setVisibility(show ? View.VISIBLE : View.GONE);
        rvCustomOrders.setVisibility(show ? View.GONE : View.VISIBLE);
    }
}

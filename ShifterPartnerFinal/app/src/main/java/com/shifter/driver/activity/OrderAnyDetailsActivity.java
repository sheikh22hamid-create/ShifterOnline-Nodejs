package com.shifter.driver.activity;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Parcel;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.widget.EditText;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;

import com.google.android.gms.maps.CameraUpdate;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.gms.maps.model.Polyline;
import com.google.android.gms.maps.model.PolylineOptions;
import com.google.android.material.bottomsheet.BottomSheetDialog;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityOrderDetailsBinding;
import com.shifter.driver.fragment.HomeFragment;
import com.shifter.driver.locationservice.FetchURL;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.locationservice.TaskLoadedCallback;
import com.shifter.driver.model.BuyOrderHistoryItem;
import com.shifter.driver.model.PDOrderItem;
import com.shifter.driver.model.RestResponse;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONObject;

import java.text.DecimalFormat;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class OrderAnyDetailsActivity extends AppCompatActivity
        implements OnMapReadyCallback, TaskLoadedCallback, GetResult.MyListener {

    private static final String TAG = "OrderAnyDetails";

    private ActivityOrderDetailsBinding binding;
    private CustPrograssbar custPrograssbar;
    private SessionManager sessionManager;
    private RiderData riderData;

    private BuyOrderHistoryItem buyOrderItem;
    private PDOrderItem orderItem;

    private GoogleMap mMap;
    private Polyline currentPolyline;

    private String dailPhone = "";
    private String status = "";
    public static boolean isUpdate = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        binding = ActivityOrderDetailsBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        custPrograssbar = new CustPrograssbar();
        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();

        readIntent();
        setupClicks();
        setupOrderData();

        SupportMapFragment mapFragment =
                (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
        if (mapFragment != null) mapFragment.getMapAsync(this);
    }

    // -------------------------------------------------- INTENT
    private void readIntent() {
        Object obj = getIntent().getParcelableExtra("myclass");

        if (!(obj instanceof BuyOrderHistoryItem)) {
            Toast.makeText(this, "Invalid order data", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        buyOrderItem = (BuyOrderHistoryItem) obj;
        orderItem = convertToPDOrderItem(buyOrderItem);
    }

    // -------------------------------------------------- CLICKS
    private void setupClicks() {

        binding.imgBack.setOnClickListener(v -> finish());

        binding.imgCall.setOnClickListener(v -> {
            if (!TextUtils.isEmpty(dailPhone)) {
                Intent i = new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + dailPhone));
                startActivity(i);
            }
        });

        binding.imgMsg.setOnClickListener(v -> {
            Intent i = new Intent(this, ChatActivityUser.class);
            i.putExtra("receiverName", orderItem.getDropName());
            i.putExtra("receiverId", orderItem.getOrderUserid());
            startActivity(i);
        });

        binding.txtReject.setOnClickListener(v -> {
            if ("0".equals(orderItem.getOrderFlowId())) {
                orderstatus("reject", "");
            } else {
                openRejectSheet();
            }
        });

        binding.txtConfirm.setOnClickListener(v ->
                orderstatus(status, "")
        );
    }

    // -------------------------------------------------- UI
    private void setupOrderData() {

        binding.txtOrderid.setText(getString(R.string.order_id) + " #" + orderItem.getId());
        binding.txtDatetime.setText(getString(R.string.date) + " " + orderItem.getOrderDate());
        binding.txtUname.setText(orderItem.getPickName());

        binding.txtKm.setText(orderItem.getDistance() + " Km");
        binding.txtEarning.setText(
                sessionManager.getStringData(SessionManager.currency) + orderItem.getTotal()
        );

        try {
            DecimalFormat df = new DecimalFormat("#.##");
            binding.txtMit.setText(
                    df.format(Double.parseDouble(orderItem.getTimeDuration())) + " " + getString(R.string.min_deliver)
            );
        } catch (Exception e) {
            binding.txtMit.setText("0 " + getString(R.string.min_deliver));
        }

        binding.txtTotype.setText(orderItem.getPickType());
        binding.txtFromtype.setText(orderItem.getDropType());
        binding.txtToaddress.setText(orderItem.getCustomerPaddress());
        binding.txtFromaddress.setText(orderItem.getCustomerDaddress());

        setupPhoneVisibility();
    }

    private void setupPhoneVisibility() {
        String flow = orderItem.getOrderFlowId();

        if ("1".equals(flow)) {
            dailPhone = orderItem.getCustomerPmobile();
            binding.imgCall.setVisibility(View.VISIBLE);
        } else if ("3".equals(flow) || "5".equals(flow)) {
            dailPhone = orderItem.getCustomerDmobile();
            binding.imgCall.setVisibility(View.VISIBLE);
        } else {
            binding.imgCall.setVisibility(View.GONE);
        }
    }

    // -------------------------------------------------- ORDER STATUS
    private void orderstatus(String status, String comment) {

        custPrograssbar.prograssCreate(this);

        try {
            JSONObject json = new JSONObject();
            json.put("oid", orderItem.getId());
            json.put("status", status);
            json.put("rid", riderData.getId());
            json.put("comment", comment);

            RequestBody body = RequestBody.create(
                    MediaType.parse("application/json"), json.toString());

            Call<JsonObject> call =
                    APIClient.getInterface().orderStatusChange(body);

            GetResult result = new GetResult();
            result.setMyListener(this);
            result.callForLogin(call, "1");

        } catch (Exception e) {
            custPrograssbar.closePrograssBar();
        }
    }

    @Override
    public void callback(JsonObject result, String callNo) {

        custPrograssbar.closePrograssBar();

        // device_match check — order_status_change.php
        if (result.has("device_match") && !result.get("device_match").getAsBoolean()) {
            Toast.makeText(this, "Logged in from another device", Toast.LENGTH_LONG).show();
            logoutUser();
            return;
        }

        RestResponse res =
                new Gson().fromJson(result.toString(), RestResponse.class);

        Toast.makeText(this, res.getResponseMsg(), Toast.LENGTH_SHORT).show();

       /* if ("true".equalsIgnoreCase(res.getResult())) {
            HomeFragment.isUpdateHome = true;
            finish();
        }*/

        if ("true".equalsIgnoreCase(res.getResult())) {
            HomeFragment.isUpdateHome = true;
            OrderAnyDetailsActivity.isUpdate = true; // 🔥 ADD THIS
            finish();
        }

    }

    private void logoutUser() {
        try {
            stopService(new Intent(this, com.shifter.driver.locationservice.LocationUpdateService.class));
        } catch (Exception e) {
            e.printStackTrace();
        }
        sessionManager.logoutUser();
        Intent intent = new Intent(this, com.shifter.driver.activity.LoginActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    // -------------------------------------------------- MAP
    @Override
    public void onMapReady(@NonNull GoogleMap googleMap) {
        mMap = googleMap;
        UpdateLocationPath();
    }

    public void UpdateLocationPath() {

        LatLng from = new LatLng(orderItem.getPlat(), orderItem.getPlong());
        LatLng to = new LatLng(orderItem.getDlat(), orderItem.getDlong());

        new FetchURL(this).execute(getUrl(from, to, "driving"), "driving");

        mMap.addMarker(new MarkerOptions()
                .position(from)
                .icon(BitmapDescriptorFactory.fromResource(R.drawable.ic_current_location_pin)));

        mMap.addMarker(new MarkerOptions()
                .position(to)
                .icon(BitmapDescriptorFactory.fromResource(R.drawable.ic_destination)));

        CameraUpdate cam = CameraUpdateFactory.newLatLngZoom(from, 11);
        mMap.animateCamera(cam);
    }

    @Override
    public void onTaskDone(Object... values) {
        if (currentPolyline != null) currentPolyline.remove();
        currentPolyline = mMap.addPolyline((PolylineOptions) values[0]);
    }

    // -------------------------------------------------- REJECT SHEET
    private void openRejectSheet() {

        BottomSheetDialog dialog = new BottomSheetDialog(this);
        View v = getLayoutInflater().inflate(R.layout.custome_rejectorder, null);
        dialog.setContentView(v);

        RadioGroup group = v.findViewById(R.id.radiogroup);
        EditText edOther = v.findViewById(R.id.ed_other);
        TextView btn = v.findViewById(R.id.txt_continue);

        String[] reasons = {
                "Earning too low", "Location too far",
                "Store not open", "Cant find location", "Other"
        };

        for (String r : reasons) {
            RadioButton rb = new RadioButton(this);
            rb.setText(r);
            group.addView(rb);
        }

        btn.setOnClickListener(x -> {
            int id = group.getCheckedRadioButtonId();
            if (id == -1) return;

            RadioButton rb = group.findViewById(id);
            if ("Other".equals(rb.getText().toString())) {
                if (TextUtils.isEmpty(edOther.getText())) {
                    edOther.setError("Enter reason");
                    return;
                }
                orderstatus("cancle", edOther.getText().toString());
            } else {
                orderstatus("cancle", rb.getText().toString());
            }
            dialog.dismiss();
        });

        dialog.show();
    }

    // -------------------------------------------------- UTILS
    private String getUrl(LatLng o, LatLng d, String mode) {
        return "https://maps.googleapis.com/maps/api/directions/json?"
                + "origin=" + o.latitude + "," + o.longitude
                + "&destination=" + d.latitude + "," + d.longitude
                + "&mode=" + mode
                + "&key=" + getString(R.string.google_maps_key);
    }

    private PDOrderItem convertToPDOrderItem(BuyOrderHistoryItem b) {

        if (b == null) return null;

        Parcel parcel = Parcel.obtain();

        // ⚠️ ORDER SAME hona chahiye as PDOrderItem.writeToParcel()

        parcel.writeString(b.getPickType());                 // pickType
        parcel.writeString(b.getDistance());                 // distance
        parcel.writeString(b.getOrderFlowId());              // orderFlowId
        parcel.writeString(b.getStorePaddress());            // customerPaddress
        parcel.writeString("");                              // description
        parcel.writeString(b.getCustomerDaddress());         // customerDaddress
        parcel.writeString(b.getCustomerDmobile());          // customerPmobile
        parcel.writeString(b.getDropType());                 // dropType
        parcel.writeString(b.getPickName());                 // pickName
        parcel.writeString(b.getOrderDate());                // orderDate
        parcel.writeDouble(b.getPlong());                    // plong
        parcel.writeString(b.getCustomerDmobile());          // customerDmobile
        parcel.writeString(b.getTotal());                    // total
        parcel.writeDouble(b.getDlong());                    // dlong
        parcel.writeDouble(b.getDlat());                     // dlat
        parcel.writeString(b.getDropName());                 // dropName
        parcel.writeString(b.getTimeDuration());             // timeDuration
        parcel.writeString(b.getId());                       // id
        parcel.writeDouble(b.getPlat());                     // plat
        parcel.writeString(b.getStatus());                   // status
        parcel.writeString(b.getOrderuserid());              // orderUserid

        parcel.setDataPosition(0);

        PDOrderItem item = PDOrderItem.CREATOR.createFromParcel(parcel);
        parcel.recycle();

        return item;
    }
}

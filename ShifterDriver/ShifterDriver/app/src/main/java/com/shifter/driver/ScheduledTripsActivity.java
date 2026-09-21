package com.shifter.driver;

import android.os.Bundle;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.gson.JsonObject;
import com.shifter.driver.adapter.ScheduledTripsAdapter;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.retrofit.NodeApiClient;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

/**
 * Browse upcoming booking_type=2 scheduled trips and mark interest ahead of
 * time — see docs/superpowers/specs/2026-09-21-scheduled-order-priority-dispatch-design.md
 * §8. Interest is non-binding: it only affects whether this driver gets the
 * 15-minute priority popup window when the order goes live
 * (dispatchManager.offerToInterestedRiders on the backend) — it does not
 * reserve or lock the trip.
 *
 * Network calls follow OrderItleListActivity's existing pattern: build the
 * JSON body with org.json.JSONObject, wrap it in an okhttp RequestBody,
 * dispatch through NodeApiClient.getInterface() (Retrofit), and for the
 * shared/reusable "just refresh the screen" call go through GetResult's
 * callForLogin/MyListener tag-based callback. The interest-toggle call needs
 * to remember exactly which trip/direction it was for so a failure can
 * revert just that row, so it uses a plain retrofit2.Callback closure
 * instead (the same style HomeFragment.sendDriverStatusUpdateToBackend and
 * updatePackageStatus already use for the same reason).
 */
public class ScheduledTripsActivity extends AppCompatActivity implements GetResult.MyListener {

    private ScheduledTripsAdapter adapter;
    private SessionManager sessionManager;
    private RiderData riderData;
    private int riderId;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_scheduled_trips);

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        riderId = riderData != null ? riderData.getId() : 0;

        RecyclerView recycler = findViewById(R.id.recycler_scheduled_trips);
        recycler.setLayoutManager(new LinearLayoutManager(this));
        adapter = new ScheduledTripsAdapter(this::onToggleInterest);
        recycler.setAdapter(adapter);

        loadTrips();
    }

    private void loadTrips() {
        JSONObject body = new JSONObject();
        try {
            body.put("uid", riderId);
        } catch (JSONException ignored) {}

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), body.toString());
        Call<JsonObject> call = NodeApiClient.getInterface().getScheduledTrips(bodyRequest);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "1");
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        try {
            if (callNo.equalsIgnoreCase("1")) {
                onScheduledTripsResponse(new JSONObject(result.toString()));
            }
        } catch (Exception e) {
            Toast.makeText(this, "Failed to load scheduled trips.", Toast.LENGTH_SHORT).show();
        }
    }

    private void onScheduledTripsResponse(JSONObject response) {
        List<JSONObject> trips = new ArrayList<>();
        JSONArray tripData = response.optJSONArray("TripData");
        if (tripData != null) {
            for (int i = 0; i < tripData.length(); i++) {
                JSONObject trip = tripData.optJSONObject(i);
                if (trip != null) trips.add(trip);
            }
        }
        adapter.setTrips(trips);
        findViewById(R.id.txt_empty_state).setVisibility(trips.isEmpty() ? android.view.View.VISIBLE : android.view.View.GONE);
    }

    private void onToggleInterest(JSONObject trip, boolean nowInterested) {
        String orderId = trip.optString("id", "");
        if (orderId.isEmpty()) return;

        JSONObject body = new JSONObject();
        try {
            body.put("uid", riderId);
            body.put("order_id", orderId);
        } catch (JSONException ignored) {}

        RequestBody bodyRequest = RequestBody.create(MediaType.parse("application/json"), body.toString());
        Call<JsonObject> call = nowInterested
                ? NodeApiClient.getInterface().markScheduledTripInterest(bodyRequest)
                : NodeApiClient.getInterface().removeScheduledTripInterest(bodyRequest);

        call.enqueue(new retrofit2.Callback<JsonObject>() {
            @Override
            public void onResponse(Call<JsonObject> call, retrofit2.Response<JsonObject> response) {
                boolean ok = response.isSuccessful() && response.body() != null
                        && !(response.body().has("error") && response.body().get("error").getAsBoolean());
                if (!ok) {
                    adapter.revertInterest(trip, !nowInterested);
                    Toast.makeText(ScheduledTripsActivity.this,
                            "Could not update interest. Please try again.", Toast.LENGTH_SHORT).show();
                }
            }

            @Override
            public void onFailure(Call<JsonObject> call, Throwable t) {
                adapter.revertInterest(trip, !nowInterested);
                Toast.makeText(ScheduledTripsActivity.this,
                        "Network error. Interest not updated.", Toast.LENGTH_SHORT).show();
            }
        });
    }
}

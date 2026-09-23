package com.shifter.driver;

import android.os.Bundle;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;

import com.google.gson.JsonObject;
import com.shifter.driver.activity.LocaleAwareActivity;
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
public class ScheduledTripsActivity extends LocaleAwareActivity implements GetResult.MyListener {

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

    /**
     * True only when the backend actually reports success. Reads "Result"
     * first (this app's existing convention for this response shape), then
     * "ResponseCode" == "200", and finally — for a response carrying neither —
     * falls back to "no explicit error key", the old, too-loose check.
     */
    private static boolean isApiSuccess(JsonObject body) {
        if (body == null) return false;
        if (body.has("error") && !body.get("error").isJsonNull()) {
            try {
                if (body.get("error").getAsBoolean()) return false;
            } catch (Exception ignored) {}
        }
        if (body.has("Result") && !body.get("Result").isJsonNull()) {
            return "true".equalsIgnoreCase(body.get("Result").getAsString());
        }
        if (body.has("ResponseCode") && !body.get("ResponseCode").isJsonNull()) {
            return "200".equals(body.get("ResponseCode").getAsString());
        }
        return true;
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
                // HTTP 200 is NOT success on its own: this backend's driver
                // endpoints always answer 200 and carry the real outcome in
                // the body (see driverScheduledTripsController — a rider who
                // fails the eligibility re-check gets
                // {"ResponseCode":"401","Result":"false",...} with no `error`
                // key at all). "Result" is this app's authoritative success
                // flag everywhere else it reads this response shape
                // (LeadReferralActivity, AccountFragment, OrderDetailsActivity),
                // with ResponseCode as the fallback for any response that
                // omits it.
                boolean ok = response.isSuccessful() && isApiSuccess(response.body());
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

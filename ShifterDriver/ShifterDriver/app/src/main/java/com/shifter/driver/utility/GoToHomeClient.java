package com.shifter.driver.utility;

import android.content.Context;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.retrofit.NodeApiClient;
import java.util.HashMap;
import java.util.Map;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public final class GoToHomeClient {
    public interface Listener { void done(JsonObject data, String error); }
    public static void request(Context context, String action, JsonObject payload, Listener listener) {
        SessionManager session = new SessionManager(context);
        if (session.getUserDetails() == null) { listener.done(null, "Please sign in again"); return; }
        Map<String,Object> body = new HashMap<>();
        if (payload != null) for (Map.Entry<String,com.google.gson.JsonElement> item : payload.entrySet()) body.put(item.getKey(),item.getValue());
        body.put("action", action);
        body.put("rider_id", session.getUserDetails().getId());
        body.put("device_id", Utility.getDeviceId(context));
        NodeApiClient.getInterface().goToHome(body).enqueue(new Callback<JsonObject>() {
            @Override public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                JsonObject root = response.body();
                if (root == null && response.errorBody() != null) try { root = new Gson().fromJson(response.errorBody().string(), JsonObject.class); } catch (Exception ignored) {}
                if (response.isSuccessful() && root != null && root.has("success") && root.get("success").getAsBoolean()) listener.done(root.getAsJsonObject("data"), null);
                else listener.done(null, root != null && root.has("message") ? root.get("message").getAsString() : "Go to Home unavailable. Please retry.");
            }
            @Override public void onFailure(Call<JsonObject> call, Throwable error) { listener.done(null, "Connection failed. Check internet and retry."); }
        });
    }
}

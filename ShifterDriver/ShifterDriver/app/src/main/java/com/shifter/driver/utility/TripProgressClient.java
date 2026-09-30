package com.shifter.driver.utility;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.SystemClock;
import com.google.gson.Gson;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.shifter.driver.model.PDOrderItem;
import com.shifter.driver.retrofit.NodeApiClient;
import java.util.HashMap;
import java.util.Map;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/** Background location and screen actions share one server-owned trip snapshot. */
public final class TripProgressClient {
    public static final String ACTION_PROGRESS = "com.shifter.driver.TRIP_PROGRESS";
    private static boolean syncInFlight;
    private static Location previousFix;
    private static String previousFixOrder;
    // Most recent GPS fix, kept so a "pickup" (OTP verify) request can attach
    // where the driver actually was at that moment - reporting only, see
    // backend's otp_verify_lat/lng schema comment. Not reset between orders;
    // a request() call only reads it for the "pickup" action.
    private static Location lastKnownLocation;
    private static final Gson GSON = new Gson();
    public interface Listener { void done(JsonObject data, String error); }
    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("trip_progress_v1", Context.MODE_PRIVATE);
    }
    private static JsonArray queue(Context context, String id) {
        try {
            JsonArray parsed = GSON.fromJson(prefs(context).getString("samples_" + id, "[]"), JsonArray.class);
            return parsed == null ? new JsonArray() : parsed;
        }
        catch (Exception ignored) { return new JsonArray(); }
    }
    public static void recordLocation(Context context, Location location) {
        SessionManager session = new SessionManager(context);
        PDOrderItem active = session.getActiveOrder();
        if (active == null || active.getId() == null) return;
        // Never turn a cached location into a new observation on restart.
        long ageMs = (SystemClock.elapsedRealtimeNanos() - location.getElapsedRealtimeNanos()) / 1000000;
        if (ageMs < 0 || ageMs > 20000) return;
        lastKnownLocation = location;
        JsonObject sample = new JsonObject();
        sample.addProperty("timestamp", System.currentTimeMillis() - ageMs);
        sample.addProperty("lat", location.getLatitude());
        sample.addProperty("lng", location.getLongitude());
        sample.addProperty("accuracy", location.hasAccuracy() ? location.getAccuracy() : -1);
        float speed = location.hasSpeed() ? location.getSpeed() : -1;
        if (!location.hasSpeed() && previousFix != null && active.getId().equals(previousFixOrder)) {
            speed = com.shifter.driver.locationservice.LocationFixPolicy.inferredSpeed(previousFix.distanceTo(location),
                    (location.getElapsedRealtimeNanos() - previousFix.getElapsedRealtimeNanos()) / 1000000,
                    previousFix.hasAccuracy() ? previousFix.getAccuracy() : -1, location.hasAccuracy() ? location.getAccuracy() : -1);
        }
        sample.addProperty("speed", speed);
        previousFix = new Location(location);
        previousFixOrder = active.getId();
        sample.addProperty("mock", location.isFromMockProvider());
        JsonArray samples = queue(context, active.getId());
        samples.add(sample);
        while (samples.size() > 120) samples.remove(0);
        prefs(context).edit().putString("samples_" + active.getId(), samples.toString()).apply();
        request(context, active.getId(), "sync", null, null);
    }
    public static JsonObject cached(Context context, String id) {
        try { return GSON.fromJson(prefs(context).getString("state_" + id, "null"), JsonObject.class); }
        catch (Exception ignored) { return null; }
    }
    public static void request(Context context, String id, String action, String otp, Listener listener) {
        Context app = context.getApplicationContext();
        boolean sync = "sync".equals(action);
        if (sync && syncInFlight) return;
        SessionManager session = new SessionManager(app);
        if (session.getUserDetails() == null) {
            if (listener != null) listener.done(null, "Please sign in again");
            return;
        }
        if (sync) syncInFlight = true;
        JsonArray samples = sync ? queue(app, id) : new JsonArray();
        long sentThrough = samples.size() == 0 ? 0 : samples.get(samples.size() - 1).getAsJsonObject().get("timestamp").getAsLong();
        Map<String, Object> body = new HashMap<>();
        body.put("order_id", id);
        body.put("rider_id", session.getUserDetails().getId());
        body.put("device_id", Utility.getDeviceId(app));
        body.put("action", action);
        body.put("samples", samples);
        if (otp != null) body.put("otp", otp);
        // "verify_otp" (and the legacy combined "pickup") - attach the last
        // known GPS fix so admin can see where the driver actually was at
        // OTP-verify time, and so the backend's OTP-mismatch reprice check
        // (see backend's otp_verify_lat/lng comment) can run. Skipped
        // silently if no recent fix is cached yet.
        if (("verify_otp".equals(action) || "pickup".equals(action)) && lastKnownLocation != null) {
            body.put("lat", lastKnownLocation.getLatitude());
            body.put("lng", lastKnownLocation.getLongitude());
        }
        NodeApiClient.getInterface().tripProgress(body).enqueue(new Callback<JsonObject>() {
            @Override public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                if (sync) syncInFlight = false;
                JsonObject root = response.body();
                if (root == null && response.errorBody() != null) {
                    try { root = GSON.fromJson(response.errorBody().string(), JsonObject.class); } catch (Exception ignored) {}
                }
                if (root != null && root.has("success") && root.get("success").getAsBoolean() && root.has("data")) {
                    prefs(app).edit().remove("error_" + id).putLong("last_success_" + id, System.currentTimeMillis()).apply();
                    JsonObject data = root.getAsJsonObject("data");
                    if (sync) {
                        JsonArray retained = new JsonArray();
                        for (com.google.gson.JsonElement entry : queue(app, id)) {
                            if (entry.getAsJsonObject().get("timestamp").getAsLong() > sentThrough) retained.add(entry);
                        }
                        prefs(app).edit().putString("samples_" + id, retained.toString()).apply();
                    }
                    apply(app, id, data);
                    if (listener != null) listener.done(cached(app, id), null);
                } else {
                    String message = root != null && root.has("message") ? root.get("message").getAsString() : "Trip update failed. Please retry.";
                    String diagnostic = response.code() == 404 ? "Auto-arrival unavailable on server. Update backend."
                            : response.code() == 403 ? "Auto-arrival: sign in on this device again."
                            : "Auto-arrival sync failed (" + response.code() + "). Retrying.";
                    reportSyncError(app, id, diagnostic);
                    if (listener != null) listener.done(null, message);
                }
            }
            @Override public void onFailure(Call<JsonObject> call, Throwable error) {
                if (sync) syncInFlight = false;
                reportSyncError(app, id, "Auto-arrival offline. Saving GPS and retrying.");
                if (listener != null) listener.done(null, "No connection. Your location is saved; retry this action when connected.");
            }
        });
    }
    public static String syncError(Context context, String id) { return prefs(context).getString("error_" + id, ""); }
    private static void reportSyncError(Context context, String id, String message) {
        prefs(context).edit().putString("error_" + id, message).apply();
        android.util.Log.w("TripProgressClient", "Order " + id + ": " + message);
        context.sendBroadcast(new Intent(ACTION_PROGRESS).setPackage(context.getPackageName()).putExtra("order_id", id));
    }
    private static void apply(Context context, String id, JsonObject data) {
        JsonObject old = cached(context, id);
        if (old != null && (old.get("version").getAsLong() > data.get("version").getAsLong()
                || old.get("server_time").getAsLong() > data.get("server_time").getAsLong()
                || (!old.get("active").getAsBoolean() && data.get("active").getAsBoolean()))) return;
        data.addProperty("received_at", System.currentTimeMillis());
        prefs(context).edit().putString("state_" + id, data.toString()).apply();
        SessionManager session = new SessionManager(context);
        session.setOrderStopStep(id, data.get("stop_step").getAsInt());
        PDOrderItem active = session.getActiveOrder();
        if (active != null && id.equals(active.getId())) {
            if (data.get("active").getAsBoolean()) {
                active.setOrderFlowId(data.get("driver_flow_id").getAsString());
                session.setActiveOrder(active);
                boolean changed = old == null
                        ? data.get("driver_flow_id").getAsInt() > 1
                        : old.get("driver_flow_id").getAsInt() != data.get("driver_flow_id").getAsInt()
                            || old.get("stop_step").getAsInt() != data.get("stop_step").getAsInt();
                if (changed) notifyDriver(context, active, data);
            } else {
                session.clearActiveOrder();
                prefs(context).edit().remove("samples_" + id).apply();
            }
        }
        Intent updated = new Intent(ACTION_PROGRESS).setPackage(context.getPackageName());
        updated.putExtra("order_id", id);
        context.sendBroadcast(updated);
    }

    private static void notifyDriver(Context context, PDOrderItem order, JsonObject data) {
        android.app.NotificationManager manager = (android.app.NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String channel = "trip_progress";
        if (android.os.Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new android.app.NotificationChannel(channel, "Active trip updates", android.app.NotificationManager.IMPORTANCE_DEFAULT));
        }
        int flow = data.get("driver_flow_id").getAsInt();
        String text = flow == 2 ? "Pickup reached. Verify OTP after loading to start delivery."
                : flow == 4 ? "Drop reached. Confirm delivery after handover."
                : "Trip updated. Open the app for your next destination.";
        Intent intent = new Intent(context, com.shifter.driver.activity.OrderDetailsActivity.class);
        intent.putExtra("myclass", order);
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        android.app.PendingIntent pending = android.app.PendingIntent.getActivity(context, order.getId().hashCode(), intent,
                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE);
        try {
            manager.notify("trip_" + order.getId(), 2002, new androidx.core.app.NotificationCompat.Builder(context, channel)
                    .setSmallIcon(com.shifter.driver.R.drawable.ic_notification)
                    .setContentTitle("Order #" + order.getId()).setContentText(text)
                    .setStyle(new androidx.core.app.NotificationCompat.BigTextStyle().bigText(text))
                    .setContentIntent(pending).setAutoCancel(true).build());
        } catch (SecurityException ignored) { /* In-app status still works if notifications are disabled. */ }
    }
}

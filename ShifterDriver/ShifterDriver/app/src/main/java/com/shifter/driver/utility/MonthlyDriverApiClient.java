package com.shifter.driver.utility;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.google.gson.Gson;
import com.shifter.driver.model.MonthlyDutyStatus;
import com.shifter.driver.model.QueuedOrder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class MonthlyDriverApiClient {

    private static final String TAG = "MonthlyDriverApiClient";
    private static final String BASE_URL = "https://shifteronline-nodejs-dev.onrender.com";
    private static final MediaType JSON_MEDIA = MediaType.parse("application/json; charset=utf-8");

    private static final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build();

    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static final Gson gson = new Gson();

    public interface DutyStatusCallback {
        void onSuccess(MonthlyDutyStatus status);
        void onError(String message);
    }

    public interface PunchCallback {
        void onSuccess(boolean isInsideZone, String message);
        void onError(String message);
    }

    public interface QueueCallback {
        void onSuccess(List<QueuedOrder> queue);
        void onError(String message);
    }

    public static void getDutyStatus(int riderId, DutyStatusCallback callback) {
        Request request = new Request.Builder()
                .url(BASE_URL + "/api/rider/duty/status/" + riderId)
                .get()
                .build();

        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.isSuccessful() && response.body() != null) {
                    try {
                        String body = response.body().string();
                        JSONObject json = new JSONObject(body);
                        if (json.optBoolean("success", false)) {
                            JSONObject data = json.optJSONObject("data");
                            MonthlyDutyStatus status = gson.fromJson(data.toString(), MonthlyDutyStatus.class);
                            MonthlyDutyManager.getInstance().setCurrentStatus(status);
                            mainHandler.post(() -> callback.onSuccess(status));
                            return;
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error parsing duty status", e);
                    }
                }
                mainHandler.post(() -> callback.onError("Failed to fetch duty status"));
            }
        });
    }

    public static void punchIn(int riderId, double lat, double lng, PunchCallback callback) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("rider_id", riderId);
            payload.put("lat", lat);
            payload.put("lng", lng);

            RequestBody body = RequestBody.create(JSON_MEDIA, payload.toString());
            Request request = new Request.Builder()
                    .url(BASE_URL + "/api/rider/duty/punch-in")
                    .post(body)
                    .build();

            client.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    mainHandler.post(() -> callback.onError(e.getMessage()));
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    if (response.isSuccessful() && response.body() != null) {
                        try {
                            String respStr = response.body().string();
                            JSONObject json = new JSONObject(respStr);
                            boolean success = json.optBoolean("success", false);
                            boolean inside = json.optBoolean("insideZone", true);
                            String msg = json.optString("message", "Punched in");
                            if (success) {
                                mainHandler.post(() -> callback.onSuccess(inside, msg));
                                return;
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing punch in response", e);
                        }
                    }
                    mainHandler.post(() -> callback.onError("Failed to punch in"));
                }
            });
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }

    public static void punchOut(int riderId, PunchCallback callback) {
        try {
            JSONObject payload = new JSONObject();
            payload.put("rider_id", riderId);

            RequestBody body = RequestBody.create(JSON_MEDIA, payload.toString());
            Request request = new Request.Builder()
                    .url(BASE_URL + "/api/rider/duty/punch-out")
                    .post(body)
                    .build();

            client.newCall(request).enqueue(new Callback() {
                @Override
                public void onFailure(Call call, IOException e) {
                    mainHandler.post(() -> callback.onError(e.getMessage()));
                }

                @Override
                public void onResponse(Call call, Response response) throws IOException {
                    if (response.isSuccessful() && response.body() != null) {
                        try {
                            String respStr = response.body().string();
                            JSONObject json = new JSONObject(respStr);
                            boolean success = json.optBoolean("success", false);
                            String msg = json.optString("message", "Punched out");
                            if (success) {
                                mainHandler.post(() -> callback.onSuccess(true, msg));
                                return;
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing punch out response", e);
                        }
                    }
                    mainHandler.post(() -> callback.onError("Failed to punch out"));
                }
            });
        } catch (Exception e) {
            callback.onError(e.getMessage());
        }
    }

    public static void getDriverQueue(int riderId, QueueCallback callback) {
        Request request = new Request.Builder()
                .url(BASE_URL + "/api/rider/queue/" + riderId)
                .get()
                .build();

        client.newCall(request).enqueue(new Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                mainHandler.post(() -> callback.onError(e.getMessage()));
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (response.isSuccessful() && response.body() != null) {
                    try {
                        String body = response.body().string();
                        JSONObject json = new JSONObject(body);
                        if (json.optBoolean("success", false)) {
                            JSONArray data = json.optJSONArray("data");
                            List<QueuedOrder> list = new ArrayList<>();
                            if (data != null) {
                                for (int i = 0; i < data.length(); i++) {
                                    QueuedOrder item = gson.fromJson(data.getJSONObject(i).toString(), QueuedOrder.class);
                                    list.add(item);
                                }
                            }
                            mainHandler.post(() -> callback.onSuccess(list));
                            return;
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Error parsing queue", e);
                    }
                }
                mainHandler.post(() -> callback.onError("Failed to fetch queue"));
            }
        });
    }
}

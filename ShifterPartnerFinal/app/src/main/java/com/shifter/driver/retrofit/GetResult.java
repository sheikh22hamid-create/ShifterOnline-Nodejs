package com.shifter.driver.retrofit;

import android.util.Log;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;

import okhttp3.MultipartBody;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class GetResult {

    private MyListener myListener;

    public interface MyListener {
        void callback(JsonObject result, String callNo);
    }

    public void setMyListener(MyListener myListener) {
        this.myListener = myListener;
    }

    // 🔥 SAME METHOD SIGNATURE (NO BREAKING CHANGE)
    public void callForLogin(Call<?> call, String callNo) {

        // ================= REQUEST LOG =================
        try {
            Request request = ((Call<?>) call).request();
            Log.e("=== API REQUEST ===", "=== START ===");
            Log.e("API_URL", request.url().toString());
            Log.e("API_METHOD", request.method());
            Log.e("API_CALL_NO", callNo);

            if (request.body() instanceof MultipartBody) {
                MultipartBody multipartBody = (MultipartBody) request.body();
                for (MultipartBody.Part part : multipartBody.parts()) {
                    Log.e("FORM_PART", part.headers().toString());
                }
            }
            Log.e("=== API REQUEST ===", "=== END ===");
        } catch (Exception e) {
            Log.e("REQUEST_LOG_ERROR", e.getMessage());
        }

        // ================= API CALL =================
        call.enqueue(new Callback() {

            @Override
            public void onResponse(Call call, Response response) {

                Log.e("=== API RESPONSE ===", "=== START ===");
                Log.e("RESPONSE_CODE", String.valueOf(response.code()));

                try {
                    if (response.isSuccessful() && response.body() != null) {
                        if (response.body() instanceof JsonObject) {
                            Log.e("RAW_RESPONSE_SUCCESS", response.body().toString());
                            myListener.callback((JsonObject) response.body(), callNo);
                            return;
                        }
                    }

                    String raw = "";
                    if (response.errorBody() != null) {
                        raw = response.errorBody().string();
                    } else if (response.body() != null) {
                        raw = response.body().toString();
                    }

                    Log.e("RAW_RESPONSE_ALL_CASES", raw.isEmpty() ? "EMPTY_RESPONSE" : raw);

                    JsonObject parsed = safeParse(raw);
                    myListener.callback(parsed, callNo);

                } catch (Exception e) {
                    Log.e("RESPONSE_PARSE_ERROR", e.getMessage());
                    JsonObject error = new JsonObject();
                    error.addProperty("error", true);
                    error.addProperty("message", e.getMessage());
                    myListener.callback(error, callNo);
                }

                Log.e("=== API RESPONSE ===", "=== END ===");
            }


            @Override
            public void onFailure(Call call, Throwable t) {
                Log.e("API_FAILURE", t.getMessage());
                JsonObject error = new JsonObject();
                error.addProperty("error", true);
                error.addProperty("message", t.getMessage());
                myListener.callback(error, callNo);
            }
        });

    }

    // ================= SAFE JSON PARSER =================
    private JsonObject safeParse(String raw) {
        try {
            return JsonParser.parseString(raw).getAsJsonObject();
        } catch (Exception e) {
            JsonObject obj = new JsonObject();
            obj.addProperty("error", true);
            obj.addProperty("raw", raw);
            obj.addProperty("message", "Invalid JSON from server");
            return obj;
        }
    }
}

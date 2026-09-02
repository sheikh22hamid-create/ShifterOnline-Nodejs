package com.shifter.driver.utility;

import android.content.Context;
import android.util.Log;
import android.widget.Toast;

import com.google.gson.JsonObject;
import com.shifter.driver.retrofit.APIClient;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Helper class for updating order status
 * Status codes:
 * 0  → Order Created (New order)
 * 1  → Rider Accepted
 * 2  → Rider Reached Pickup
 * 3  → Pickup Completed
 * 4  → Reached Drop
 * 5  → Delivered
 * 9  → Cancelled
 * 10 → Rejected
 */
public class OrderStatusHelper {
    
    private static final String TAG = "OrderStatusHelper";
    
    /**
     * Update order status
     * @param context Context
     * @param orderId Order ID
     * @param status Status code (2, 3, 4, or 5)
     * @param listener Callback for status update result
     */
    public static void updateOrderStatus(Context context, String orderId, int status, 
                                         StatusUpdateListener listener) {
        // Validate status code
        if (status != 2 && status != 3 && status != 4 && status != 5) {
            Log.e(TAG, "Invalid status code: " + status + ". Allowed: 2, 3, 4, 5");
            if (listener != null) {
                listener.onStatusUpdateFailed(orderId, status, "Invalid status code");
            }
            return;
        }
        
        try {
            JsonObject jsonObject = new JsonObject();
            jsonObject.addProperty("order_id", orderId);
            jsonObject.addProperty("status", status);
            
            RequestBody bodyRequest = RequestBody.create(
                MediaType.parse("application/json; charset=utf-8"),
                jsonObject.toString()
            );
            
            Call<JsonObject> call = APIClient.getInterface().updateOrderStatus(bodyRequest);
            call.enqueue(new Callback<JsonObject>() {
                @Override
                public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                    if (response.isSuccessful() && response.body() != null) {
                        try {
                            JsonObject jsonResponse = response.body();
                            String responseStatus = jsonResponse.has("status") ? 
                                jsonResponse.get("status").getAsString() : "";
                            String message = jsonResponse.has("message") ? 
                                jsonResponse.get("message").getAsString() : "";
                            
                            if ("1".equals(responseStatus) || "success".equalsIgnoreCase(responseStatus)) {
                                Log.d(TAG, "Order status updated successfully: " + status);
                                if (listener != null) {
                                    listener.onStatusUpdated(orderId, status);
                                }
                                if (context != null) {
                                    Toast.makeText(context, "Status updated successfully", 
                                        Toast.LENGTH_SHORT).show();
                                }
                            } else {
                                Log.e(TAG, "Order status update failed: " + message);
                                if (listener != null) {
                                    listener.onStatusUpdateFailed(orderId, status, message);
                                }
                                if (context != null) {
                                    Toast.makeText(context, "Failed to update status: " + message, 
                                        Toast.LENGTH_SHORT).show();
                                }
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing status update response", e);
                            if (listener != null) {
                                listener.onStatusUpdateFailed(orderId, status, e.getMessage());
                            }
                        }
                    } else {
                        Log.e(TAG, "Status update API failed: " + response.code());
                        if (listener != null) {
                            listener.onStatusUpdateFailed(orderId, status, "API call failed");
                        }
                        if (context != null) {
                            Toast.makeText(context, "Failed to update status", 
                                Toast.LENGTH_SHORT).show();
                        }
                    }
                }
                
                @Override
                public void onFailure(Call<JsonObject> call, Throwable t) {
                    Log.e(TAG, "Status update API error", t);
                    if (listener != null) {
                        listener.onStatusUpdateFailed(orderId, status, t.getMessage());
                    }
                    if (context != null) {
                        Toast.makeText(context, "Network error. Please try again.", 
                            Toast.LENGTH_SHORT).show();
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error creating status update request", e);
            if (listener != null) {
                listener.onStatusUpdateFailed(orderId, status, e.getMessage());
            }
            if (context != null) {
                Toast.makeText(context, "Error processing request", Toast.LENGTH_SHORT).show();
            }
        }
    }
    
    /**
     * Interface for status update callbacks
     */
    public interface StatusUpdateListener {
        void onStatusUpdated(String orderId, int status);
        void onStatusUpdateFailed(String orderId, int status, String error);
    }
}


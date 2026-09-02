package com.shifter.driver.utility;

import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
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
 * Helper class to show Accept/Reject Order dialog
 * Handles API calls for accepting/rejecting orders
 */
public class OrderDialogHelper {

    private static final String TAG = "OrderDialogHelper";

    private static AlertDialog activeDialog;
    private static String activeDialogOrderId;

    /** Called by BaseActivity when an order:dismiss socket event matches the currently-shown popup. */
    public static void dismissIfShowing(String orderId) {
        if (activeDialog != null && activeDialog.isShowing()
                && orderId != null && orderId.equals(activeDialogOrderId)) {
            activeDialog.dismiss();
        }
    }

    /**
     * Show Accept/Reject dialog for an order
     * 
     * @param context  Activity context
     * @param orderId  Order ID to accept/reject
     * @param riderId  Rider ID (from session)
     * @param listener Callback for dialog actions
     */
    /**
     * Show Accept/Reject dialog for an order with custom UI
     * 
     * @param context   Activity context
     * @param orderId   Order ID to accept/reject
     * @param riderId   Rider ID (from session)
     * @param orderData Map/Bundle containing order details
     * @param listener  Callback for dialog actions
     */
    public static void showOrderDialog(Context context, String orderId, String riderId,
            java.util.Map<String, String> orderData,
            OrderActionListener listener) {
        if (context == null || orderId == null || riderId == null) {
            Log.e(TAG, "Invalid parameters for showOrderDialog");
            return;
        }

        AlertDialog.Builder builder = new AlertDialog.Builder(context);
        android.view.View view = android.view.LayoutInflater.from(context)
                .inflate(com.shifter.driver.R.layout.dialog_new_order, null);
        builder.setView(view);
        builder.setCancelable(false);

        AlertDialog dialog = builder.create();
        activeDialog = dialog;
        activeDialogOrderId = orderId;
        if (dialog.getWindow() != null) {
            dialog.getWindow().setBackgroundDrawable(
                    new android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT));
        }

        // Find Views
        android.widget.TextView txtPrice = view.findViewById(com.shifter.driver.R.id.txt_estimated_price);
        android.widget.TextView txtPickupTitle = view.findViewById(com.shifter.driver.R.id.txt_pickup_name_title);
        android.widget.TextView txtDropTitle = view.findViewById(com.shifter.driver.R.id.txt_drop_name_title);
        android.widget.TextView txtPickup = view.findViewById(com.shifter.driver.R.id.txt_pickup_address);
        android.widget.TextView txtDrop = view.findViewById(com.shifter.driver.R.id.txt_drop_address);
        android.widget.TextView txtName = view.findViewById(com.shifter.driver.R.id.txt_customer_name);
        android.widget.TextView txtDist = view.findViewById(com.shifter.driver.R.id.txt_distance);
        android.widget.TextView txtDetails = view.findViewById(com.shifter.driver.R.id.txt_order_details);
        android.widget.Button btnAccept = view.findViewById(com.shifter.driver.R.id.btn_accept);
        android.widget.Button btnReject = view.findViewById(com.shifter.driver.R.id.btn_reject);

        // Populate Data
        if (orderData != null) {
            txtPrice.setText(getMapValue(orderData, "estimated_earning", "₹0"));
            txtPickup.setText(getMapValue(orderData, "pickup_address", "Unknown Pickup Location"));
            txtDrop.setText(getMapValue(orderData, "delivery_address", "Unknown Drop Location"));
            txtName.setText(getMapValue(orderData, "customer_name", "Customer"));
            txtDist.setText(getMapValue(orderData, "distance", "0 km"));
            txtDetails.setText(getMapValue(orderData, "order_details", "No additional details"));

            if (txtPickupTitle != null) {
                txtPickupTitle.setText(getMapValue(orderData, "pickup_name", "PICKUP"));
            }
            if (txtDropTitle != null) {
                txtDropTitle.setText(getMapValue(orderData, "drop_name", "DROP OFF"));
            }
        } else {
            txtPickup.setText("New Order Request");
            txtDrop.setText("Check details in app");
        }

        // Auto-reject timer (Dynamic from popup_duration in notification, fallback to home_data.php, default 10s)
        int timerSeconds = 10;
        try {
            String popupDurationStr = getMapValue(orderData, "popup_duration", null);
            if (popupDurationStr != null && !popupDurationStr.isEmpty()) {
                timerSeconds = Integer.parseInt(popupDurationStr);
            } else {
                com.shifter.driver.utility.SessionManager sessionManager = new com.shifter.driver.utility.SessionManager(context);
                String timerStr = sessionManager.getStringData(com.shifter.driver.utility.SessionManager.rejectTimer);
                if (timerStr != null && !timerStr.isEmpty()) {
                    timerSeconds = Integer.parseInt(timerStr);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing reject timer", e);
        }
        
        long timerMillis = timerSeconds * 1000L;

        android.os.CountDownTimer countDownTimer = new android.os.CountDownTimer(timerMillis, 1000) {
            @Override
            public void onTick(long millisUntilFinished) {
                btnReject.setText("Reject (" + (millisUntilFinished / 1000) + "s)");
            }

            @Override
            public void onFinish() {
                if (dialog.isShowing()) {
                    dialog.dismiss();
                    rejectOrder(context, orderId, riderId, listener);
                    Toast.makeText(context, "Order automatically rejected (timeout)", Toast.LENGTH_SHORT).show();
                }
            }
        };

        dialog.setOnShowListener(d -> countDownTimer.start());
        dialog.setOnDismissListener(d -> countDownTimer.cancel());

        // Set Listeners
        btnAccept.setOnClickListener(v -> {
            dialog.dismiss(); // Will cancel the timer via onDismissListener
            acceptOrder(context, orderId, riderId, orderData, listener);
        });

        btnReject.setOnClickListener(v -> {
            dialog.dismiss(); // Will cancel the timer via onDismissListener
            rejectOrder(context, orderId, riderId, listener);
        });

        dialog.show();

        // ── Play system ringtone (volume controlled by showVolumeControlDialog) ──
        final Ringtone[] ringtone = { null };
        try {
            AudioManager audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null &&
                    audioManager.getStreamVolume(AudioManager.STREAM_RING) > 0) {
                Uri ringtoneUri = Uri.parse("android.resource://" + context.getPackageName() + "/" + com.shifter.driver.R.raw.movigo_ringtone);
                ringtone[0] = RingtoneManager.getRingtone(context, ringtoneUri);
                if (ringtone[0] != null) {
                    ringtone[0].setStreamType(AudioManager.STREAM_RING);
                    ringtone[0].play();
                    Log.d(TAG, "Order ringtone started");
                }
            } else {
                Log.d(TAG, "STREAM_RING volume is 0 — skipping sound");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing ringtone", e);
        }

        // Stop ringtone when dialog is dismissed for any reason
        dialog.setOnDismissListener(d -> {
            if (ringtone[0] != null && ringtone[0].isPlaying()) {
                ringtone[0].stop();
                Log.d(TAG, "Order ringtone stopped on dialog dismiss");
            }
        });
    }

    /**
     * Call API to accept order
     */
    private static void acceptOrder(Context context, String orderId, String riderId,
            java.util.Map<String, String> orderData, OrderActionListener listener) {
        try {
            JsonObject jsonObject = new JsonObject();
            jsonObject.addProperty("order_id", orderId);
            jsonObject.addProperty("rider_id", riderId);
            jsonObject.addProperty("lat", String.valueOf(com.shifter.driver.locationservice.LocationUpdateService.getLocation().getLatitude()));
            jsonObject.addProperty("lng", String.valueOf(com.shifter.driver.locationservice.LocationUpdateService.getLocation().getLongitude()));

            RequestBody bodyRequest = RequestBody.create(
                    MediaType.parse("application/json; charset=utf-8"),
                    jsonObject.toString());

            Call<JsonObject> call = APIClient.getInterface().acceptOrder(bodyRequest);
            call.enqueue(new Callback<JsonObject>() {
                @Override
                public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                    if (response.isSuccessful() && response.body() != null) {
                        try {
                            JsonObject jsonResponse = response.body();
                            boolean isSuccess = false;
                            String message = "Unknown error";

                            if (jsonResponse.has("Result")) {
                                isSuccess = jsonResponse.get("Result").getAsBoolean();
                                message = jsonResponse.has("msg") ? jsonResponse.get("msg").getAsString() : "";
                            } else {
                                String status = jsonResponse.has("status") ? jsonResponse.get("status").getAsString()
                                        : "";
                                isSuccess = "1".equals(status) || "success".equalsIgnoreCase(status);
                                message = jsonResponse.has("message") ? jsonResponse.get("message").getAsString() : "";
                            }

                            if (isSuccess) {
                                Log.d(TAG, "Order accepted successfully");
                                if (listener != null) {
                                    listener.onOrderAccepted(orderId);
                                }
                                Toast.makeText(context, message.isEmpty() ? "Order accepted successfully" : message,
                                        Toast.LENGTH_SHORT).show();
                                
                                // Launch OrderDetailsActivity immediately
                                startOrderDetailsActivity(context, orderId, orderData);
                            } else {
                                Log.e(TAG, "Order accept failed: " + message);
                                new AlertDialog.Builder(context)
                                        .setTitle("Alert")
                                        .setMessage(message.isEmpty() ? "Failed to accept order" : message)
                                        .setPositiveButton("OK", null)
                                        .show();
                                if (listener != null) {
                                    listener.onOrderActionFailed(orderId, "accept", message);
                                }
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing accept order response", e);
                            Toast.makeText(context, "Error processing response",
                                    Toast.LENGTH_SHORT).show();
                        }
                    } else {
                        Log.e(TAG, "Accept order API failed: " + response.code());
                        Toast.makeText(context, "Failed to accept order",
                                Toast.LENGTH_SHORT).show();
                        if (listener != null) {
                            listener.onOrderActionFailed(orderId, "accept", "API call failed");
                        }
                    }
                }

                @Override
                public void onFailure(Call<JsonObject> call, Throwable t) {
                    Log.e(TAG, "Accept order API error", t);
                    Toast.makeText(context, "Network error. Please try again.",
                            Toast.LENGTH_SHORT).show();
                    if (listener != null) {
                        listener.onOrderActionFailed(orderId, "accept", t.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error creating accept order request", e);
            Toast.makeText(context, "Error processing request", Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * Call API to reject order
     */
    private static void rejectOrder(Context context, String orderId, String riderId,
            OrderActionListener listener) {
        try {
            JsonObject jsonObject = new JsonObject();
            jsonObject.addProperty("order_id", orderId);
            jsonObject.addProperty("rider_id", riderId);

            RequestBody bodyRequest = RequestBody.create(
                    MediaType.parse("application/json; charset=utf-8"),
                    jsonObject.toString());

            Call<JsonObject> call = APIClient.getInterface().rejectOrder(bodyRequest);
            call.enqueue(new Callback<JsonObject>() {
                @Override
                public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                    if (response.isSuccessful() && response.body() != null) {
                        try {
                            JsonObject jsonResponse = response.body();
                            boolean isSuccess = false;
                            String message = "Unknown error";

                            if (jsonResponse.has("Result")) {
                                isSuccess = jsonResponse.get("Result").getAsBoolean();
                                message = jsonResponse.has("msg") ? jsonResponse.get("msg").getAsString() : "";
                            } else {
                                String status = jsonResponse.has("status") ? jsonResponse.get("status").getAsString()
                                        : "";
                                isSuccess = "1".equals(status) || "success".equalsIgnoreCase(status);
                                message = jsonResponse.has("message") ? jsonResponse.get("message").getAsString() : "";
                            }

                            if (isSuccess) {
                                Log.d(TAG, "Order rejected successfully");
                                if (listener != null) {
                                    listener.onOrderRejected(orderId);
                                }
                                Toast.makeText(context, message.isEmpty() ? "Order rejected" : message,
                                        Toast.LENGTH_SHORT).show();
                            } else {
                                Log.e(TAG, "Order reject failed: " + message);
                                Toast.makeText(context, message.isEmpty() ? "Failed to reject order" : message,
                                        Toast.LENGTH_SHORT).show();
                                if (listener != null) {
                                    listener.onOrderActionFailed(orderId, "reject", message);
                                }
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "Error parsing reject order response", e);
                            Toast.makeText(context, "Error processing response",
                                    Toast.LENGTH_SHORT).show();
                        }
                    } else {
                        Log.e(TAG, "Reject order API failed: " + response.code());
                        Toast.makeText(context, "Failed to reject order",
                                Toast.LENGTH_SHORT).show();
                        if (listener != null) {
                            listener.onOrderActionFailed(orderId, "reject", "API call failed");
                        }
                    }
                }

                @Override
                public void onFailure(Call<JsonObject> call, Throwable t) {
                    Log.e(TAG, "Reject order API error", t);
                    Toast.makeText(context, "Network error. Please try again.",
                            Toast.LENGTH_SHORT).show();
                    if (listener != null) {
                        listener.onOrderActionFailed(orderId, "reject", t.getMessage());
                    }
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error creating reject order request", e);
            Toast.makeText(context, "Error processing request", Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * Interface for order action callbacks
     */
    public interface OrderActionListener {
        void onOrderAccepted(String orderId);

        void onOrderRejected(String orderId);

        void onOrderActionFailed(String orderId, String action, String error);
    }
    
    public static void startOrderDetailsActivity(Context context, String orderId, java.util.Map<String, String> data) {
        if (data == null) data = new java.util.HashMap<>();
        
        double plat = 0.0, plong = 0.0, dlat = 0.0, dlong = 0.0;
        try { plat  = Double.parseDouble(getMapValue(data, "plat",  "0")); } catch (Exception ignored) {}
        try { plong = Double.parseDouble(getMapValue(data, "plong", "0")); } catch (Exception ignored) {}
        try { dlat  = Double.parseDouble(getMapValue(data, "dlat",  "0")); } catch (Exception ignored) {}
        try { dlong = Double.parseDouble(getMapValue(data, "dlong", "0")); } catch (Exception ignored) {}
        
        com.shifter.driver.model.PDOrderItem orderItem = new com.shifter.driver.model.PDOrderItem(
                orderId,
                getMapValue(data, "order_flow_id", "1"),          
                getMapValue(data, "customer_name",  "Customer"),  
                getMapValue(data, "drop_name",      ""),
                getMapValue(data, "pickup_address", ""),          
                getMapValue(data, "delivery_address", ""),        
                getMapValue(data, "customer_pmobile", ""),
                getMapValue(data, "customer_dmobile", ""),
                getMapValue(data, "pick_type",  ""),
                getMapValue(data, "drop_type",  ""),
                plat, plong, dlat, dlong,
                getMapValue(data, "estimated_earning", "0"),      
                getMapValue(data, "distance",          "0"),
                getMapValue(data, "time_duration",     "0"),
                getMapValue(data, "order_date",        ""),
                getMapValue(data, "order_details",     ""),
                getMapValue(data, "status",            ""),
                getMapValue(data, "order_user_id",     ""),
                "0.00", "0.00", "0.00", "0.00", "0.00", "0", "0.00",
                getMapValue(data, "payment_status", "1")
        );
        // Save active order locally so app always remembers and re-opens it
        try {
            new com.shifter.driver.utility.SessionManager(context).setActiveOrder(orderItem);
        } catch (Exception e) {
            e.printStackTrace();
        }

        android.content.Intent homeIntent = new android.content.Intent(context, com.shifter.driver.activity.HomeActivity.class);
        homeIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_SINGLE_TOP | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);
        
        android.content.Intent intent = new android.content.Intent(context, com.shifter.driver.activity.OrderDetailsActivity.class);
        intent.putExtra("myclass", orderItem);
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK | android.content.Intent.FLAG_ACTIVITY_CLEAR_TOP);

        try {
            int flags = android.app.PendingIntent.FLAG_UPDATE_CURRENT;
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.M) {
                flags |= android.app.PendingIntent.FLAG_IMMUTABLE;
            }
            
            android.app.PendingIntent piHome = android.app.PendingIntent.getActivity(context, 101, homeIntent, flags);
            piHome.send();
            
            android.app.PendingIntent piDetails = android.app.PendingIntent.getActivity(context, 102, intent, flags);
            piDetails.send();
            
        } catch (Exception e) {
            e.printStackTrace();
            try {
                context.startActivity(homeIntent);
                context.startActivity(intent);
            } catch (Exception ex) {
                ex.printStackTrace();
            }
        }
    }

    private static String getMapValue(java.util.Map<String, String> map, String key, String defaultValue) {
        if (map != null && map.containsKey(key)) {
            String value = map.get(key);
            return value != null ? value : defaultValue;
        }
        return defaultValue;
    }
}

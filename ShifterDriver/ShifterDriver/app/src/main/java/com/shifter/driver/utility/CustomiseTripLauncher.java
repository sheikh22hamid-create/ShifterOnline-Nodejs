package com.shifter.driver.utility;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import android.widget.Toast;

import androidx.core.app.NotificationCompat;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.MyApplication;
import com.shifter.driver.R;
import com.shifter.driver.activity.OrderDetailsActivity;
import com.shifter.driver.model.PDOrder;
import com.shifter.driver.model.PDOrderItem;
import com.shifter.driver.retrofit.NodeApiClient;

import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

/**
 * Opens the normal Trip Details screen (route, customer details, trip actions) as soon as a Customise Order
 * turns into this driver's ride. That happens in two ways and both end up here:
 *  - the driver accepts the customer's price (the accept response / the {@code customise:converted} socket event), or
 *  - the customer picks this driver's counter-offer (only the {@code customise:converted} socket event reaches
 *    the driver, who may be anywhere in the app).
 *
 * The ride is fetched the same way {@code BaseActivity} fetches a pushed order, so the screen gets the same data
 * as the "Continue Delivery" card. App in the foreground: the screen opens directly. App in the background: a tap
 * notification is shown instead (Android blocks starting an activity from the background).
 * If the ride cannot be fetched, nothing is forced: the driver still has the Continue Delivery card as before.
 */
public final class CustomiseTripLauncher {
    private static final String TAG = "CustomiseTripLauncher";
    private static final String CHANNEL_ID = "customise_trip";
    private static final long DEDUPE_MS = 60_000L;

    private static String lastRideId = "";
    private static long lastAt = 0L;

    private CustomiseTripLauncher() {}

    /** Both the accept response and the socket event call this for the same ride; only the first one acts. */
    private static synchronized boolean claim(String rideId) {
        long now = System.currentTimeMillis();
        if (rideId.equals(lastRideId) && now - lastAt < DEDUPE_MS) return false;
        lastRideId = rideId;
        lastAt = now;
        return true;
    }

    private static synchronized void release(String rideId) {
        // Fetch failed: let a later event (or the other trigger) try again.
        if (rideId.equals(lastRideId)) lastAt = 0L;
    }

    public static void open(Context context, String pkgOrderId) {
        if (context == null || pkgOrderId == null) return;
        final String rideId = pkgOrderId.trim();
        if (rideId.isEmpty() || "null".equals(rideId) || "0".equals(rideId)) return;
        final Context app = context.getApplicationContext() != null ? context.getApplicationContext() : context;
        if (!claim(rideId)) return;

        final SessionManager session = new SessionManager(app);
        if (session.getUserDetails() == null) {
            release(rideId);
            return;
        }
        try {
            JSONObject body = new JSONObject();
            body.put("type", "recent");
            body.put("rid", String.valueOf(session.getUserDetails().getId()));
            NodeApiClient.getInterface()
                    .pkgHistory(RequestBody.create(MediaType.parse("application/json"), body.toString()))
                    .enqueue(new Callback<JsonObject>() {
                        @Override
                        public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                            PDOrderItem ride = null;
                            try {
                                PDOrder history = new Gson().fromJson(response.body(), PDOrder.class);
                                if (history != null && history.getOrderHistory() != null) {
                                    for (PDOrderItem item : history.getOrderHistory()) {
                                        if (rideId.equals(item.getId())) {
                                            ride = item;
                                            break;
                                        }
                                    }
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "Could not read ride " + rideId, e);
                            }
                            if (ride == null) {
                                release(rideId);
                                return;
                            }
                            launch(app, session, ride);
                        }

                        @Override
                        public void onFailure(Call<JsonObject> call, Throwable t) {
                            Log.e(TAG, "Ride fetch failed for " + rideId, t);
                            release(rideId);
                        }
                    });
        } catch (Exception e) {
            Log.e(TAG, "open failed for " + rideId, e);
            release(rideId);
        }
    }

    private static void launch(Context app, SessionManager session, PDOrderItem ride) {
        // Same rule BaseActivity applies to a pushed order: details are shown once the advance is settled
        // (cash, already paid, monthly driver, or a scheduled / next-day booking).
        boolean isMonthly = session.isMonthlyDriver();
        boolean isNextDayOrScheduled = "2".equals(ride.getBookingType()) || "3".equals(ride.getBookingType());
        boolean isCashPayment = "1".equals(ride.getPMethodId()) || "0".equals(ride.getAdvancePayment());
        boolean paid = "1".equals(ride.getPaymentStatus());
        if (!(isMonthly || isNextDayOrScheduled || isCashPayment || paid)) {
            Toast.makeText(app, "Order accepted. Trip details will open once the customer's advance payment is received.", Toast.LENGTH_LONG).show();
            return;
        }

        try {
            session.setActiveOrder(ride);
        } catch (Exception e) {
            Log.e(TAG, "setActiveOrder failed", e);
        }

        Intent intent = new Intent(app, OrderDetailsActivity.class);
        intent.putExtra("myclass", ride);
        intent.putExtra("just_accepted", true);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        if (MyApplication.isAppInForeground()) {
            app.startActivity(intent);
        } else {
            notifyTap(app, ride, intent);
        }
    }

    private static void notifyTap(Context app, PDOrderItem ride, Intent intent) {
        NotificationManager manager = (NotificationManager) app.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Customise order trips", NotificationManager.IMPORTANCE_HIGH));
        }
        PendingIntent pending = PendingIntent.getActivity(app, ride.getId().hashCode(), intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = "Your Customise Order is confirmed. Tap to open the trip.";
        try {
            manager.notify("customise_trip_" + ride.getId(), 2003, new NotificationCompat.Builder(app, CHANNEL_ID)
                    .setSmallIcon(R.drawable.ic_notification)
                    .setContentTitle("Order #" + ride.getId())
                    .setContentText(text)
                    .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                    .setPriority(NotificationCompat.PRIORITY_HIGH)
                    .setContentIntent(pending)
                    .setAutoCancel(true)
                    .build());
        } catch (SecurityException ignored) {
            // Notifications are switched off: the Continue Delivery card on Home still works.
        }
    }
}

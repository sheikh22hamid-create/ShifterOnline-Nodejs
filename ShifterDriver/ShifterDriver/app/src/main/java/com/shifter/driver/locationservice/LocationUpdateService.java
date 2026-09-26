package com.shifter.driver.locationservice;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.Nullable;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.firebase.firestore.FirebaseFirestore;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.activity.HomeActivity;
import com.shifter.driver.utility.SessionManager;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class LocationUpdateService extends Service {

    private static final String TAG = "LocationUpdateService";
    private static final String CHANNEL_ID = "location_updates";
    private static final int NOTIFICATION_ID = 1001;
    private static final long UPDATE_INTERVAL = 10000; // 10 seconds
    private static final long FASTEST_INTERVAL = 5000; // 5 seconds
    public static final String ACTION_LOCATION_UPDATED = "com.shifter.driver.LOCATION_UPDATED";
    public static final String ACTION_REFRESH_LOCATION = "com.shifter.driver.REFRESH_TRIP_LOCATION";

    // holds last known location
    private static Location lastLocation;
    private static volatile boolean sIsRunning = false;

    public static boolean isRunning(android.content.Context context) {
        if (sIsRunning) return true;
        if (context == null) return false;
        try {
            android.app.ActivityManager manager = (android.app.ActivityManager) context.getSystemService(android.content.Context.ACTIVITY_SERVICE);
            if (manager != null) {
                for (android.app.ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
                    if (LocationUpdateService.class.getName().equals(service.service.getClassName())) {
                        sIsRunning = true;
                        return true;
                    }
                }
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return false;
    }
    
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private Handler locationUpdateHandler;
    private SessionManager sessionManager;
    private FirebaseFirestore db;
    private String riderId;
    private ExecutorService apiExecutor; // For parallel API calls
    private android.location.LocationManager satelliteManager;
    private android.location.LocationListener satelliteListener;
    private Location latestSatelliteFix;

    public static synchronized boolean setLocation(Location location) {
        if (location == null || !LocationFixPolicy.accept(lastLocation == null ? 0 : lastLocation.getElapsedRealtimeNanos() / 1000000,
                location.getElapsedRealtimeNanos() / 1000000, android.os.SystemClock.elapsedRealtime(),
                location.getLatitude(), location.getLongitude(), location.hasAccuracy() ? location.getAccuracy() : -1)) return false;
        lastLocation = new Location(location);
        return true;
    }

    public static synchronized Location getLocation() {
        if (lastLocation != null && LocationFixPolicy.isFresh(lastLocation.getElapsedRealtimeNanos() / 1000000,
                android.os.SystemClock.elapsedRealtime())) return new Location(lastLocation);
        Location fallback = new Location("default");
        fallback.setLatitude(0.0);
        fallback.setLongitude(0.0);
        return fallback;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        sIsRunning = true;
        Log.d(TAG, "Service onCreate");
        ensureChannel();
        
        sessionManager = new SessionManager(this);
        db = FirebaseFirestore.getInstance();
        
        // Get rider ID from session
        try {
            if (sessionManager.getUserDetails() != null) {
                riderId = String.valueOf(sessionManager.getUserDetails().getId());
            }
        } catch (Exception e) {
            Log.e(TAG, "Error getting rider ID: " + e.getMessage());
        }
        
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        locationUpdateHandler = new Handler(Looper.getMainLooper());
        apiExecutor = Executors.newSingleThreadExecutor(); // For API calls
        
        createLocationCallback();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "Service onStartCommand");
        // Start as foreground immediately
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
        startLocationUpdates();
        requestCurrentFix();
        
        return START_STICKY;
    }

    private void createLocationCallback() {
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) {
                    return;
                }
                
                Location location = locationResult.getLastLocation();
                if (location != null) {
                    Log.d(TAG, "Location updated: " + location.getLatitude() + ", " + location.getLongitude());
                    handleLocationUpdate(location);
                }
            }
        };
    }

    private void startLocationUpdates() {
        LocationRequest locationRequest = LocationRequest.create();
        boolean activeTrip = sessionManager.getActiveOrder() != null;
        locationRequest.setInterval(activeTrip ? 5000 : UPDATE_INTERVAL);
        locationRequest.setFastestInterval(activeTrip ? 3000 : FASTEST_INTERVAL);
        locationRequest.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
        locationRequest.setWaitForAccurateLocation(true);
        locationRequest.setMaxWaitTime(0);
        
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED 
            && ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) 
                != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "Location permissions not granted");
            return;
        }
        
        fusedLocationClient.requestLocationUpdates(locationRequest, locationCallback, Looper.getMainLooper())
                .addOnSuccessListener(aVoid -> Log.d(TAG, "Location updates started"))
                .addOnFailureListener(e -> Log.e(TAG, "Failed to start location updates: " + e.getMessage()));
        if (activeTrip) startSatelliteUpdates();
    }

    private void startSatelliteUpdates() {
        if (satelliteListener != null || ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                != PackageManager.PERMISSION_GRANTED) return;
        satelliteManager = (android.location.LocationManager) getSystemService(LOCATION_SERVICE);
        if (satelliteManager == null || !satelliteManager.getAllProviders().contains(android.location.LocationManager.GPS_PROVIDER)) return;
        satelliteListener = new android.location.LocationListener() {
            @Override public void onLocationChanged(Location fix) {
                if (fix.hasAccuracy() && LocationFixPolicy.isFresh(fix.getElapsedRealtimeNanos() / 1000000, android.os.SystemClock.elapsedRealtime())) {
                    latestSatelliteFix = new Location(fix);
                    handleLocationUpdate(fix);
                }
            }
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) { latestSatelliteFix = null; }
            @Override public void onStatusChanged(String provider, int status, android.os.Bundle extras) {}
        };
        try {
            satelliteManager.requestLocationUpdates(android.location.LocationManager.GPS_PROVIDER, 3000, 0f, satelliteListener, Looper.getMainLooper());
        } catch (RuntimeException error) {
            satelliteListener = null;
            Log.w(TAG, "Satellite location unavailable; using fused updates", error);
        }
    }

    private void handleLocationUpdate(Location location) {
        // Fused dead-reckoning can drift while a stationary phone has a usable
        // satellite fix. Prefer fresh satellite observations, never old GPS.
        if (!android.location.LocationManager.GPS_PROVIDER.equals(location.getProvider()) && latestSatelliteFix != null
                && LocationFixPolicy.preferSatellite(latestSatelliteFix.getElapsedRealtimeNanos() / 1000000,
                        latestSatelliteFix.getAccuracy(), android.os.SystemClock.elapsedRealtime())) return;
        // Update static location
        if (!setLocation(location)) return;
        Log.d(TAG, "Trip fix provider=" + location.getProvider() + " accuracy=" + location.getAccuracy()
                + " speed=" + (location.hasSpeed() ? location.getSpeed() : -1));

        try {
            Intent locIntent = new Intent(ACTION_LOCATION_UPDATED);
            locIntent.putExtra("lat", location.getLatitude());
            locIntent.putExtra("lng", location.getLongitude());
            locIntent.setPackage(getPackageName());
            sendBroadcast(locIntent);
        } catch (Exception ignored) {}
        
        // Send to Firebase Firestore and Backend API in parallel if rider ID is available
        if (riderId != null && !riderId.isEmpty()) {
            // Update Firestore (existing functionality - MUST NOT be removed)
            updateLocationInFirestore(location);
            
            // Update backend API (new requirement - run in parallel)
            updateLocationToBackend(location);

            // Live tracking for backend duty & active orders
            emitLocationPingToNode(location);
            com.shifter.driver.utility.TripProgressClient.recordLocation(getApplicationContext(), location);

            // Daily Driver duty ping — throttled to roughly once every 90s while punched in.
            maybeSendDailyDriverPing(location);
        } else {
            Log.w(TAG, "Rider ID not available, skipping location updates");
        }
    }

    private com.google.android.gms.tasks.CancellationTokenSource freshFixCancellation;
    private long lastFreshFixRequest;
    private void requestCurrentFix() {
        if (android.os.SystemClock.elapsedRealtime() - lastFreshFixRequest < 10000) return;
        if (ActivityCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) return;
        lastFreshFixRequest = android.os.SystemClock.elapsedRealtime();
        if (freshFixCancellation != null) freshFixCancellation.cancel();
        freshFixCancellation = new com.google.android.gms.tasks.CancellationTokenSource();
        final com.google.android.gms.tasks.CancellationTokenSource token = freshFixCancellation;
        locationUpdateHandler.postDelayed(token::cancel, 20000);
        fusedLocationClient.getCurrentLocation(LocationRequest.PRIORITY_HIGH_ACCURACY, token.getToken())
                .addOnSuccessListener(location -> { if (location != null) handleLocationUpdate(location); })
                .addOnFailureListener(error -> Log.w(TAG, "Current GPS fix unavailable", error));
    }

    /**
     * Update location to Firebase Firestore (existing functionality - MUST NOT be removed)
     */
    private void updateLocationInFirestore(Location location) {
        Map<String, Object> locationData = new HashMap<>();
        locationData.put("latitude", location.getLatitude());
        locationData.put("longitude", location.getLongitude());
        locationData.put("accuracy", location.getAccuracy());
        locationData.put("speed", location.getSpeed());
        locationData.put("bearing", location.getBearing());
        locationData.put("timestamp", System.currentTimeMillis());
        locationData.put("isOnline", true);
        
        // Update location in Firestore
        db.collection("RiderLocations")
                .document(riderId)
                .set(locationData)
                .addOnSuccessListener(aVoid -> {
                    Log.d(TAG, "Location updated in Firestore successfully");
                })
                .addOnFailureListener(e -> {
                    Log.e(TAG, "Error updating location in Firestore: " + e.getMessage());
                });
    }
    
    private static volatile long lastDailyDriverPingAt = 0L;
    private static final long DAILY_DRIVER_PING_INTERVAL_MS = 90_000; // ~90s, within the 60-120s window
    private static volatile boolean wasInsideDailyDriverZone = true;

    /**
     * Calls POST /api/rider/daily-driver/duty/ping while the driver is
     * punched in for a Daily Driver shift. Throttled independently of the
     * regular (10s/5s) fused location cadence since the backend only needs
     * this roughly every 60-120 seconds.
     *
     * Relies on DailyDriverManager's cached duty status, which HomeFragment
     * keeps fresh via its existing 10s duty-status poll while visible. No
     * dedicated Daily Driver background poller exists yet; if the app is
     * fully backgrounded for a long time this cached flag can go stale.
     */
    private void maybeSendDailyDriverPing(Location location) {
        try {
            if (!com.shifter.driver.utility.DailyDriverManager.getInstance().isPunchedIn()) return;
            long now = android.os.SystemClock.elapsedRealtime();
            if (now - lastDailyDriverPingAt < DAILY_DRIVER_PING_INTERVAL_MS) return;
            lastDailyDriverPingAt = now;

            if (riderId == null || riderId.isEmpty()) return;
            int driverId = Integer.parseInt(riderId);
            com.shifter.driver.utility.DailyDriverApiClient.ping(driverId, location.getLatitude(), location.getLongitude(),
                    new com.shifter.driver.utility.DailyDriverApiClient.PingCallback() {
                        @Override
                        public void onSuccess(boolean active, boolean insideZone, boolean inDelivery,
                                               int totalInZoneMinutes, int totalOutZoneMinutes) {
                            // Alert only on the inside->outside transition, not every ping,
                            // so it doesn't spam a toast every ~90s while genuinely outside.
                            if (active && !insideZone && wasInsideDailyDriverZone) {
                                Toast.makeText(getApplicationContext(),
                                        "You're outside your Daily Driver zone. Time won't be counted until you return.",
                                        Toast.LENGTH_LONG).show();
                            }
                            wasInsideDailyDriverZone = insideZone;
                        }

                        @Override
                        public void onError(String message) {
                        }
                    });
        } catch (Exception e) {
            Log.e(TAG, "Error sending daily driver duty ping", e);
        }
    }

    private void emitLocationPingToNode(Location location) {
        try {
            SessionManager sm = new SessionManager(getApplicationContext());
            com.shifter.driver.model.PDOrderItem activeOrder = sm.getActiveOrder();

            org.json.JSONObject payload = new org.json.JSONObject();
            payload.put("rider_id", riderId);
            if (activeOrder != null && activeOrder.getId() != null) {
                payload.put("order_id", activeOrder.getId());
            }
            payload.put("lat", location.getLatitude());
            payload.put("lng", location.getLongitude());
            payload.put("heading", location.getBearing());
            com.shifter.driver.socket.NodeSocketManager.getInstance().emitLocationPing(payload);
        } catch (Exception e) {
            Log.e(TAG, "Error emitting driver:location_ping", e);
        }
    }

    /**
     * Update location to backend API (new requirement - runs in parallel with Firestore)
     * This runs in background thread to not block UI
     */
    private void updateLocationToBackend(Location location) {
        // Run API call in background thread
        apiExecutor.execute(() -> {
            try {
                java.util.Map<String, Object> body = new java.util.HashMap<>();
                body.put("rider_id", riderId);
                body.put("lat", String.valueOf(location.getLatitude()));
                body.put("lng", String.valueOf(location.getLongitude()));
                body.put("device_id", com.shifter.driver.utility.Utility.getDeviceId(getApplicationContext()));

                Call<JsonObject> call = com.shifter.driver.retrofit.NodeApiClient.getInterface().updateLocation(body);
                call.enqueue(new Callback<JsonObject>() {
                    @Override
                    public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                        if (response.isSuccessful() && response.body() != null) {
                            JsonObject body = response.body();
                            // device_match check — update_location.php
                            if (body.has("device_match") && !body.get("device_match").getAsBoolean()) {
                                android.os.Handler mainHandler = new android.os.Handler(android.os.Looper.getMainLooper());
                                mainHandler.post(() -> {
                                    SessionManager sm = new SessionManager(getApplicationContext());
                                    sm.logoutUser();
                                    Intent logoutIntent = new Intent(getApplicationContext(), com.shifter.driver.activity.LoginActivity.class);
                                    logoutIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                                    startActivity(logoutIntent);
                                    stopSelf();
                                });
                            }
                        }
                    }

                    @Override
                    public void onFailure(Call<JsonObject> call, Throwable t) {
                        // Don't show toast or block - this is background operation
                    }
                });
            } catch (Exception e) {
               // Log.e(TAG, "Error creating location update request", e);
            }
        });
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        if (satelliteManager != null && satelliteListener != null) satelliteManager.removeUpdates(satelliteListener);
        if (freshFixCancellation != null) freshFixCancellation.cancel();
        if (locationUpdateHandler != null) locationUpdateHandler.removeCallbacksAndMessages(null);
        sIsRunning = false;
        Log.d(TAG, "Service onDestroy");
        stopLocationUpdates();
        stopForeground(true);
        
        // Shutdown executor
        if (apiExecutor != null && !apiExecutor.isShutdown()) {
            apiExecutor.shutdown();
        }
        
        super.onDestroy();
    }

    private void stopLocationUpdates() {
        if (locationCallback != null && fusedLocationClient != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
            
            // Mark rider as offline in Firestore & Node Backend
            if (riderId != null && !riderId.isEmpty()) {
                Map<String, Object> offlineData = new HashMap<>();
                offlineData.put("isOnline", false);
                offlineData.put("timestamp", System.currentTimeMillis());
                
                db.collection("RiderLocations")
                        .document(riderId)
                        .update(offlineData)
                        .addOnSuccessListener(aVoid -> Log.d(TAG, "Rider marked as offline in Firestore"))
                        .addOnFailureListener(e -> Log.e(TAG, "Error marking rider offline: " + e.getMessage()));

                // Sync offline status to Node backend
                try {
                    Map<String, Object> nodeBody = new HashMap<>();
                    nodeBody.put("rider_id", Integer.parseInt(riderId));
                    nodeBody.put("a_status", 0);
                    com.shifter.driver.retrofit.NodeApiClient.getInterface().setStatus(nodeBody).enqueue(new Callback<JsonObject>() {
                        @Override
                        public void onResponse(Call<JsonObject> call, Response<JsonObject> response) {
                            Log.d(TAG, "Rider marked as offline in Node backend");
                        }
                        @Override
                        public void onFailure(Call<JsonObject> call, Throwable t) {
                            Log.e(TAG, "Failed to mark rider offline in Node backend: " + t.getMessage());
                        }
                    });
                } catch (Exception e) {
                    Log.e(TAG, "Error building offline payload for Node", e);
                }
            }
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    getString(R.string.app_name),
                    NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Location updates running");
            channel.setShowBadge(false);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }
    }

    private Notification buildNotification() {
        // Use a dedicated intent that carries NO order extras — just brings the app to front.
        // Request code 9001 is unique and will never clash with order notification (uses 0).
        Intent launchIntent = new Intent(this, HomeActivity.class);
        launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        // Explicitly make sure no order-related flags are present
        launchIntent.removeExtra("show_order_dialog");
        launchIntent.removeExtra("order_id");
        launchIntent.removeExtra("type");

        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
                : PendingIntent.FLAG_UPDATE_CURRENT;
        // Request code 9001 — distinct from order notification's PendingIntent (request code 0)
        PendingIntent pi = PendingIntent.getActivity(this, 9001, launchIntent, flags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.app_name))
                .setContentText("Location tracking is active")
                .setSmallIcon(R.drawable.ic_notification)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .build();
    }
}

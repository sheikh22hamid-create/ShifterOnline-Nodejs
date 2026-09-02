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
import com.shifter.driver.retrofit.APIClient;
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

    // holds last known location
    private static Location lastLocation;
    
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private Handler locationUpdateHandler;
    private SessionManager sessionManager;
    private FirebaseFirestore db;
    private String riderId;
    private ExecutorService apiExecutor; // For parallel API calls

    public static void setLocation(Location location) {
        lastLocation = location;
    }

    public static Location getLocation() {
        if (lastLocation != null) return lastLocation;
        Location fallback = new Location("default");
        fallback.setLatitude(0.0);
        fallback.setLongitude(0.0);
        return fallback;
    }

    @Override
    public void onCreate() {
        super.onCreate();
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
        startLocationUpdates();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "Service onStartCommand");
        // Start as foreground immediately
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
        
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
        locationRequest.setInterval(UPDATE_INTERVAL);
        locationRequest.setFastestInterval(FASTEST_INTERVAL);
        locationRequest.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
        
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
    }

    private void handleLocationUpdate(Location location) {
        // Update static location
        setLocation(location);
        
        // Send to Firebase Firestore and Backend API in parallel if rider ID is available
        if (riderId != null && !riderId.isEmpty()) {
            // Update Firestore (existing functionality - MUST NOT be removed)
            updateLocationInFirestore(location);
            
            // Update backend API (new requirement - run in parallel)
            updateLocationToBackend(location);
        } else {
            Log.w(TAG, "Rider ID not available, skipping location updates");
        }
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
    
    /**
     * Update location to backend API (new requirement - runs in parallel with Firestore)
     * This runs in background thread to not block UI
     */
    private void updateLocationToBackend(Location location) {
        // Run API call in background thread
        apiExecutor.execute(() -> {
            try {
                JsonObject jsonObject = new JsonObject();
                jsonObject.addProperty("rider_id", riderId);
                jsonObject.addProperty("lat", String.valueOf(location.getLatitude()));
                jsonObject.addProperty("lng", String.valueOf(location.getLongitude()));
                
                RequestBody bodyRequest = RequestBody.create(
                    MediaType.parse("application/json; charset=utf-8"),
                    jsonObject.toString()
                );
                
                Call<JsonObject> call = APIClient.getInterface().updateLocation(bodyRequest);
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
            
            // Mark rider as offline in Firestore
            if (riderId != null && !riderId.isEmpty()) {
                Map<String, Object> offlineData = new HashMap<>();
                offlineData.put("isOnline", false);
                offlineData.put("timestamp", System.currentTimeMillis());
                
                db.collection("RiderLocations")
                        .document(riderId)
                        .update(offlineData)
                        .addOnSuccessListener(aVoid -> Log.d(TAG, "Rider marked as offline"))
                        .addOnFailureListener(e -> Log.e(TAG, "Error marking rider offline: " + e.getMessage()));
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

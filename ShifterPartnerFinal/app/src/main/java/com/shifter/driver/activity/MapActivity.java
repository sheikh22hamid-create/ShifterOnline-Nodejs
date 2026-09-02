package com.shifter.driver.activity;

import static android.os.Build.VERSION.SDK_INT;
import static com.google.android.gms.location.LocationServices.getFusedLocationProviderClient;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.Address;
import android.location.Criteria;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.AsyncTask;
import android.os.Build;
import android.os.Bundle;
import android.text.TextUtils;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.google.android.gms.common.api.Status;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationAvailability;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.maps.CameraUpdate;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.OnMapReadyCallback;
import com.google.android.gms.maps.SupportMapFragment;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.gms.tasks.Task;
import com.google.android.libraries.places.api.Places;
import com.google.android.libraries.places.api.model.Place;
import com.google.android.libraries.places.widget.Autocomplete;
import com.google.android.libraries.places.widget.AutocompleteActivity;
import com.google.android.libraries.places.widget.model.AutocompleteActivityMode;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityMapBinding;
import com.shifter.driver.model.TampAddress;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;
import com.shifter.driver.utility.Utility;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

public class MapActivity extends AppCompatActivity implements OnMapReadyCallback, LocationListener {
    private ActivityMapBinding binding;
    GoogleMap mMap;
    SessionManager sessionManager;
    CustPrograssbar custPrograssbar;

    String userAddress = "";
    String cityname = null;
    double mLatitude = 0.0;
    double mLongitude = 0.0;
    double currentLatitude;
    double currentLongitude;
    FusedLocationProviderClient fusedLocationProviderClient;
    Bundle addressBundle;
    LocationCallback locationCallback;
    LocationRequest locationRequest;
    private MarkerOptions place1;
    Marker marker;
    List<AsyncTask> filterTaskList = new ArrayList<>();
    boolean isZooming = false;
    int placeAutocompleteRequestCode = 1;

    private static final String TAG = "MapActivity";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        binding = ActivityMapBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());
        Log.d(TAG, "onCreate: Activity started");

        custPrograssbar = new CustPrograssbar();

        sessionManager = new SessionManager(MapActivity.this);
        setupEditTextHandling();

        binding.imgBack.setOnClickListener(v -> finish());
        binding.btnLocation.setOnClickListener(v -> {
            if (TextUtils.isEmpty(binding.edHouse.getText().toString())) {
                binding.edHouse.setError("Please enter house number");
                binding.edHouse.requestFocus();
                return;
            }
            saveAddressWithCity(cityname);
        });

        // Get map fragment and initialize
        SupportMapFragment mapFragment = (SupportMapFragment) getSupportFragmentManager().findFragmentById(R.id.map);
        if (mapFragment != null) {
            // Ensure fragment is visible
            View fragmentView = mapFragment.getView();
            if (fragmentView != null) {
                fragmentView.setVisibility(View.VISIBLE);
            }
            mapFragment.getMapAsync(this);
            Log.d(TAG, "Map fragment found, requesting map");
        } else {
            Log.e(TAG, "Map fragment is null!");
            Toast.makeText(this, "Map initialization failed", Toast.LENGTH_SHORT).show();
        }

        custPrograssbar.prograssCreate(MapActivity.this);
        addressBundle = new Bundle();
        fusedLocationProviderClient = getFusedLocationProviderClient(this);
        getLocationRequest();
        showCurrentLocationOnMap();
        locationCallback = new LocationCallback() {
            @Override
            public void onLocationAvailability(LocationAvailability locationAvailability) {
                Log.d(TAG, "onLocationAvailability: " + locationAvailability.isLocationAvailable());
            }

            @Override
            public void onLocationResult(LocationResult locationResult) {
                if (locationResult == null) {
                    Log.d(TAG, "onLocationResult: locationResult is null");
                    return;
                }
                Log.d(TAG, "onLocationResult - Lat: " + locationResult.getLocations().get(0).getLatitude() +
                        ", Lon: " + locationResult.getLocations().get(0).getLongitude());
                fusedLocationProviderClient.removeLocationUpdates(locationCallback);
            }
        };

        Intent i = getIntent();
        if (i != null) {
            Bundle extras = i.getExtras();
            if (extras != null) {
                cityname = getIntent().getStringExtra("city");
                if (cityname == null || cityname.isEmpty()) {
                    cityname = ""; // fallback
                }
                Log.d(TAG, "Received city from intent: " + cityname);
            }
        }
        if (savedInstanceState != null) {
            mLatitude = savedInstanceState.getDouble("latitude");
            mLongitude = savedInstanceState.getDouble("longitude");
            userAddress = savedInstanceState.getString("userAddress");
            currentLatitude = savedInstanceState.getDouble("currentLatitude");
            currentLongitude = savedInstanceState.getDouble("currentLongitude");
            Log.d(TAG, "Restored from savedInstanceState - Lat: " + mLatitude + ", Lon: " + mLongitude);
        }

        // Back button
        /*
         * binding.imgBack.setOnClickListener(v -> {
         * finish();
         * });
         */

        // Select location button
        binding.btnLocation.setOnClickListener(v -> {

            // House number validation
            if (TextUtils.isEmpty(binding.edHouse.getText().toString())) {
                binding.edHouse.setError("Please enter house number");
                binding.edHouse.requestFocus();
                return;
            }

            String bundleCity = addressBundle.getString("city");

            if (bundleCity == null || bundleCity.isEmpty()) {
                Toast.makeText(this, "Please select a valid location", Toast.LENGTH_SHORT).show();
                return;
            }

            // City match logic
            if (cityname.equalsIgnoreCase(bundleCity)) {
                saveAddressWithCity(cityname);
            } else if (isNearbyCity(bundleCity)) {
                showCityConfirmationDialog(cityname, bundleCity);
            } else {
                showCityConfirmationDialog(cityname, bundleCity);
            }
        });

    }

    // ---------------- EDITTEXT KEYBOARD HANDLING ----------------
    // ---------------- EDITTEXT KEYBOARD HANDLING ----------------
    private void setupEditTextHandling() {

        // House field focus listener
        binding.edHouse.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override
            public void onFocusChange(View v, boolean hasFocus) {
                if (hasFocus) {
                    // Delay to ensure keyboard is shown
                    binding.edHouse.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            // Calculate position to scroll
                            int[] location = new int[2];
                            binding.edHouse.getLocationInWindow(location);

                            // Scroll the NestedScrollView
                            binding.bottomForm.smoothScrollTo(0, binding.edHouse.getTop());
                        }
                    }, 200);
                }
            }
        });

        // Landmark field focus listener
        binding.edLandmark.setOnFocusChangeListener(new View.OnFocusChangeListener() {
            @Override
            public void onFocusChange(View v, boolean hasFocus) {
                if (hasFocus) {
                    // Delay to ensure keyboard is shown
                    binding.edLandmark.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            // Scroll to landmark field
                            binding.bottomForm.smoothScrollTo(0, binding.edLandmark.getTop());
                        }
                    }, 200);
                }
            }
        });

        // Hide keyboard when "Done" pressed on landmark field
        binding.edLandmark.setOnEditorActionListener(new TextView.OnEditorActionListener() {
            @Override
            public boolean onEditorAction(TextView v, int actionId, android.view.KeyEvent event) {
                if (actionId == android.view.inputmethod.EditorInfo.IME_ACTION_DONE) {
                    // Hide keyboard
                    android.view.inputmethod.InputMethodManager imm = (android.view.inputmethod.InputMethodManager) getSystemService(
                            Context.INPUT_METHOD_SERVICE);
                    if (imm != null) {
                        imm.hideSoftInputFromWindow(v.getWindowToken(), 0);
                    }
                    v.clearFocus();

                    // Scroll back to top
                    binding.bottomForm.smoothScrollTo(0, 0);
                    return true;
                }
                return false;
            }
        });
    }

    // Nearby cities check karne ka method
    private boolean isNearbyCity(String detectedCity) {
        if (detectedCity == null)
            return false;

        // Indore ke nearby areas ko allow karo
        String[] nearbyAreas = { "sater", "satter", "sanwer", "mhow", "pithampur", "dewas", "ujjain" };
        String lowerCity = detectedCity.toLowerCase();

        for (String area : nearbyAreas) {
            if (lowerCity.contains(area)) {
                Log.d(TAG, "Nearby city detected: " + detectedCity + " matches " + area);
                return true;
            }
        }
        return false;
    }

    // Address save karne ka common method
    private void saveAddressWithCity(String selectedCity) {
        if (TextUtils.isEmpty(binding.edHouse.getText().toString())) {
            binding.edHouse.setError("Please enter house number");
            return;
        }

        TampAddress tampAddress = new TampAddress();
        tampAddress.setAddress(addressBundle.getString("fulladdress"));
        tampAddress.setCity(selectedCity);
        tampAddress.setLandmark(binding.edLandmark.getText().toString());
        tampAddress.setHno(binding.edHouse.getText().toString());
        tampAddress.setLatitude(mLatitude);
        tampAddress.setLongitude(mLongitude);
        sessionManager.setAddress(tampAddress);

        Log.d(TAG, "Address saved with city: " + selectedCity);
        Toast.makeText(this, "Address saved successfully!", Toast.LENGTH_SHORT).show();
        finish();
    }

    // City confirmation dialog dikhane ka method
    private void showCityConfirmationDialog(String expectedCity, String detectedCity) {
        androidx.appcompat.app.AlertDialog.Builder builder = new androidx.appcompat.app.AlertDialog.Builder(this);
        builder.setTitle("Confirm Your City")
                .setMessage("We detected '" + detectedCity + "' but you selected '" + expectedCity
                        + "'.\n\nWhich one is correct?")
                .setPositiveButton(expectedCity, (dialog, which) -> {
                    // User ne expected city confirm kari
                    Log.d(TAG, "User confirmed expected city: " + expectedCity);
                    saveAddressWithCity(expectedCity);
                })
                .setNegativeButton(detectedCity, (dialog, which) -> {
                    // User ne detected city confirm kari
                    Log.d(TAG, "User confirmed detected city: " + detectedCity);
                    saveAddressWithCity(detectedCity);
                })
                .setNeutralButton("Cancel", (dialog, which) -> {
                    Log.d(TAG, "User cancelled city selection");
                    dialog.dismiss();
                })
                .show();
    }

    // Better city detection ka method
    private String getBetterCityFromAddress(Address address) {
        if (address == null)
            return "Unknown";

        String city = address.getLocality();
        Log.d(TAG, "getBetterCityFromAddress - Locality: " + city);

        // Pehle locality check karo
        if (city == null || city.isEmpty()) {
            city = address.getSubLocality();
            Log.d(TAG, "getBetterCityFromAddress - SubLocality: " + city);
        }

        // Fir sub-admin area check karo
        if (city == null || city.isEmpty()) {
            city = address.getSubAdminArea();
            Log.d(TAG, "getBetterCityFromAddress - SubAdminArea: " + city);
        }

        // Last me admin area check karo
        if (city == null || city.isEmpty()) {
            city = address.getAdminArea();
            Log.d(TAG, "getBetterCityFromAddress - AdminArea: " + city);
        }

        return city != null ? city : "Unknown";
    }

    // Better location accuracy ke liye
    private void getHighAccuracyLocation() {
        if (checkAndRequestPermissions()) {
            LocationRequest highAccuracyRequest = LocationRequest.create();
            highAccuracyRequest.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
            highAccuracyRequest.setInterval(10000);
            highAccuracyRequest.setFastestInterval(5000);
            highAccuracyRequest.setNumUpdates(2);

            if (ActivityCompat.checkSelfPermission(this,
                    Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                return;
            }

            fusedLocationProviderClient.requestLocationUpdates(highAccuracyRequest,
                    new LocationCallback() {
                        @Override
                        public void onLocationResult(LocationResult locationResult) {
                            if (locationResult != null) {
                                Location location = locationResult.getLastLocation();
                                if (location != null && location.getAccuracy() < 50) { // 50 meters within accuracy
                                    mLatitude = location.getLatitude();
                                    mLongitude = location.getLongitude();
                                    Log.d(TAG, "High accuracy location found - Lat: " + mLatitude + ", Lon: "
                                            + mLongitude);
                                    getAddressByGeoCodingLatLng();
                                }
                                fusedLocationProviderClient.removeLocationUpdates(this);
                            }
                        }
                    }, null);
        }
    }

    private void getLocationRequest() {
        locationRequest = new LocationRequest();
        locationRequest.setInterval(10000);
        locationRequest.setFastestInterval(3000);
        locationRequest.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
        Log.d(TAG, "Location request configured");
    }

    @SuppressLint("MissingPermission")
    @Override
    public void onMapReady(@NonNull GoogleMap googleMap) {
        Log.d(TAG, "onMapReady: Map is ready");
        mMap = googleMap;

        // First set map type and settings
        mMap.setMapType(GoogleMap.MAP_TYPE_NORMAL);
        mMap.getUiSettings().setMapToolbarEnabled(false);
        mMap.getUiSettings().setZoomControlsEnabled(true);
        mMap.getUiSettings().setMyLocationButtonEnabled(true);
        mMap.getUiSettings().setCompassEnabled(true);
        mMap.getUiSettings().setAllGesturesEnabled(true);
        if (mMap.isIndoorEnabled()) {
            mMap.setIndoorEnabled(false);
        }

        // 🔥 ADD THIS: Set padding to avoid overlap with top bar and bottom sheet
        // Calculate top bar height
        binding.topBar.post(new Runnable() {
            @Override
            public void run() {
                int topBarHeight = binding.topBar.getHeight();
                int bottomFormHeight = 150; // Minimum bottom padding

                // Set map padding (left, top, right, bottom)
                mMap.setPadding(0, topBarHeight, 0, bottomFormHeight);

                Log.d(TAG, "Map padding set - Top: " + topBarHeight + ", Bottom: " + bottomFormHeight);
            }
        });

        // Set a default location FIRST to ensure map tiles load
        LatLng defaultLocation = new LatLng(23.0225, 72.5714); // Default to India center
        mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(defaultLocation, 12));
        Log.d(TAG, "onMapReady: Map camera set to default location");

        custPrograssbar.closePrograssBar();

        if (ActivityCompat.checkSelfPermission(this,
                Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED &&
                ActivityCompat.checkSelfPermission(this,
                        Manifest.permission.ACCESS_COARSE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "onMapReady: Location permissions not granted");
            // Don't return, map should still work without location
        } else {
            // Enable my location layer to make map visible
            try {
                mMap.setMyLocationEnabled(true);
                Log.d(TAG, "onMapReady: My location enabled");
            } catch (SecurityException e) {
                Log.e(TAG, "onMapReady: SecurityException - " + e.getMessage());
            }
        }

        mMap.setOnCameraMoveListener(new GoogleMap.OnCameraMoveListener() {
            @Override
            public void onCameraMove() {
                // Don't clear map on camera move to keep it visible
                // Only clear if we need to update markers
                Log.d(TAG, "onCameraMove: Camera is moving");
            }
        });

        mMap.setOnMapClickListener(latLng -> {
            mMap.clear();
            mLatitude = latLng.latitude;
            mLongitude = latLng.longitude;
            Log.d(TAG, "onMapClick - Lat: " + latLng.latitude + ", Lon: " + latLng.longitude);

            // Add marker at clicked location
            if (marker != null) {
                marker.remove();
            }
            marker = mMap.addMarker(new MarkerOptions()
                    .position(latLng)
                    .title("Selected Location"));

            isZooming = true;
            onLocationChanged((Location) null);
            getAddressByGeoCodingLatLng();
        });

        mMap.setOnMapLoadedCallback(new GoogleMap.OnMapLoadedCallback() {
            @Override
            public void onMapLoaded() {
                Log.d(TAG,
                        "onMapLoaded: Map tiles loaded successfully - " + mMap.getCameraPosition().target.toString());
                // Map is now fully loaded with tiles
            }
        });

        mMap.setOnCameraIdleListener(new GoogleMap.OnCameraIdleListener() {
            @SuppressLint("MissingPermission")
            @Override
            public void onCameraIdle() {
                LatLng latLng = mMap.getCameraPosition().target;
                Log.d(TAG, "onCameraIdle - Camera target: " + latLng);

                if (latLng != null && latLng.latitude != 0.0 && latLng.longitude != 0.0) {
                    mMap.clear();
                    // Add marker at camera target location
                    if (marker != null) {
                        marker.remove();
                    }
                    marker = mMap.addMarker(new MarkerOptions()
                            .position(latLng)
                            .title("Selected Location"));

                    // Update coordinates
                    mLatitude = latLng.latitude;
                    mLongitude = latLng.longitude;

                    GetAddressFromLatLng asyncTask = new GetAddressFromLatLng();
                    asyncTask.executeOnExecutor(AsyncTask.THREAD_POOL_EXECUTOR, latLng.latitude, latLng.longitude);
                } else {
                    Log.w(TAG, "onCameraIdle: Invalid latlng, trying to get current location");
                    if (SDK_INT == Build.VERSION_CODES.R) {
                        try {
                            LocationManager systemService = (LocationManager) getSystemService(
                                    Context.LOCATION_SERVICE);
                            systemService.getCurrentLocation(LocationManager.NETWORK_PROVIDER, null, getMainExecutor(),
                                    locationCallback -> {
                                        Log.d(TAG,
                                                "Android R - Current location - Lat: " + locationCallback.getLatitude()
                                                        + ", Lon: " + locationCallback.getLongitude());
                                        LatLng latLng1 = new LatLng(locationCallback.getLatitude(),
                                                locationCallback.getLongitude());
                                        GetAddressFromLatLng asyncTask = new GetAddressFromLatLng();
                                        asyncTask.executeOnExecutor(AsyncTask.THREAD_POOL_EXECUTOR, latLng1.latitude,
                                                latLng1.longitude);
                                    });
                        } catch (Exception e) {
                            Log.e(TAG, "onCameraIdle Android R error: " + e.getMessage());
                        }
                    }
                }
            }
        });

        try {
            LocationManager locationManager = (LocationManager) getSystemService(LOCATION_SERVICE);
            Criteria criteria = new Criteria();
            String provider = locationManager.getBestProvider(criteria, true);
            Location location = locationManager.getLastKnownLocation(provider);

            if (location != null && location.getLatitude() != 0.0 && location.getLongitude() != 0.0) {
                Log.d(TAG, "Using last known location - Lat: " + location.getLatitude() + ", Lon: "
                        + location.getLongitude());
                onLocationChanged(location);
            } else {
                Log.d(TAG, "Last known location not available, fetching current location");
                LocationManager systemService = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
                if (SDK_INT == Build.VERSION_CODES.R) {
                    systemService.getCurrentLocation(LocationManager.NETWORK_PROVIDER, null, getMainExecutor(),
                            locationCallback -> {
                                Log.d(TAG, "Android R Current location - Lat: " + locationCallback.getLatitude()
                                        + ", Lon: " + locationCallback.getLongitude());
                                onLocationChanged(locationCallback);
                            });
                    locationManager.requestLocationUpdates(provider, 20000, 0, this);
                } else {
                    Task<Location> lastLocation = fusedLocationProviderClient.getLastLocation();
                    lastLocation.addOnSuccessListener(this, location1 -> {
                        if (location1 != null) {
                            mMap.clear();
                            mLatitude = location1.getLatitude();
                            mLongitude = location1.getLongitude();
                            Log.d(TAG, "Fused location - Lat: " + mLatitude + ", Lon: " + mLongitude);
                            onLocationChanged(location1);
                            filterTaskList.clear();
                            GetAddressFromLatLng asyncTask = new GetAddressFromLatLng();
                            filterTaskList.add(asyncTask);
                            asyncTask.executeOnExecutor(AsyncTask.THREAD_POOL_EXECUTOR, mLatitude, mLongitude);
                        } else {
                            Log.w(TAG, "Fused location is null");
                            Utility.enableLoc(this);
                            Toast.makeText(this, "Location not Available", Toast.LENGTH_SHORT).show();
                        }
                    });
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in onMapReady: " + e.getMessage());
        }
    }

    @Override
    public void onLocationChanged(@NonNull Location location) {
        // Null check add करो!
        if (location == null) {
            Log.w(TAG, "onLocationChanged: location is null");
            return;
        }

        double latitude;
        double longitude;

        if (mLatitude != 0.0 && mLongitude != 0.0) {
            latitude = mLatitude;
            longitude = mLongitude;
        } else {
            latitude = location.getLatitude();
            longitude = location.getLongitude();
        }

        Log.d(TAG, "onLocationChanged - Final Lat: " + latitude + ", Lon: " + longitude);

        LatLng sydney = new LatLng(latitude, longitude);

        if (mMap != null) {
            mMap.clear();
            if (marker != null) {
                marker.remove();
            }
            marker = mMap.addMarker(new MarkerOptions()
                    .position(sydney)
                    .title("Current Location"));

            mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(sydney, 11));
            mMap.animateCamera(CameraUpdateFactory.zoomTo(14), 2000, null);

            Log.d(TAG, "onLocationChanged: Marker added and camera moved");
        }
    }

    /*
     * public void onClick(View view) {
     * switch (view.getId()) {
     * case R.id.img_back:
     * Log.d(TAG, "Back button clicked");
     * finish();
     * break;
     * 
     * case R.id.btn_location:
     * Log.d(TAG, "Location button clicked");
     * 
     * // House number check
     * if (TextUtils.isEmpty(binding.edHouse.getText().toString())) {
     * binding.edHouse.setError("Please enter house number");
     * binding.edHouse.requestFocus();
     * return;
     * }
     * 
     * String bundleCity = addressBundle.getString("city");
     * Log.d(TAG, "Expected city: " + cityname + ", Actual city: " + bundleCity);
     * 
     * // City validation - flexible approach
     * if (bundleCity == null || bundleCity.isEmpty()) {
     * Log.w(TAG, "City not detected in address bundle");
     * Toast.makeText(this, "Please select a valid location",
     * Toast.LENGTH_SHORT).show();
     * return;
     * }
     * 
     * // Case 1: Exact match
     * if (cityname.equalsIgnoreCase(bundleCity)) {
     * Log.d(TAG, "City exact match - saving address");
     * saveAddressWithCity(cityname);
     * }
     * // Case 2: Nearby city match
     * else if (isNearbyCity(bundleCity)) {
     * Log.d(TAG, "Nearby city detected - showing confirmation");
     * showCityConfirmationDialog(cityname, bundleCity);
     * }
     * // Case 3: No match - let user decide
     * else {
     * Log.w(TAG, "City mismatch - Expected: " + cityname + ", Got: " + bundleCity);
     * showCityConfirmationDialog(cityname, bundleCity);
     * }
     * break;
     * }
     * }
     */

    private void showCurrentLocationOnMap() {
        Log.d(TAG, "showCurrentLocationOnMap called");
        if (checkAndRequestPermissions()) {
            @SuppressLint("MissingPermission")
            Task<Location> lastLocation = fusedLocationProviderClient.getLastLocation();
            lastLocation.addOnSuccessListener(this, location -> {
                if (location != null) {
                    if (mMap != null)
                        mMap.clear();
                    mLatitude = location.getLatitude();
                    mLongitude = location.getLongitude();
                    Log.d(TAG, "showCurrentLocationOnMap - Lat: " + mLatitude + ", Lon: " + mLongitude);
                    getAddressByGeoCodingLatLng();
                } else {
                    Log.w(TAG, "showCurrentLocationOnMap: Location is null, showing default map");
                    // Default location show करो
                    LatLng defaultLocation = new LatLng(23.0225, 72.5714); // India center
                    if (mMap != null) {
                        mMap.moveCamera(CameraUpdateFactory.newLatLngZoom(defaultLocation, 12));
                    }
                }
            });
        }
    }

    private boolean checkAndRequestPermissions() {
        int locationPermission = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION);
        int coarsePermision = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION);
        List<String> listPermissionsNeeded = new ArrayList<>();

        if (locationPermission != PackageManager.PERMISSION_GRANTED) {
            listPermissionsNeeded.add(Manifest.permission.ACCESS_FINE_LOCATION);
        }
        if (coarsePermision != PackageManager.PERMISSION_GRANTED) {
            listPermissionsNeeded.add(Manifest.permission.ACCESS_COARSE_LOCATION);
        }

        if (!listPermissionsNeeded.isEmpty()) {
            Log.d(TAG, "Requesting permissions: " + listPermissionsNeeded);
            boolean showRationale = false;
            if (ActivityCompat.shouldShowRequestPermissionRationale(this, Manifest.permission.ACCESS_FINE_LOCATION) ||
                    ActivityCompat.shouldShowRequestPermissionRationale(this,
                            Manifest.permission.ACCESS_COARSE_LOCATION)) {
                showRationale = true;
            }
            if (showRationale) {
                new androidx.appcompat.app.AlertDialog.Builder(this)
                        .setTitle("Location Permission Needed")
                        .setMessage("Please grant Location permission to detect your current location on the map.")
                        .setPositiveButton("OK", (dialog, which) -> {
                            ActivityCompat.requestPermissions(this, listPermissionsNeeded.toArray(new String[0]), 2);
                        })
                        .setNegativeButton("Cancel", (dialog, which) -> dialog.dismiss())
                        .create().show();
            } else {
                ActivityCompat.requestPermissions(this, listPermissionsNeeded.toArray(new String[0]), 2);
            }
            return false;
        }

        Log.d(TAG, "All permissions granted");
        return true;
    }

    private void getAddressByGeoCodingLatLng() {
        Log.d(TAG, "getAddressByGeoCodingLatLng - Lat: " + mLatitude + ", Lon: " + mLongitude);

        if (mLatitude != 0 && mLongitude != 0) {
            if (Utility.popupWindow != null && Utility.popupWindow.isShowing()) {
                Utility.hideProgress();
            }

            for (AsyncTask prevTask : filterTaskList) {
                prevTask.cancel(true);
            }

            filterTaskList.clear();
            GetAddressFromLatLng asyncTask = new GetAddressFromLatLng();
            filterTaskList.add(asyncTask);
            asyncTask.executeOnExecutor(AsyncTask.THREAD_POOL_EXECUTOR, mLatitude, mLongitude);
        } else {
            Log.w(TAG, "getAddressByGeoCodingLatLng: Invalid coordinates");
        }
    }

    private class GetAddressFromLatLng extends AsyncTask<Double, Void, Bundle> {
        Double latitude;
        Double longitude;

        @Override
        protected void onPreExecute() {
            super.onPreExecute();
            Log.d(TAG, "GetAddressFromLatLng started - Lat: " + mLatitude + ", Lon: " + mLongitude);
            Utility.showProgress(MapActivity.this);
        }

        @Override
        protected Bundle doInBackground(Double... doubles) {
            try {
                Utility.hideProgress();
                latitude = doubles[0];
                longitude = doubles[1];
                Log.d(TAG, "Geocoding - Lat: " + latitude + ", Lon: " + longitude);

                Geocoder geocoder = new Geocoder(MapActivity.this, Locale.getDefault());
                List<Address> addresses = geocoder.getFromLocation(latitude, longitude, 3); // 3 results lo for better
                                                                                            // accuracy

                Log.d(TAG, "Geocoder returned " + (addresses != null ? addresses.size() : 0) + " addresses");

                if (addresses != null && !addresses.isEmpty()) {
                    // Pehla address use karo (most accurate)
                    Address addressObj = addresses.get(0);

                    // Better city detection use karo
                    String city = getBetterCityFromAddress(addressObj);
                    addressBundle.putString("city", city);

                    // Address build karo
                    StringBuilder sb = new StringBuilder();

                    String addressLine = addressObj.getAddressLine(0);
                    if (addressLine != null) {
                        sb.append(addressLine);
                    }

                    addressBundle.putString("fulladdress", sb.toString());
                    Log.d(TAG, "Final address - City: " + city + ", Address: " + sb.toString());

                    return addressBundle;
                } else {
                    Log.w(TAG, "No addresses found by geocoder");
                    addressBundle.putString("city", "Unknown");
                    addressBundle.putString("fulladdress", "Address not available");
                    return addressBundle;
                }
            } catch (IOException e) {
                Log.e(TAG, "Geocoder IOException: " + e.getMessage());
                addressBundle.putString("city", "Unknown");
                addressBundle.putString("fulladdress", "Address not available");
                return addressBundle;
            } catch (Exception e) {
                Log.e(TAG, "Geocoder Exception: " + e.getMessage());
                addressBundle.putString("city", "Unknown");
                addressBundle.putString("fulladdress", "Address not available");
                return addressBundle;
            }
        }

        @Override
        protected void onPostExecute(Bundle userAddress) {
            super.onPostExecute(userAddress);
            Log.d(TAG, "onPostExecute: Address processing completed");

            if (userAddress == null) {
                Log.w(TAG, "onPostExecute: userAddress bundle is null");
                Utility.hideProgress();
                return;
            }

            String address = userAddress.getString("fulladdress");
            String city = userAddress.getString("city");

            Log.d(TAG, "onPostExecute - Full Address: " + address);
            Log.d(TAG, "onPostExecute - City: " + city);

            if (city != null && !city.equals("Unknown")) {
                binding.txtSociety.setText(city);
            } else {
                Log.w(TAG, "onPostExecute: city is null or unknown");
                binding.txtSociety.setText(getString(R.string.select_location));
            }

            if (address != null && !address.equals("Address not available")) {
                binding.txtAddress.setText(address);
            } else {
                Log.w(TAG, "onPostExecute: address is null");
                binding.txtAddress.setText(getString(R.string.move_map_to_select_location));
            }

            binding.btnLocation.setVisibility(View.VISIBLE);
            Utility.hideProgress();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Log.d(TAG, "onActivityResult - requestCode: " + requestCode + ", resultCode: " + resultCode);

        if (requestCode == placeAutocompleteRequestCode) {
            if (resultCode == RESULT_OK) {
                Place place = Autocomplete.getPlaceFromIntent(data);
                userAddress = place.getAddress();
                mLatitude = place.getLatLng().latitude;
                mLongitude = place.getLatLng().longitude;

                Log.d(TAG, "Place selected - Address: " + userAddress + ", Lat: " + mLatitude + ", Lon: " + mLongitude);
                tempMarker();
            } else if (resultCode == AutocompleteActivity.RESULT_ERROR) {
                Status status = Autocomplete.getStatusFromIntent(data);
                Log.e(TAG, "Autocomplete error: " + status.getStatusMessage());
            } else if (resultCode == RESULT_CANCELED) {
                Log.d(TAG, "Autocomplete canceled by user");
            }
        }
    }

    private void tempMarker() {
        Log.d(TAG, "tempMarker - Lat: " + mLatitude + ", Lon: " + mLongitude);
        CameraUpdate cameraUpdate;
        LatLng coordinate = new LatLng(mLatitude, mLongitude);

        if (mMap != null) {
            MarkerOptions markerOptions;
            try {
                mMap.clear();
                if (isZooming) {
                    cameraUpdate = CameraUpdateFactory.newLatLngZoom(coordinate, mMap.getCameraPosition().zoom);
                } else {
                    cameraUpdate = CameraUpdateFactory.newLatLngZoom(coordinate, 18);
                }
                mMap.animateCamera(cameraUpdate);
                mMap.setMapType(GoogleMap.MAP_TYPE_NORMAL);
                Log.d(TAG, "Camera moved to selected location");
            } catch (Exception ex) {
                Log.e(TAG, "tempMarker error: " + ex.getMessage());
                ex.printStackTrace();
            }
        }
    }

    // Other required LocationListener methods
    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
        Log.d(TAG, "onStatusChanged - Provider: " + provider + ", Status: " + status);
    }

    @Override
    public void onProviderEnabled(@NonNull String provider) {
        Log.d(TAG, "onProviderEnabled: " + provider);
    }

    @Override
    public void onProviderDisabled(@NonNull String provider) {
        Log.d(TAG, "onProviderDisabled: " + provider);
    }

    @Override
    protected void onSaveInstanceState(@NonNull Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putDouble("latitude", mLatitude);
        outState.putDouble("longitude", mLongitude);
        outState.putString("userAddress", userAddress);
        outState.putDouble("currentLatitude", currentLatitude);
        outState.putDouble("currentLongitude", currentLongitude);
    }
}
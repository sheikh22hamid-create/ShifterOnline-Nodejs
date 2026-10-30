package com.shifter.driver.activity;

import android.graphics.Color;
import android.graphics.Typeface;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import com.google.android.gms.maps.CameraUpdateFactory;
import com.google.android.gms.maps.GoogleMap;
import com.google.android.gms.maps.MapView;
import com.google.android.gms.maps.model.BitmapDescriptorFactory;
import com.google.android.gms.maps.model.CircleOptions;
import com.google.android.gms.maps.model.LatLng;
import com.google.android.gms.maps.model.LatLngBounds;
import com.google.android.gms.maps.model.Marker;
import com.google.android.gms.maps.model.MarkerOptions;
import com.google.android.gms.maps.model.PolylineOptions;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.shifter.driver.locationservice.LocationUpdateService;
import com.shifter.driver.utility.GoToHomeClient;
import java.text.SimpleDateFormat;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Go to Home: the driver saves a home on the map and switches the mode on. The server builds the route from the
 * driver's live position, refreshes it every 2 hours and gives orders whose drop lies within 5 km of that route
 * priority in the first search batch. Enabling also switches Standard Tier ON if it was OFF (server side, once).
 */
public class GoToHomeActivity extends LocaleAwareActivity {
    private static final int TEXT_DARK = Color.rgb(15, 23, 42);
    private static final int TEXT_MUTED = Color.rgb(100, 116, 139);
    private static final int GREEN = Color.parseColor("#059669");
    private static final int ORANGE = Color.parseColor("#FF5E1E");

    private LinearLayout content;
    private TextView statusText, detailText, homeText, messageText;
    private Button saveHomeBtn, gpsBtn, toggleBtn;
    private MapView mapView;
    private GoogleMap map;
    private JsonObject state;
    private LatLng pendingHome;
    private Marker pendingMarker;
    private boolean busy;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }
    private boolean alive() { return !isFinishing() && !isDestroyed(); }

    private TextView text(String value, int sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(value);
        t.setTextSize(sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(null, Typeface.BOLD);
        return t;
    }

    private Button button(String label, View.OnClickListener l) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setOnClickListener(l);
        return b;
    }

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(Color.WHITE);
        scroll.setFitsSystemWindows(true);
        content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(16), dp(16), dp(16), dp(24));
        scroll.addView(content);
        setContentView(scroll);

        content.addView(text("Go to Home", 22, TEXT_DARK, true));
        content.addView(text("Drive home and get orders whose drop is within 5 km of your route.", 13, TEXT_MUTED, false));

        statusText = text("Loading…", 16, TEXT_DARK, true);
        statusText.setPadding(0, dp(14), 0, 0);
        content.addView(statusText);
        detailText = text("", 13, TEXT_MUTED, false);
        content.addView(detailText);
        messageText = text("", 13, Color.rgb(185, 28, 28), false);
        messageText.setPadding(0, dp(6), 0, 0);
        content.addView(messageText);

        mapView = new MapView(this);
        mapView.onCreate(null);
        LinearLayout.LayoutParams mlp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(300));
        mlp.topMargin = dp(12);
        content.addView(mapView, mlp);
        mapView.onStart();
        mapView.onResume();
        mapView.getMapAsync(g -> {
            if (!alive()) return;
            map = g;
            map.getUiSettings().setZoomControlsEnabled(true);
            mapView.setOnTouchListener((v, e) -> { v.getParent().requestDisallowInterceptTouchEvent(true); return false; });
            map.setOnMapClickListener(p -> { if (!busy) setPending(p); });
            map.setOnMarkerDragListener(new GoogleMap.OnMarkerDragListener() {
                public void onMarkerDragStart(Marker m) {}
                public void onMarkerDrag(Marker m) {}
                public void onMarkerDragEnd(Marker m) { pendingHome = m.getPosition(); updateButtons(); }
            });
            Location fix = LocationUpdateService.getLocation();
            if (fix != null && fix.hasAccuracy()) map.moveCamera(CameraUpdateFactory.newLatLngZoom(new LatLng(fix.getLatitude(), fix.getLongitude()), 12));
            draw();
        });

        homeText = text("Tap the map to choose your home, or use your current location.", 13, TEXT_DARK, false);
        homeText.setPadding(0, dp(10), 0, 0);
        content.addView(homeText);

        gpsBtn = button("📍 Use my current location", v -> {
            Location fix = LocationUpdateService.getLocation();
            if (fix == null || !fix.hasAccuracy()) { toast("Current location not available yet. Turn on GPS and retry."); return; }
            setPending(new LatLng(fix.getLatitude(), fix.getLongitude()));
            if (map != null) map.animateCamera(CameraUpdateFactory.newLatLngZoom(pendingHome, 15));
        });
        content.addView(gpsBtn);
        saveHomeBtn = button("Save home location", v -> saveHome());
        content.addView(saveHomeBtn);
        toggleBtn = button("Enable Go to Home", v -> toggle());
        content.addView(toggleBtn);

        load();
    }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }

    private void setPending(LatLng p) {
        pendingHome = p;
        if (map != null) {
            if (pendingMarker != null) pendingMarker.remove();
            pendingMarker = map.addMarker(new MarkerOptions().position(p).draggable(true).title("New home")
                    .icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_ORANGE)));
        }
        updateButtons();
    }

    private void load() {
        setBusy(true);
        GoToHomeClient.request(this, "state", null, (data, error) -> {
            if (!alive()) return;
            setBusy(false);
            if (error != null) { messageText.setText(error + "  (tap Retry)"); toggleBtn.setText("Retry"); toggleBtn.setOnClickListener(v -> load()); return; }
            apply(data);
        });
    }

    private void apply(JsonObject data) {
        state = data;
        messageText.setText("");
        toggleBtn.setOnClickListener(v -> toggle());
        render();
    }

    private boolean flag(String k) { return state != null && state.has(k) && !state.get(k).isJsonNull() && state.get(k).getAsBoolean(); }

    private String when(String key) {
        try {
            if (state == null || !state.has(key) || state.get(key).isJsonNull()) return "";
            SimpleDateFormat in = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            in.setTimeZone(TimeZone.getTimeZone("UTC"));
            java.util.Date d = in.parse(state.get(key).getAsString().substring(0, 19));
            return new SimpleDateFormat("h:mm a, d MMM", Locale.getDefault()).format(d);
        } catch (Exception e) { return ""; }
    }

    private void render() {
        boolean active = flag("active");
        if (!flag("enabled_by_admin")) {
            statusText.setText("Go to Home is not available right now");
            statusText.setTextColor(TEXT_MUTED);
        } else if (active) {
            statusText.setText("Go to Home is ON");
            statusText.setTextColor(GREEN);
        } else {
            statusText.setText("Go to Home is OFF");
            statusText.setTextColor(TEXT_DARK);
        }
        StringBuilder sb = new StringBuilder();
        if (active) {
            String next = when("next_refresh_at");
            if (!next.isEmpty()) sb.append("Route refreshes from your location at ").append(next).append("\n");
            if (flag("route_valid") && state.has("route_distance_km") && !state.get("route_distance_km").isJsonNull())
                sb.append(String.format(Locale.US, "Route to home: %.1f km\n", state.get("route_distance_km").getAsDouble()));
            else sb.append("Route is being refreshed. Priority resumes once it is ready.\n");
            if (state.has("last_refresh_status") && !state.get("last_refresh_status").isJsonNull() && !"ok".equals(state.get("last_refresh_status").getAsString()))
                sb.append("Last refresh failed. Keep GPS on; we will retry shortly.\n");
        }
        sb.append(flag("standard_tier_on") ? "Standard Tier: ON" : "Standard Tier: OFF (you can switch it ON or OFF from Home at any time)");
        detailText.setText(sb.toString());
        if (state.has("home") && !state.get("home").isJsonNull()) {
            JsonObject h = state.getAsJsonObject("home");
            String addr = h.has("address") && !h.get("address").isJsonNull() ? h.get("address").getAsString() : "";
            homeText.setText("Saved home: " + (addr.isEmpty() ? String.format(Locale.US, "%.5f, %.5f", h.get("lat").getAsDouble(), h.get("lng").getAsDouble()) : addr));
        } else {
            homeText.setText("Tap the map to choose your home, or use your current location.");
        }
        toggleBtn.setText(active ? "Disable Go to Home" : "Enable Go to Home");
        updateButtons();
        draw();
    }

    private void updateButtons() {
        saveHomeBtn.setEnabled(!busy && pendingHome != null);
        gpsBtn.setEnabled(!busy);
        toggleBtn.setEnabled(!busy && flag("enabled_by_admin"));
    }

    private void setBusy(boolean b) { busy = b; if (saveHomeBtn != null) updateButtons(); }

    private void saveHome() {
        if (busy || pendingHome == null) return;
        final LatLng p = pendingHome;
        setBusy(true);
        worker.execute(() -> {
            String address = "";
            try {
                List<Address> r = new Geocoder(this, Locale.getDefault()).getFromLocation(p.latitude, p.longitude, 1);
                if (r != null && !r.isEmpty() && r.get(0).getMaxAddressLineIndex() >= 0) address = r.get(0).getAddressLine(0);
            } catch (Exception ignored) { /* address is optional */ }
            final String addr = address == null ? "" : address;
            runOnUiThread(() -> {
                if (!alive()) return;
                JsonObject body = new JsonObject();
                body.addProperty("lat", p.latitude);
                body.addProperty("lng", p.longitude);
                body.addProperty("address", addr);
                GoToHomeClient.request(this, "save_home", body, (data, error) -> {
                    if (!alive()) return;
                    setBusy(false);
                    if (error != null) { messageText.setText(error); return; }
                    pendingHome = null;
                    if (pendingMarker != null) { pendingMarker.remove(); pendingMarker = null; }
                    apply(data);
                    toast("Home location saved");
                });
            });
        });
    }

    private void toggle() {
        if (busy || state == null) return;
        boolean active = flag("active");
        if (!active && !flag("has_home")) { toast("Save your home location first"); return; }
        setBusy(true);
        messageText.setText("");
        GoToHomeClient.request(this, active ? "disable" : "enable", null, (data, error) -> {
            if (!alive()) return;
            setBusy(false);
            if (error != null) { messageText.setText(error + "  Tap the button to retry."); updateButtons(); return; }
            apply(data);
        });
    }

    private LatLng pt(JsonElement e) {
        JsonObject o = e.getAsJsonObject();
        return new LatLng(o.get("lat").getAsDouble(), o.get("lng").getAsDouble());
    }

    private void draw() {
        if (map == null || state == null) return;
        map.clear();
        pendingMarker = null;
        LatLngBounds.Builder bounds = new LatLngBounds.Builder();
        boolean any = false;
        if (flag("route_valid") && state.has("route") && state.get("route").isJsonArray()) {
            JsonArray route = state.getAsJsonArray("route");
            if (route.size() >= 2) {
                PolylineOptions line = new PolylineOptions().color(ORANGE).width(10f);
                for (int i = 0; i < route.size(); i++) {
                    LatLng p = pt(route.get(i));
                    line.add(p);
                    bounds.include(p);
                    // 5 km corridor: a translucent circle about every 15th point of the thinned route
                    if (i % 15 == 0 || i == route.size() - 1) {
                        map.addCircle(new CircleOptions().center(p).radius(5000).strokeWidth(0f).fillColor(Color.argb(28, 255, 94, 30)));
                    }
                }
                map.addPolyline(line);
                any = true;
            }
        }
        if (state.has("home") && !state.get("home").isJsonNull()) {
            LatLng h = pt(state.get("home"));
            map.addMarker(new MarkerOptions().position(h).title("Home").icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_GREEN)));
            bounds.include(h);
            any = true;
        }
        if (state.has("current") && !state.get("current").isJsonNull() && flag("route_valid")) {
            LatLng c = pt(state.get("current"));
            map.addMarker(new MarkerOptions().position(c).title("Route started here").icon(BitmapDescriptorFactory.defaultMarker(BitmapDescriptorFactory.HUE_AZURE)));
            bounds.include(c);
        }
        if (pendingHome != null) setPending(pendingHome);
        if (any) {
            try { map.animateCamera(CameraUpdateFactory.newLatLngBounds(bounds.build(), dp(48))); } catch (Exception ignored) { /* map not laid out yet */ }
        }
    }

    @Override protected void onStart() { super.onStart(); if (mapView != null) mapView.onStart(); }
    @Override protected void onResume() { super.onResume(); if (mapView != null) mapView.onResume(); }
    @Override protected void onPause() { if (mapView != null) mapView.onPause(); super.onPause(); }
    @Override protected void onStop() { if (mapView != null) mapView.onStop(); super.onStop(); }
    @Override public void onLowMemory() { super.onLowMemory(); if (mapView != null) mapView.onLowMemory(); }

    @Override
    protected void onDestroy() {
        worker.shutdownNow();
        if (mapView != null) { mapView.onDestroy(); mapView = null; }
        super.onDestroy();
    }
}

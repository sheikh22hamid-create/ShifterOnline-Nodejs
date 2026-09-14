package com.shifter.driver.utility;

import android.content.Context;
import android.location.Location;
import android.util.Log;

import com.shifter.driver.model.MonthlyDutyStatus;

import org.json.JSONArray;
import org.json.JSONObject;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;
import retrofit2.Callback;
import retrofit2.Response;

public class MonthlyDutyManager {

    private static final String TAG = "MonthlyDutyManager";
    private static MonthlyDutyManager instance;
    private MonthlyDutyStatus currentStatus;
    private boolean isInsideZone = true;

    private MonthlyDutyManager() {}

    public static synchronized MonthlyDutyManager getInstance() {
        if (instance == null) {
            instance = new MonthlyDutyManager();
        }
        return instance;
    }

    public MonthlyDutyStatus getCurrentStatus() {
        return currentStatus;
    }

    public void setCurrentStatus(MonthlyDutyStatus status) {
        this.currentStatus = status;
    }

    public boolean isInsideZone() {
        return isInsideZone;
    }

    public void setInsideZone(boolean insideZone) {
        this.isInsideZone = insideZone;
    }

    /**
     * Checks if current location is within the assigned service zone.
     */
    public boolean checkLocationInsideZone(Location location) {
        if (currentStatus == null || currentStatus.getZone() == null || location == null) {
            this.isInsideZone = true;
            return true;
        }

        MonthlyDutyStatus.Zone zone = currentStatus.getZone();
        double lat = location.getLatitude();
        double lng = location.getLongitude();

        // 1. Polygon check if present
        if (zone.getPolygonGeojson() != null && !zone.getPolygonGeojson().trim().isEmpty()) {
            try {
                JSONArray coords = new JSONArray(zone.getPolygonGeojson());
                boolean insidePoly = isPointInPolygon(lat, lng, coords);
                this.isInsideZone = insidePoly;
                return insidePoly;
            } catch (Exception ignored) {}
        }

        // 2. Circle radius fallback
        if (zone.getCenterLat() != 0 && zone.getCenterLng() != 0) {
            float[] results = new float[1];
            Location.distanceBetween(lat, lng, zone.getCenterLat(), zone.getCenterLng(), results);
            double distKm = results[0] / 1000.0;
            boolean insideRadius = distKm <= (zone.getRadiusKm() > 0 ? zone.getRadiusKm() : 5.0);
            this.isInsideZone = insideRadius;
            return insideRadius;
        }

        this.isInsideZone = true;
        return true;
    }

    private boolean isPointInPolygon(double lat, double lng, JSONArray polygon) {
        if (polygon == null || polygon.length() < 3) return false;
        boolean inside = false;
        try {
            int len = polygon.length();
            for (int i = 0, j = len - 1; i < len; j = i++) {
                JSONArray ptI = polygon.getJSONArray(i);
                JSONArray ptJ = polygon.getJSONArray(j);
                double xi = ptI.getDouble(0), yi = ptI.getDouble(1);
                double xj = ptJ.getDouble(0), yj = ptJ.getDouble(1);

                boolean intersect = ((yi > lng) != (yj > lng)) &&
                        (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
        } catch (Exception ignored) {}
        return inside;
    }
}

package com.shifter.driver.locationservice;

public interface TaskLoadedCallback {
    /**
     * Called when a background task (like fetching directions/polylines) is done.
     * The implementation (e.g. an Activity) expects values[0] to contain a PolylineOptions.
     */
    void onTaskDone(Object... values);
}

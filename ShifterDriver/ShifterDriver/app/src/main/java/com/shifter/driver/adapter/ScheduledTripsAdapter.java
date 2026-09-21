package com.shifter.driver.adapter;

import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.R;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Binds the driver-facing list of upcoming booking_type=2 scheduled trips
 * (Task 6's /rider/scheduled-trips response) and lets the driver toggle
 * non-binding "interest" ahead of time — see docs/superpowers/specs/
 * 2026-09-21-scheduled-order-priority-dispatch-design.md §8.
 */
public class ScheduledTripsAdapter extends RecyclerView.Adapter<ScheduledTripsAdapter.ViewHolder> {

    public interface OnInterestToggle {
        void onToggle(JSONObject trip, boolean nowInterested);
    }

    private final List<JSONObject> trips = new ArrayList<>();
    private final OnInterestToggle listener;

    public ScheduledTripsAdapter(OnInterestToggle listener) {
        this.listener = listener;
    }

    public void setTrips(List<JSONObject> newTrips) {
        trips.clear();
        trips.addAll(newTrips);
        notifyDataSetChanged();
    }

    /**
     * Reverts a single row's optimistic "is_interested" flip after a failed
     * network call, without needing the full list re-fetched.
     */
    public void revertInterest(JSONObject trip, boolean revertedValue) {
        int index = trips.indexOf(trip);
        if (index == -1) {
            // JSONObject has no equals() override, so fall back to matching by id.
            String targetId = trip.optString("id", "");
            for (int i = 0; i < trips.size(); i++) {
                if (targetId.equals(trips.get(i).optString("id", ""))) {
                    index = i;
                    break;
                }
            }
        }
        if (index == -1) return;
        try {
            trips.get(index).put("is_interested", revertedValue ? "1" : "0");
        } catch (Exception ignored) {}
        notifyItemChanged(index);
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_scheduled_trip, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        JSONObject trip = trips.get(position);
        holder.scheduleTime.setText(trip.optString("schedule_date_time", ""));
        holder.pickup.setText(trip.optString("pickup_address", ""));
        holder.fare.setText("₹" + trip.optString("estimated_fare", "0"));

        boolean interested = "1".equals(trip.optString("is_interested", "0"));
        holder.interestToggle.setText(interested ? "Interested ✓" : "I'm Interested");
        holder.interestToggle.setOnClickListener(v -> {
            boolean nowInterested = !interested;
            try {
                trip.put("is_interested", nowInterested ? "1" : "0");
            } catch (Exception ignored) {}
            holder.interestToggle.setText(nowInterested ? "Interested ✓" : "I'm Interested");
            if (listener != null) listener.onToggle(trip, nowInterested);
        });
    }

    @Override
    public int getItemCount() {
        return trips.size();
    }

    static class ViewHolder extends RecyclerView.ViewHolder {
        final TextView scheduleTime;
        final TextView pickup;
        final TextView fare;
        final Button interestToggle;

        ViewHolder(@NonNull View itemView) {
            super(itemView);
            scheduleTime = itemView.findViewById(R.id.txt_schedule_time);
            pickup = itemView.findViewById(R.id.txt_pickup);
            fare = itemView.findViewById(R.id.txt_fare);
            interestToggle = itemView.findViewById(R.id.btn_interest_toggle);
        }
    }
}

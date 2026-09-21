package com.shifter.driver.adapter;

import android.content.Context;
import android.graphics.Color;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.R;
import com.shifter.driver.model.LeadItem;

import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

public class SubmittedLeadsAdapter extends RecyclerView.Adapter<SubmittedLeadsAdapter.LeadViewHolder> {

    private final Context context;
    private final List<LeadItem> leads = new ArrayList<>();

    public SubmittedLeadsAdapter(Context context) {
        this.context = context;
    }

    public void setLeads(List<LeadItem> newLeads) {
        leads.clear();
        if (newLeads != null) {
            leads.addAll(newLeads);
        }
        notifyDataSetChanged();
    }

    @NonNull
    @Override
    public LeadViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(context).inflate(R.layout.item_submitted_lead, parent, false);
        return new LeadViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull LeadViewHolder holder, int position) {
        LeadItem lead = leads.get(position);

        String name = lead.getName().isEmpty() ? lead.getPhone() : lead.getName();
        holder.txtName.setText(name);

        // Format phone nicely: e.g. 98765 43210
        String p = lead.getPhone();
        if (p != null && p.length() == 10) {
            p = p.substring(0, 5) + " " + p.substring(5);
        }
        holder.txtPhone.setText(p != null ? p : "");

        // Avatar initial
        String initial = "L";
        if (!name.isEmpty()) {
            initial = name.substring(0, 1).toUpperCase(Locale.ROOT);
        }
        holder.txtAvatar.setText(initial);

        // Category badge (Customer vs Driver Partner)
        boolean isDriver = "driver".equalsIgnoreCase(lead.getLeadType());
        if (holder.txtLeadTypeBadge != null) {
            if (isDriver) {
                holder.txtLeadTypeBadge.setText("🚚 Driver");
                holder.txtLeadTypeBadge.setBackground(ContextCompat.getDrawable(context, R.drawable.bg_badge_lead_driver));
                holder.txtLeadTypeBadge.setTextColor(Color.parseColor("#7C3AED"));
            } else {
                holder.txtLeadTypeBadge.setText("👤 Customer");
                holder.txtLeadTypeBadge.setBackground(ContextCompat.getDrawable(context, R.drawable.bg_badge_lead_customer));
                holder.txtLeadTypeBadge.setTextColor(Color.parseColor("#1D4ED8"));
            }
        }

        // Date formatting
        String formattedDate = formatDate(lead.getSubmittedAt());
        holder.txtDate.setText(formattedDate);

        // Status badge configuration
        String status = lead.getStatus().toLowerCase(Locale.ROOT);
        switch (status) {
            case "verified":
                holder.txtStatusBadge.setText("✓ Verified");
                holder.txtStatusBadge.setBackground(ContextCompat.getDrawable(context, R.drawable.bg_badge_verified));
                holder.txtStatusBadge.setTextColor(Color.parseColor("#2563EB"));
                holder.txtDesc.setText("Verified! Reward credited on 1st ride & you become favorite driver.");
                break;

            case "converted":
                holder.txtStatusBadge.setText("🎉 Rewarded");
                holder.txtStatusBadge.setBackground(ContextCompat.getDrawable(context, R.drawable.bg_badge_green_light));
                holder.txtStatusBadge.setTextColor(Color.parseColor("#16A34A"));
                holder.txtDesc.setText("1st Ride completed! Reward points added & Favorite Driver active.");
                break;

            case "rejected":
                holder.txtStatusBadge.setText("✕ Rejected");
                holder.txtStatusBadge.setBackground(ContextCompat.getDrawable(context, R.drawable.bg_badge_rejected));
                holder.txtStatusBadge.setTextColor(Color.parseColor("#DC2626"));
                holder.txtDesc.setText("Number could not be verified by ops team.");
                break;

            case "expired":
                holder.txtStatusBadge.setText("⌛ Expired");
                holder.txtStatusBadge.setBackground(ContextCompat.getDrawable(context, R.drawable.bg_badge_expired));
                holder.txtStatusBadge.setTextColor(Color.parseColor("#64748B"));
                holder.txtDesc.setText("Lead verification window expired before registration.");
                break;

            case "pending":
            default:
                holder.txtStatusBadge.setText("⏳ Pending");
                holder.txtStatusBadge.setBackground(ContextCompat.getDrawable(context, R.drawable.bg_badge_pending));
                holder.txtStatusBadge.setTextColor(Color.parseColor("#D97706"));
                holder.txtDesc.setText("Verification pending. Our ops team will call this contact.");
                break;
        }
    }

    @Override
    public int getItemCount() {
        return leads.size();
    }

    private String formatDate(String isoDate) {
        if (isoDate == null || isoDate.isEmpty()) return "";
        try {
            SimpleDateFormat inputFormat = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            inputFormat.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date date = inputFormat.parse(isoDate);
            if (date == null) {
                // Try fallback without millis
                SimpleDateFormat inputFormat2 = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
                inputFormat2.setTimeZone(TimeZone.getTimeZone("UTC"));
                date = inputFormat2.parse(isoDate);
            }
            if (date != null) {
                SimpleDateFormat outFormat = new SimpleDateFormat("dd MMM yyyy", Locale.getDefault());
                return outFormat.format(date);
            }
        } catch (Exception e) {
            // If parsing fails, return first 10 characters (YYYY-MM-DD)
            if (isoDate.length() >= 10) {
                return isoDate.substring(0, 10);
            }
        }
        return isoDate;
    }

    static class LeadViewHolder extends RecyclerView.ViewHolder {
        TextView txtAvatar, txtName, txtLeadTypeBadge, txtPhone, txtStatusBadge, txtDesc, txtDate;

        LeadViewHolder(@NonNull View itemView) {
            super(itemView);
            txtAvatar = itemView.findViewById(R.id.txt_lead_avatar);
            txtName = itemView.findViewById(R.id.txt_lead_name);
            txtLeadTypeBadge = itemView.findViewById(R.id.txt_lead_type_badge);
            txtPhone = itemView.findViewById(R.id.txt_lead_phone);
            txtStatusBadge = itemView.findViewById(R.id.txt_lead_status_badge);
            txtDesc = itemView.findViewById(R.id.txt_lead_desc);
            txtDate = itemView.findViewById(R.id.txt_lead_date);
        }
    }
}

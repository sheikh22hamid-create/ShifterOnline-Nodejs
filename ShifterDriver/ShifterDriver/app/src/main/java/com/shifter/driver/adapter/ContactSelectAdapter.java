package com.shifter.driver.adapter;

import android.content.Context;
import android.graphics.Color;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.R;
import com.shifter.driver.model.ContactItem;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public class ContactSelectAdapter extends RecyclerView.Adapter<ContactSelectAdapter.ContactViewHolder> {

    public interface OnSelectionChangeListener {
        void onSelectionChanged(int selectedCount);
    }

    private final Context context;
    private final List<ContactItem> originalList = new ArrayList<>();
    private final List<ContactItem> filteredList = new ArrayList<>();
    private final OnSelectionChangeListener listener;

    // Pastel palette for contact avatar initials
    private static final int[] AVATAR_COLORS = new int[]{
            Color.parseColor("#5B2EE8"),
            Color.parseColor("#2563EB"),
            Color.parseColor("#059669"),
            Color.parseColor("#D97706"),
            Color.parseColor("#DC2626"),
            Color.parseColor("#7C3AED"),
            Color.parseColor("#0891B2")
    };

    public ContactSelectAdapter(Context context, OnSelectionChangeListener listener) {
        this.context = context;
        this.listener = listener;
    }

    public void setContacts(List<ContactItem> contacts) {
        originalList.clear();
        filteredList.clear();
        if (contacts != null) {
            originalList.addAll(contacts);
            filteredList.addAll(contacts);
        }
        notifyDataSetChanged();
        if (listener != null) {
            listener.onSelectionChanged(getSelectedCount());
        }
    }

    public void filter(String query) {
        filteredList.clear();
        if (query == null || query.trim().isEmpty()) {
            filteredList.addAll(originalList);
        } else {
            String lower = query.trim().toLowerCase(Locale.ROOT);
            for (ContactItem item : originalList) {
                if (item.getName().toLowerCase(Locale.ROOT).contains(lower)
                        || item.getPhone().contains(lower)
                        || item.getRawPhone().contains(lower)) {
                    filteredList.add(item);
                }
            }
        }
        notifyDataSetChanged();
    }

    public void toggleSelectAll(boolean select) {
        for (ContactItem item : filteredList) {
            item.setSelected(select);
        }
        notifyDataSetChanged();
        if (listener != null) {
            listener.onSelectionChanged(getSelectedCount());
        }
    }

    public int getSelectedCount() {
        int count = 0;
        for (ContactItem item : originalList) {
            if (item.isSelected()) {
                count++;
            }
        }
        return count;
    }

    public List<ContactItem> getSelectedContacts() {
        List<ContactItem> selected = new ArrayList<>();
        for (ContactItem item : originalList) {
            if (item.isSelected()) {
                selected.add(item);
            }
        }
        return selected;
    }

    @NonNull
    @Override
    public ContactViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(context).inflate(R.layout.item_contact_lead, parent, false);
        return new ContactViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ContactViewHolder holder, int position) {
        ContactItem item = filteredList.get(position);

        holder.txtName.setText(item.getName().isEmpty() ? item.getRawPhone() : item.getName());
        holder.txtPhone.setText(item.getRawPhone());

        // Set avatar initial
        String initial = "👤";
        if (!item.getName().isEmpty()) {
            initial = item.getName().substring(0, 1).toUpperCase(Locale.ROOT);
        }
        holder.txtAvatar.setText(initial);
        int colorIndex = Math.abs((item.getName() + item.getPhone()).hashCode()) % AVATAR_COLORS.length;
        holder.txtAvatar.setTextColor(AVATAR_COLORS[colorIndex]);

        // Selection checkbox state
        if (item.isSelected()) {
            holder.imgCheck.setImageResource(R.drawable.ic_lead_checkbox_selected);
        } else {
            holder.imgCheck.setImageResource(R.drawable.ic_lead_checkbox_unselected);
        }

        holder.itemView.setOnClickListener(v -> {
            item.setSelected(!item.isSelected());
            notifyItemChanged(position);
            if (listener != null) {
                listener.onSelectionChanged(getSelectedCount());
            }
        });
    }

    @Override
    public int getItemCount() {
        return filteredList.size();
    }

    static class ContactViewHolder extends RecyclerView.ViewHolder {
        TextView txtAvatar, txtName, txtPhone;
        ImageView imgCheck;

        ContactViewHolder(@NonNull View itemView) {
            super(itemView);
            txtAvatar = itemView.findViewById(R.id.txt_avatar);
            txtName = itemView.findViewById(R.id.txt_contact_name);
            txtPhone = itemView.findViewById(R.id.txt_contact_phone);
            imgCheck = itemView.findViewById(R.id.img_check);
        }
    }
}

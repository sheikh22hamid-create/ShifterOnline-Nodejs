package com.shifter.driver.adepter;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.TextView;

import androidx.annotation.NonNull;
import androidx.recyclerview.widget.RecyclerView;

import com.shifter.driver.R;
import com.shifter.driver.model.CustomOrder;

import java.util.List;

public class CustomOrderAdapter extends RecyclerView.Adapter<CustomOrderAdapter.ViewHolder> {

    private Context context;
    private List<CustomOrder> orderList;
    private OnBidClickListener bidClickListener;

    public interface OnBidClickListener {
        void onBidClick(CustomOrder order);
    }

    public CustomOrderAdapter(Context context, List<CustomOrder> orderList, OnBidClickListener bidClickListener) {
        this.context = context;
        this.orderList = orderList;
        this.bidClickListener = bidClickListener;
    }

    @NonNull
    @Override
    public ViewHolder onCreateViewHolder(@NonNull ViewGroup parent, int viewType) {
        View view = LayoutInflater.from(context).inflate(R.layout.item_custom_order, parent, false);
        return new ViewHolder(view);
    }

    @Override
    public void onBindViewHolder(@NonNull ViewHolder holder, int position) {
        CustomOrder order = orderList.get(position);

        String orderId = order.getOrderId();
        holder.txtOrderId.setText("Order #" + (orderId != null ? orderId : (position + 1)));

        String pickup = order.getPickupAddress();
        holder.txtPickup.setText(pickup != null && !pickup.isEmpty() ? pickup : "N/A");

        String drop = order.getDropAddress();
        holder.txtDrop.setText(drop != null && !drop.isEmpty() ? drop : "N/A");

        String category = order.getCategory();
        holder.txtCategory.setText(category != null && !category.isEmpty() ? category : "N/A");

        String price = order.getPrice();
        holder.txtPrice.setText(price != null && !price.isEmpty() ? "₹" + price : "Open Bid");

        String status = order.getStatus();
        holder.txtStatus.setText(status != null && !status.isEmpty() ? status : "Pending");

        holder.btnBid.setOnClickListener(v -> {
            if (bidClickListener != null) {
                bidClickListener.onBidClick(order);
            }
        });
    }

    @Override
    public int getItemCount() {
        return orderList != null ? orderList.size() : 0;
    }

    public static class ViewHolder extends RecyclerView.ViewHolder {
        TextView txtOrderId, txtPickup, txtDrop, txtCategory, txtPrice, txtStatus;
        Button btnBid;

        public ViewHolder(@NonNull View itemView) {
            super(itemView);
            txtOrderId = itemView.findViewById(R.id.txt_custom_order_id);
            txtPickup = itemView.findViewById(R.id.txt_custom_pickup);
            txtDrop = itemView.findViewById(R.id.txt_custom_drop);
            txtCategory = itemView.findViewById(R.id.txt_custom_category);
            txtPrice = itemView.findViewById(R.id.txt_custom_price);
            txtStatus = itemView.findViewById(R.id.txt_custom_status);
            btnBid = itemView.findViewById(R.id.btn_place_bid);
        }
    }
}

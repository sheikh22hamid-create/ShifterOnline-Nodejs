package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;
import java.io.Serializable;

public class QueuedOrder implements Serializable {

    @SerializedName("id")
    private int id;

    @SerializedName("rider_id")
    private int riderId;

    @SerializedName("order_id")
    private int orderId;

    @SerializedName("queue_order")
    private int queueOrder;

    @SerializedName("status")
    private String status;

    @SerializedName("order")
    private OrderDetail order;

    public int getId() { return id; }
    public void setId(int id) { this.id = id; }
    public int getRiderId() { return riderId; }
    public void setRiderId(int riderId) { this.riderId = riderId; }
    public int getOrderId() { return orderId; }
    public void setOrderId(int orderId) { this.orderId = orderId; }
    public int getQueueOrder() { return queueOrder; }
    public void setQueueOrder(int queueOrder) { this.queueOrder = queueOrder; }
    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }
    public OrderDetail getOrder() { return order; }
    public void setOrder(OrderDetail order) { this.order = order; }

    public int getQueuePosition() {
        return queueOrder;
    }

    public double getEstimatedEarnings() {
        if (order != null && order.getTotalDcharge() != null) {
            try {
                return Double.parseDouble(order.getTotalDcharge());
            } catch (Exception ignored) {}
        }
        return 0.0;
    }

    public String getPickupAddress() {
        return order != null ? order.getPickAddress() : null;
    }

    public String getDropAddress() {
        return order != null ? order.getDropAddress() : null;
    }

    public static class OrderDetail implements Serializable {
        @SerializedName("id")
        private int id;
        @SerializedName("pick_address")
        private String pickAddress;
        @SerializedName("drop_address")
        private String dropAddress;
        @SerializedName("distance")
        private String distance;
        @SerializedName("total_dcharge")
        private String totalDcharge;

        public int getId() { return id; }
        public String getPickAddress() { return pickAddress; }
        public String getDropAddress() { return dropAddress; }
        public String getDistance() { return distance; }
        public String getTotalDcharge() { return totalDcharge; }
    }
}

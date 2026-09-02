package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

public class CustomOrder {

    @SerializedName("id")
    @Expose
    private String id;

    @SerializedName("order_id")
    @Expose
    private String orderId;

    @SerializedName("pickup_address")
    @Expose
    private String pickupAddress;

    @SerializedName("drop_address")
    @Expose
    private String dropAddress;

    @SerializedName("category")
    @Expose
    private String category;

    @SerializedName("price")
    @Expose
    private String price;

    @SerializedName("status")
    @Expose
    private String status;

    @SerializedName("distance")
    @Expose
    private String distance;

    @SerializedName("note")
    @Expose
    private String note;

    @SerializedName("created_at")
    @Expose
    private String createdAt;

    // Getters
    public String getId() { return id; }
    public String getOrderId() { return orderId != null ? orderId : id; }
    public String getPickupAddress() { return pickupAddress; }
    public String getDropAddress() { return dropAddress; }
    public String getCategory() { return category; }
    public String getPrice() { return price; }
    public String getStatus() { return status; }
    public String getDistance() { return distance; }
    public String getNote() { return note; }
    public String getCreatedAt() { return createdAt; }

    // Setters
    public void setId(String id) { this.id = id; }
    public void setOrderId(String orderId) { this.orderId = orderId; }
    public void setPickupAddress(String pickupAddress) { this.pickupAddress = pickupAddress; }
    public void setDropAddress(String dropAddress) { this.dropAddress = dropAddress; }
    public void setCategory(String category) { this.category = category; }
    public void setPrice(String price) { this.price = price; }
    public void setStatus(String status) { this.status = status; }
    public void setDistance(String distance) { this.distance = distance; }
    public void setNote(String note) { this.note = note; }
    public void setCreatedAt(String createdAt) { this.createdAt = createdAt; }
}

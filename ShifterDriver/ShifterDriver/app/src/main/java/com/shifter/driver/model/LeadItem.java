package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

public class LeadItem {

    @SerializedName("id")
    @Expose
    private int id;

    @SerializedName("driver_id")
    @Expose
    private int driverId;

    @SerializedName("name")
    @Expose
    private String name;

    @SerializedName("phone")
    @Expose
    private String phone;

    @SerializedName("status")
    @Expose
    private String status; // pending, verified, rejected, converted, expired

    @SerializedName("submitted_at")
    @Expose
    private String submittedAt;

    @SerializedName("verified_at")
    @Expose
    private String verifiedAt;

    @SerializedName("expires_at")
    @Expose
    private String expiresAt;

    @SerializedName("converted_at")
    @Expose
    private String convertedAt;

    @SerializedName("lead_type")
    @Expose
    private String leadType; // customer or driver

    public LeadItem() {
    }

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public int getDriverId() {
        return driverId;
    }

    public void setDriverId(int driverId) {
        this.driverId = driverId;
    }

    public String getName() {
        return name != null ? name : "";
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getPhone() {
        return phone != null ? phone : "";
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getStatus() {
        return status != null ? status : "pending";
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getSubmittedAt() {
        return submittedAt;
    }

    public void setSubmittedAt(String submittedAt) {
        this.submittedAt = submittedAt;
    }

    public String getVerifiedAt() {
        return verifiedAt;
    }

    public void setVerifiedAt(String verifiedAt) {
        this.verifiedAt = verifiedAt;
    }

    public String getExpiresAt() {
        return expiresAt;
    }

    public void setExpiresAt(String expiresAt) {
        this.expiresAt = expiresAt;
    }

    public String getConvertedAt() {
        return convertedAt;
    }

    public void setConvertedAt(String convertedAt) {
        this.convertedAt = convertedAt;
    }

    public String getLeadType() {
        return leadType != null && !leadType.trim().isEmpty() ? leadType : "customer";
    }

    public void setLeadType(String leadType) {
        this.leadType = leadType;
    }
}

package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

import java.util.List;

public class DriverPremiumPlan {

    @SerializedName("plan_id")
    private int planId;

    @SerializedName("plan_name")
    private String planName;

    @SerializedName("plan_type")
    private String planType;

    @SerializedName("plan_type_label")
    private String planTypeLabel;

    @SerializedName("plan_for")
    private String planFor;

    @SerializedName("expire_date")
    private String expireDate;

    @SerializedName("days_left")
    private int daysLeft;

    @SerializedName("validity_label")
    private String validityLabel;

    @SerializedName("is_popular")
    private boolean isPopular;

    @SerializedName("is_active")
    private boolean isActive;

    @SerializedName("description")
    private String description;

    @SerializedName("commission_percent")
    private double commissionPercent;

    @SerializedName("per_trip_charge")
    private double perTripCharge;

    @SerializedName("price_info")
    private PriceInfo priceInfo;

    @SerializedName("refer_and_earn")
    private ReferAndEarn referAndEarn;

    @SerializedName("purchase_info")
    private PurchaseInfo purchaseInfo;

    /** ui_tags is now top-level (was inside benefits before) */
    @SerializedName("ui_tags")
    private List<String> uiTags;

    // ---- Getters ----
    public int getPlanId()              { return planId; }
    public String getPlanName()         { return planName; }
    public String getPlanType()         { return planType; }
    public String getPlanTypeLabel()    { return planTypeLabel; }
    public String getPlanFor()          { return planFor; }
    public String getExpireDate()       { return expireDate; }
    public int getDaysLeft()            { return daysLeft; }
    public String getValidityLabel()    { return validityLabel; }
    public boolean isPopular()          { return isPopular; }
    public boolean isActive()           { return isActive; }
    public String getDescription()      { return description; }
    public double getCommissionPercent(){ return commissionPercent; }
    public double getPerTripCharge()    { return perTripCharge; }
    public PriceInfo getPriceInfo()     { return priceInfo; }
    public ReferAndEarn getReferAndEarn(){ return referAndEarn; }
    public PurchaseInfo getPurchaseInfo(){ return purchaseInfo; }
    public List<String> getUiTags()     { return uiTags; }

    // ---- Nested: PriceInfo ----
    public static class PriceInfo {
        @SerializedName("price")
        private double price;

        @SerializedName("currency_symbol")
        private String currencySymbol;

        public double getPrice()            { return price; }
        public String getCurrencySymbol()   { return currencySymbol != null ? currencySymbol : "₹"; }
    }

    // ---- Nested: ReferAndEarn ----
    public static class ReferAndEarn {
        @SerializedName("points_per_referral")
        private int pointsPerReferral;

        @SerializedName("point_value")
        private double pointValue;

        @SerializedName("number_of_referrals")
        private int numberOfReferrals;

        @SerializedName("auto_activate")
        private boolean autoActivate;

        @SerializedName("note")
        private String note;

        public int getPointsPerReferral()   { return pointsPerReferral; }
        public double getPointValue()       { return pointValue; }
        public int getNumberOfReferrals()   { return numberOfReferrals; }
        public boolean isAutoActivate()     { return autoActivate; }
        public String getNote()             { return note; }
    }

    // ---- Nested: PurchaseInfo ----
    public static class PurchaseInfo {
        @SerializedName("point_value")
        private double pointValue;

        @SerializedName("points_available")
        private int pointsAvailable;

        @SerializedName("points_required")
        private int pointsRequired;

        @SerializedName("points_usable")
        private int pointsUsable;

        @SerializedName("points_covered_amount")
        private double pointsCoveredAmount;

        @SerializedName("payable_amount")
        private double payableAmount;

        @SerializedName("can_buy_with_points")
        private boolean canBuyWithPoints;

        public double getPointValue()           { return pointValue; }
        public int getPointsAvailable()         { return pointsAvailable; }
        public int getPointsRequired()          { return pointsRequired; }
        public int getPointsUsable()            { return pointsUsable; }
        public double getPointsCoveredAmount()  { return pointsCoveredAmount; }
        public double getPayableAmount()        { return payableAmount; }
        public boolean canBuyWithPoints()       { return canBuyWithPoints; }
    }
}

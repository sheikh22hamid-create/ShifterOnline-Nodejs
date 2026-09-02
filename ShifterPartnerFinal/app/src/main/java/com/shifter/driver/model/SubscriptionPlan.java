package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

public class SubscriptionPlan {

    @SerializedName("id")
    private String id;

    @SerializedName("screen_show")
    private String screenShow;

    @SerializedName("title")
    private String title;

    @SerializedName("subtitle")
    private String subtitle;

    @SerializedName("description")
    private String description;

    @SerializedName("price")
    private String price;

    @SerializedName("discount_price")
    private String discountPrice;

    @SerializedName("benefit_1")
    private String benefit1;

    @SerializedName("benefit_2")
    private String benefit2;

    @SerializedName("benefit_3")
    private String benefit3;

    @SerializedName("benefit_4")
    private String benefit4;

    @SerializedName("plan_for")
    private String planFor;

    public String getId() { return id; }
    public String getScreenShow() { return screenShow; }
    public String getTitle() { return title; }
    public String getSubtitle() { return subtitle; }
    public String getDescription() { return description; }
    public String getPrice() { return price; }
    public String getDiscountPrice() { return discountPrice; }
    public String getBenefit1() { return benefit1; }
    public String getBenefit2() { return benefit2; }
    public String getBenefit3() { return benefit3; }
    public String getBenefit4() { return benefit4; }
    public String getPlanFor() { return planFor; }
}

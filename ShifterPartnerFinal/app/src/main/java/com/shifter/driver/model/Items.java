package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

import java.util.List;

public class Items {

    @SerializedName("item_title")
    @Expose
    private String itemTitle;
    @SerializedName("quantity")
    @Expose
    private String quantity;
    @SerializedName("item_img")
    @Expose
    private List<String> itemImg = null;
    @SerializedName("item_total")
    @Expose
    private Object itemTotal;
    @SerializedName("item_confirm")
    @Expose
    private String itemConfirm;

    public String getItemTitle() {
        return itemTitle;
    }

    public void setItemTitle(String itemTitle) {
        this.itemTitle = itemTitle;
    }

    public String getQuantity() {
        return quantity;
    }

    public void setQuantity(String quantity) {
        this.quantity = quantity;
    }

    public List<String> getItemImg() {
        return itemImg;
    }

    public void setItemImg(List<String> itemImg) {
        this.itemImg = itemImg;
    }

    public Object getItemTotal() {
        return itemTotal;
    }

    public void setItemTotal(Object itemTotal) {
        this.itemTotal = itemTotal;
    }

    public String getItemConfirm() {
        return itemConfirm;
    }

    public void setItemConfirm(String itemConfirm) {
        this.itemConfirm = itemConfirm;
    }

}
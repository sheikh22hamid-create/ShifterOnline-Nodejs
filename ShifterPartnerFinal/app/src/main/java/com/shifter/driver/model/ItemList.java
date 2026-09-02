package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

import java.util.List;

public class ItemList {

    @SerializedName("item_list")
    @Expose
    private List<Itemimg> itemList = null;

    public List<Itemimg> getItemList() {
        return itemList;
    }

    public void setItemList(List<Itemimg> itemList) {
        this.itemList = itemList;
    }

}
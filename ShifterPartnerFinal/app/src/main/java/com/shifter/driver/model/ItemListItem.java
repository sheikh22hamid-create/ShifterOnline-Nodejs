package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

import java.util.List;

public class ItemListItem {

	@SerializedName("quantity")
	private String quantity;

	@SerializedName("item_img")
	private List<String> itemImg;

	@SerializedName("item_total")
	private Object itemTotal;

	@SerializedName("item_title")
	private String itemTitle;

	@SerializedName("item_confirm")
	private String itemConfirm;

	public String getQuantity(){
		return quantity;
	}

	public List<String> getItemImg(){
		return itemImg;
	}

	public Object getItemTotal(){
		return itemTotal;
	}

	public String getItemTitle(){
		return itemTitle;
	}

	public String getItemConfirm(){
		return itemConfirm;
	}
}
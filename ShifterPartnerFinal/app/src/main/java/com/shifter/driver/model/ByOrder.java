package com.shifter.driver.model;

import java.util.List;
import com.google.gson.annotations.SerializedName;

public class ByOrder{

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("BuyOrderHistory")
	private List<BuyOrderHistoryItem> buyOrderHistory;

	@SerializedName("BuyOrderDetails")
	private BuyOrderHistoryItem item;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("Result")
	private String result;

	public String getResponseCode(){
		return responseCode;
	}

	public List<BuyOrderHistoryItem> getBuyOrderHistory(){
		return buyOrderHistory;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public String getResult(){
		return result;
	}

	public BuyOrderHistoryItem getItem() {
		return item;
	}

	public void setItem(BuyOrderHistoryItem item) {
		this.item = item;
	}
}
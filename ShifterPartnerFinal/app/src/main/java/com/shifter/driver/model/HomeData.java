package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

public class HomeData{

	@SerializedName("today_order")
	private int pastTotalComplete;

	@SerializedName("today_earning")
	private double pastMonthEarning;

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("current_star")
	private String currentStar;

	@SerializedName("month_order")
	private int currentTotalComplete;

	@SerializedName("BuyOrderHistory")
	private BuyOrderHistoryItem buyOrderHistory;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("reject_timer")
	private String rejectTimer;

	@SerializedName("month_earning")
	private double currentMonthEarning;

	@SerializedName("past_star")
	private String pastStar;

	@SerializedName("OrderHistory")
	private PDOrderItem orderHistory;

	@SerializedName("Result")
	private String result;

	@SerializedName(value = "Online", alternate = {"online", "is_online", "isOnline"})
	private boolean isOnline;

	@SerializedName("device_match")
	private boolean deviceMatch = true;

	@SerializedName(value = "isHowUse", alternate = {"isHowUse ", "is_how_use"})
	private boolean isHowUse = true;

	public int getPastTotalComplete(){
		return pastTotalComplete;
	}

	public double getPastMonthEarning(){
		return pastMonthEarning;
	}

	public String getResponseCode(){
		return responseCode;
	}

	public String getCurrentStar(){
		return currentStar;
	}

	public int getCurrentTotalComplete(){
		return currentTotalComplete;
	}

	public BuyOrderHistoryItem getBuyOrderHistory(){
		return buyOrderHistory;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public double getCurrentMonthEarning(){
		return currentMonthEarning;
	}

	public String getPastStar(){
		return pastStar;
	}

	public PDOrderItem getOrderHistory(){
		return orderHistory;
	}

	public String getResult(){
		return result;
	}

	public String getRejectTimer(){
		return rejectTimer;
	}

	public boolean isOnline() {
		return isOnline;
	}

	public boolean isDeviceMatch() {
		return deviceMatch;
	}

	public boolean isHowUse() {
		return isHowUse;
	}
}
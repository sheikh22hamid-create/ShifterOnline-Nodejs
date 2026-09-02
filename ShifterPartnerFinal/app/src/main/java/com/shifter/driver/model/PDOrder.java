package com.shifter.driver.model;

import java.util.List;
import com.google.gson.annotations.SerializedName;

public class PDOrder{

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("OrderHistory")
	private List<PDOrderItem> orderHistory;

	@SerializedName("Result")
	private String result;

	@SerializedName("advance_payment_msg")
	private String advancePaymentMsg;

	@SerializedName("advance_payment_timer")
	private String advancePaymentTimer;

	public String getResponseCode(){
		return responseCode;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public List<PDOrderItem> getOrderHistory(){
		return orderHistory;
	}

	public String getResult(){
		return result;
	}

	public String getAdvancePaymentMsg() {
		return advancePaymentMsg;
	}

	public String getAdvancePaymentTimer() {
		return advancePaymentTimer;
	}
}
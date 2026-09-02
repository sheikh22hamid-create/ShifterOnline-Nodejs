package com.shifter.driver.model;

import java.util.List;
import com.google.gson.annotations.SerializedName;

public class Notification{

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("NotificationData")
	private List<NotificationDataItem> notificationData;

	@SerializedName("Result")
	private String result;

	public String getResponseCode(){
		return responseCode;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public List<NotificationDataItem> getNotificationData(){
		return notificationData;
	}

	public String getResult(){
		return result;
	}
}
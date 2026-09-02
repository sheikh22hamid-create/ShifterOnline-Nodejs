package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

public class NotificationDataItem{

	@SerializedName("msg")
	private String msg;

	@SerializedName("date")
	private String date;

	@SerializedName("type")
	private String type;

	@SerializedName("title")
	private String title;

	@SerializedName("id")
	private String id;

	@SerializedName("rid")
	private String rid;

	public String getMsg(){
		return msg;
	}

	public String getDate(){
		return date;
	}

	public String getId(){
		return id;
	}

	public String getRid(){
		return rid;
	}

	public String getType() {
		return type;
	}

	public String getTitle() {
		return title;
	}
}
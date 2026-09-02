package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

public class CodeItem {

	@SerializedName("ccode")
	private String ccode;

	@SerializedName("id")
	private String id;

	@SerializedName("status")
	private String status;

	public String getCcode(){
		return ccode;
	}

	public String getId(){
		return id;
	}

	public String getStatus(){
		return status;
	}
}
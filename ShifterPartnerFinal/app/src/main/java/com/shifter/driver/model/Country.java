package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

import java.util.List;

public class Country{

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("CountryCode")
	private List<CodeItem> countryCode;

	@SerializedName("Result")
	private String result;

	public String getResponseCode(){
		return responseCode;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public List<CodeItem> getCountryCode(){
		return countryCode;
	}

	public String getResult(){
		return result;
	}
}
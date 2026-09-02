package com.shifter.driver.model;

import java.util.List;
import com.google.gson.annotations.SerializedName;

public class City{

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("CityList")
	private List<CityListItem> cityList;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("Result")
	private String result;

	public void setResponseCode(String responseCode){
		this.responseCode = responseCode;
	}

	public String getResponseCode(){
		return responseCode;
	}

	public void setCityList(List<CityListItem> cityList){
		this.cityList = cityList;
	}

	public List<CityListItem> getCityList(){
		return cityList;
	}

	public void setResponseMsg(String responseMsg){
		this.responseMsg = responseMsg;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public void setResult(String result){
		this.result = result;
	}

	public String getResult(){
		return result;
	}
}
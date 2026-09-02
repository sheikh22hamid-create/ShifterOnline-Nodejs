package com.shifter.driver.model;

import java.util.List;
import com.google.gson.annotations.SerializedName;

public class Survery{

	@SerializedName("SurveryList")
	private List<SurveryListItem> surveryList;

	@SerializedName("totalquestion")
	private int totalquestion;

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("Result")
	private String result;

	public void setSurveryList(List<SurveryListItem> surveryList){
		this.surveryList = surveryList;
	}

	public List<SurveryListItem> getSurveryList(){
		return surveryList;
	}

	public void setTotalquestion(int totalquestion){
		this.totalquestion = totalquestion;
	}

	public int getTotalquestion(){
		return totalquestion;
	}

	public void setResponseCode(String responseCode){
		this.responseCode = responseCode;
	}

	public String getResponseCode(){
		return responseCode;
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
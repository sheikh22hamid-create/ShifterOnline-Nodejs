package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

public class RestResponse{

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("Result")
	private String result;

	@SerializedName("Next_step")
	private String NextStep;
	public String getResponseCode(){
		return responseCode;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public String getResult(){
		return result;
	}

	public String getNextStep() {
		return NextStep;
	}

	public void setNextStep(String nextStep) {
		NextStep = nextStep;
	}
}
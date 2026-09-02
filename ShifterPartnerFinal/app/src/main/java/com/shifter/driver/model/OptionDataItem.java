package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;

public class OptionDataItem{

	@SerializedName("option_title")
	private String optionTitle;

	@SerializedName("option_id")
	private String optionId;

	@SerializedName("question_id")
	private String questionId;


	private boolean isSelect;

	public void setOptionTitle(String optionTitle){
		this.optionTitle = optionTitle;
	}

	public String getOptionTitle(){
		return optionTitle;
	}

	public void setOptionId(String optionId){
		this.optionId = optionId;
	}

	public String getOptionId(){
		return optionId;
	}

	public void setQuestionId(String questionId){
		this.questionId = questionId;
	}

	public String getQuestionId(){
		return questionId;
	}

	public boolean isSelect() {
		return isSelect;
	}

	public void setSelect(boolean select) {
		isSelect = select;
	}
}
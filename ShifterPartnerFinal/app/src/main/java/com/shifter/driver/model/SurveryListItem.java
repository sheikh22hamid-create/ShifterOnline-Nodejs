package com.shifter.driver.model;

import java.util.List;
import com.google.gson.annotations.SerializedName;

public class SurveryListItem{

	@SerializedName("question_type")
	private String questionType;

	@SerializedName("question_title")
	private String questionTitle;

	@SerializedName("option_data")
	private List<OptionDataItem> optionData;

	public void setQuestionType(String questionType){
		this.questionType = questionType;
	}

	public String getQuestionType(){
		return questionType;
	}

	public void setQuestionTitle(String questionTitle){
		this.questionTitle = questionTitle;
	}

	public String getQuestionTitle(){
		return questionTitle;
	}

	public void setOptionData(List<OptionDataItem> optionData){
		this.optionData = optionData;
	}

	public List<OptionDataItem> getOptionData(){
		return optionData;
	}
}
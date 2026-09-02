package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;

import java.util.ArrayList;

import com.google.gson.annotations.SerializedName;

public class DocumentV implements Parcelable {

	@SerializedName("personal_doc")
	private int personalDoc;

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("dynamic_question")
	private DynamicQuestion dynamicQuestion;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("contact_status")
	private int contactStatus;

	@SerializedName("address_status")
	private int addressStatus;

	@SerializedName("Result")
	private String result;

	@SerializedName("vehicle_list")
	private ArrayList<VehicleListItem> vehicleList;

	@SerializedName("kit_status")
	private int kitStatus;

	@SerializedName("lic_status")
	private int licStatus;

	@SerializedName("residence_status")
	private int residenceStatus;

	@SerializedName("bank_status")
	private int bankStatus;

	@SerializedName("vehicle_status")
	private int vehicleStatus;

	@SerializedName("add_info")
	private int addInfo;

	@SerializedName("survey_status")
	private int surveyStatus;

	@SerializedName("dynamic_question_status")
	private int dynamicQuestionStatus;

	@SerializedName("bycle_status")
	private int bycleStatus;


	// ✅ ADD THIS
	public DocumentV() {
		// empty constructor
	}

	protected DocumentV(Parcel in) {
		personalDoc = in.readInt();
		responseCode = in.readString();
		responseMsg = in.readString();
		contactStatus = in.readInt();
		addressStatus = in.readInt();
		result = in.readString();
		kitStatus = in.readInt();
		licStatus = in.readInt();
		residenceStatus = in.readInt();
		bankStatus = in.readInt();
		vehicleStatus = in.readInt();
		addInfo = in.readInt();
		surveyStatus = in.readInt();
		dynamicQuestionStatus = in.readInt();
		bycleStatus = in.readInt();
	}

	public static final Creator<DocumentV> CREATOR = new Creator<DocumentV>() {
		@Override
		public DocumentV createFromParcel(Parcel in) {
			return new DocumentV(in);
		}

		@Override
		public DocumentV[] newArray(int size) {
			return new DocumentV[size];
		}
	};

	public int getPersonalDoc(){
		return personalDoc;
	}

	public String getResponseCode(){
		return responseCode;
	}

	public DynamicQuestion getDynamicQuestion(){
		return dynamicQuestion;
	}

	public String getResponseMsg(){
		return responseMsg;
	}

	public int getContactStatus(){
		return contactStatus;
	}

	public int getAddressStatus(){
		return addressStatus;
	}

	public String getResult(){
		return result;
	}

	public ArrayList<VehicleListItem> getVehicleList(){
		return vehicleList;
	}

	public int getKitStatus(){
		return kitStatus;
	}

	public int getLicStatus(){
		return licStatus;
	}

	public int getResidenceStatus(){
		return residenceStatus;
	}

	public int getBankStatus(){
		return bankStatus;
	}

	public int getVehicleStatus(){
		return vehicleStatus;
	}

	public int getAddInfo(){
		return addInfo;
	}

	public int getSurveyStatus(){
		return surveyStatus;
	}

	public int getDynamicQuestionStatus(){
		return dynamicQuestionStatus;
	}

	public int getBycleStatus(){
		return bycleStatus;
	}

	@Override
	public int describeContents() {
		return 0;
	}

	@Override
	public void writeToParcel(Parcel parcel, int i) {
		parcel.writeInt(personalDoc);
		parcel.writeString(responseCode);
		parcel.writeString(responseMsg);
		parcel.writeInt(contactStatus);
		parcel.writeInt(addressStatus);
		parcel.writeString(result);
		parcel.writeInt(kitStatus);
		parcel.writeInt(licStatus);
		parcel.writeInt(residenceStatus);
		parcel.writeInt(bankStatus);
		parcel.writeInt(vehicleStatus);
		parcel.writeInt(addInfo);
		parcel.writeInt(surveyStatus);
		parcel.writeInt(dynamicQuestionStatus);
		parcel.writeInt(bycleStatus);
	}

	public void setPersonalDoc(int personalDoc) {
		this.personalDoc = personalDoc;
	}

	public void setResponseCode(String responseCode) {
		this.responseCode = responseCode;
	}

	public void setDynamicQuestion(DynamicQuestion dynamicQuestion) {
		this.dynamicQuestion = dynamicQuestion;
	}

	public void setResponseMsg(String responseMsg) {
		this.responseMsg = responseMsg;
	}

	public void setContactStatus(int contactStatus) {
		this.contactStatus = contactStatus;
	}

	public void setAddressStatus(int addressStatus) {
		this.addressStatus = addressStatus;
	}

	public void setResult(String result) {
		this.result = result;
	}

	public void setVehicleList(ArrayList<VehicleListItem> vehicleList) {
		this.vehicleList = vehicleList;
	}

	public void setKitStatus(int kitStatus) {
		this.kitStatus = kitStatus;
	}

	public void setLicStatus(int licStatus) {
		this.licStatus = licStatus;
	}

	public void setResidenceStatus(int residenceStatus) {
		this.residenceStatus = residenceStatus;
	}

	public void setBankStatus(int bankStatus) {
		this.bankStatus = bankStatus;
	}

	public void setVehicleStatus(int vehicleStatus) {
		this.vehicleStatus = vehicleStatus;
	}

	public void setAddInfo(int addInfo) {
		this.addInfo = addInfo;
	}

	public void setSurveyStatus(int surveyStatus) {
		this.surveyStatus = surveyStatus;
	}

	public void setDynamicQuestionStatus(int dynamicQuestionStatus) {
		this.dynamicQuestionStatus = dynamicQuestionStatus;
	}

	public void setBycleStatus(int bycleStatus) {
		this.bycleStatus = bycleStatus;
	}
}
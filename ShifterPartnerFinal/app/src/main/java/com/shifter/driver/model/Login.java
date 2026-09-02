package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

public class Login implements Parcelable {

	@SerializedName("ResponseCode")
	private String responseCode;

	@SerializedName("ResponseMsg")
	private String responseMsg;

	@SerializedName("mobile_exist")
	private int mobileExist;

	@SerializedName("otp")
	private int otp;

	// 🔥 Map both "rider_data" and "DriverData" to this variable for compatibility
	@SerializedName(value = "rider_data", alternate = {"DriverData"})
	@Expose
	private RiderData riderData;

	@SerializedName("Result")
	private String result;

	// 🔥 NEW: Is_New_User from your API
	@SerializedName("Is_New_User")
	private String isNewUser;

	// ============================
	// PARCEL CONSTRUCTOR
	// ============================
	protected Login(Parcel in) {
		responseCode = in.readString();
		responseMsg = in.readString();
		mobileExist = in.readInt();
		otp = in.readInt();
		result = in.readString();
		isNewUser = in.readString();
		// Parcelable objects
		riderData = in.readParcelable(RiderData.class.getClassLoader());
	}

	public static final Creator<Login> CREATOR = new Creator<Login>() {
		@Override
		public Login createFromParcel(Parcel in) {
			return new Login(in);
		}

		@Override
		public Login[] newArray(int size) {
			return new Login[size];
		}
	};

	// ============================
	// GETTERS & SETTERS
	// ============================

	public String getResponseCode() {
		return responseCode;
	}

	public void setResponseCode(String responseCode) {
		this.responseCode = responseCode;
	}

	public String getResponseMsg() {
		return responseMsg;
	}

	public void setResponseMsg(String responseMsg) {
		this.responseMsg = responseMsg;
	}

	public int getMobileExist() {
		return mobileExist;
	}

	public void setMobileExist(int mobileExist) {
		this.mobileExist = mobileExist;
	}

	public int getOtp() {
		return otp;
	}

	public void setOtp(int otp) {
		this.otp = otp;
	}

	// 🔥 OLD: getRiderData()
	public RiderData getRiderData() {
		return riderData;
	}

	public void setRiderData(RiderData riderData) {
		this.riderData = riderData;
	}

	public String getResult() {
		return result;
	}

	public void setResult(String result) {
		this.result = result;
	}

	// 🔥 NEW: getIsNewUser()
	public String getIsNewUser() {
		return isNewUser;
	}

	public void setIsNewUser(String isNewUser) {
		this.isNewUser = isNewUser;
	}

	// ============================
	// PARCELABLE METHODS
	// ============================

	@Override
	public int describeContents() {
		return 0;
	}

	@Override
	public void writeToParcel(Parcel parcel, int i) {
		parcel.writeString(responseCode);
		parcel.writeString(responseMsg);
		parcel.writeInt(mobileExist);
		parcel.writeInt(otp);
		parcel.writeString(result);
		parcel.writeString(isNewUser);
		parcel.writeParcelable(riderData, i);
	}
}
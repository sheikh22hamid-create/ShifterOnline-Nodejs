package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;

import com.google.gson.annotations.SerializedName;

public class VehicleListItem implements Parcelable {

	@SerializedName("v_img")
	private final String vImg;

	@SerializedName("v_rquired")
	private final String vRquired;

	@SerializedName("id")
	private final String id;

	@SerializedName("title")
	private final String title;

	@SerializedName("status")
	private final String status;

	protected VehicleListItem(Parcel in) {
		vImg = in.readString();
		vRquired = in.readString();
		id = in.readString();
		title = in.readString();
		status = in.readString();
	}

	public static final Creator<VehicleListItem> CREATOR = new Creator<VehicleListItem>() {
		@Override
		public VehicleListItem createFromParcel(Parcel in) {
			return new VehicleListItem(in);
		}

		@Override
		public VehicleListItem[] newArray(int size) {
			return new VehicleListItem[size];
		}
	};

	public String getVImg(){
		return vImg;
	}

	public String getVRquired(){
		return vRquired;
	}

	public String getId(){
		return id;
	}

	public String getTitle(){
		return title;
	}

	public String getStatus(){
		return status;
	}

	@Override
	public int describeContents() {
		return 0;
	}

	@Override
	public void writeToParcel(Parcel parcel, int i) {
		parcel.writeString(vImg);
		parcel.writeString(vRquired);
		parcel.writeString(id);
		parcel.writeString(title);
		parcel.writeString(status);
	}
}
package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;

import com.google.gson.annotations.SerializedName;

public class DynamicQuestion implements Parcelable {

	@SerializedName("id_status")
	private final String idStatus;

	@SerializedName("dynamic_type")
	private final String dynamicType;

	@SerializedName("question")
	private final String question;

	@SerializedName("id")
	private final String id;

	@SerializedName("title")
	private final String title;

	protected DynamicQuestion(Parcel in) {
		idStatus = in.readString();
		dynamicType = in.readString();
		question = in.readString();
		id = in.readString();
		title = in.readString();
	}

	public static final Creator<DynamicQuestion> CREATOR = new Creator<DynamicQuestion>() {
		@Override
		public DynamicQuestion createFromParcel(Parcel in) {
			return new DynamicQuestion(in);
		}

		@Override
		public DynamicQuestion[] newArray(int size) {
			return new DynamicQuestion[size];
		}
	};

	public String getIdStatus(){
		return idStatus;
	}

	public String getDynamicType(){
		return dynamicType;
	}

	public String getQuestion(){
		return question;
	}

	public String getId(){
		return id;
	}

	public String getTitle(){
		return title;
	}

	@Override
	public int describeContents() {
		return 0;
	}

	@Override
	public void writeToParcel(Parcel parcel, int i) {
		parcel.writeString(idStatus);
		parcel.writeString(dynamicType);
		parcel.writeString(question);
		parcel.writeString(id);
		parcel.writeString(title);
	}
}
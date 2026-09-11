package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;
import com.google.gson.annotations.SerializedName;

public class OrderStop implements Parcelable {
    @SerializedName("sequence") private int sequence;
    @SerializedName("address") private String address;
    @SerializedName("hno") private String hno;
    @SerializedName("landmark") private String landmark;
    @SerializedName("lat") private String lat;
    @SerializedName("lng") private String lng;
    @SerializedName("contact_name") private String contactName;
    @SerializedName("contact_number") private String contactNumber;

    protected OrderStop(Parcel in) {
        sequence = in.readInt(); address = in.readString(); hno = in.readString();
        landmark = in.readString(); lat = in.readString(); lng = in.readString();
        contactName = in.readString(); contactNumber = in.readString();
    }

    public static final Creator<OrderStop> CREATOR = new Creator<OrderStop>() {
        public OrderStop createFromParcel(Parcel in) { return new OrderStop(in); }
        public OrderStop[] newArray(int size) { return new OrderStop[size]; }
    };

    public int getSequence() { return sequence; }
    public String getAddress() { return address; }
    public String getHno() { return hno; }
    public String getLandmark() { return landmark; }
    public String getLat() { return lat; }
    public String getLng() { return lng; }

    public String displayAddress() {
        StringBuilder value = new StringBuilder();
        if (hno != null && !hno.trim().isEmpty()) value.append(hno.trim());
        if (landmark != null && !landmark.trim().isEmpty()) {
            if (value.length() > 0) value.append(", ");
            value.append(landmark.trim());
        }
        if (address != null && !address.trim().isEmpty()) {
            if (value.length() > 0) value.append(", ");
            value.append(address.trim());
        }
        return value.length() == 0 ? "Address unavailable" : value.toString();
    }

    public int describeContents() { return 0; }
    public void writeToParcel(Parcel dest, int flags) {
        dest.writeInt(sequence); dest.writeString(address); dest.writeString(hno);
        dest.writeString(landmark); dest.writeString(lat); dest.writeString(lng);
        dest.writeString(contactName); dest.writeString(contactNumber);
    }
}

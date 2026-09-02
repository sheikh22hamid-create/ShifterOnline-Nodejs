package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

public class RiderData implements Parcelable {

    @SerializedName("id")
    @Expose
    private int id;
    @SerializedName("full_name")
    @Expose
    private String fullName;
    @SerializedName("email")
    @Expose
    private String email;
    @SerializedName("mobile")
    @Expose
    private String mobile;
    @SerializedName("account_name")
    @Expose
    private String accountName;
    @SerializedName("account_number")
    @Expose
    private String accountNumber;
    @SerializedName("ifsc")
    @Expose
    private String ifsc;
    @SerializedName("vehicle")
    @Expose
    private String vehicle;
    @SerializedName("profile_picture")
    @Expose
    private String profilePicture;
    @SerializedName("verification_type")
    @Expose
    private String verificationType;
    @SerializedName("verification_status")
    @Expose
    private String verificationStatus;
    @SerializedName("status")
    @Expose
    private int status;
    @SerializedName("wallet_balance")
    @Expose
    private String walletBalance;
    @SerializedName("plan_type")
    @Expose
    private String planType;
    @SerializedName("monthly_plan")
    @Expose
    private int monthlyPlan;
    @SerializedName("working_hours")
    @Expose
    private int workingHours;
    @SerializedName("fcm_token")
    @Expose
    private String fcmToken;
    @SerializedName("rdate")
    @Expose
    private String rdate;

    public RiderData() {
    }

    protected RiderData(Parcel in) {
        id = in.readInt();
        fullName = in.readString();
        email = in.readString();
        mobile = in.readString();
        accountName = in.readString();
        accountNumber = in.readString();
        ifsc = in.readString();
        vehicle = in.readString();
        profilePicture = in.readString();
        verificationType = in.readString();
        verificationStatus = in.readString();
        status = in.readInt();
        walletBalance = in.readString();
        planType = in.readString();
        monthlyPlan = in.readInt();
        workingHours = in.readInt();
        fcmToken = in.readString();
        rdate = in.readString();
    }

    public static final Creator<RiderData> CREATOR = new Creator<RiderData>() {
        @Override
        public RiderData createFromParcel(Parcel in) {
            return new RiderData(in);
        }

        @Override
        public RiderData[] newArray(int size) {
            return new RiderData[size];
        }
    };

    public int getId() {
        return id;
    }

    public void setId(int id) {
        this.id = id;
    }

    public String getFullName() {
        return fullName;
    }

    public void setFullName(String fullName) {
        this.fullName = fullName;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getMobile() {
        return mobile;
    }

    public void setMobile(String mobile) {
        this.mobile = mobile;
    }

    public String getAccountName() {
        return accountName;
    }

    public void setAccountName(String accountName) {
        this.accountName = accountName;
    }

    public String getAccountNumber() {
        return accountNumber;
    }

    public void setAccountNumber(String accountNumber) {
        this.accountNumber = accountNumber;
    }

    public String getIfsc() {
        return ifsc;
    }

    public void setIfsc(String ifsc) {
        this.ifsc = ifsc;
    }

    public String getVehicle() {
        return vehicle;
    }

    public void setVehicle(String vehicle) {
        this.vehicle = vehicle;
    }

    public String getProfilePicture() {
        return profilePicture;
    }

    public void setProfilePicture(String profilePicture) {
        this.profilePicture = profilePicture;
    }

    public String getVerificationType() {
        return verificationType;
    }

    public void setVerificationType(String verificationType) {
        this.verificationType = verificationType;
    }

    public String getVerificationStatus() {
        return verificationStatus;
    }

    public void setVerificationStatus(String verificationStatus) {
        this.verificationStatus = verificationStatus;
    }

    public int getStatus() {
        return status;
    }

    public void setStatus(int status) {
        this.status = status;
    }

    public String getWalletBalance() {
        return walletBalance;
    }

    public void setWalletBalance(String walletBalance) {
        this.walletBalance = walletBalance;
    }

    public String getPlanType() {
        return planType;
    }

    public void setPlanType(String planType) {
        this.planType = planType;
    }

    public int getMonthlyPlan() {
        return monthlyPlan;
    }

    public void setMonthlyPlan(int monthlyPlan) {
        this.monthlyPlan = monthlyPlan;
    }

    public int getWorkingHours() {
        return workingHours;
    }

    public void setWorkingHours(int workingHours) {
        this.workingHours = workingHours;
    }

    public String getFcmToken() {
        return fcmToken;
    }

    public void setFcmToken(String fcmToken) {
        this.fcmToken = fcmToken;
    }

    public String getRdate() {
        return rdate;
    }

    public void setRdate(String rdate) {
        this.rdate = rdate;
    }

    @Override
    public int describeContents() {
        return 0;
    }

    @Override
    public void writeToParcel(Parcel parcel, int i) {
        parcel.writeInt(id);
        parcel.writeString(fullName);
        parcel.writeString(email);
        parcel.writeString(mobile);
        parcel.writeString(accountName);
        parcel.writeString(accountNumber);
        parcel.writeString(ifsc);
        parcel.writeString(vehicle);
        parcel.writeString(profilePicture);
        parcel.writeString(verificationType);
        parcel.writeString(verificationStatus);
        parcel.writeInt(status);
        parcel.writeString(walletBalance);
        parcel.writeString(planType);
        parcel.writeInt(monthlyPlan);
        parcel.writeInt(workingHours);
        parcel.writeString(fcmToken);
        parcel.writeString(rdate);
    }
}
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
    @SerializedName(value = "mobile", alternate = {"fmobile"})
    @Expose
    private String mobile;
    @SerializedName("dob")
    @Expose
    private String dob;
    @SerializedName("nationality")
    @Expose
    private String nationality;
    @SerializedName(value = "full_address", alternate = {"address"})
    @Expose
    private String fullAddress;
    @SerializedName(value = "know_language", alternate = {"language", "known_languages"})
    @Expose
    private String knowLanguage;
    @SerializedName("vehicle_no")
    @Expose
    private String vehicleNo;
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
    // Auto-verification charge fields - only meaningful when payment_complete
    // is 0. Let the app route a driver whose docs are already verified but
    // who never paid straight back to the payment screen on re-login,
    // instead of a dead-end resubmit of the registration form.
    @SerializedName("payment_complete")
    @Expose
    private int paymentComplete;
    @SerializedName("auto_verification_charge")
    @Expose
    private double autoVerificationCharge;
    @SerializedName("auto_verification_charge_old")
    @Expose
    private double autoVerificationChargeOld;
    @SerializedName("auto_verification_msg")
    @Expose
    private String autoVerificationMsg;
    @SerializedName(value = "reffer_code", alternate = {"referral_code", "refferal_code"})
    @Expose
    private String refferCode;
    @SerializedName("trial_status")
    @Expose
    private String trialStatus;
    @SerializedName("trial_orders_allowed")
    @Expose
    private Integer trialOrdersAllowed;
    @SerializedName("trial_orders_completed")
    @Expose
    private int trialOrdersCompleted;
    @SerializedName("body_type")
    @Expose
    private String bodyType;
    @SerializedName("allowed_body_types")
    @Expose
    private String allowedBodyTypes;

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
        paymentComplete = in.readInt();
        autoVerificationCharge = in.readDouble();
        autoVerificationChargeOld = in.readDouble();
        autoVerificationMsg = in.readString();
        dob = in.readString();
        nationality = in.readString();
        fullAddress = in.readString();
        knowLanguage = in.readString();
        vehicleNo = in.readString();
        refferCode = in.readString();
        trialStatus = in.readString();
        trialOrdersCompleted = in.readInt();
        if (in.readByte() == 1) {
            trialOrdersAllowed = in.readInt();
        } else {
            trialOrdersAllowed = null;
        }
        bodyType = in.readString();
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

    public int getPaymentComplete() {
        return paymentComplete;
    }

    public void setPaymentComplete(int paymentComplete) {
        this.paymentComplete = paymentComplete;
    }

    public double getAutoVerificationCharge() {
        return autoVerificationCharge;
    }

    public void setAutoVerificationCharge(double autoVerificationCharge) {
        this.autoVerificationCharge = autoVerificationCharge;
    }

    public double getAutoVerificationChargeOld() {
        return autoVerificationChargeOld;
    }

    public void setAutoVerificationChargeOld(double autoVerificationChargeOld) {
        this.autoVerificationChargeOld = autoVerificationChargeOld;
    }

    public String getAutoVerificationMsg() {
        return autoVerificationMsg;
    }

    public void setAutoVerificationMsg(String autoVerificationMsg) {
        this.autoVerificationMsg = autoVerificationMsg;
    }

    public String getTrialStatus() {
        return trialStatus;
    }

    public void setTrialStatus(String trialStatus) {
        this.trialStatus = trialStatus;
    }

    public Integer getTrialOrdersAllowed() {
        return trialOrdersAllowed;
    }

    public void setTrialOrdersAllowed(Integer trialOrdersAllowed) {
        this.trialOrdersAllowed = trialOrdersAllowed;
    }

    public int getTrialOrdersCompleted() {
        return trialOrdersCompleted;
    }

    public void setTrialOrdersCompleted(int trialOrdersCompleted) {
        this.trialOrdersCompleted = trialOrdersCompleted;
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
        parcel.writeInt(paymentComplete);
        parcel.writeDouble(autoVerificationCharge);
        parcel.writeDouble(autoVerificationChargeOld);
        parcel.writeString(autoVerificationMsg);
        parcel.writeString(dob);
        parcel.writeString(nationality);
        parcel.writeString(fullAddress);
        parcel.writeString(knowLanguage);
        parcel.writeString(vehicleNo);
        parcel.writeString(refferCode);
        parcel.writeString(trialStatus);
        parcel.writeInt(trialOrdersCompleted);
        if (trialOrdersAllowed != null) {
            parcel.writeByte((byte) 1);
            parcel.writeInt(trialOrdersAllowed);
        } else {
            parcel.writeByte((byte) 0);
        }
        parcel.writeString(bodyType);
    }

    public String getDob() {
        return dob;
    }

    public void setDob(String dob) {
        this.dob = dob;
    }

    public String getNationality() {
        return nationality;
    }

    public void setNationality(String nationality) {
        this.nationality = nationality;
    }

    public String getFullAddress() {
        return fullAddress;
    }

    public void setFullAddress(String fullAddress) {
        this.fullAddress = fullAddress;
    }

    public String getKnowLanguage() {
        return knowLanguage;
    }

    public void setKnowLanguage(String knowLanguage) {
        this.knowLanguage = knowLanguage;
    }

    public String getVehicleNo() {
        return vehicleNo;
    }

    public void setVehicleNo(String vehicleNo) {
        this.vehicleNo = vehicleNo;
    }

    public String getRefferCode() {
        return refferCode;
    }

    public void setRefferCode(String refferCode) {
        this.refferCode = refferCode;
    }

    public String getBodyType() {
        return bodyType != null && !bodyType.isEmpty() ? bodyType : "both";
    }

    public void setBodyType(String bodyType) {
        this.bodyType = bodyType;
    }

    public String getAllowedBodyTypes() {
        return allowedBodyTypes;
    }

    public void setAllowedBodyTypes(String allowedBodyTypes) {
        this.allowedBodyTypes = allowedBodyTypes;
    }
}
package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

public class PayoutH {
    @SerializedName("payout_id")
    @Expose
    private String payoutId;
    @SerializedName("amt")
    @Expose
    private String amt;
    @SerializedName("status")
    @Expose
    private String status;
    @SerializedName("proof")
    @Expose
    private Object proof;
    @SerializedName("r_date")
    @Expose
    private String rDate;
    @SerializedName("r_type")
    @Expose
    private String rType;
    @SerializedName("acc_number")
    @Expose
    private String accNumber;
    @SerializedName("bank_name")
    @Expose
    private String bankName;
    @SerializedName("acc_name")
    @Expose
    private String accName;
    @SerializedName("ifsc_code")
    @Expose
    private String ifscCode;
    @SerializedName("upi_id")
    @Expose
    private String upiId;
    @SerializedName("paypal_id")
    @Expose
    private String paypalId;

    public String getPayoutId() {
        return payoutId;
    }

    public void setPayoutId(String payoutId) {
        this.payoutId = payoutId;
    }

    public String getAmt() {
        return amt;
    }

    public void setAmt(String amt) {
        this.amt = amt;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Object getProof() {
        return proof;
    }

    public void setProof(Object proof) {
        this.proof = proof;
    }

    public String getrDate() {
        return rDate;
    }

    public void setrDate(String rDate) {
        this.rDate = rDate;
    }

    public String getrType() {
        return rType;
    }

    public void setrType(String rType) {
        this.rType = rType;
    }

    public String getAccNumber() {
        return accNumber;
    }

    public void setAccNumber(String accNumber) {
        this.accNumber = accNumber;
    }

    public String getBankName() {
        return bankName;
    }

    public void setBankName(String bankName) {
        this.bankName = bankName;
    }

    public String getAccName() {
        return accName;
    }

    public void setAccName(String accName) {
        this.accName = accName;
    }

    public String getIfscCode() {
        return ifscCode;
    }

    public void setIfscCode(String ifscCode) {
        this.ifscCode = ifscCode;
    }

    public String getUpiId() {
        return upiId;
    }

    public void setUpiId(String upiId) {
        this.upiId = upiId;
    }

    public String getPaypalId() {
        return paypalId;
    }

    public void setPaypalId(String paypalId) {
        this.paypalId = paypalId;
    }

}

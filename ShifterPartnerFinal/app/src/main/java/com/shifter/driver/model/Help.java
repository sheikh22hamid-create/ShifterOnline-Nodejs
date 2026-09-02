package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

import java.util.List;

public class Help {
    @SerializedName("pagelist")
    @Expose
    private List<Pages> pagelist = null;
    @SerializedName("ResponseCode")
    @Expose
    private String responseCode;
    @SerializedName("Result")
    @Expose
    private String result;
    @SerializedName("ResponseMsg")
    @Expose
    private String responseMsg;
    @SerializedName("referral_code")
    @Expose
    private String referralCode;
    @SerializedName("referral_msg")
    @Expose
    private String referralMsg;

    public String getReferralCode() {
        return referralCode;
    }

    public void setReferralCode(String referralCode) {
        this.referralCode = referralCode;
    }

    public String getReferralMsg() {
        return referralMsg;
    }

    public void setReferralMsg(String referralMsg) {
        this.referralMsg = referralMsg;
    }

    public List<Pages> getPagelist() {
        return pagelist;
    }

    public void setPagelist(List<Pages> pagelist) {
        this.pagelist = pagelist;
    }

    public String getResponseCode() {
        return responseCode;
    }

    public void setResponseCode(String responseCode) {
        this.responseCode = responseCode;
    }

    public String getResult() {
        return result;
    }

    public void setResult(String result) {
        this.result = result;
    }

    public String getResponseMsg() {
        return responseMsg;
    }

    public void setResponseMsg(String responseMsg) {
        this.responseMsg = responseMsg;
    }

}

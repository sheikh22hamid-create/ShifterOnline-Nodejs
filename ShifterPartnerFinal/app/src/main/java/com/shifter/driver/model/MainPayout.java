package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

import java.util.List;

public class MainPayout {

    @SerializedName("ResponseCode")
    @Expose
    private String responseCode;
    @SerializedName("Result")
    @Expose
    private String result;
    @SerializedName("ResponseMsg")
    @Expose
    private String responseMsg;
    @SerializedName("total_earning")
    @Expose
    private String totalEarning;
    @SerializedName("Payoutlist")
    @Expose
    private List<PayoutH> payoutlist;

    public String getResponseCode() {
        return responseCode;
    }

    public void setResponseCode(String responseCode) {
        this.responseCode = responseCode;
    }

 public void settotalEarning(String responseCode) {
        this.totalEarning = responseCode;
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

    public List<PayoutH> getPayoutlist() {
        return payoutlist;
    }

    public void setPayoutlist(List<PayoutH> payoutlist) {
        this.payoutlist = payoutlist;
    }

    public String getTotalEarning() {
        return totalEarning;
    }

}
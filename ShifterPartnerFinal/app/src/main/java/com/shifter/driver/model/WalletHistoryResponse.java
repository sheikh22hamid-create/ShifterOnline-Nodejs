package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

import java.util.List;

public class WalletHistoryResponse {

    @SerializedName("Result")
    @Expose
    private Boolean result;

    @SerializedName("msg")
    @Expose
    private String msg;

    @SerializedName("wallet_balance")
    @Expose
    private String walletBalance;

    @SerializedName("wallet_points")
    @Expose
    private String walletPoints;

    @SerializedName("total_credit")
    @Expose
    private String totalCredit;

    @SerializedName("total_debit")
    @Expose
    private String totalDebit;

    @SerializedName("data")
    @Expose
    private List<WalletHistoryData> data;

    public Boolean getResult() {
        return result;
    }

    public void setResult(Boolean result) {
        this.result = result;
    }

    public String getMsg() {
        return msg;
    }

    public void setMsg(String msg) {
        this.msg = msg;
    }

    public String getWalletBalance() {
        return walletBalance;
    }

    public void setWalletBalance(String walletBalance) {
        this.walletBalance = walletBalance;
    }

    public String getWalletPoints() {
        return walletPoints;
    }

    public void setWalletPoints(String walletPoints) {
        this.walletPoints = walletPoints;
    }

    public String getTotalCredit() {
        return totalCredit;
    }

    public void setTotalCredit(String totalCredit) {
        this.totalCredit = totalCredit;
    }

    public String getTotalDebit() {
        return totalDebit;
    }

    public void setTotalDebit(String totalDebit) {
        this.totalDebit = totalDebit;
    }

    public List<WalletHistoryData> getData() {
        return data;
    }

    public void setData(List<WalletHistoryData> data) {
        this.data = data;
    }
}

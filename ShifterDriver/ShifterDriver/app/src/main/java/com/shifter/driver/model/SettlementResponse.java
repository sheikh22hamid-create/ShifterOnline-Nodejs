package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;
import java.util.List;

public class SettlementResponse {

    @SerializedName("ResponseCode")
    private String responseCode;

    @SerializedName("Result")
    private String result;

    @SerializedName("ResponseMsg")
    private String responseMsg;

    @SerializedName("code")
    private String code;

    @SerializedName("settlement")
    private SettlementView settlement;

    @SerializedName("settlements")
    private List<SettlementView> settlements;

    @SerializedName("phase")
    private String phase;

    @SerializedName("sent")
    private Boolean sent;

    @SerializedName("link")
    private String link;

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

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public SettlementView getSettlement() {
        return settlement;
    }

    public void setSettlement(SettlementView settlement) {
        this.settlement = settlement;
    }

    public List<SettlementView> getSettlements() {
        return settlements;
    }

    public void setSettlements(List<SettlementView> settlements) {
        this.settlements = settlements;
    }

    public String getPhase() {
        return phase;
    }

    public boolean wasSent() {
        return sent != null && sent;
    }

    public String getLink() {
        return link;
    }

    public boolean isSuccess() {
        return "200".equals(responseCode) && "true".equalsIgnoreCase(result);
    }
}

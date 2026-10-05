package com.shifter.driver.model;

import com.google.gson.annotations.SerializedName;
import java.io.Serializable;

public class SettlementView implements Serializable {

    @SerializedName("settlement_id")
    private int settlementId;

    @SerializedName("order_id")
    private int orderId;

    @SerializedName("status")
    private String status;

    @SerializedName("amount_due")
    private String amountDue;

    @SerializedName("fare")
    private String fare;

    @SerializedName("method")
    private String method;

    @SerializedName("customer_choice")
    private String customerChoice;

    @SerializedName("confirmed_by")
    private String confirmedBy;

    @SerializedName("confirmed_at")
    private String confirmedAt;

    @SerializedName("pending_since")
    private String pendingSince;

    @SerializedName("dispute_reason")
    private String disputeReason;

    @SerializedName("dispute_raised_by")
    private String disputeRaisedBy;

    @SerializedName("payer")
    private String payer;

    @SerializedName("receiver_markup")
    private String receiverMarkup;

    @SerializedName("advance_held")
    private String advanceHeld;

    @SerializedName("receiver_pay_total")
    private String receiverPayTotal;

    public int getSettlementId() {
        return settlementId;
    }

    public void setSettlementId(int settlementId) {
        this.settlementId = settlementId;
    }

    public int getOrderId() {
        return orderId;
    }

    public void setOrderId(int orderId) {
        this.orderId = orderId;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public String getAmountDue() {
        return amountDue;
    }

    public void setAmountDue(String amountDue) {
        this.amountDue = amountDue;
    }

    public String getFare() {
        return fare;
    }

    public void setFare(String fare) {
        this.fare = fare;
    }

    public String getMethod() {
        return method;
    }

    public void setMethod(String method) {
        this.method = method;
    }

    public String getCustomerChoice() {
        return customerChoice;
    }

    public void setCustomerChoice(String customerChoice) {
        this.customerChoice = customerChoice;
    }

    public String getConfirmedBy() {
        return confirmedBy;
    }

    public void setConfirmedBy(String confirmedBy) {
        this.confirmedBy = confirmedBy;
    }

    public String getConfirmedAt() {
        return confirmedAt;
    }

    public void setConfirmedAt(String confirmedAt) {
        this.confirmedAt = confirmedAt;
    }

    public String getPendingSince() {
        return pendingSince;
    }

    public void setPendingSince(String pendingSince) {
        this.pendingSince = pendingSince;
    }

    public String getDisputeReason() {
        return disputeReason;
    }

    public void setDisputeReason(String disputeReason) {
        this.disputeReason = disputeReason;
    }

    public String getDisputeRaisedBy() {
        return disputeRaisedBy;
    }

    public void setDisputeRaisedBy(String disputeRaisedBy) {
        this.disputeRaisedBy = disputeRaisedBy;
    }

    public String getPayer() {
        return payer;
    }

    public boolean isReceiverPayer() {
        return "receiver".equals(payer);
    }

    public String getReceiverMarkup() {
        return receiverMarkup;
    }

    public String getAdvanceHeld() {
        return advanceHeld;
    }

    public String getReceiverPayTotal() {
        return receiverPayTotal;
    }

    public boolean isPending() {
        return "pending".equalsIgnoreCase(status);
    }

    public boolean isDisputed() {
        return "disputed".equalsIgnoreCase(status);
    }

    public boolean isCashReceived() {
        return "cash_received".equalsIgnoreCase(status);
    }

    public boolean isPaidOnline() {
        return "paid_online".equalsIgnoreCase(status);
    }

    public boolean isSettled() {
        return isCashReceived() || isPaidOnline() || "waived".equalsIgnoreCase(status) || "customer_owes".equalsIgnoreCase(status);
    }
}

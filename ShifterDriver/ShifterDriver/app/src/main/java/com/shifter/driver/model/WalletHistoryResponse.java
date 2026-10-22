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

    // Driver-only fields (customerWalletController.walletHistory's
    // withdrawalSummary) - the app renders button visibility off these
    // instead of re-deriving the rules from wallet_balance itself.
    @SerializedName("outstanding_due")
    @Expose
    private String outstandingDue;

    @SerializedName("can_withdraw")
    @Expose
    private Boolean canWithdraw;

    @SerializedName("can_clear_due")
    @Expose
    private Boolean canClearDue;

    @SerializedName("max_due_limit")
    @Expose
    private Double maxDueLimit;

    @SerializedName("min_withdrawal_amount")
    @Expose
    private Double minWithdrawalAmount;

    // Admin-configured for this driver's vehicle type (backend falls back to the global value).
    @SerializedName("min_required_balance")
    @Expose
    private Double minRequiredBalance;

    @SerializedName("vehicle_name")
    @Expose
    private String vehicleName;

    @SerializedName("due_limit_reached")
    @Expose
    private Boolean dueLimitReached;

    @SerializedName("available_to_withdraw")
    @Expose
    private String availableToWithdraw;

    @SerializedName("payout_methods")
    @Expose
    private PayoutMethods payoutMethods;

    public static class PayoutMethods {
        @SerializedName("upi_id")
        @Expose
        private String upiId;

        @SerializedName("bank_account")
        @Expose
        private BankAccount bankAccount;

        public String getUpiId() {
            return upiId;
        }

        public BankAccount getBankAccount() {
            return bankAccount;
        }
    }

    public static class BankAccount {
        @SerializedName("bank_name")
        @Expose
        private String bankName;

        @SerializedName("account_name")
        @Expose
        private String accountName;

        @SerializedName("ifsc_code")
        @Expose
        private String ifscCode;

        @SerializedName("account_number_masked")
        @Expose
        private String accountNumberMasked;

        public String getBankName() {
            return bankName;
        }

        public String getAccountName() {
            return accountName;
        }

        public String getIfscCode() {
            return ifscCode;
        }

        public String getAccountNumberMasked() {
            return accountNumberMasked;
        }
    }

    public String getAvailableToWithdraw() {
        return availableToWithdraw;
    }

    public PayoutMethods getPayoutMethods() {
        return payoutMethods;
    }

    public String getOutstandingDue() {
        return outstandingDue;
    }

    public Boolean getCanWithdraw() {
        return canWithdraw != null && canWithdraw;
    }

    public Boolean getCanClearDue() {
        return canClearDue != null && canClearDue;
    }

    public Double getMaxDueLimit() {
        return maxDueLimit;
    }

    public Double getMinWithdrawalAmount() {
        return minWithdrawalAmount;
    }

    public Double getMinRequiredBalance() {
        return minRequiredBalance;
    }

    public String getVehicleName() {
        return vehicleName;
    }

    public Boolean getDueLimitReached() {
        return dueLimitReached != null && dueLimitReached;
    }

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

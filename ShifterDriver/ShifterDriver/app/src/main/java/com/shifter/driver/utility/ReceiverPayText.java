package com.shifter.driver.utility;

import com.shifter.driver.model.SettlementView;

import java.util.Locale;

/** Pure-Java text/visibility rules for the receiver-pays mode of the Trip Payment screen. */
public final class ReceiverPayText {

    private ReceiverPayText() {}

    public static boolean isReceiverMode(SettlementView s) {
        return s != null && s.isReceiverPayer() && s.isPending();
    }

    public static String collectLine(String currency, String amountDue, String receiverName, String receiverPhone) {
        String name = isBlank(receiverName) ? "the receiver" : receiverName.trim();
        StringBuilder sb = new StringBuilder("Collect ")
                .append(money(currency, parse(amountDue)))
                .append(" cash from ").append(name);
        if (!isBlank(receiverPhone)) {
            sb.append(" (").append(receiverPhone.trim()).append(")");
        }
        sb.append(", or the receiver can pay online via the link we sent on WhatsApp.");
        return sb.toString();
    }

    public static String onlineHint(String currency, String total, String amountDue) {
        double t = parse(total);
        return "Receiver's online total: " + money(currency, t > 0 ? t : parse(amountDue));
    }

    public static final String RECEIVER_GRACE_WARNING =
            "Payment must be collected directly from the receiver.\nIf the receiver is facing any issue paying, you can report it to Admin.\nAdmin will track the record. Payment must be collected by you.";

    /** Receiver-mode grace warning; otherwise the original text untouched. */
    public static String graceWarning(boolean receiverMode, String original) {
        return receiverMode ? RECEIVER_GRACE_WARNING : original;
    }

    public static String receivedConfirmMessage(boolean receiverMode, String formattedAmount) {
        return "Did you collect " + formattedAmount + " from the "
                + (receiverMode ? "receiver" : "customer") + " in cash or direct UPI?";
    }

    private static String money(String currency, double v) {
        return (currency == null ? "" : currency) + String.format(Locale.getDefault(), "%.2f", v);
    }

    private static boolean isBlank(String s) {
        return s == null || s.trim().isEmpty();
    }

    private static double parse(String val) {
        if (val == null || val.trim().isEmpty()) return 0.0;
        try {
            return Double.parseDouble(val.trim());
        } catch (Exception e) {
            return 0.0;
        }
    }
}

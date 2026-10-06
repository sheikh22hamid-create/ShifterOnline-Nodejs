package com.shifter.driver.utility;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.google.gson.Gson;
import com.shifter.driver.model.SettlementView;

import org.junit.Test;

public class ReceiverPayTextTest {

    private final Gson gson = new Gson();

    private SettlementView view(String json) {
        return gson.fromJson(json, SettlementView.class);
    }

    @Test
    public void isReceiverMode_nullIsFalse() {
        assertFalse(ReceiverPayText.isReceiverMode(null));
    }

    @Test
    public void isReceiverMode_customerPayerIsFalse() {
        assertFalse(ReceiverPayText.isReceiverMode(view("{\"payer\":\"customer\",\"status\":\"pending\"}")));
    }

    @Test
    public void isReceiverMode_receiverPendingIsTrue() {
        assertTrue(ReceiverPayText.isReceiverMode(view("{\"payer\":\"receiver\",\"status\":\"pending\"}")));
    }

    @Test
    public void isReceiverMode_receiverCashReceivedIsFalse() {
        assertFalse(ReceiverPayText.isReceiverMode(view("{\"payer\":\"receiver\",\"status\":\"cash_received\"}")));
    }

    @Test
    public void isReceiverMode_payerAbsentIsFalse() {
        assertFalse(ReceiverPayText.isReceiverMode(view("{\"status\":\"pending\"}")));
    }

    @Test
    public void collectLine_full() {
        assertEquals("Collect \u20B990.00 cash from Ramesh (9876543210), or the receiver can pay online via the link we sent on WhatsApp.",
                ReceiverPayText.collectLine("\u20B9", "90", "Ramesh", "9876543210"));
    }

    @Test
    public void collectLine_nullNameFallsBack() {
        assertEquals("Collect \u20B990.00 cash from the receiver (9876543210), or the receiver can pay online via the link we sent on WhatsApp.",
                ReceiverPayText.collectLine("\u20B9", "90", null, "9876543210"));
        assertEquals("Collect \u20B990.00 cash from the receiver (9876543210), or the receiver can pay online via the link we sent on WhatsApp.",
                ReceiverPayText.collectLine("\u20B9", "90", "  ", "9876543210"));
    }

    @Test
    public void collectLine_nullPhoneOmitsParentheses() {
        assertEquals("Collect \u20B990.00 cash from Ramesh, or the receiver can pay online via the link we sent on WhatsApp.",
                ReceiverPayText.collectLine("\u20B9", "90", "Ramesh", null));
        assertEquals("Collect \u20B990.00 cash from the receiver, or the receiver can pay online via the link we sent on WhatsApp.",
                ReceiverPayText.collectLine("\u20B9", "90", null, ""));
    }

    @Test
    public void collectLine_unparsableAmountIsZero() {
        assertEquals("Collect \u20B90.00 cash from Ramesh (1), or the receiver can pay online via the link we sent on WhatsApp.",
                ReceiverPayText.collectLine("\u20B9", "abc", "Ramesh", "1"));
    }

    @Test
    public void graceWarning_receiverModeSaysReceiver() {
        assertEquals(ReceiverPayText.RECEIVER_GRACE_WARNING, ReceiverPayText.graceWarning(true, "orig"));
        assertTrue(ReceiverPayText.graceWarning(true, "orig").contains("receiver"));
        assertFalse(ReceiverPayText.graceWarning(true, "orig").contains("from the customer"));
    }

    @Test
    public void graceWarning_normalReturnsOriginalUnchanged() {
        assertEquals("orig", ReceiverPayText.graceWarning(false, "orig"));
    }

    @Test
    public void receivedConfirmMessage_receiverAndNormal() {
        assertEquals("Did you collect ₹90.00 from the receiver in cash or direct UPI?",
                ReceiverPayText.receivedConfirmMessage(true, "₹90.00"));
        assertEquals("Did you collect ₹90.00 from the customer in cash or direct UPI?",
                ReceiverPayText.receivedConfirmMessage(false, "₹90.00"));
    }

    @Test
    public void pendingSettlementDesc_customerIsUnchanged() {
        assertEquals("Tap to collect ₹120.00. New orders are paused after the grace period while a payment is pending.",
                ReceiverPayText.pendingSettlementDesc(false, "₹120.00"));
    }

    @Test
    public void pendingSettlementDesc_receiverSaysReceiverAndDropsPauseWarning() {
        assertEquals("Tap to collect ₹120.00 from the receiver.",
                ReceiverPayText.pendingSettlementDesc(true, "₹120.00"));
    }

    @Test
    public void collectAmount_receiverModeIncludesTheBookersFee() {
        SettlementView v = view("{\"payer\":\"receiver\",\"status\":\"pending\",\"amount_due\":\"100\",\"receiver_pay_total\":\"103\"}");
        assertEquals("103", ReceiverPayText.collectAmount(v));
    }

    @Test
    public void collectAmount_fallsBackToAmountDue() {
        assertEquals("100", ReceiverPayText.collectAmount(view("{\"payer\":\"receiver\",\"status\":\"pending\",\"amount_due\":\"100\"}")));
        assertEquals("100", ReceiverPayText.collectAmount(view("{\"payer\":\"receiver\",\"status\":\"pending\",\"amount_due\":\"100\",\"receiver_pay_total\":\"0\"}")));
    }

    @Test
    public void collectAmount_customerModeIsAmountDueEvenIfATotalIsPresent() {
        SettlementView v = view("{\"payer\":\"customer\",\"status\":\"pending\",\"amount_due\":\"100\",\"receiver_pay_total\":\"103\"}");
        assertEquals("100", ReceiverPayText.collectAmount(v));
    }

    @Test
    public void feeHint_explainsTheFeeIsPartOfTheCashToCollect() {
        assertEquals("Includes the booker's service fee of ₹3.00. Collect the full amount.",
                ReceiverPayText.feeHint("₹", "103", "100"));
    }

    @Test
    public void feeHint_emptyWhenThereIsNoFee() {
        assertEquals("", ReceiverPayText.feeHint("₹", "100", "100"));
        assertEquals("", ReceiverPayText.feeHint("₹", null, "100"));
    }
}

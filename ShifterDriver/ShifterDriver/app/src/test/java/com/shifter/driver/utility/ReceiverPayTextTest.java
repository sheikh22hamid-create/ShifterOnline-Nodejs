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
    public void onlineHint_usesTotalWhenPositive() {
        assertEquals("Receiver's online total: \u20B992.70", ReceiverPayText.onlineHint("\u20B9", "92.7", "90"));
    }

    @Test
    public void onlineHint_nullTotalFallsBack() {
        assertEquals("Receiver's online total: \u20B990.00", ReceiverPayText.onlineHint("\u20B9", null, "90"));
    }

    @Test
    public void onlineHint_zeroTotalFallsBack() {
        assertEquals("Receiver's online total: \u20B990.00", ReceiverPayText.onlineHint("\u20B9", "0", "90"));
    }
}

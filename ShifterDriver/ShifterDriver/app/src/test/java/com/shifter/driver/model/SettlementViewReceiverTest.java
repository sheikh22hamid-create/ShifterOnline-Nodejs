package com.shifter.driver.model;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import com.google.gson.Gson;

import org.junit.Test;

public class SettlementViewReceiverTest {

    private final Gson gson = new Gson();

    @Test
    public void legacyPayloadIsNotReceiverPayer() {
        SettlementView v = gson.fromJson(
                "{\"amount_due\":90,\"status\":\"pending\",\"order_id\":50,\"settlement_id\":4}",
                SettlementView.class);
        assertFalse(v.isReceiverPayer());
        assertNull(v.getPayer());
        assertNull(v.getReceiverPayTotal());
        assertNull(v.getReceiverMarkup());
        assertNull(v.getAdvanceHeld());
    }

    @Test
    public void customerPayerIsNotReceiverPayer() {
        SettlementView v = gson.fromJson("{\"payer\":\"customer\",\"status\":\"pending\"}", SettlementView.class);
        assertFalse(v.isReceiverPayer());
    }

    @Test
    public void receiverPayloadParses() {
        SettlementView v = gson.fromJson(
                "{\"payer\":\"receiver\",\"amount_due\":90,\"receiver_markup\":2.7,\"advance_held\":20,"
                        + "\"receiver_pay_total\":92.7,\"status\":\"pending\",\"order_id\":50,\"settlement_id\":4}",
                SettlementView.class);
        assertTrue(v.isReceiverPayer());
        assertTrue(v.isPending());
        assertEquals(2.7, Double.parseDouble(v.getReceiverMarkup()), 0.0001);
        assertEquals(20.0, Double.parseDouble(v.getAdvanceHeld()), 0.0001);
        assertEquals(92.7, Double.parseDouble(v.getReceiverPayTotal()), 0.0001);
    }

    @Test
    public void receiverPayloadWithStringNumbersParses() {
        SettlementView v = gson.fromJson(
                "{\"payer\":\"receiver\",\"receiver_pay_total\":\"92.70\",\"status\":\"pending\"}",
                SettlementView.class);
        assertEquals(92.7, Double.parseDouble(v.getReceiverPayTotal()), 0.0001);
    }

    @Test
    public void responseSentFalseWithLink() {
        SettlementResponse r = gson.fromJson(
                "{\"ResponseCode\":\"200\",\"Result\":\"true\",\"sent\":false,\"link\":\"https://x/pay/t\"}",
                SettlementResponse.class);
        assertFalse(r.wasSent());
        assertEquals("https://x/pay/t", r.getLink());
    }

    @Test
    public void responseSentTrueNoLink() {
        SettlementResponse r = gson.fromJson("{\"sent\":true}", SettlementResponse.class);
        assertTrue(r.wasSent());
        assertNull(r.getLink());
    }

    @Test
    public void responseWithoutSentIsNotSent() {
        SettlementResponse r = gson.fromJson("{}", SettlementResponse.class);
        assertFalse(r.wasSent());
        assertNull(r.getPhase());
    }

    @Test
    public void responseConvertedPhaseWithSettlement() {
        SettlementResponse r = gson.fromJson(
                "{\"phase\":\"converted\",\"settlement\":{\"payer\":\"customer\",\"status\":\"pending\",\"order_id\":50}}",
                SettlementResponse.class);
        assertEquals("converted", r.getPhase());
        assertNotNull(r.getSettlement());
        assertEquals(50, r.getSettlement().getOrderId());
        assertFalse(r.getSettlement().isReceiverPayer());
    }
}

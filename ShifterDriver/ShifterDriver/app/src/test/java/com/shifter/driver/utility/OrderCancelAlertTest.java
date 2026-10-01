package com.shifter.driver.utility;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class OrderCancelAlertTest {

    @Test
    public void sameOrderWithinWindowIsHandledOnlyOnce() {
        // FCM and the socket both deliver the same cancellation.
        assertTrue(OrderCancelAlert.shouldHandle("dedupe-1", 1_000L));
        assertFalse(OrderCancelAlert.shouldHandle("dedupe-1", 3_000L));
    }

    @Test
    public void sameOrderAfterWindowIsHandledAgain() {
        assertTrue(OrderCancelAlert.shouldHandle("dedupe-2", 1_000L));
        assertTrue(OrderCancelAlert.shouldHandle("dedupe-2", 12_000L));
    }

    @Test
    public void differentOrderIsAlwaysHandled() {
        assertTrue(OrderCancelAlert.shouldHandle("dedupe-3", 1_000L));
        assertTrue(OrderCancelAlert.shouldHandle("dedupe-4", 1_500L));
    }
}

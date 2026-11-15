package com.shifter.driver.utility;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.Locale;

public class OrderDateFormatTest {
    static {
        Locale.setDefault(Locale.ENGLISH);
    }

    @Test
    public void utcInstantIsShownInIndianTime() {
        // 07:23:08 UTC = 12:53:08 IST (the order in the bug report)
        assertEquals("27 Oct 2026, 12:53 PM", OrderDateFormat.toIst("2026-10-27T07:23:08.000Z"));
    }

    @Test
    public void instantWithoutMillisAndWithoutZoneLetterIsTreatedAsUtc() {
        assertEquals("27 Oct 2026, 12:53 PM", OrderDateFormat.toIst("2026-10-27T07:23:08Z"));
        assertEquals("27 Oct 2026, 12:53 PM", OrderDateFormat.toIst("2026-10-27T07:23:08"));
    }

    @Test
    public void lateEveningUtcRollsIntoTheNextIndianDay() {
        assertEquals("28 Oct 2026, 12:30 AM", OrderDateFormat.toIst("2026-10-27T19:00:00.000Z"));
    }

    @Test
    public void plainWallClockValueIsOnlyReformatted() {
        assertEquals("27 Oct 2026, 06:30 PM", OrderDateFormat.toIst("2026-10-27 18:30:00"));
    }

    @Test
    public void unreadableOrEmptyValuesAreNotInvented() {
        assertEquals("", OrderDateFormat.toIst(null));
        assertEquals("", OrderDateFormat.toIst("  "));
        assertEquals("", OrderDateFormat.toIst("null"));
        assertEquals("yesterday", OrderDateFormat.toIst("yesterday"));
        assertEquals("2026-13-45T99:99:99Z", OrderDateFormat.toIst("2026-13-45T99:99:99Z"));
    }
}

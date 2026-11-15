package com.shifter.driver.utility;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class DistanceChipTest {
    @Test
    public void unitIsUppercasedAndTheNumberIsLeftAlone() {
        assertEquals("5.7 KM", DistanceChip.valueText("5.7 km"));
        assertEquals("9.5 KM", DistanceChip.valueText("9.5 Km"));
        assertEquals("9.5 KM", DistanceChip.valueText("9.5km"));
        assertEquals("12.34 KM", DistanceChip.valueText("12.34 KM"));
    }

    @Test
    public void aBareNumberGetsTheUnit() {
        assertEquals("2 KM", DistanceChip.valueText("2"));
        assertEquals("9.5 KM", DistanceChip.valueText(" 9.5 "));
    }

    @Test
    public void nothingToShowGivesAnEmptyValue() {
        assertEquals("", DistanceChip.valueText(null));
        assertEquals("", DistanceChip.valueText("   "));
    }
}

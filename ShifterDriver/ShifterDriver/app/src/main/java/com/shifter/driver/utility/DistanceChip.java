package com.shifter.driver.utility;

import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.AbsoluteSizeSpan;
import android.text.style.StyleSpan;
import android.graphics.Typeface;
import android.view.View;
import android.widget.TextView;

import java.util.Locale;

/**
 * The highlighted distance indicator of the New Ride Request popup:
 * "<b>5.7 KM</b> - From your location" (pickup) and "<b>9.5 KM</b> - From your pickup" (drop).
 *
 * Display only. The distance values and where they come from are decided by the callers exactly as before; this only
 * turns the finished value ("5.7 km", "9.5") into a chip whose number is bold and larger than its label. A missing or
 * blank value hides the chip (the popup then shows the plain PICKUP LOCATION / DROP LOCATION title as it always did).
 */
public final class DistanceChip {
    private static final int VALUE_SP = 18;
    private static final int LABEL_SP = 12;

    private DistanceChip() {}

    /** "5.7 km" / "5.7" -> "5.7 KM"; the number and its formatting are left exactly as given. */
    static String valueText(String distance) {
        if (distance == null) return "";
        String d = distance.trim();
        if (d.isEmpty()) return "";
        if (d.toLowerCase(Locale.ROOT).contains("km")) {
            return d.replaceAll("(?i)\\s*km", " KM").trim();
        }
        return d + " KM";
    }

    /** Shows the chip with {@code distance} (bold, larger) and {@code label} (smaller); hides it when there is no distance. */
    public static void show(TextView chip, String distance, String label) {
        if (chip == null) return;
        String value = valueText(distance);
        if (value.isEmpty()) {
            chip.setVisibility(View.GONE);
            return;
        }
        SpannableStringBuilder text = new SpannableStringBuilder(value);
        text.setSpan(new StyleSpan(Typeface.BOLD), 0, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        text.setSpan(new AbsoluteSizeSpan(VALUE_SP, true), 0, value.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        int labelStart = text.length();
        text.append("  –  ").append(label);
        text.setSpan(new AbsoluteSizeSpan(LABEL_SP, true), labelStart, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        chip.setText(text);
        chip.setVisibility(View.VISIBLE);
    }

    public static void hide(TextView chip) {
        if (chip != null) chip.setVisibility(View.GONE);
    }
}

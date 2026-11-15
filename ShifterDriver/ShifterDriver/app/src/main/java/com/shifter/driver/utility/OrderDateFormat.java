package com.shifter.driver.utility;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Turns the order date the server sends into something a driver can read.
 *
 * The server serialises the order's date as a UTC instant ("2026-10-27T07:23:08.000Z"), which used to be shown raw.
 * It is shown here in Indian time as "27 Oct 2026, 12:53 PM". A plain "yyyy-MM-dd HH:mm:ss" value (no zone) is
 * already a wall-clock time and is only reformatted. Anything unreadable is returned unchanged, so a surprise format
 * never hides the date.
 */
public final class OrderDateFormat {
    private static final TimeZone IST = TimeZone.getTimeZone("Asia/Kolkata");
    private static final TimeZone UTC = TimeZone.getTimeZone("UTC");

    private OrderDateFormat() {}

    public static String toIst(String raw) {
        if (raw == null) return "";
        String s = raw.trim();
        if (s.isEmpty() || "null".equalsIgnoreCase(s)) return "";
        try {
            if (s.indexOf('T') > 0) {
                // 2026-10-27T07:23:08.000Z, 2026-10-27T07:23:08Z (a UTC instant) or without the zone letter (taken as UTC)
                String core = s.length() >= 19 ? s.substring(0, 19) : s;
                return format(parse(core.replace(' ', 'T'), "yyyy-MM-dd'T'HH:mm:ss", UTC));
            }
            if (s.length() >= 19) {
                // 2026-10-27 12:53:08 - already a wall-clock time, shown as it is
                return format(parse(s.substring(0, 19), "yyyy-MM-dd HH:mm:ss", IST));
            }
        } catch (ParseException ignored) {
            // fall through to the original text
        }
        return raw;
    }

    private static Date parse(String text, String pattern, TimeZone zone) throws ParseException {
        SimpleDateFormat in = new SimpleDateFormat(pattern, Locale.US);
        in.setTimeZone(zone);
        in.setLenient(false);
        return in.parse(text);
    }

    private static String format(Date d) {
        SimpleDateFormat out = new SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault());
        out.setTimeZone(IST);
        return out.format(d);
    }
}

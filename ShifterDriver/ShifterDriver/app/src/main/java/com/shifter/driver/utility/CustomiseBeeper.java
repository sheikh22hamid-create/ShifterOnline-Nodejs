package com.shifter.driver.utility;

import android.content.Context;
import android.media.AudioManager;
import android.media.ToneGenerator;

import java.util.HashSet;
import java.util.Set;

/**
 * One short beep when a new Customise Order becomes available. The same order can arrive more than once (socket
 * redelivery, then the push), so each order id beeps at most once per app run. Silent / vibrate mode stays silent
 * and the beep follows the notification volume, so the phone's own sound settings are respected.
 */
public final class CustomiseBeeper {
    private static final Set<String> BEEPED = new HashSet<>();

    private CustomiseBeeper() {}

    /** @return true if a beep was played */
    public static synchronized boolean beepOnce(Context context, String orderId) {
        if (context == null || orderId == null || !BEEPED.add(orderId)) return false;
        try {
            AudioManager audio = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
            if (audio == null || audio.getRingerMode() != AudioManager.RINGER_MODE_NORMAL) return false;
            ToneGenerator tone = new ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80);
            tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 350);
            new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(tone::release, 1000);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}

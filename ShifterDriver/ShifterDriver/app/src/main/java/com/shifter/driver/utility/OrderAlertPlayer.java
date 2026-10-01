package com.shifter.driver.utility;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.shifter.driver.R;

/**
 * Manages order alert playback (Voice Announcement vs Classic Ringtone)
 * based on the driver's saved preference.
 */
public class OrderAlertPlayer {
    private static final String TAG = "OrderAlertPlayer";

    public static final String MODE_VOICE = "VOICE";
    public static final String MODE_RINGTONE = "RINGTONE";

    private static MediaPlayer activeMediaPlayer = null;
    private static final Handler mainHandler = new Handler(Looper.getMainLooper());
    private static Runnable stopPreviewRunnable = null;

    /**
     * Gets driver's selected alert sound mode. Defaults to VOICE.
     */
    public static String getSoundMode(Context context) {
        if (context == null) return MODE_VOICE;
        try {
            SessionManager sessionManager = new SessionManager(context.getApplicationContext());
            String mode = sessionManager.getStringData(SessionManager.orderAlertSoundMode);
            if (mode == null || mode.trim().isEmpty()) {
                return MODE_VOICE;
            }
            return mode;
        } catch (Exception e) {
            Log.e(TAG, "Error getting sound mode", e);
            return MODE_VOICE;
        }
    }

    /**
     * Saves driver's selected alert sound mode ("VOICE" or "RINGTONE").
     */
    public static void setSoundMode(Context context, String mode) {
        if (context == null) return;
        try {
            SessionManager sessionManager = new SessionManager(context.getApplicationContext());
            sessionManager.setStringData(SessionManager.orderAlertSoundMode, mode);
            Log.d(TAG, "Sound mode saved: " + mode);
        } catch (Exception e) {
            Log.e(TAG, "Error saving sound mode", e);
        }
    }

    /**
     * Plays either Voice Announcement or Classic Ringtone when an order arrives.
     */
    public static void playOrderAlert(Context context, String announcementText) {
        if (context == null) return;
        Context appContext = context.getApplicationContext();

        try {
            AudioManager audioManager = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null && audioManager.getStreamVolume(AudioManager.STREAM_RING) <= 0) {
                Log.d(TAG, "STREAM_RING volume is 0 — skipping order alert sound");
                return;
            }

            stop();

            String mode = getSoundMode(appContext);
            Log.d(TAG, "playOrderAlert mode=" + mode);

            if (MODE_RINGTONE.equalsIgnoreCase(mode)) {
                playRingtoneLoop(appContext);
            } else {
                if (announcementText != null && !announcementText.trim().isEmpty()) {
                    OrderVoiceAnnouncer.announce(announcementText);
                    Log.d(TAG, "Voice announcement initiated");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error in playOrderAlert", e);
        }
    }

    /**
     * Plays a short (3-second) preview of the given mode in settings/dialog.
     */
    public static void playPreview(Context context, String mode) {
        if (context == null) return;
        Context appContext = context.getApplicationContext();

        stop();

        try {
            AudioManager audioManager = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null && audioManager.getStreamVolume(AudioManager.STREAM_RING) <= 0) {
                Log.d(TAG, "STREAM_RING volume is 0 during preview");
            }

            if (MODE_RINGTONE.equalsIgnoreCase(mode)) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();

                activeMediaPlayer = MediaPlayer.create(appContext, R.raw.movigo_ringtone, attrs, 0);
                if (activeMediaPlayer != null) {
                    activeMediaPlayer.setLooping(false);
                    activeMediaPlayer.start();

                    if (stopPreviewRunnable != null) {
                        mainHandler.removeCallbacks(stopPreviewRunnable);
                    }
                    stopPreviewRunnable = OrderAlertPlayer::stopRingtone;
                    mainHandler.postDelayed(stopPreviewRunnable, 3500);
                }
            } else {
                OrderVoiceAnnouncer.announce("Aapse do kilometer door order hai. Jaldi accept karein.");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing preview", e);
        }
    }

    /**
     * Plays the new-order ringtone once (order cancelled alert). Same sound as
     * a new order, but never loops and ignores the VOICE/RINGTONE preference:
     * a cancellation must be unmistakable. Skipped only when the ring volume
     * is muted, like every other order alert.
     */
    public static synchronized void playOnce(Context context) {
        if (context == null) return;
        Context appContext = context.getApplicationContext();
        try {
            AudioManager audioManager = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null && audioManager.getStreamVolume(AudioManager.STREAM_RING) <= 0) {
                Log.d(TAG, "STREAM_RING volume is 0 - skipping cancel alert sound");
                return;
            }
            stop();
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            activeMediaPlayer = MediaPlayer.create(appContext, R.raw.movigo_ringtone, attrs, 0);
            if (activeMediaPlayer != null) {
                activeMediaPlayer.setLooping(false);
                activeMediaPlayer.setOnCompletionListener(mp -> stopRingtone());
                activeMediaPlayer.start();
                Log.d(TAG, "Cancel alert ringtone played once");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing cancel alert ringtone", e);
        }
    }

    private static synchronized void playRingtoneLoop(Context context) {
        try {
            stopRingtone();

            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();

            activeMediaPlayer = MediaPlayer.create(context, R.raw.movigo_ringtone, attrs, 0);
            if (activeMediaPlayer != null) {
                activeMediaPlayer.setLooping(true);
                activeMediaPlayer.start();
                Log.d(TAG, "Ringtone looping started");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing ringtone loop", e);
        }
    }

    /**
     * Stops both Voice Announcement and Classic Ringtone.
     */
    public static synchronized void stop() {
        if (stopPreviewRunnable != null) {
            mainHandler.removeCallbacks(stopPreviewRunnable);
            stopPreviewRunnable = null;
        }
        try {
            OrderVoiceAnnouncer.stop();
        } catch (Exception ignored) {}
        stopRingtone();
    }

    private static synchronized void stopRingtone() {
        if (activeMediaPlayer != null) {
            try {
                if (activeMediaPlayer.isPlaying()) {
                    activeMediaPlayer.stop();
                }
                activeMediaPlayer.release();
            } catch (Exception ignored) {
            }
            activeMediaPlayer = null;
        }
    }
}

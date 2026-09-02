package com.shifter.driver.activity;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;

import com.google.android.exoplayer2.ExoPlayer;
import com.google.android.exoplayer2.MediaItem;
import com.google.android.exoplayer2.PlaybackException;
import com.google.android.exoplayer2.Player;
import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.shifter.driver.R;
import com.shifter.driver.databinding.ActivityTrainingVideoBinding;
import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.TrainingData;
import com.shifter.driver.retrofit.APIClient;
import com.shifter.driver.retrofit.GetResult;
import com.shifter.driver.utility.CustPrograssbar;
import com.shifter.driver.utility.SessionManager;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Locale;

import okhttp3.MediaType;
import okhttp3.RequestBody;
import retrofit2.Call;

public class TrainingVideoActivity extends AppCompatActivity implements GetResult.MyListener {

    private ActivityTrainingVideoBinding binding;
    private ExoPlayer player;
    private SessionManager sessionManager;
    private RiderData riderData;
    private CustPrograssbar custPrograssbar;

    private String videoUrl = "";
    private String videoId = "training_v1";
    private String videoTitle = "Shifter Driver Training";
    private int savedPositionSeconds = 0;
    private int totalDurationSeconds = 0;
    private float watchProgress = 0.0f;
    private boolean isCompleted = false;
    private boolean hasRestoredPosition = false;

    private Handler progressHandler = new Handler(Looper.getMainLooper());
    private static final long UI_UPDATE_INTERVAL_MS = 500L;
    private static final long SERVER_SYNC_INTERVAL_MS = 8000L; // 8 seconds
    private long lastServerSyncTimeMs = 0L;

    private static final String PREF_NAME = "shifter_driver_training_prefs";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Keep screen awake during training playback
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        // Light Status Bar with dark icons to match app theme
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            getWindow().setStatusBarColor(ContextCompat.getColor(this, R.color.white));
        }

        binding = ActivityTrainingVideoBinding.inflate(getLayoutInflater());
        setContentView(binding.getRoot());

        sessionManager = new SessionManager(this);
        riderData = sessionManager.getUserDetails();
        custPrograssbar = new CustPrograssbar();

        initIntentExtras();
        setupClickListeners();

        // Restore local position cache if available
        restoreLocalProgress();

        // Fetch fresh training status from server if not passed
        if (videoUrl.isEmpty()) {
            fetchTrainingStatus();
        } else {
            initializePlayer();
        }
    }

    private void initIntentExtras() {
        Intent intent = getIntent();
        if (intent != null) {
            videoUrl = intent.getStringExtra("video_url") != null ? intent.getStringExtra("video_url") : "";
            videoId = intent.getStringExtra("video_id") != null ? intent.getStringExtra("video_id") : "training_v1";
            videoTitle = intent.getStringExtra("video_title") != null ? intent.getStringExtra("video_title") : "Shifter Driver Training";
            savedPositionSeconds = intent.getIntExtra("current_position_seconds", 0);
            watchProgress = intent.getFloatExtra("watch_progress", 0.0f);
            isCompleted = intent.getBooleanExtra("is_completed", false);
        }
    }

    private void restoreLocalProgress() {
        if (riderData == null) return;
        SharedPreferences sp = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        int localPos = sp.getInt("pos_" + riderData.getId() + "_" + videoId, 0);
        float localProg = sp.getFloat("prog_" + riderData.getId() + "_" + videoId, 0.0f);
        if (localPos > savedPositionSeconds) {
            savedPositionSeconds = localPos;
        }
        if (localProg > watchProgress) {
            watchProgress = localProg;
        }
    }

    private void saveLocalProgress(int posSec, float prog) {
        if (riderData == null) return;
        SharedPreferences sp = getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
        sp.edit()
                .putInt("pos_" + riderData.getId() + "_" + videoId, posSec)
                .putFloat("prog_" + riderData.getId() + "_" + videoId, prog)
                .apply();
    }

    private void setupClickListeners() {
        // Center Big Play/Pause
        binding.btnCenterPlayPause.setOnClickListener(v -> togglePlayPause());

        // Bottom Play/Pause
        binding.btnBottomPlayPause.setOnClickListener(v -> togglePlayPause());

        // Touch Blocker (tapping on video toggles play/pause)
        binding.touchBlocker.setOnClickListener(v -> togglePlayPause());

        // Unlock Home Button
        binding.btnUnlockHome.setOnClickListener(v -> {
            if (isCompleted || watchProgress >= 99.0f) {
                navigateToHome();
            } else {
                Toast.makeText(this, "Please watch the video 100% to unlock Home Dashboard", Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void fetchTrainingStatus() {
        if (riderData == null) {
            Toast.makeText(this, "Driver session error", Toast.LENGTH_SHORT).show();
            finish();
            return;
        }

        custPrograssbar.prograssCreate(this);

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", String.valueOf(riderData.getId()));
            jsonObject.put("rid", String.valueOf(riderData.getId()));
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().getTrainingStatus(body);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "GET_STATUS");
    }

    private void initializePlayer() {
        if (videoUrl == null || videoUrl.trim().isEmpty()) {
            Toast.makeText(this, "Training video not available. Please contact admin.", Toast.LENGTH_LONG).show();
            return;
        }

        binding.tvVideoTitle.setText(videoTitle);
        restoreLocalProgress();

        if (player == null) {
            player = new ExoPlayer.Builder(this).build();
            binding.playerView.setPlayer(player);

            MediaItem mediaItem = MediaItem.fromUri(Uri.parse(videoUrl.trim()));
            player.setMediaItem(mediaItem);

            player.addListener(new Player.Listener() {
                @Override
                public void onPlaybackStateChanged(int playbackState) {
                    if (playbackState == Player.STATE_BUFFERING) {
                        binding.pbVideoLoading.setVisibility(View.VISIBLE);
                    } else if (playbackState == Player.STATE_READY) {
                        binding.pbVideoLoading.setVisibility(View.GONE);
                        long durationMs = player.getDuration();
                        if (durationMs > 0) {
                            totalDurationSeconds = (int) (durationMs / 1000L);
                        }

                        // Seek to saved position on first ready
                        if (!hasRestoredPosition && savedPositionSeconds > 0) {
                            hasRestoredPosition = true;
                            long seekMs = Math.min((long) savedPositionSeconds * 1000L, durationMs > 0 ? durationMs - 1000L : (long) savedPositionSeconds * 1000L);
                            player.seekTo(seekMs);
                        }
                    } else if (playbackState == Player.STATE_ENDED) {
                        binding.pbVideoLoading.setVisibility(View.GONE);
                        handleTrainingCompleted();
                    }
                }

                @Override
                public void onIsPlayingChanged(boolean isPlaying) {
                    updatePlayPauseUI(isPlaying);
                }

                @Override
                public void onPlayerError(@NonNull PlaybackException error) {
                    binding.pbVideoLoading.setVisibility(View.GONE);
                    Toast.makeText(TrainingVideoActivity.this, "Video loading error: " + error.getMessage(), Toast.LENGTH_SHORT).show();
                }
            });

            player.prepare();

            // Set seek ahead of time if known
            if (savedPositionSeconds > 0) {
                player.seekTo((long) savedPositionSeconds * 1000L);
            }

            player.play();
        }

        startProgressTracker();
        updateUI();
    }

    private void togglePlayPause() {
        if (player == null) return;
        if (player.isPlaying()) {
            player.pause();
        } else {
            // If already ended, restart or resume
            if (player.getPlaybackState() == Player.STATE_ENDED) {
                player.seekTo(0);
            }
            player.play();
        }
    }

    private void updatePlayPauseUI(boolean isPlaying) {
        if (isPlaying) {
            binding.ivCenterPlayIcon.setImageResource(android.R.drawable.ic_media_pause);
            binding.btnBottomPlayPause.setImageResource(android.R.drawable.ic_media_pause);
            // Hide center button when playing smoothly
            binding.btnCenterPlayPause.animate().alpha(0.0f).setDuration(500).start();
        } else {
            binding.ivCenterPlayIcon.setImageResource(android.R.drawable.ic_media_play);
            binding.btnBottomPlayPause.setImageResource(android.R.drawable.ic_media_play);
            binding.btnCenterPlayPause.animate().alpha(1.0f).setDuration(200).start();
        }
    }

    private final Runnable progressRunnable = new Runnable() {
        @Override
        public void run() {
            if (player != null && (player.getPlaybackState() == Player.STATE_READY || player.isPlaying())) {
                long currentPosMs = player.getCurrentPosition();
                long durationMs = player.getDuration();

                int currentPosSec = (int) (currentPosMs / 1000L);
                int durationSec = durationMs > 0 ? (int) (durationMs / 1000L) : totalDurationSeconds;

                if (durationSec > 0) {
                    totalDurationSeconds = durationSec;
                    float calcProgress = ((float) currentPosSec / (float) durationSec) * 100.0f;
                    if (calcProgress > watchProgress) {
                        watchProgress = Math.min(calcProgress, 100.0f);
                    }

                    // Format Time: mm:ss / mm:ss
                    String timeStr = String.format(Locale.getDefault(), "%02d:%02d / %02d:%02d",
                            currentPosSec / 60, currentPosSec % 60,
                            durationSec / 60, durationSec % 60);
                    binding.tvVideoTime.setText(timeStr);

                    int intProgress = Math.round(watchProgress);
                    binding.tvProgressPercentBadge.setText(intProgress + "%");
                    binding.tvWatchProgressText.setText(intProgress + "%");
                    binding.pbOverallProgress.setProgress(intProgress);
                    binding.pbVideoBottomLine.setProgress((int) (((float) currentPosMs / durationMs) * 100));

                    // Save locally on every tick
                    saveLocalProgress(currentPosSec, watchProgress);

                    // Sync with server periodically every 8-10s
                    long now = System.currentTimeMillis();
                    if (now - lastServerSyncTimeMs >= SERVER_SYNC_INTERVAL_MS) {
                        lastServerSyncTimeMs = now;
                        saveProgressToServer(currentPosSec, durationSec, watchProgress);
                    }
                }
            }
            progressHandler.postDelayed(this, UI_UPDATE_INTERVAL_MS);
        }
    };

    private void startProgressTracker() {
        progressHandler.removeCallbacks(progressRunnable);
        progressHandler.post(progressRunnable);
    }

    private void stopProgressTracker() {
        progressHandler.removeCallbacks(progressRunnable);
    }

    private void saveProgressToServer(int currentPosSec, int durationSec, float progress) {
        if (riderData == null) return;

        saveLocalProgress(currentPosSec, progress);

        JSONObject jsonObject = new JSONObject();
        try {
            jsonObject.put("rider_id", riderData.getId());
            jsonObject.put("rid", riderData.getId());
            jsonObject.put("video_id", videoId);
            jsonObject.put("video_url", videoUrl);
            jsonObject.put("watch_progress", progress);
            jsonObject.put("current_position_seconds", currentPosSec);
            jsonObject.put("total_duration_seconds", durationSec);
        } catch (JSONException e) {
            e.printStackTrace();
        }

        RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
        Call<JsonObject> call = APIClient.getInterface().saveTrainingProgress(body);
        GetResult getResult = new GetResult();
        getResult.setMyListener(this);
        getResult.callForLogin(call, "SAVE_PROGRESS");
    }

    private void handleTrainingCompleted() {
        isCompleted = true;
        watchProgress = 100.0f;
        updateUI();

        if (riderData != null) {
            saveLocalProgress(totalDurationSeconds, 100.0f);

            JSONObject jsonObject = new JSONObject();
            try {
                jsonObject.put("rider_id", riderData.getId());
                jsonObject.put("rid", riderData.getId());
                jsonObject.put("video_id", videoId);
                jsonObject.put("video_url", videoUrl);
            } catch (JSONException e) {
                e.printStackTrace();
            }

            RequestBody body = RequestBody.create(MediaType.parse("application/json"), jsonObject.toString());
            Call<JsonObject> call = APIClient.getInterface().completeTraining(body);
            GetResult getResult = new GetResult();
            getResult.setMyListener(this);
            getResult.callForLogin(call, "COMPLETE_TRAINING");
        }

        // Show Success Celebration Dialog
        new AlertDialog.Builder(this)
                .setTitle("🎉 Training Completed!")
                .setMessage("Congratulations! You have successfully completed the mandatory driver training. Your Home dashboard is now unlocked.")
                .setPositiveButton("Go To Home", (dialog, which) -> navigateToHome())
                .setCancelable(false)
                .show();
    }

    private void updateUI() {
        if (isCompleted || watchProgress >= 99.0f) {
            binding.tvStatusBadge.setText("COMPLETED");
            binding.tvStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.green));
            binding.tvStatusBadge.setBackgroundResource(R.drawable.bg_badge_green_light);

            binding.btnUnlockHome.setText("✓ Training Complete — Enter Home Dashboard");
            binding.btnUnlockHome.setAlpha(1.0f);
            binding.btnUnlockHome.setBackgroundResource(R.drawable.rounded_button_green);

            binding.tvSyncStatus.setText("✓ Training successfully completed and saved on server!");
        } else {
            binding.tvStatusBadge.setText("IN PROGRESS");
            binding.tvStatusBadge.setTextColor(ContextCompat.getColor(this, R.color.purple_500));
            binding.tvStatusBadge.setBackgroundResource(R.drawable.bg_badge_orange_light);

            binding.btnUnlockHome.setText("🔒 Complete Training To Unlock Home (" + Math.round(watchProgress) + "%)");
            binding.btnUnlockHome.setAlpha(0.7f);
        }
    }

    private void navigateToHome() {
        Intent intent = new Intent(TrainingVideoActivity.this, HomeActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
        startActivity(intent);
        finish();
    }

    @Override
    public void callback(JsonObject result, String callNo) {
        custPrograssbar.closePrograssBar();
        try {
            if ("GET_STATUS".equalsIgnoreCase(callNo)) {
                if (result != null && result.has("Result") && result.get("Result").getAsString().equalsIgnoreCase("true")) {
                    Gson gson = new Gson();
                    TrainingData data = gson.fromJson(result.toString(), TrainingData.class);
                    if (data != null) {
                        videoUrl = data.getVideoUrl();
                        videoId = data.getVideoId();
                        videoTitle = data.getVideoTitle();
                        if (data.getCurrentPositionSeconds() > savedPositionSeconds) {
                            savedPositionSeconds = data.getCurrentPositionSeconds();
                        }
                        if (data.getWatchProgress() > watchProgress) {
                            watchProgress = data.getWatchProgress();
                        }
                        isCompleted = data.isCompleted();

                        // If already completed on server, go straight to home
                        if (isCompleted) {
                            navigateToHome();
                            return;
                        }

                        initializePlayer();
                    }
                } else {
                    Toast.makeText(this, "Could not fetch training details", Toast.LENGTH_SHORT).show();
                }
            } else if ("SAVE_PROGRESS".equalsIgnoreCase(callNo)) {
                // Background sync done quietly
            } else if ("COMPLETE_TRAINING".equalsIgnoreCase(callNo)) {
                isCompleted = true;
                updateUI();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (player != null && !player.isPlaying() && !isCompleted) {
            player.play();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) {
            player.pause();
            int currentPosSec = (int) (player.getCurrentPosition() / 1000L);
            int durationSec = player.getDuration() > 0 ? (int) (player.getDuration() / 1000L) : totalDurationSeconds;
            saveLocalProgress(currentPosSec, watchProgress);
            saveProgressToServer(currentPosSec, durationSec, watchProgress);
        }
    }

    @Override
    protected void onStop() {
        super.onStop();
        if (player != null) {
            int currentPosSec = (int) (player.getCurrentPosition() / 1000L);
            saveLocalProgress(currentPosSec, watchProgress);
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        stopProgressTracker();
        if (player != null) {
            int currentPosSec = (int) (player.getCurrentPosition() / 1000L);
            saveLocalProgress(currentPosSec, watchProgress);
            player.release();
            player = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (isCompleted) {
            navigateToHome();
        } else {
            new AlertDialog.Builder(this)
                    .setTitle("Training Incomplete")
                    .setMessage("Watching this training video is mandatory before accessing delivery orders. Your progress (" + Math.round(watchProgress) + "%) is saved. Are you sure you want to exit?")
                    .setPositiveButton("Exit App", (dialog, which) -> finish())
                    .setNegativeButton("Continue Watching", null)
                    .show();
        }
    }
}

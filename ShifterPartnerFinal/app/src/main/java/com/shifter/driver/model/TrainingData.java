package com.shifter.driver.model;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

public class TrainingData {

    @SerializedName("ResponseCode")
    @Expose
    private String responseCode;

    @SerializedName("Result")
    @Expose
    private String result;

    @SerializedName("ResponseMsg")
    @Expose
    private String responseMsg;

    @SerializedName("rider_id")
    @Expose
    private int riderId;

    @SerializedName("training_required")
    @Expose
    private int trainingRequired;

    @SerializedName("training_status")
    @Expose
    private String trainingStatus;

    @SerializedName("video_id")
    @Expose
    private String videoId;

    @SerializedName("video_title")
    @Expose
    private String videoTitle;

    @SerializedName("video_url")
    @Expose
    private String videoUrl;

    @SerializedName("watch_progress")
    @Expose
    private float watchProgress;

    @SerializedName("current_position_seconds")
    @Expose
    private int currentPositionSeconds;

    @SerializedName("total_duration_seconds")
    @Expose
    private int totalDurationSeconds;

    @SerializedName("completed_at")
    @Expose
    private String completedAt;

    public String getResponseCode() {
        return responseCode;
    }

    public void setResponseCode(String responseCode) {
        this.responseCode = responseCode;
    }

    public String getResult() {
        return result;
    }

    public void setResult(String result) {
        this.result = result;
    }

    public String getResponseMsg() {
        return responseMsg;
    }

    public void setResponseMsg(String responseMsg) {
        this.responseMsg = responseMsg;
    }

    public int getRiderId() {
        return riderId;
    }

    public void setRiderId(int riderId) {
        this.riderId = riderId;
    }

    public int getTrainingRequired() {
        return trainingRequired;
    }

    public void setTrainingRequired(int trainingRequired) {
        this.trainingRequired = trainingRequired;
    }

    public String getTrainingStatus() {
        return trainingStatus != null ? trainingStatus : "NOT_STARTED";
    }

    public void setTrainingStatus(String trainingStatus) {
        this.trainingStatus = trainingStatus;
    }

    public boolean isCompleted() {
        return "COMPLETED".equalsIgnoreCase(trainingStatus);
    }

    public String getVideoId() {
        return videoId != null ? videoId : "training_v1";
    }

    public void setVideoId(String videoId) {
        this.videoId = videoId;
    }

    public String getVideoTitle() {
        return videoTitle != null ? videoTitle : "Driver Training";
    }

    public void setVideoTitle(String videoTitle) {
        this.videoTitle = videoTitle;
    }

    public String getVideoUrl() {
        return videoUrl;
    }

    public void setVideoUrl(String videoUrl) {
        this.videoUrl = videoUrl;
    }

    public float getWatchProgress() {
        return watchProgress;
    }

    public void setWatchProgress(float watchProgress) {
        this.watchProgress = watchProgress;
    }

    public int getCurrentPositionSeconds() {
        return currentPositionSeconds;
    }

    public void setCurrentPositionSeconds(int currentPositionSeconds) {
        this.currentPositionSeconds = currentPositionSeconds;
    }

    public int getTotalDurationSeconds() {
        return totalDurationSeconds;
    }

    public void setTotalDurationSeconds(int totalDurationSeconds) {
        this.totalDurationSeconds = totalDurationSeconds;
    }

    public String getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(String completedAt) {
        this.completedAt = completedAt;
    }
}

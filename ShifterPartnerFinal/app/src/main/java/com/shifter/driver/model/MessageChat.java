package com.shifter.driver.model;

public class MessageChat {
    private String senderId, receiverId, message;
    private long timestamp;

    public MessageChat() { } // Required for Firebase

    public MessageChat(String senderId, String receiverId, String message, long timestamp) {
        this.senderId = senderId;
        this.receiverId = receiverId;
        this.message = message;
        this.timestamp = timestamp;
    }

    // Getters and Setters
    public String getSenderId() { return senderId; }
    public String getReceiverId() { return receiverId; }
    public String getMessage() { return message; }
    public long getTimestamp() { return timestamp; }
}

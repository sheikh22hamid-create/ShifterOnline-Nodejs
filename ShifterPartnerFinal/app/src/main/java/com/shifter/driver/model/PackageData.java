package com.shifter.driver.model;

public class PackageData {
    private String id;
    private String title;
    private String city_id;
    private String km;
    private String time;
    private String status; // String mein change karo
    private String driver_active;

    public String getDriver_active() { return driver_active; }
    public void setDriver_active(String driver_active) { this.driver_active = driver_active; }

    public String getId() { return id; }
    public void setId(String id) { this.id = id; }

    public String getTitle() { return title; }
    public void setTitle(String title) { this.title = title; }

    public String getCity_id() { return city_id; }
    public void setCity_id(String city_id) { this.city_id = city_id; }

    public String getKm() { return km; }
    public void setKm(String km) { this.km = km; }

    public String getTime() { return time; }
    public void setTime(String time) { this.time = time; }

    public String getStatus() { return status; }
    public void setStatus(String status) { this.status = status; }

    @com.google.gson.annotations.SerializedName("driver_detail_image")
    private String driverDetailImage;

    @com.google.gson.annotations.SerializedName("user_detail_image")
    private String userDetailImage;

    public String getDriverDetailImage() { return driverDetailImage; }
    public void setDriverDetailImage(String driverDetailImage) { this.driverDetailImage = driverDetailImage; }

    public String getUserDetailImage() { return userDetailImage; }
    public void setUserDetailImage(String userDetailImage) { this.userDetailImage = userDetailImage; }

    // Helper method to check if status is active
    public boolean isActive() {
        return "1".equals(status);
    }
}
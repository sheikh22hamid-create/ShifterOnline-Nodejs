package com.shifter.driver.model;

import java.io.Serializable;

public class MonthlyDutyStatus implements Serializable {

    private boolean isMonthlyDriver;
    private Contract contract;
    private Zone zone;
    private Duty duty;

    public boolean isMonthlyDriver() {
        return isMonthlyDriver;
    }

    public void setMonthlyDriver(boolean monthlyDriver) {
        isMonthlyDriver = monthlyDriver;
    }

    public Contract getContract() {
        return contract;
    }

    public void setContract(Contract contract) {
        this.contract = contract;
    }

    public Zone getZone() {
        return zone;
    }

    public void setZone(Zone zone) {
        this.zone = zone;
    }

    public Duty getDuty() {
        return duty;
    }

    public void setDuty(Duty duty) {
        this.duty = duty;
    }

    public String getShiftStartTime() {
        return contract != null && contract.getShiftStartTime() != null ? contract.getShiftStartTime() : "10:00 AM";
    }

    public String getShiftEndTime() {
        return contract != null && contract.getShiftEndTime() != null ? contract.getShiftEndTime() : "08:00 PM";
    }

    public int getTargetHoursDaily() {
        return contract != null ? (int) Math.round(contract.getTargetShiftHours()) : 10;
    }

    public int getTodayDutyMinutes() {
        return duty != null ? duty.getInZoneMinutes() : 0;
    }

    public double getTodaySalaryEarned() {
        return duty != null ? duty.getDailySalary() : 0.0;
    }

    public boolean isCurrentlyPunchedIn() {
        return duty != null && duty.isPunchedIn();
    }

    public double getTodayOvertimePay() {
        return duty != null ? duty.getOvertimePay() : 0.0;
    }

    public int getTodayOvertimeMinutes() {
        return duty != null ? duty.getOvertimeMinutes() : 0;
    }

    public double getTodayCashCollected() {
        return duty != null ? duty.getCashCollected() : 0.0;
    }

    public static class Contract implements Serializable {
        private int id;
        private String shiftStartTime;
        private String shiftEndTime;
        private double targetShiftHours;
        private double monthlyBaseSalary;
        private double overtimeHourlyRate;
        private int allowedBreakMinutes;
        private String status;

        public int getId() { return id; }
        public void setId(int id) { this.id = id; }
        public String getShiftStartTime() { return shiftStartTime; }
        public void setShiftStartTime(String shiftStartTime) { this.shiftStartTime = shiftStartTime; }
        public String getShiftEndTime() { return shiftEndTime; }
        public void setShiftEndTime(String shiftEndTime) { this.shiftEndTime = shiftEndTime; }
        public double getTargetShiftHours() { return targetShiftHours; }
        public void setTargetShiftHours(double targetShiftHours) { this.targetShiftHours = targetShiftHours; }
        public double getMonthlyBaseSalary() { return monthlyBaseSalary; }
        public void setMonthlyBaseSalary(double monthlyBaseSalary) { this.monthlyBaseSalary = monthlyBaseSalary; }
        public double getOvertimeHourlyRate() { return overtimeHourlyRate; }
        public void setOvertimeHourlyRate(double overtimeHourlyRate) { this.overtimeHourlyRate = overtimeHourlyRate; }
        public int getAllowedBreakMinutes() { return allowedBreakMinutes; }
        public void setAllowedBreakMinutes(int allowedBreakMinutes) { this.allowedBreakMinutes = allowedBreakMinutes; }
        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }
    }

    public static class Zone implements Serializable {
        private int id;
        private String name;
        private double centerLat;
        private double centerLng;
        private double radiusKm;
        private String polygonGeojson;

        public int getId() { return id; }
        public void setId(int id) { this.id = id; }
        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public double getCenterLat() { return centerLat; }
        public void setCenterLat(double centerLat) { this.centerLat = centerLat; }
        public double getCenterLng() { return centerLng; }
        public void setCenterLng(double centerLng) { this.centerLng = centerLng; }
        public double getRadiusKm() { return radiusKm; }
        public void setRadiusKm(double radiusKm) { this.radiusKm = radiusKm; }
        public String getPolygonGeojson() { return polygonGeojson; }
        public void setPolygonGeojson(String polygonGeojson) { this.polygonGeojson = polygonGeojson; }
    }

    public static class Duty implements Serializable {
        private boolean isPunchedIn;
        private String punchInAt;
        private String punchOutAt;
        private int inZoneMinutes;
        private int outZoneMinutes;
        private int overtimeMinutes;
        private double overtimePay;
        private double cashCollected;
        private int totalOnlineMinutes;
        private int targetMinutes;
        private double dailySalary;
        private int ordersCompleted;

        public boolean isPunchedIn() { return isPunchedIn; }
        public void setPunchedIn(boolean punchedIn) { isPunchedIn = punchedIn; }
        public String getPunchInAt() { return punchInAt; }
        public void setPunchInAt(String punchInAt) { this.punchInAt = punchInAt; }
        public String getPunchOutAt() { return punchOutAt; }
        public void setPunchOutAt(String punchOutAt) { this.punchOutAt = punchOutAt; }
        public int getInZoneMinutes() { return inZoneMinutes; }
        public void setInZoneMinutes(int inZoneMinutes) { this.inZoneMinutes = inZoneMinutes; }
        public int getOutZoneMinutes() { return outZoneMinutes; }
        public void setOutZoneMinutes(int outZoneMinutes) { this.outZoneMinutes = outZoneMinutes; }
        public int getOvertimeMinutes() { return overtimeMinutes; }
        public void setOvertimeMinutes(int overtimeMinutes) { this.overtimeMinutes = overtimeMinutes; }
        public double getOvertimePay() { return overtimePay; }
        public void setOvertimePay(double overtimePay) { this.overtimePay = overtimePay; }
        public double getCashCollected() { return cashCollected; }
        public void setCashCollected(double cashCollected) { this.cashCollected = cashCollected; }
        public int getTotalOnlineMinutes() { return totalOnlineMinutes; }
        public void setTotalOnlineMinutes(int totalOnlineMinutes) { this.totalOnlineMinutes = totalOnlineMinutes; }
        public int getTargetMinutes() { return targetMinutes; }
        public void setTargetMinutes(int targetMinutes) { this.targetMinutes = targetMinutes; }
        public double getDailySalary() { return dailySalary; }
        public void setDailySalary(double dailySalary) { this.dailySalary = dailySalary; }
        public int getOrdersCompleted() { return ordersCompleted; }
        public void setOrdersCompleted(int ordersCompleted) { this.ordersCompleted = ordersCompleted; }
    }
}

package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;

import com.google.gson.annotations.SerializedName;

public class PDOrderItem implements Parcelable {

	@SerializedName("pick_type")
	private final String pickType;

	@SerializedName("distance")
	private final String distance;

	@SerializedName("order_flow_id")
	private final String orderFlowId;

	@SerializedName("customer_paddress")
	private final String customerPaddress;

	@SerializedName("description")
	private final String description;

	@SerializedName("customer_daddress")
	private final String customerDaddress;

	@SerializedName("customer_pmobile")
	private final String customerPmobile;

	@SerializedName("drop_type")
	private final String dropType;

	@SerializedName("pick_name")
	private final String pickName;

	@SerializedName("order_date")
	private final String orderDate;

	@SerializedName("plong")
	private final double plong;

	@SerializedName("customer_dmobile")
	private final String customerDmobile;

	@SerializedName("total")
	private final String total;

	@SerializedName("dlong")
	private final double dlong;

	@SerializedName("dlat")
	private final double dlat;

	@SerializedName("drop_name")
	private final String dropName;

	@SerializedName("time_duration")
	private final String timeDuration;

	@SerializedName("id")
	private final String id;

	@SerializedName("plat")
	private final double plat;

	@SerializedName("status")
	private final String status;

	@SerializedName("order_user_id")
	private final String orderUserid;

	@SerializedName("loading_charge")
	private final String loadingCharge;

	@SerializedName("unloading_charge")
	private final String unloadingCharge;

	@SerializedName("service_charge")
	private final String serviceCharge;

	@SerializedName("wating_charge")
	private final String watingCharge;

	@SerializedName("free_waiting_time")
	private final String freeWaitingTime;

	@SerializedName("radius_range")
	private final String radiusRange;

	@SerializedName("radius_charge")
	private final String radiusCharge;

	@SerializedName("payment_status")
	private final String paymentStatus;

	@SerializedName("advance_payment_msg")
	private String advancePaymentMsg;

	@SerializedName("advance_payment_timer")
	private String advancePaymentTimer;

	@SerializedName("advance_payment")
	private String advancePayment;

	@SerializedName("minimum_charge")
	private String minimumCharge;

	@SerializedName("actual_pickup_charge")
	private String actualPickupCharge;

	@SerializedName("pickup_charge")
	private String pickupCharge;

	@SerializedName("pickup_to_drop_charge")
	private String pickupToDropCharge;

	@SerializedName("add_stop_charge")
	private String addStopCharge;

	@SerializedName("extra_waiting_time_charge")
	private String extraWaitingTimeCharge;

	@SerializedName("night_charge")
	private String nightCharge;

	@SerializedName("final_fare_amount")
	private String finalFareAmount;

	@SerializedName("commission")
	private String commission;

	@SerializedName("per_trip_charge")
	private String perTripCharge;

	@SerializedName("total_deductions")
	private String totalDeductions;

	@SerializedName("driver_total_earning")
	private String driverTotalEarning;

	@SerializedName("total_amount_by_user")
	private String totalAmountByUser;

	@SerializedName("cash_to_collect")
	private String cashToCollect;

	@SerializedName("cash_collected_from_user")
	private String cashCollectedFromUser;

	@SerializedName("wallet_adjustment")
	private String walletAdjustment;

	@SerializedName("wallet_adjustment_note")
	private String walletAdjustmentNote;

	@SerializedName("settlement_note")
	private String settlementNote;

	// Constructor to build from notification data (no API call needed)
	public PDOrderItem(String id, String orderFlowId, String pickName, String dropName,
	                   String customerPaddress, String customerDaddress,
	                   String customerPmobile, String customerDmobile,
	                   String pickType, String dropType,
	                   double plat, double plong, double dlat, double dlong,
	                   String total, String distance, String timeDuration,
	                   String orderDate, String description, String status, String orderUserid,
	                   String loadingCharge, String unloadingCharge, String serviceCharge,
	                   String watingCharge, String freeWaitingTime, String radiusRange, String radiusCharge,
	                   String paymentStatus) {
		this.id = id;
		this.orderFlowId = orderFlowId;
		this.pickName = pickName;
		this.dropName = dropName;
		this.customerPaddress = customerPaddress;
		this.customerDaddress = customerDaddress;
		this.customerPmobile = customerPmobile;
		this.customerDmobile = customerDmobile;
		this.pickType = pickType;
		this.dropType = dropType;
		this.plat = plat;
		this.plong = plong;
		this.dlat = dlat;
		this.dlong = dlong;
		this.total = total;
		this.distance = distance;
		this.timeDuration = timeDuration;
		this.orderDate = orderDate;
		this.description = description;
		this.status = status;
		this.orderUserid = orderUserid;
		this.loadingCharge = loadingCharge;
		this.unloadingCharge = unloadingCharge;
		this.serviceCharge = serviceCharge;
		this.watingCharge = watingCharge;
		this.freeWaitingTime = freeWaitingTime;
		this.radiusRange = radiusRange;
		this.radiusCharge = radiusCharge;
		this.paymentStatus = paymentStatus;
	}

	protected PDOrderItem(Parcel in) {
		pickType = in.readString();
		distance = in.readString();
		orderFlowId = in.readString();
		customerPaddress = in.readString();
		description = in.readString();
		customerDaddress = in.readString();
		customerPmobile = in.readString();
		dropType = in.readString();
		pickName = in.readString();
		orderDate = in.readString();
		plong = in.readDouble();
		customerDmobile = in.readString();
		total = in.readString();
		dlong = in.readDouble();
		dlat = in.readDouble();
		dropName = in.readString();
		timeDuration = in.readString();
		id = in.readString();
		plat = in.readDouble();
		status = in.readString();
		orderUserid = in.readString();
		loadingCharge = in.readString();
		unloadingCharge = in.readString();
		serviceCharge = in.readString();
		watingCharge = in.readString();
		freeWaitingTime = in.readString();
		radiusRange = in.readString();
		radiusCharge = in.readString();
		paymentStatus = in.readString();
	}

	public static final Creator<PDOrderItem> CREATOR = new Creator<PDOrderItem>() {
		@Override
		public PDOrderItem createFromParcel(Parcel in) {
			return new PDOrderItem(in);
		}

		@Override
		public PDOrderItem[] newArray(int size) {
			return new PDOrderItem[size];
		}
	};

	public String getPickType(){
		return pickType;
	}

	public String getDistance(){
		return distance;
	}

	public String getOrderFlowId(){
		return orderFlowId;
	}

	public String getCustomerPaddress(){
		return customerPaddress;
	}

	public String getDescription(){
		return description;
	}

	public String getCustomerDaddress(){
		return customerDaddress;
	}

	public String getCustomerPmobile(){
		return customerPmobile;
	}

	public String getDropType(){
		return dropType;
	}

	public String getPickName(){
		return pickName;
	}

	public String getOrderDate(){
		return orderDate;
	}

	public double getPlong(){
		return plong;
	}

	public String getCustomerDmobile(){
		return customerDmobile;
	}

	public String getTotal(){
		return total;
	}

	public double getDlong(){
		return dlong;
	}

	public double getDlat(){
		return dlat;
	}

	public String getDropName(){
		return dropName;
	}

	public String getTimeDuration(){
		return timeDuration;
	}

	public String getId(){
		return id;
	}

	public double getPlat(){
		return plat;
	}

	public String getStatus(){
		return status;
	}
	public String getOrderUserid(){
		return orderUserid;
	}

	public String getPaymentStatus(){
		return paymentStatus;
	}

	public String getLoadingCharge() {
		return loadingCharge;
	}

	public String getUnloadingCharge() {
		return unloadingCharge;
	}

	public String getServiceCharge() {
		return serviceCharge;
	}

	public String getWatingCharge() {
		return watingCharge;
	}

	public String getFreeWaitingTime() {
		return freeWaitingTime;
	}

	public String getRadiusRange() {
		return radiusRange;
	}

	public String getRadiusCharge() {
		return radiusCharge;
	}

	public String getAdvancePaymentMsg() {
		return advancePaymentMsg;
	}

	public String getAdvancePaymentTimer() {
		return advancePaymentTimer;
	}

	public String getAdvancePayment() {
		return advancePayment;
	}

	public String getMinimumCharge() {
		return minimumCharge;
	}

	public String getActualPickupCharge() {
		return actualPickupCharge;
	}

	public String getPickupCharge() {
		return pickupCharge;
	}

	public String getPickupToDropCharge() {
		return pickupToDropCharge;
	}

	public String getAddStopCharge() {
		return addStopCharge;
	}

	public String getExtraWaitingTimeCharge() {
		return extraWaitingTimeCharge;
	}

	public String getNightCharge() {
		return nightCharge;
	}

	public String getFinalFareAmount() {
		return finalFareAmount;
	}

	public String getCommission() {
		return commission;
	}

	public String getPerTripCharge() {
		return perTripCharge;
	}

	public String getTotalDeductions() {
		return totalDeductions;
	}

	public String getDriverTotalEarning() {
		return driverTotalEarning;
	}

	public String getTotalAmountByUser() {
		return totalAmountByUser;
	}

	public String getCashToCollect() {
		return cashToCollect;
	}

	public String getCashCollectedFromUser() {
		return cashCollectedFromUser;
	}

	public String getWalletAdjustment() {
		return walletAdjustment;
	}

	public String getWalletAdjustmentNote() {
		return walletAdjustmentNote;
	}

	public String getSettlementNote() {
		return settlementNote;
	}

	@Override
	public int describeContents() {
		return 0;
	}

	@Override
	public void writeToParcel(Parcel parcel, int i) {
		parcel.writeString(pickType);
		parcel.writeString(distance);
		parcel.writeString(orderFlowId);
		parcel.writeString(customerPaddress);
		parcel.writeString(description);
		parcel.writeString(customerDaddress);
		parcel.writeString(customerPmobile);
		parcel.writeString(dropType);
		parcel.writeString(pickName);
		parcel.writeString(orderDate);
		parcel.writeDouble(plong);
		parcel.writeString(customerDmobile);
		parcel.writeString(total);
		parcel.writeDouble(dlong);
		parcel.writeDouble(dlat);
		parcel.writeString(dropName);
		parcel.writeString(timeDuration);
		parcel.writeString(id);
		parcel.writeDouble(plat);
		parcel.writeString(status);
		parcel.writeString(orderUserid);
		parcel.writeString(loadingCharge);
		parcel.writeString(unloadingCharge);
		parcel.writeString(serviceCharge);
		parcel.writeString(watingCharge);
		parcel.writeString(freeWaitingTime);
		parcel.writeString(radiusRange);
		parcel.writeString(radiusCharge);
		parcel.writeString(paymentStatus);
	}
}
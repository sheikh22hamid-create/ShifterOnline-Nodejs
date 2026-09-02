package com.shifter.driver.model;

import android.os.Parcel;
import android.os.Parcelable;

import com.google.gson.annotations.Expose;
import com.google.gson.annotations.SerializedName;

import java.util.List;

public class BuyOrderHistoryItem  implements Parcelable {

	@SerializedName("pick_type")
	private final String pickType;

	@SerializedName("distance")
	private final String distance;

	@SerializedName("order_flow_id")
	private final String orderFlowId;

	@SerializedName("customer_daddress")
	private final String customerDaddress;

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

	@SerializedName("order_user_id")
	private final String orderuserid;

	@SerializedName("dlong")
	private final double dlong;

	@SerializedName("dlat")
	private final double dlat;



	@SerializedName("drop_name")
	private final String dropName;

	@SerializedName("time_duration")
	private final String timeDuration;

	@SerializedName("store_paddress")
	private final String storePaddress;

	@SerializedName("id")
	private final String id;

	@SerializedName("plat")
	private final double plat;

	@SerializedName("status")
	private final String status;

	@SerializedName("pay_total")
	private final String payTotal;

	@SerializedName("take_charge_percentage")
	private final String takeChargePercentage;

	@SerializedName("payout_charge")
	private final String payoutCharge;

	@SerializedName("item_list")
	@Expose
	private List<Items> itemList = null;


	protected BuyOrderHistoryItem(Parcel in) {
		pickType = in.readString();
		distance = in.readString();
		orderFlowId = in.readString();
		customerDaddress = in.readString();
		dropType = in.readString();
		pickName = in.readString();
		orderDate = in.readString();
		plong = in.readDouble();
		customerDmobile = in.readString();
		total = in.readString();
		orderuserid = in.readString();
		dlong = in.readDouble();
		dlat = in.readDouble();
		dropName = in.readString();
		timeDuration = in.readString();
		storePaddress = in.readString();
		id = in.readString();
		plat = in.readDouble();
		status = in.readString();
		payTotal = in.readString();
		takeChargePercentage = in.readString();
		payoutCharge = in.readString();
	}

	public static final Creator<BuyOrderHistoryItem> CREATOR = new Creator<BuyOrderHistoryItem>() {
		@Override
		public BuyOrderHistoryItem createFromParcel(Parcel in) {
			return new BuyOrderHistoryItem(in);
		}

		@Override
		public BuyOrderHistoryItem[] newArray(int size) {
			return new BuyOrderHistoryItem[size];
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

	public String getCustomerDaddress(){
		return customerDaddress;
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

	public String getStorePaddress(){
		return storePaddress;
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

	public String getPayTotal() {
		return payTotal;
	}

	public String getTakeChargePercentage() {
		return takeChargePercentage;
	}

	public String getPayoutCharge() {
		return payoutCharge;
	}

	public List<Items> getItemList() {
		return itemList;
	}

	public void setItemList(List<Items> itemList) {
		this.itemList = itemList;
	}

	public String getOrderuserid() {
		return orderuserid;
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
		parcel.writeString(customerDaddress);
		parcel.writeString(dropType);
		parcel.writeString(pickName);
		parcel.writeString(orderDate);
		parcel.writeDouble(plong);
		parcel.writeString(customerDmobile);
		parcel.writeString(total);
		parcel.writeString(orderuserid);
		parcel.writeDouble(dlong);
		parcel.writeDouble(dlat);
		parcel.writeString(dropName);
		parcel.writeString(timeDuration);
		parcel.writeString(storePaddress);
		parcel.writeString(id);
		parcel.writeDouble(plat);
		parcel.writeString(status);
		parcel.writeString(payTotal);
		parcel.writeString(takeChargePercentage);
		parcel.writeString(payoutCharge);
	}
}
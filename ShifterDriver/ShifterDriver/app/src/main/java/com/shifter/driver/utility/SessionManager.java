package com.shifter.driver.utility;

import android.content.Context;
import android.content.SharedPreferences;
import android.preference.PreferenceManager;

import com.shifter.driver.model.RiderData;
import com.shifter.driver.model.TampAddress;
import com.google.gson.Gson;

public class SessionManager {
    Context context;
    private final SharedPreferences mPrefs;
    SharedPreferences.Editor mEditor;
    public static String rtl = "rtl";
    public static String intro = "intro";
    public static String login = "login";
    public static String user = "users";
    public static String currency = "currency";
    public static String coupon = "coupon";
    public static String couponid = "couponid";
    public static String wallet = "wallet";
    public static String contact = "contact";
    public static String language = "language";
    public static String rejectTimer = "reject_timer";
    public static String orderAlertSoundMode = "order_alert_sound_mode";

    public SessionManager(Context context) {
        mPrefs = PreferenceManager.getDefaultSharedPreferences(context);
        mEditor = mPrefs.edit();
        this.context=context;
    }
    public void setStringData(String key, String val) {
        mEditor.putString(key, val);
        mEditor.commit();
    }
    public String getStringData(String key) {
        return mPrefs.getString(key, null);
    }
    public void setFloatData(String key, float val) {
        mEditor.putFloat(key, val);
        mEditor.commit();
    }
    public float getFloatData(String key) {
        return mPrefs.getFloat(key, 0);
    }
    public void setBooleanData(String key, Boolean val) {
        mEditor.putBoolean(key, val);
        mEditor.commit();
    }
    public boolean getBooleanData(String key) {
        return mPrefs.getBoolean(key, false);
    }

    public void setIntData(String key, int val) {
        mEditor.putInt(key, val);
        mEditor.commit();
    }
    public int getIntData(String key) {
        return mPrefs.getInt(key, 0);
    }

    public boolean isMonthlyDriver() {
        try {
            com.shifter.driver.model.MonthlyDutyStatus status = com.shifter.driver.utility.MonthlyDutyManager.getInstance().getCurrentStatus();
            if (status != null && status.isMonthlyDriver()) return true;
            RiderData rider = getUserDetails();
            if (rider != null && rider.getMonthlyPlan() == 1) return true;
        } catch (Exception ignored) {}
        return false;
    }

    // ========================================
    // OLD: EXACTLY AS BEFORE - NO CHANGE
    // ========================================
    public void setUserDetails(RiderData val) {
        mEditor.putString(user, new Gson().toJson(val));
        mEditor.commit();
    }
    public RiderData getUserDetails() {
        return new Gson().fromJson(mPrefs.getString(user, ""), RiderData.class);
    }



    // ========================================
    // OLD: EXACTLY AS BEFORE - NO CHANGE
    // ========================================
    public void setAddress(TampAddress val) {
        mEditor.putString("taddress", new Gson().toJson(val));
        mEditor.commit();
    }

    public TampAddress getAddress() {
        return new Gson().fromJson(mPrefs.getString("taddress", ""), TampAddress.class);
    }

    public void logoutUser() {
        com.shifter.driver.socket.NodeSocketManager.getInstance().disconnect();
        mEditor.clear();
        mEditor.commit();
    }

    public static String activeOrder = "active_order";

    public void setActiveOrder(com.shifter.driver.model.PDOrderItem item) {
        if (item != null) {
            mEditor.putString(activeOrder, new Gson().toJson(item));
        } else {
            mEditor.remove(activeOrder);
        }
        mEditor.commit();
    }

    public com.shifter.driver.model.PDOrderItem getActiveOrder() {
        String json = mPrefs.getString(activeOrder, null);
        if (json != null && !json.isEmpty()) {
            try {
                return new Gson().fromJson(json, com.shifter.driver.model.PDOrderItem.class);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
        return null;
    }

    public void clearActiveOrder() {
        mEditor.remove(activeOrder);
        mEditor.commit();
    }

    public void setOrderStopStep(String orderId, int step) {
        if (orderId != null) {
            setIntData("order_stop_step_" + orderId, step);
        }
    }

    public int getOrderStopStep(String orderId) {
        if (orderId != null) {
            return getIntData("order_stop_step_" + orderId);
        }
        return 0;
    }

    public void clearOrderStopStep(String orderId) {
        if (orderId != null) {
            mEditor.remove("order_stop_step_" + orderId);
            mEditor.commit();
        }
    }

    public void setLanguage(String lang) {
        mEditor.putString(language, lang);
        mEditor.commit();
    }

    public String getLanguage() {
        return mPrefs.getString(language, "en");
    }

    public static final String KEY_CUSTOMER_CARE_NUMBER = "customer_care_number";

    public void setCustomerCareNumber(String number) {
        if (number != null && !number.trim().isEmpty()) {
            setStringData(KEY_CUSTOMER_CARE_NUMBER, number.trim());
        }
    }

    public String getCustomerCareNumber() {
        String num = getStringData(KEY_CUSTOMER_CARE_NUMBER);
        return (num != null && !num.trim().isEmpty()) ? num.trim() : "+91 9109114515";
    }
}
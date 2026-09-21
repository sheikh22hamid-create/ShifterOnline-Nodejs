package com.shifter.driver.retrofit;

import com.google.gson.JsonObject;

import java.util.Map;

import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import java.util.List;

import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.GET;
import retrofit2.http.Headers;
import retrofit2.http.Multipart;
import retrofit2.http.POST;
import retrofit2.http.Part;
import retrofit2.http.Query;

/**
 * Node backend REST endpoints the driver app needs outside the socket
 * connection — see backend/API_INTEGRATION_GUIDE.md §4. No auth header:
 * the Node backend trusts rider_id in the body (see
 * memory/order_dispatch_auth_gap.md).
 */
public interface NodeService {

    @POST("api/rider/status")
    Call<JsonObject> setStatus(@Body Map<String, Object> body);

    // --- Auth (Node port of rider_api/send_otp.php, verify_otp.php,
    // logout.php - see riderAuthController.js). @Body RequestBody (not
    // Map) so call sites keep building their existing JSONObject payload
    // unchanged, only the target client/method changes.
    @POST("api/rider/auth/send-otp")
    Call<JsonObject> sendOtp(@Body RequestBody body);

    @POST("api/rider/auth/verify-otp")
    Call<JsonObject> verifyOtp(@Body RequestBody body);

    @POST("api/rider/auth/logout")
    Call<JsonObject> logout(@Body RequestBody body);

    // Node port of rider_api/pkg_history.php (driver's active/past order list -
    // "type": "past" for history, anything else (the app also sends "recent")
    // for current/active orders). Response shape verified identical to PHP's:
    // OrderHistory[] with the same PDOrderItem fields, Result/ResponseMsg.
    @POST("api/rider/orders/history")
    Call<JsonObject> pkgHistory(@Body RequestBody body);

    // Node port of rider_api/home_data.php (driver dashboard). Response now
    // includes OrderHistory/BuyOrderHistory (active order, if any) and
    // device_match, matching the PHP shape the app's HomeData model expects.
    @POST("api/rider/home")
    Call<JsonObject> homeData(@Body RequestBody body);

    // Node port of rider_api/citylist.php (registration city dropdown) -
    // riderRoutes.js exposes it as GET /api/rider/cities (driverContentController.cityList),
    // behind appKeyAuth like the other genie_rest_key-tagged calls below.
    // Response key is "CityList" (not the old "CityData").
    @Headers("Authorization: genie_rest_key")
    @GET("api/rider/cities")
    Call<JsonObject> getCityList();

    // Node port of rider_api/vehicle_type.php (driverKycController.vehicleTypeList).
    @POST("api/rider/vehicle/type-list")
    Call<JsonObject> vehicleType(@Body RequestBody body);

    // Node port of cust_api/packagelist.php's DRIVER branch (home screen's
    // delivery-type toggle list) - see riderController.packageListForDriver.
    @POST("api/rider/package-list")
    Call<JsonObject> getPackageList(@Body RequestBody body);

    // Node port of rider_api/rider_delivery_type.php - riderController.setDeliveryType
    // expects {rider_id, package_id, enabled: boolean}, not the old {rider_id,
    // delivery_type, status}, so the call site builds this shape directly.
    @POST("api/rider/delivery-type")
    Call<JsonObject> updateDeliveryType(@Body Map<String, Object> body);

    // Node port of rider_api/reg_user.php's "automatic" registration path
    // (document numbers + isVerified flags in `documents`, not raw card
    // images - see riderAuthController.js registerHandler). The "manual"
    // path (raw Aadhaar/DL/RC/PAN photo uploads) has no Node equivalent
    // yet, so that one stays on the PHP client for now.
    @Multipart
    @POST("api/rider/auth/register")
    Call<ResponseBody> registerAutomatic(
            @Part("mobile") RequestBody mobile,
            @Part("full_name") RequestBody fullName,
            @Part("email") RequestBody email,
            @Part("dob") RequestBody dob,
            @Part("account_name") RequestBody accountName,
            @Part("account_number") RequestBody accountNumber,
            @Part("ifsc") RequestBody ifsc,
            @Part("vehicle") RequestBody vehicle,
            @Part("vehicle_no") RequestBody vehicleNo,
            @Part("city_id") RequestBody cityId,
            @Part("register_type") RequestBody registerType,
            @Part("documents") RequestBody documents,
            @Part MultipartBody.Part profilePhoto,
            @Part("fcm_token") RequestBody fcmToken,
            @Part("device_id") RequestBody deviceId,
            @Part("referral_code") RequestBody referralCode,
            @Part("rc_owner_name") RequestBody rcOwnerName,
            @Part("rc_owner_aadhar_number") RequestBody rcOwnerAadhaarNumber
    );

    // --- KYC manual-upload endpoints (Node port of rider_api/bank_account.php,
    // vehicle_detail_save.php, eme_contact.php, kit_details.php - see
    // driverKycController.js / driverContentController.js). All three require
    // the same static app-key header the PHP originals did.
    @Headers("Authorization: genie_rest_key")
    @POST("api/rider/kyc/bank-account")
    Call<JsonObject> bankAccount(@Body RequestBody body);

    @Headers("Authorization: genie_rest_key")
    @Multipart
    @POST("api/rider/kyc/vehicle-detail")
    Call<JsonObject> vehicalVerification(
            @Part("rider_id") RequestBody riderId,
            @Part("type_id") RequestBody typeId,
            @Part("reg_num") RequestBody regNum,
            @Part("size") RequestBody size,
            @Part List<MultipartBody.Part> parts);

    @Headers("Authorization: genie_rest_key")
    @POST("api/rider/emergency-contact")
    Call<JsonObject> emeContact(@Body RequestBody body);

    // Node port of rider_api/pagelist.php (FAQ/help pages) - no app-key header, matches the route.
    @POST("api/rider/pages")
    Call<JsonObject> pagelist(@Body RequestBody body);

    // Node port of rider_api/rider_vehicle_update.php.
    @POST("api/rider/vehicle/update")
    Call<JsonObject> riderVehicleUpdate(@Body RequestBody body);

    // Node port of rider_api/buy_history.php (driver's "custom order" / buy_order history).
    @Headers("Authorization: genie_rest_key")
    @POST("api/rider/orders/legacy/history")
    Call<JsonObject> buyHistory(@Body RequestBody body);

    // Node port of cust_api/wallet_history.php and add_wallet.php - shared
    // between customer and driver apps via wallet_type ("user" vs "driver"),
    // see customerWalletController.js header.
    @POST("api/users/wallet/history")
    Call<JsonObject> getWalletHistory(@Body RequestBody body);

    @POST("api/users/wallet/add")
    Call<JsonObject> addWallet(@Body RequestBody body);

    // Node port of rider_api/create_order.php (Razorpay order creation ahead
    // of the wallet top-up checkout) - new endpoint, see customerWalletController.js.
    @POST("api/users/wallet/create-order")
    Call<JsonObject> createOrder(@Body RequestBody body);

    // Node port of cust_api/custom_order_list_driver.php / custom_order_bid.php.
    @POST("api/rider/custom-order/open")
    Call<JsonObject> getCustomOrderList(@Body RequestBody body);

    @POST("api/rider/custom-order/bid")
    Call<JsonObject> placeCustomOrderBid(@Body RequestBody body);

    @Headers("Authorization: genie_rest_key")
    @POST("api/rider/notifications")
    Call<JsonObject> notification(@Body RequestBody body);

    @Headers("Authorization: genie_rest_key")
    @Multipart
    @POST("api/rider/kit-details")
    Call<JsonObject> riderkit(
            @Part("rider_id") RequestBody riderId,
            @Part("qu_answer") RequestBody quAnswer,
            @Part("size") RequestBody size,
            @Part List<MultipartBody.Part> parts);

    // Node port of rider_api/dy_answer.php (dynamic onboarding question, text
    // and/or front+back proof images).
    @Headers("Authorization: genie_rest_key")
    @Multipart
    @POST("api/rider/survey/dynamic-answer")
    Call<JsonObject> dyAnswer(
            @Part("rider_id") RequestBody riderId,
            @Part("type") RequestBody type,
            @Part("id_num") RequestBody idNum,
            @Part("size") RequestBody size,
            @Part List<MultipartBody.Part> frontParts,
            @Part("sizes") RequestBody sizes,
            @Part List<MultipartBody.Part> backParts);

    // Node port of rider_api/get_registration_settings.php.
    @POST("api/rider/registration-settings")
    Call<JsonObject> getRegistrationSettings(@Body RequestBody body);

    // Driver-registration auto-verification charge: server-priced Razorpay
    // order, then server-side signature+amount verification before the
    // driver's payment_complete flag is set (see AutoPaymentActivity).
    @POST("api/rider/verification-payment/create-order")
    Call<JsonObject> createVerificationPaymentOrder(@Body RequestBody body);

    @POST("api/rider/verification-payment/verify")
    Call<JsonObject> verifyVerificationPayment(@Body RequestBody body);

    // Node port of rider_api/cancel_order.php's driver-cancel path - NOT a
    // PHP field-for-field port like the rest of this interface. This is the
    // newer order-lifecycle rewrite (orderController.js/tripLifecycle.js),
    // mounted at /api/order (not /api/rider) and returns {success, message,
    // data} instead of {Result, ResponseMsg, order_status, device_match} -
    // callers must parse accordingly, not via the old RestResponse shape.
    @POST("api/order/driver-cancel")
    Call<JsonObject> driverCancel(@Body Map<String, Object> body);

    // Node port of rider_api/otp_check.php (pickup OTP the driver asks the
    // customer for before marking arrived). Same {success, message, data}
    // shape as driverCancel above, not the old {Result, ResponseMsg}.
    @POST("api/order/verify-pickup-otp")
    Call<JsonObject> verifyPickupOtp(@Body Map<String, Object> body);

    // Node port of rider_api/check_amount.php (extra pickup-distance charge +
    // UPI payment link shown before pickup confirmation).
    @POST("api/order/check-pickup-amount")
    Call<JsonObject> checkPickupAmount(@Body Map<String, Object> body);

    // Node port of cust_api/cancel_reason.php. Response includes both "Result"
    // and "success" so this drops in without touching the app's existing
    // {Result, reason_list} parsing.
    @POST("api/order/cancel-reasons")
    Call<JsonObject> getCancelReasons(@Body RequestBody body);

    // Node port of rider_api/order_status_change.php (pkg_order - reject/cancel only, see orderController.js).
    @POST("api/order/status-change")
    Call<JsonObject> orderStatusChange(@Body RequestBody body);

    // Node port of rider_api/b_order_status_change.php (buy_order lifecycle).
    @POST("api/order/buy/status-change")
    Call<JsonObject> bOrderStatusChange(@Body RequestBody body);

    // Node port of rider_api/item_list.php.
    @POST("api/order/buy/item-list")
    Call<JsonObject> itemList(@Body RequestBody body);

    // Node port of rider_api/item_unavilable.php.
    @POST("api/order/buy/item-unavailable")
    Call<JsonObject> itemCencle(@Body RequestBody body);

    // Node port of rider_api/item_upload.php.
    @Multipart
    @POST("api/order/buy/item-upload")
    Call<JsonObject> itemUpload(
            @Part("rider_id") RequestBody riderId,
            @Part("item_id") RequestBody itemId,
            @Part("order_id") RequestBody orderId,
            @Part("item_total") RequestBody itemTotal,
            @Part("size") RequestBody size,
            @Part List<MultipartBody.Part> parts);

    @POST("api/rider/location")
    Call<JsonObject> updateLocation(@Body Map<String, Object> body);

    @POST("api/rider/training/status")
    Call<JsonObject> getTrainingStatus(@Body Map<String, Object> body);

    @POST("api/rider/training/progress")
    Call<JsonObject> saveTrainingProgress(@Body Map<String, Object> body);

    @POST("api/rider/training/complete")
    Call<JsonObject> completeTraining(@Body Map<String, Object> body);

    @POST("api/rider/premium-plans")
    Call<JsonObject> getDriverPremiumPlans(@Body Map<String, Object> body);

    @POST("api/rider/premium-plans/purchase")
    Call<JsonObject> purchaseDriverPremiumPlan(@Body Map<String, Object> body);

    // Node port of rider_api/withdraw_requests.php (driverPayoutController.js)
    // - queues a wallet-balance withdrawal for admin approval. Body: rider_id, amount.
    @POST("api/rider/payout/withdraw-request")
    Call<JsonObject> withdrawRequest(@Body Map<String, Object> body);

    @POST("api/rider/profile")
    Call<JsonObject> getProfile(@Body Map<String, Object> body);

    @POST("api/rider/profile/update")
    Call<JsonObject> updateProfile(@Body Map<String, Object> body);

    @POST("api/rider/check-referral")
    Call<JsonObject> checkReferral(@Body Map<String, Object> body);

    @POST("api/rider/apply-referral")
    Call<JsonObject> applyReferral(@Body Map<String, Object> body);

    @POST("api/rider/leads")
    Call<JsonObject> submitLeads(@Body Map<String, Object> body);

    @GET("api/rider/leads")
    Call<JsonObject> getMyLeads(@Query("rider_id") int riderId);

    // Task 6/9: browse booking_type=2 scheduled trips and mark non-binding
    // "interest" ahead of time (priority popup eligibility only - see
    // dispatchManager.offerToInterestedRiders). riderRoutes.js mounts these
    // under /api/rider, NOT /api/driver as an earlier draft of this plan
    // assumed - verified against this file's existing api/rider/* routes.
    @POST("api/rider/scheduled-trips")
    Call<JsonObject> getScheduledTrips(@Body RequestBody body);

    @POST("api/rider/scheduled-trips/interest")
    Call<JsonObject> markScheduledTripInterest(@Body RequestBody body);

    @POST("api/rider/scheduled-trips/interest/remove")
    Call<JsonObject> removeScheduledTripInterest(@Body RequestBody body);
}

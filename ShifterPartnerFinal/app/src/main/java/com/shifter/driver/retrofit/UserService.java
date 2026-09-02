package com.shifter.driver.retrofit;

import com.google.gson.JsonObject;

import java.util.List;

import okhttp3.MultipartBody;
import okhttp3.RequestBody;
import okhttp3.ResponseBody;
import retrofit2.Call;
import retrofit2.http.Body;
import retrofit2.http.Headers;
import retrofit2.http.Multipart;
import retrofit2.http.POST;
import retrofit2.http.Part;
import retrofit2.http.GET;
import retrofit2.http.Query;

public interface UserService {

        @Headers("Authorization:genie_rest_key")
        @POST("/cust_api/cancel_reason.php")
        Call<JsonObject> getCancelReasons(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "otp_check.php")
        Call<JsonObject> checkArrivedOtp(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "check_amount.php")
        Call<JsonObject> checkAmount(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "country_code.php")
        Call<JsonObject> countryCode(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "send_otp.php")
        Call<JsonObject> sendOTP(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "verify_otp.php")
        Call<JsonObject> verifyOtp(@Body RequestBody requestBody);


        // 🔥 NEW: Get registration settings
        @Headers({"Authorization:genie_rest_key", "Content-Type:application/json"})
        @POST(APIClient.APPEND_URL + "get_registration_settings.php")
        Call<JsonObject> getRegistrationSettings(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "mobile_check.php")
        Call<JsonObject> mobileCheck(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "rider_login.php")
        Call<JsonObject> riderLogin(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "citylist.php")
        Call<JsonObject> city(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "vehicle_type.php")
        Call<JsonObject> vehicleType(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "rider_vehicle_update.php")
        Call<JsonObject> riderVehicleUpdate(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "document_check.php")
        Call<JsonObject> documentCheck(@Body RequestBody requestBody);

        /*
         * @Headers("Authorization:genie_rest_key")
         * 
         * @Multipart
         * 
         * @POST(APIClient.APPEND_URL + "reg_user.php")
         * Call<JsonObject> regUser(
         * 
         * @Part("first_name") RequestBody firstname,
         * 
         * @Part("last_name") RequestBody lastname,
         * 
         * @Part("mobile") RequestBody mobile,
         * 
         * @Part("dob") RequestBody dob,
         * 
         * @Part("nationality") RequestBody nationality,
         * 
         * @Part("city_id") RequestBody cityid,
         * 
         * @Part("full_address") RequestBody fulladdress,
         * 
         * @Part("know_language") RequestBody knowlanguage,
         * 
         * @Part("smobile") RequestBody smobile,
         * 
         * @Part("rlats") RequestBody rlats,
         * 
         * @Part("rlongs")RequestBody rlongs,
         * 
         * @Part("size")RequestBody size,
         * 
         * @Part List<MultipartBody.Part> parts,
         * 
         * @Part("password") RequestBody password);
         */

        /*
         * @Headers({
         * "Authorization: genie_rest_key", // ✅ Check exact format
         * "Accept: application/json"
         * })
         * 
         * @Multipart
         * 
         * @POST(APIClient.APPEND_URL + "reg_user.php")
         * Call<JsonObject> regUser(
         * 
         * @Part("first_name") RequestBody firstname,
         * 
         * @Part("last_name") RequestBody lastname,
         * 
         * @Part("mobile") RequestBody mobile,
         * 
         * @Part("dob") RequestBody dob,
         * 
         * @Part("nationality") RequestBody nationality,
         * 
         * @Part("city_id") RequestBody cityid,
         * 
         * @Part("full_address") RequestBody fulladdress,
         * 
         * @Part("know_language") RequestBody knowlanguage,
         * 
         * @Part("smobile") RequestBody smobile,
         * 
         * @Part("rlats") RequestBody rlats,
         * 
         * @Part("rlongs") RequestBody rlongs,
         * 
         * @Part("size") RequestBody size,
         * 
         * @Part List<MultipartBody.Part> parts,
         * 
         * @Part("password") RequestBody password
         * );
         */

        @Headers({
                        "Authorization: genie_rest_key",
                        "Accept: application/json"
        })
        @Multipart
        @POST(APIClient.APPEND_URL + "reg_user.php")
        Call<ResponseBody> regUser(
                        @Part("first_name") RequestBody firstname,
                        @Part("last_name") RequestBody lastname,
                        @Part("mobile") RequestBody mobile,
                        @Part("dob") RequestBody dob,
                        @Part("nationality") RequestBody nationality,
                        @Part("city_id") RequestBody cityid,
                        @Part("full_address") RequestBody fulladdress,
                        @Part("know_language") RequestBody knowlanguage,
                        @Part("smobile") RequestBody smobile,
                        @Part("rlats") RequestBody rlats,
                        @Part("rlongs") RequestBody rlongs,
                        @Part("size") RequestBody size,
                        @Part List<MultipartBody.Part> parts,
                        @Part("password") RequestBody password,
                        @Part("fcm_token") RequestBody fcmToken,
                        @Part("device_id") RequestBody deviceId);

        /////////////////////
        //New Register api

     /*   @Multipart
        @POST(APIClient.APPEND_URL + "reg_user.php")
        Call<ResponseBody> regUserNew(
                @Part("full_name") RequestBody firstname,
                @Part("email") RequestBody email,
                @Part("account_name") RequestBody accountname,
                @Part("account_number") RequestBody accountnumber,
                @Part("ifsc") RequestBody ifsc,
                @Part("vehicle") RequestBody vehicle,
                @Part List<MultipartBody.Part> parts,
                @Part("fcm_token") RequestBody fcmToken);*/


        @Headers({
                "Authorization: genie_rest_key",
                "Content-Type: application/json"
        })
        @POST(APIClient.APPEND_URL + "reg_user.php")
        Call<ResponseBody> regUserJson(@Body RequestBody requestBody);

        @Multipart
        @POST(APIClient.APPEND_URL + "reg_user.php")
        Call<ResponseBody> regUserNew(
                @Part("mobile") RequestBody mobile,
                @Part("full_name") RequestBody firstname,
                @Part("email") RequestBody email,
                @Part("account_name") RequestBody accountname,
                @Part("account_number") RequestBody accountnumber,
                @Part("ifsc") RequestBody ifsc,
                @Part("vehicle") RequestBody vehicle,
                @Part("vehicle_no") RequestBody vehicleNo,
                @Part("city_id") RequestBody cityId,
                @Part("register_type") RequestBody registerType,
                @Part MultipartBody.Part aadhaar,
                @Part MultipartBody.Part aadhaarBack,
                @Part MultipartBody.Part dl,
                @Part MultipartBody.Part rc,
                @Part MultipartBody.Part pan,
                @Part("fcm_token") RequestBody fcmToken,
                @Part("device_id") RequestBody deviceId,
                @Part("refferal_code") RequestBody referralCode
        );

/*        @Multipart
        @POST(APIClient.APPEND_URL + "reg_user.php")
        Call<ResponseBody> regUserNew(
                @Part("mobile") RequestBody mobile,           // 🔥 NEW
                @Part("full_name") RequestBody firstname,
                @Part("email") RequestBody email,
                @Part("account_name") RequestBody accountname,
                @Part("account_number") RequestBody accountnumber,
                @Part("ifsc") RequestBody ifsc,
                @Part("vehicle") RequestBody vehicle,
                @Part("register_type") RequestBody registerType,
                @Part List<MultipartBody.Part> parts,
                @Part("fcm_token") RequestBody fcmToken);*/

        //////////////////////////





        @Headers("Authorization:genie_rest_key")
        @GET("cust_api/city.php")
        Call<JsonObject> getCityList();

        @Headers("Authorization:genie_rest_key")
        @Multipart
        @POST(APIClient.APPEND_URL + "personal_document.php")
        Call<JsonObject> personalDocument(@Part("rider_id") RequestBody riderid, @Part("type") RequestBody type,
                        @Part("text_id") RequestBody textid, @Part("size") RequestBody size,
                        @Part List<MultipartBody.Part> parts, @Part("sizes") RequestBody sizes,
                        @Part List<MultipartBody.Part> partss);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "eme_contact.php")
        Call<JsonObject> emeContact(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @Multipart
        @POST(APIClient.APPEND_URL + "vehicle_detail_save.php")
        Call<JsonObject> vehicalVerification(@Part("rider_id") RequestBody riderid, @Part("type_id") RequestBody type,
                        @Part("reg_num") RequestBody textid, @Part("size") RequestBody size,
                        @Part List<MultipartBody.Part> parts);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "bank_account.php")
        Call<JsonObject> bankAccount(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @Multipart
        @POST(APIClient.APPEND_URL + "kit_details.php")
        Call<JsonObject> riderkit(@Part("rider_id") RequestBody riderid, @Part("qu_answer") RequestBody quanswer,
                        @Part("size") RequestBody size, @Part List<MultipartBody.Part> parts);

        @Headers("Authorization:genie_rest_key")
        @Multipart
        @POST(APIClient.APPEND_URL + "dy_answer.php")
        Call<JsonObject> dyAnswer(@Part("rider_id") RequestBody riderid, @Part("type") RequestBody quanswer,
                        @Part("id_num") RequestBody idnum, @Part("size") RequestBody size,
                        @Part List<MultipartBody.Part> parts, @Part("sizes") RequestBody sizes,
                        @Part List<MultipartBody.Part> partss);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "survey_list.php")
        Call<JsonObject> surveyList(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "survery_answer.php")
        Call<JsonObject> surveryAnswer(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "pkg_history.php")
        Call<JsonObject> pkgHistory(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "order_status_change.php")
        Call<JsonObject> orderStatusChange(@Body RequestBody requestBody);


        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "cancel_order.php")
        Call<JsonObject> orderCancel(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "buy_history.php")
        Call<JsonObject> buyHistory(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "buy_order_list.php")
        Call<JsonObject> buyOrderList(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "b_order_status_change.php")
        Call<JsonObject> bOrderStatusChange(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "item_unavilable.php")
        Call<JsonObject> itemCencle(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "item_list.php")
        Call<JsonObject> itemList(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @Multipart
        @POST(APIClient.APPEND_URL + "item_upload.php")
        Call<JsonObject> itemUpload(@Part("rider_id") RequestBody riderid, @Part("item_id") RequestBody itemid,
                        @Part("order_id") RequestBody orderid, @Part("item_total") RequestBody itemtotal,
                        @Part("size") RequestBody size, @Part List<MultipartBody.Part> partss);

        @Headers("Authorization:genie_rest_key")
        @Multipart
        @POST(APIClient.APPEND_URL + "bill_upload.php")
        Call<JsonObject> itemUpload(@Part("rider_id") RequestBody riderid, @Part("order_id") RequestBody orderid,
                        @Part("size") RequestBody size, @Part List<MultipartBody.Part> partss);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "notification_list.php")
        Call<JsonObject> notification(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "home_data.php")
        Call<JsonObject> homeData(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "is_bicyle.php")
        Call<JsonObject> isBicyle(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "pagelist.php")
        Call<JsonObject> pagelist(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "withdraw_requests.php")
        Call<JsonObject> requestWithdraw(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "payout_list.php")
        Call<JsonObject> getpayoutList(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("cust_api/wallet_history.php")
        Call<JsonObject> getWalletHistory(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "get_joining_plan.php")
        Call<JsonObject> getJoiningPlan(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "rider_status.php")
        Call<JsonObject> riderStatus(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "logout.php")
        Call<JsonObject> logoutRider(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("rider_api/create_order.php")
        Call<JsonObject> createOrder(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("cust_api/add_wallet.php")
        Call<JsonObject> addWallet(@Body RequestBody requestBody);

        @POST("cust_api/packagelist.php")
        Call<JsonObject> getPackageList(@Body RequestBody body);

        @Headers("Authorization:genie_rest_key")
        @POST("rider_api/rider_delivery_type.php")
        Call<JsonObject> updateDeliveryType(@Body RequestBody requestBody);

        // Order Action APIs (Rider Side)
        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "accept_order.php")
        Call<JsonObject> acceptOrder(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "reject_order.php")
        Call<JsonObject> rejectOrder(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "update_status.php")
        Call<JsonObject> updateOrderStatus(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST(APIClient.APPEND_URL + "update_location.php")
        Call<JsonObject> updateLocation(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("cust_api/get_plan.php")
        Call<JsonObject> getPlans(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("cust_api/create_plan_order.php")
        Call<JsonObject> createPlanOrder(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("cust_api/plan_success.php")
        Call<JsonObject> planSuccess(@Body RequestBody requestBody);

        // Custom Order APIs (Driver Side)
        @Headers("Authorization:genie_rest_key")
        @POST("cust_api/custom_order_list_driver.php")
        Call<JsonObject> getCustomOrderList(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("cust_api/custom_order_bid.php")
        Call<JsonObject> placeCustomOrderBid(@Body RequestBody requestBody);

        // ---- New Driver Premium Plans APIs ----
        @Headers("Authorization:genie_rest_key")
        @POST("rider_api/get_driver_premium_plans_api.php")
        Call<JsonObject> getDriverPremiumPlans(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("rider_api/purchase_driver_premium_plan_api.php")
        Call<JsonObject> purchaseDriverPremiumPlan(@Body RequestBody requestBody);

        // ---- Driver Training APIs ----
        @Headers("Authorization:genie_rest_key")
        @POST("rider_api/get_training_status.php")
        Call<JsonObject> getTrainingStatus(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("rider_api/save_training_progress.php")
        Call<JsonObject> saveTrainingProgress(@Body RequestBody requestBody);

        @Headers("Authorization:genie_rest_key")
        @POST("rider_api/complete_training.php")
        Call<JsonObject> completeTraining(@Body RequestBody requestBody);

}

// ignore_for_file: file_names

import 'package:flutter/material.dart';

class Config {
  static const String imageURLPath =
      'https://admin.shifteronline.com/admin/';
  static const String baseurl = '${imageURLPath}cust_api/';

  // Node.js order/dispatch backend (REST + Socket.io) — order creation,
  // tracking and cancel/rate go here directly, not through the legacy PHP
  // API (see memory/order_flow_direct_app_integration.md). Login/OTP/profile
  // etc. stay on the legacy `baseurl` above; this is only for the order flow.
  static const String nodeBaseUrl = 'https://dev-api.shifteronline.com';
  // Vehicle-category images (cat_img/other_image on pkg_category) are a mix
  // of pre-migration files that still live on the legacy PHP admin's disk
  // and newer ones uploaded through the Node admin panel straight to
  // Cloudinary. Only the Node backend's /images/* route (Cloudinary
  // redirect + legacy-folder static fallback, see backend/src/app.js) can
  // resolve both - imageURLPath (the PHP domain) 404s on anything uploaded
  // after the Cloudinary migration. Use this for any pkg_category image,
  // not imageURLPath.
  static const String nodeImageURLPath = '$nodeBaseUrl/';

  // cat_img/other_image/detail_image on pkg_category can be either a
  // relative legacy path (needs nodeImageURLPath prefixed) or, since the
  // Cloudinary migration, already a full absolute URL (e.g.
  // https://admin.shifteronline.com/images/... or a Cloudinary URL) -
  // prefixing nodeImageURLPath onto an already-absolute URL produces a
  // malformed, unloadable image URL. Always resolve through this instead of
  // concatenating nodeImageURLPath directly.
  static String resolveImageUrl(String value) {
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return value;
    }
    return '$nodeImageURLPath$value';
  }
  static const String googleApikey =
      "AIzaSyD8IR3hFe5hlBFJr81pgpPJtB28xLiJPmw"; //"AIzaSyD8IR3hFe5hlBFJr81pgpPJtB28xLiJPmw";//"AIzaSyDDi8FMY861tc6LZrhL3H9wlqU8iraX72o"; // Google Key

  static const String oneSignel = '********************';

  // Must match google-services.json / Firebase project used by the app
  static const String projectID = 'shifter-9b0aa';
  static String? firebaseKey;

  static const String accDelete = 'acc_delete.php';
  static const String reguser = 'reg_user.php';
  static const String city = 'city.php';
  static const String ccode = 'country_code.php';
  static const String mobilecheck = 'mobile_check.php';
  static const String userlogin = 'user_login.php';
  static const String smaType = "sms_type.php";
  static const String msgOtp = "msg_otp.php";
  static const String twilioOtp = "twilio_otp.php";
  static const String otp = 'otp.php';
  static const String faq = 'faq.php';
  static const String forgetPassword = 'forget_password.php';
  static const String homeData = 'home_data.php';
  static const String pageList = 'pagelist.php';
  static const String profile = 'profile.php';
  static const String address = 'address_list.php';
  static const String addressUser = 'address_user.php';
  static const String paymentgateway = 'paymentgateway.php';
  static const String pksOrder = 'pks_order.php';
  static const String pkgHistory = 'pkg_history.php';
  static const String pkgOrderList = 'pkg_order_list.php';
  static const String buyorderlist = 'buy_order_list.php';

  static const String couponlist = "couponlist.php";
  static const String checkcoupon = "check_coupon.php";
  static const String buyOrder = "buy_order.php";
  static const String buyHistory = "buy_history.php";
  static const String proImage = "pro_image.php";
  static const String makeList = "make_list.php";
  static const String mapinfo = "map_info.php";
  static const String buymapinfo = "buy_map_info.php";
  static const String notificationList = "notification_list.php";
  static const String verifyOtp = "verify-otp.php";
  static const String otpverfy = "otp_verify.php";
  static const String confirmitem = "confirm_item.php";
  static const String buycancle = "buy_cancle.php";
  static const String pkscancle = "pks_cancle.php";
  static const String itemRemove = "item_remove.php";
  static const String paybill = "pay_bill.php";
  static const String buyrate = "buy_rate.php";
  static const String addFavoriteDriver = "add_favorite_driver.php";
  static const String getFavoriteDrivers = "get_favorite_drivers.php";
  static const String generateInvoiceUrl = "invoice_url_generate.php";
  static const String cancelReason = "cancel_reason.php";
  static const String advancedPayment = "advanced_payment.php";
  static const String getDistance = "get_distance.php";

  // static String oneSignel;
  static const String pkgrate = "pkg_rate.php";
  static const String packagelist = "packagelist.php";
  static const String deliverynotposibel =
      "Delivery is not possible as the delivery area is too far or is not in a serviceable area (no delivery partners in the area), please select a different address or store to continue";

  static const String addWallet = "add_wallet.php";
  static const String createOrder = "create_order.php";

  static const String withdrawWallet = "withdraw_wallet.php";
  static const String walletHistory = "wallet_history.php";
  static const String checkDriver = "check_driver.php";

  // payment methodes
  static const String paymentStatus = "payment_status.php";
  static String flutterwave = "flutterwave/index.php?";
  static String ticketBook = "ticket_book.php";
  static String stripe = "stripe/index.php?";
  static String senangPay = "result.php?";
  static String paytm = "paytm/index.php?";
  static String payStack = "paystack/index.php";
  static String merpago = "merpago/index.php?";
  static String payFast = "Payfast/index.php?";
  static String midtans = "Midtrans/index.php?";
  static String khalti = "Khalti/index.php?";
  static String checkout2 = "2checkout/index.php?";

  // Config.dart में add करें (legacy joining fee - kept for reference)
  static const String joiningFeeDetails = "join_fee";
  static const String payJoiningFee = "pay_join_fee";
  static const String updateJoiningFeeStatus = "update_join_fee_status";

  // Custom Order APIs
  static const String customOrderCreate = "custom_order_create.php";
  static const String customOrderBidList = "custom_order_bid_list.php";
  static const String customOrderConvert = "custom_order_convert.php";

  // Node backend order-flow endpoints (relative to nodeBaseUrl, no leading slash)
  static const String nodeOrderCreate = "api/order/create";
  static const String nodeOrderDetails = "api/order/details";
  static const String nodeOrderCancel = "api/order/customer-cancel";
  static const String nodeOrderRate = "api/order/rate";
  static const String nodeOrderUploadPhoto = "api/order/upload-photo";
  static const String nodeFareEstimate = "api/order/fare-estimate";
  static const String nodeCategories = "api/order/categories";
  // Node mirrors of the legacy PHP get_distance.php / packagelist.php —
  // same response shape (DistanceData / PackageData), including the same
  // active-plan fare discount math, so the fare-estimate screen's existing
  // parsing/calculation logic works unchanged against these instead.
  static const String nodeDistance = "api/order/distance";
  static const String nodePackageList = "api/order/packagelist";
  static const String nodeNextDayEligibility = "api/order/next-day-eligibility";
  // Node mirrors of the legacy PHP wallet / premium-plan / custom-order-bid
  // endpoints (customerWalletController.js, customerPlanController.js,
  // customOrderBiddingController.js - mounted under /api/users in app.js).
  // Response shapes were built to match their PHP counterparts field-for-
  // field, so existing parsing code needed no changes beyond the URL.
  static const String nodeWalletAdd = "api/users/wallet/add";
  static const String nodeWalletHistory = "api/users/wallet/history";
  static const String nodeWalletWithdraw = "api/users/wallet/withdraw";
  static const String nodePremiumPlans = "api/users/premium-plans";
  static const String nodePremiumPlansPurchase = "api/users/premium-plans/purchase";
  static const String nodeCustomOrderCreate = "api/users/custom-order/create";
  static const String nodeCustomOrderBids = "api/users/custom-order/bids";
  static const String nodeCustomOrderConvert = "api/users/custom-order/convert";
  // Node mirrors of the remaining small read-mostly / profile cust_api/*.php
  // endpoints (customerProfileController.js, customerContentController.js -
  // mounted under /api/users). Same field-for-field response shape as PHP.
  static const String nodeProfileUpdate = "api/users/profile/update";
  static const String nodeProfileImage = "api/users/profile/image";
  static const String nodeAddressList = "api/users/address/list";
  static const String nodeAddressSave = "api/users/address/save";
  static const String nodeFavoritesToggle = "api/users/favorites/toggle";
  static const String nodeFavoritesList = "api/users/favorites/list";
  static const String nodeCoupons = "api/users/coupons/list";
  static const String nodeCouponsCheck = "api/users/coupons/check";
  static const String nodeNotifications = "api/users/notifications";
  static const String nodeCities = "api/users/cities";
  static const String nodePages = "api/users/pages";
  static const String nodeFaqs = "api/users/faqs";
  static const String nodePaymentGateways = "api/users/payment-gateways";
  static const String nodeHome = "api/users/home";
  static const String nodeCancelReasons = "api/users/cancel-reasons";
  static const String nodeAppConfig = "api/users/app-config";
  // Read-only auth-adjacent lookups (country codes) - safe to move even
  // though login/OTP/register themselves stay on the legacy PHP for now.
  static const String nodeCountryCodes = "api/users/country-codes";
  static const String nodeDeleteAccount = "api/users/delete-account";
  // Auth itself - Node port of mobile_check.php / msg_otp.php / verify-otp.php
  // / user_login.php / reg_user.php / forget_password.php
  // (customerAuthController.js). Same 2Factor.in OTP provider as msg_otp.php
  // (see backend/src/services/otpService.js) and identical response shape.
  // The Twilio SMS path (twilio_otp.php) stays on PHP - it's already the
  // inactive branch in production (live `SMS_TYPE` setting is "Msg91", not
  // "Twilio") and was never wired to the 2Factor-based verify-otp.php's
  // tbl_otp session anyway, so there's no working Node equivalent to port it
  // to.
  static const String nodeMobileCheck = "api/users/mobile-check";
  static const String nodeSendOtp = "api/users/send-otp";
  static const String nodeVerifyOtp = "api/users/verify-otp";
  static const String nodeLogin = "api/users/login";
  static const String nodeLoginByOtp = "api/users/login-by-otp";
  static const String nodeRegister = "api/users/register";
  static const String nodeForgotPassword = "api/users/forgot-password";
  // Node port of cust_api/pkg_history.php ("My Orders" screen) - the old
  // pkgHistory (below, legacy PHP baseurl) has no visibility into orders
  // created through the Node order flow, so Pending/Completed/Cancelled
  // orders never showed up when the app was still calling it.
  static const String nodeOrderHistory = "api/users/orders/history";
  // Node mirrors of the remaining live-tracking / buy-order-detail / payment
  // cust_api/*.php endpoints (orderController.js + legacyOrderController.js,
  // mounted under /api/order). Same field-for-field response shape as PHP.
  static const String nodeMapInfo = "api/order/map-info";
  static const String nodeBuyOrderDetail = "api/order/legacy/detail";
  static const String nodeBuyMapInfo = "api/order/legacy/map-info";
  static const String nodeBuyRate = "api/order/legacy/rate";
  static const String nodeBuyCancel = "api/order/legacy/cancel";
  static const String nodePayBill = "api/order/legacy/pay-bill";
  static const String nodePaymentStatus = "api/order/payment-status";
  static const String nodeInvoiceUrl = "api/order/invoice-url";
  static const String nodeAdvancePayment = "api/order/advance-payment";
  // "Buy Anything" create + item confirm/remove - Node ports of
  // cust_api/buy_order.php, confirm_item.php, item_remove.php.
  static const String nodeBuyOrderCreate = "api/order/legacy/create";
  static const String nodeConfirmItem = "api/order/legacy/confirm-item";
  static const String nodeItemRemove = "api/order/legacy/item-remove";
  // Node port of create_order.php's Razorpay order-creation step (generic
  // amount-based, used ahead of wallet top-up, premium-plan purchase and
  // advance-payment collection alike) - customerWalletController.js.
  static const String nodeCreateOrder = "api/users/wallet/create-order";
  // Availability endpoint evaluates nearby online drivers for a pickup coordinate
  // using the Node backend on dev-api.shifteronline.com.
  static const String availableVehiclesUrl =
      '${nodeBaseUrl}/api/order/available-vehicles';
}

Widget loading({double? size}) {
  return Image(
    image: const AssetImage("assets/loading.gif"),
    height: size,
    // color: linercolor,
  );
}

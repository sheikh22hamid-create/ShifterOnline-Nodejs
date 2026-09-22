const express = require("express");
const customerAuthController = require("../controllers/customerAuthController");
const customerProfileController = require("../controllers/customerProfileController");
const customerWalletController = require("../controllers/customerWalletController");
const customerContentController = require("../controllers/customerContentController");
const customOrderBiddingController = require("../controllers/customOrderBiddingController");
const customerPlanController = require("../controllers/customerPlanController");

const router = express.Router();

// Customer auth (Node port of cust_api/*.php - mobile check, OTP, password
// login/register, forgot-password, soft account delete, country codes).
// Mounted at /api/users in app.js.
router.post("/mobile-check", customerAuthController.mobileCheck);
router.post("/send-otp", customerAuthController.sendOtp);
router.post("/verify-otp", customerAuthController.verifyOtp);
router.post("/login", customerAuthController.login);
router.post("/login-by-otp", customerAuthController.loginByOtp);
router.post("/register", customerAuthController.register);
router.post("/forgot-password", customerAuthController.forgotPassword);
router.post("/delete-account", customerAuthController.deleteAccount);
router.get("/country-codes", customerAuthController.countryCodeList);

// Profile / address
router.post("/profile/overview", customerProfileController.profileOverview);
router.get("/profile/overview", customerProfileController.profileOverview);
router.post("/profile/update", customerProfileController.updateProfile);
router.post("/profile/image", customerProfileController.updateProfileImage);
router.post("/address/list", customerProfileController.addressList);
router.post("/address/save", customerProfileController.saveAddress);

// Wallet
router.post("/wallet/add", customerWalletController.addWallet);
router.post("/wallet/history", customerWalletController.walletHistory);
router.post("/wallet/withdraw", customerWalletController.withdrawWallet);
router.post("/wallet/create-order", customerWalletController.createRazorpayOrder);

// Favorites / coupons / notifications / static content / home
router.post("/favorites/toggle", customerContentController.toggleFavoriteDriver);
router.post("/favorites/list", customerContentController.listFavoriteDrivers);
router.post("/coupons/list", customerContentController.couponList);
router.post("/coupons/check", customerContentController.checkCoupon);
router.post("/notifications", customerContentController.notificationList);
router.get("/cities", customerContentController.cityList);
router.get("/pages", customerContentController.pageList);
router.post("/faqs", customerContentController.faqList);
router.get("/payment-gateways", customerContentController.paymentGatewayList);
router.post("/home", customerContentController.homeData);
router.post("/orders/history", customerContentController.pkgHistoryCustomer);
router.post("/cancel-reasons", customerContentController.cancelReasonList);
router.get("/app-config", customerContentController.appConfig);

// Custom-order bidding (customer side) - driver side is in riderRoutes.js,
// admin side already exists in adminRoutes.js/customOrderController.js
router.post("/custom-order/create", customOrderBiddingController.createCustomOrder);
router.post("/custom-order/bids", customOrderBiddingController.listBids);
router.post("/custom-order/convert", customOrderBiddingController.convertOrder);

// Customer premium plan purchase (Node port of get_premium_plans_api.php /
// purchase_premium_plan_api.php's CUSTOMER_PREMIUM branch - see
// customerPlanService.js header for what's out of scope)
router.post("/premium-plans", customerPlanController.list);
router.post("/premium-plans/purchase", customerPlanController.purchase);

// User Referral Leads from Phone Contacts (Customer vs Driver Leads)
const userLeadController = require("../controllers/userLeadController");
router.post("/leads", userLeadController.submitLeads);
router.get("/leads", userLeadController.listMyLeads);

module.exports = router;

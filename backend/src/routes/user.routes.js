const express = require("express");
const customerAuthController = require("../controllers/customerAuthController");
const customerProfileController = require("../controllers/customerProfileController");
const customerWalletController = require("../controllers/customerWalletController");
const customerContentController = require("../controllers/customerContentController");

const router = express.Router();

// Customer auth (Node port of cust_api/*.php - mobile check, OTP, password
// login/register, forgot-password, soft account delete, country codes).
// Mounted at /api/users in app.js.
router.post("/mobile-check", customerAuthController.mobileCheck);
router.post("/send-otp", customerAuthController.sendOtp);
router.post("/verify-otp", customerAuthController.verifyOtp);
router.post("/login", customerAuthController.login);
router.post("/register", customerAuthController.register);
router.post("/forgot-password", customerAuthController.forgotPassword);
router.post("/delete-account", customerAuthController.deleteAccount);
router.get("/country-codes", customerAuthController.countryCodeList);

// Profile / address
router.post("/profile/update", customerProfileController.updateProfile);
router.post("/profile/image", customerProfileController.updateProfileImage);
router.post("/address/list", customerProfileController.addressList);
router.post("/address/save", customerProfileController.saveAddress);

// Wallet
router.post("/wallet/add", customerWalletController.addWallet);
router.post("/wallet/history", customerWalletController.walletHistory);
router.post("/wallet/withdraw", customerWalletController.withdrawWallet);

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

module.exports = router;

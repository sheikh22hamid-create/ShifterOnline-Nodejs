const express = require("express");
const riderController = require("../controllers/riderController");
const driverPlanController = require("../controllers/driverPlanController");
const trainingController = require("../controllers/trainingController");
const riderAuthController = require("../controllers/riderAuthController");
const driverKycController = require("../controllers/driverKycController");
const driverPayoutController = require("../controllers/driverPayoutController");
const driverSurveyController = require("../controllers/driverSurveyController");
const customOrderBiddingController = require("../controllers/customOrderBiddingController");
const driverContentController = require("../controllers/driverContentController");
const driverOrderHistoryController = require("../controllers/driverOrderHistoryController");
const legacyOrderController = require("../controllers/legacyOrderController");
const driverKycStatusController = require("../controllers/driverKycStatusController");
const driverGovVerificationController = require("../controllers/driverGovVerificationController");
const driverVerificationPaymentController = require("../controllers/driverVerificationPaymentController");
const driverLeadController = require("../controllers/driverLeadController");
const driverScheduledTripsController = require("../controllers/driverScheduledTripsController");
const appKeyAuth = require("../middleware/appKeyAuth");

const router = express.Router();
router.post('/favorite-routes', require('../controllers/favoriteRouteController').driver);

// Driver auth (Node port of rider_api/*.php - mobile check, OTP login,
// password login, registration with KYC docs, logout)
router.post("/auth/mobile-check", riderAuthController.mobileCheck);
router.post("/auth/send-otp", riderAuthController.sendOtp);
router.post("/auth/verify-otp", riderAuthController.verifyOtp);
router.post("/auth/login", riderAuthController.login);
router.post("/auth/register", riderAuthController.register);
router.post("/auth/logout", riderAuthController.logout);

// Driver-registration auto-verification charge (Razorpay order + verify)
router.post("/verification-payment/create-order", driverVerificationPaymentController.createOrder);
router.post("/verification-payment/verify", driverVerificationPaymentController.verifyPayment);

router.get("/test-drivers", riderController.listTestDrivers);
router.get("/:riderId/delivery-types", riderController.getDeliveryTypes);
router.post("/delivery-type", riderController.setDeliveryType);
router.post("/package-list", riderController.packageListForDriver);
router.post("/scheduled-trips", driverScheduledTripsController.listScheduledTrips);
router.post("/scheduled-trips/interest", driverScheduledTripsController.markInterest);
router.post("/scheduled-trips/interest/remove", driverScheduledTripsController.removeInterest);
router.post("/status", riderController.setStatus);
router.post("/location", riderController.updateLocation);
router.post("/isolate-test-drivers", riderController.isolateTestDrivers);
router.post("/premium-plans", driverPlanController.list);
router.post("/premium-plans/purchase", driverPlanController.purchase);

// Driver profile view and update
router.post("/profile", riderController.getProfile);
router.post("/profile/update", riderController.updateProfile);
router.post("/check-referral", riderController.checkReferral);
router.post("/apply-referral", riderController.applyReferral);
router.post("/claim-referral-reward", riderController.claimReferralReward);
router.post("/leads", driverLeadController.submitLeads);
router.get("/leads", driverLeadController.listMyLeads);

// Driver mandatory training video gate endpoints
router.post("/training/status", trainingController.getStatus);
router.post("/training/progress", trainingController.saveProgress);
router.post("/training/complete", trainingController.complete);

// Monthly Driver Duty & Queue endpoints
const monthlyDriverController = require("../controllers/monthlyDriverController");
const orderQueueController = require("../controllers/orderQueueController");

router.get("/duty/status/:riderId", monthlyDriverController.getDutyStatus);
router.post("/duty/punch-in", monthlyDriverController.punchIn);
router.post("/duty/punch-out", monthlyDriverController.punchOut);
router.get("/queue/:riderId", orderQueueController.getDriverQueue);

// Daily Driver: plans, enrollment, auto-enroll, duty tracking
const dailyDriverController = require("../controllers/dailyDriverController");
router.post("/daily-driver/plans", dailyDriverController.listPlans);
router.post("/daily-driver/enroll", dailyDriverController.enroll);
router.post("/daily-driver/enrollment/cancel", dailyDriverController.cancelEnrollment);
router.post("/daily-driver/auto-enroll", dailyDriverController.setAutoEnroll);
router.post("/daily-driver/auto-enroll/cancel", dailyDriverController.cancelAutoEnroll);
router.get("/daily-driver/duty/status/:riderId", dailyDriverController.getDutyStatus);
router.post("/daily-driver/duty/punch-in", dailyDriverController.punchIn);
router.post("/daily-driver/duty/punch-out", dailyDriverController.punchOut);
router.post("/daily-driver/duty/ping", dailyDriverController.locationPing);

// KYC document uploads, bank account, vehicle details
// (appKeyAuth = the static app-key header the PHP originals required)
router.post("/kyc/address-document", appKeyAuth, driverKycController.uploadAddressDocument);
router.post("/kyc/license-document", appKeyAuth, driverKycController.uploadLicenseDocument);
router.post("/kyc/residence-document", appKeyAuth, driverKycController.uploadResidenceDocument);
router.post("/kyc/bank-account", appKeyAuth, driverKycController.saveBankAccount);
router.post("/kyc/vehicle-detail", appKeyAuth, driverKycController.saveVehicleDetail);
router.post("/vehicle/update", driverKycController.updateRiderVehicle);
router.post("/vehicle/type-list", driverKycController.vehicleTypeList);
router.get("/vehicle/list", appKeyAuth, driverKycController.vehicleList);

// Payouts / wallet withdrawal
router.post("/payout/list", driverPayoutController.payoutList);
router.post("/payout/request", driverPayoutController.requestPayout);
router.post("/payout/withdraw-request", driverPayoutController.withdrawRequest);

// Dynamic questions / onboarding survey
router.get("/survey/dynamic-questions", appKeyAuth, driverSurveyController.dynamicQuestionList);
router.post("/survey/dynamic-answer", appKeyAuth, driverSurveyController.saveDynamicAnswer);
router.post("/survey/list", appKeyAuth, driverSurveyController.surveyList);
router.post("/survey/answer", appKeyAuth, driverSurveyController.saveSurveyAnswers);

// Custom-order bidding (driver side) - customer side is in user.routes.js
router.post("/custom-order/open", customOrderBiddingController.listOpenOrdersForDriver);
router.post("/custom-order/bid", customOrderBiddingController.placeBid);

// Driver home/dashboard, static content, misc onboarding (Node port of the
// remaining rider_api/*.php endpoints confirmed live in UserService.java)
router.post("/home", driverContentController.homeData);
router.get("/cities", appKeyAuth, driverContentController.cityList);
router.get("/country-codes", appKeyAuth, driverContentController.countryCodeList);
router.post("/pages", driverContentController.pageList);
router.post("/notifications", appKeyAuth, driverContentController.notificationList);
router.post("/emergency-contact", appKeyAuth, driverContentController.saveEmergencyContact);
router.post("/is-bicycle", appKeyAuth, driverContentController.setIsBicycle);
router.post("/registration-settings", driverContentController.registrationSettings);
router.get("/joining-plan", appKeyAuth, driverContentController.joiningPlan);
router.post("/kit-details", appKeyAuth, driverContentController.saveKitDetails);

// Driver's own order history (rid-filtered - distinct from the uid-filtered
// customer versions in orderRoutes.js/legacyOrderController.js)
router.post("/orders/history", driverOrderHistoryController.pkgHistoryDriver);
router.post("/orders/legacy/history", appKeyAuth, legacyOrderController.buyHistoryDriver);
router.post("/orders/legacy/detail", appKeyAuth, legacyOrderController.buyOrderDetailDriver);
router.post("/orders/legacy/bill-upload", appKeyAuth, legacyOrderController.billUpload);

// KYC onboarding-progress dashboard + post-hoc document verification
router.post("/kyc/document-check", appKeyAuth, driverKycStatusController.documentCheck);
router.post("/kyc/verify-document", appKeyAuth, driverKycStatusController.verifyDriverDocument);

// Government DL/RC verification proxies (see driverGovVerificationController.js
// header - DL is the official Sarathi Parivahan portal; RC is an
// unofficial Acko API call kept as-is per product decision)
router.get("/kyc/dl/captcha", driverGovVerificationController.generateCaptcha);
router.post("/kyc/dl/verify", driverGovVerificationController.verifyDrivingLicence);
router.post("/kyc/rc/verify", driverGovVerificationController.verifyRc);
router.post("/kyc/aadhar/verify", driverGovVerificationController.verifyAadhar);
// Lets the app fetch the Acko/Sarathi session cookies admin can rotate via
// PUT /admin/settings instead of having them hardcoded in the APK.
router.get("/kyc/dynamic-config", appKeyAuth, driverGovVerificationController.getDynamicKycConfig);

module.exports = router;


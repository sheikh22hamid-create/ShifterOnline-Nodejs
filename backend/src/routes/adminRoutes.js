const express = require("express");
const authController = require("../controllers/authController");
const staffController = require("../controllers/staffController");
const masterDataController = require("../controllers/masterDataController");
const rateCardController = require("../controllers/rateCardController");
const adminRiderController = require("../controllers/adminRiderController");
const adminOrderController = require("../controllers/adminOrderController");
const adminCustomerController = require("../controllers/adminCustomerController");
const payoutController = require("../controllers/payoutController");
const customOrderController = require("../controllers/customOrderController");
const marketingController = require("../controllers/marketingController");
const referralController = require("../controllers/referralController");
const settingsController = require("../controllers/settingsController");
const analyticsController = require("../controllers/analyticsController");
const fleetController = require("../controllers/fleetController");
const cmsController = require("../controllers/cmsController");
const questionController = require("../controllers/questionController");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const scopeFilter = require("../middleware/scopeFilter");

const router = express.Router();

// Every route below (except login) requires a valid admin-panel JWT.
router.post("/auth/login", authController.login);
router.get("/auth/me", auth, authController.me);
router.put("/auth/profile", auth, authController.updateProfile);

// --- Staff & Executive Management -----------------------------------------
router.get("/staff", auth, authorize("superadmin", "admin"), staffController.list);
router.post("/staff", auth, authorize("superadmin", "admin"), staffController.create);
router.put("/staff/:id", auth, authorize("superadmin", "admin"), staffController.update);
router.delete("/staff/:id", auth, authorize("superadmin"), staffController.remove);

// --- Cities, Vehicles & Categories (Master Setup) --------------------------
router.get("/cities", auth, masterDataController.listCities);
router.post("/cities", auth, authorize("superadmin"), masterDataController.createCity);
router.put("/cities/:id", auth, authorize("superadmin"), masterDataController.updateCity);
router.delete("/cities/:id", auth, authorize("superadmin"), masterDataController.deleteCity);

router.get("/vehicles", auth, masterDataController.listVehicles);
router.post("/vehicles", auth, authorize("superadmin"), masterDataController.createVehicle);
router.put("/vehicles/:id", auth, authorize("superadmin"), masterDataController.updateVehicle);
router.delete("/vehicles/:id", auth, authorize("superadmin"), masterDataController.deleteVehicle);

router.get("/categories", auth, masterDataController.listCategories);
router.post("/categories", auth, authorize("superadmin"), masterDataController.createCategory);
router.put("/categories/:id", auth, authorize("superadmin"), masterDataController.updateCategory);
router.delete("/categories/:id", auth, authorize("superadmin"), masterDataController.deleteCategory);

// --- Rate Cards & Pricing Engine (tbl_package, Model 1-5) -------------------
router.get("/rate-cards", auth, rateCardController.list);
router.get("/rate-cards/:id", auth, rateCardController.getOne);
router.post("/rate-cards", auth, authorize("superadmin"), rateCardController.create);
router.put("/rate-cards/:id", auth, authorize("superadmin"), rateCardController.update);
router.delete("/rate-cards/:id", auth, authorize("superadmin"), rateCardController.remove);

// --- Drivers & KYC Verification ---------------------------------------------
const RIDER_ROLES = ["superadmin", "admin", "executive"];
router.get("/riders", auth, authorize(...RIDER_ROLES), scopeFilter, adminRiderController.list);
router.get("/riders/:id", auth, authorize(...RIDER_ROLES), scopeFilter, adminRiderController.getOne);
router.post("/riders/:id/kyc-decision", auth, authorize(...RIDER_ROLES), scopeFilter, adminRiderController.kycDecision);
router.patch("/riders/:id/status", auth, authorize("superadmin", "admin"), scopeFilter, adminRiderController.toggleStatus);
router.delete("/riders/:id", auth, authorize("superadmin"), adminRiderController.remove);

// --- Orders & Live Dispatch Intervention ------------------------------------
// NOTE: /orders/scheduled must be registered before /orders/:id, or Express
// would match "scheduled" as the :id param.
router.get("/orders/scheduled", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.listScheduled);
router.post("/orders/scheduled/:id/assign-driver", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.assignScheduledDriver);

router.get("/orders", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.list);
router.get("/orders/:id", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.getOne);
router.get("/orders/:id/invoice", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.invoice);
router.post("/orders/:id/assign-rider", auth, authorize(...RIDER_ROLES), scopeFilter, adminOrderController.assignRider);
router.put("/orders/:id", auth, authorize("superadmin", "admin"), scopeFilter, adminOrderController.update);
router.post("/orders/:id/cancel", auth, authorize("superadmin", "admin"), scopeFilter, adminOrderController.cancel);

// --- Customers ---------------------------------------------------------------
router.get("/customers", auth, authorize(...RIDER_ROLES), scopeFilter, adminCustomerController.list);
router.get("/customers/:id", auth, authorize(...RIDER_ROLES), scopeFilter, adminCustomerController.getOne);
router.patch("/customers/:id/status", auth, authorize("superadmin", "admin"), scopeFilter, adminCustomerController.toggleStatus);
router.post("/customers/:id/wallet-adjust", auth, authorize("superadmin", "admin"), scopeFilter, adminCustomerController.walletAdjust);
router.delete("/customers/:id", auth, authorize("superadmin"), adminCustomerController.remove);

// --- Driver Payouts ----------------------------------------------------------
router.get("/payouts", auth, authorize("superadmin", "admin"), scopeFilter, payoutController.list);
router.post("/payouts/:id/approve", auth, authorize("superadmin", "admin"), payoutController.approve);
router.post("/payouts/:id/reject", auth, authorize("superadmin", "admin"), payoutController.reject);

// --- Custom Orders & Bidding Engine ------------------------------------------
router.get("/custom-orders", auth, authorize(...RIDER_ROLES), scopeFilter, customOrderController.list);
router.get("/custom-orders/:id/bids", auth, authorize(...RIDER_ROLES), scopeFilter, customOrderController.getBids);
router.post("/custom-orders/:id/convert", auth, authorize("superadmin", "admin"), scopeFilter, customOrderController.convert);

// --- Marketing: Banners, Coupons, Premium Plans ------------------------------
router.get("/marketing/banners", auth, marketingController.listBanners);
router.post("/marketing/banners", auth, authorize("superadmin", "admin"), marketingController.createBanner);
router.put("/marketing/banners/:id", auth, authorize("superadmin", "admin"), marketingController.updateBanner);
router.delete("/marketing/banners/:id", auth, authorize("superadmin", "admin"), marketingController.deleteBanner);

router.get("/marketing/coupons", auth, marketingController.listCoupons);
router.post("/marketing/coupons", auth, authorize("superadmin"), marketingController.createCoupon);
router.put("/marketing/coupons/:id", auth, authorize("superadmin"), marketingController.updateCoupon);
router.delete("/marketing/coupons/:id", auth, authorize("superadmin"), marketingController.deleteCoupon);

router.get("/marketing/premium-plans", auth, marketingController.listPremiumPlans);
router.post("/marketing/premium-plans", auth, authorize("superadmin"), marketingController.createPremiumPlan);
router.put("/marketing/premium-plans/:id", auth, authorize("superadmin"), marketingController.updatePremiumPlan);
router.delete("/marketing/premium-plans/:id", auth, authorize("superadmin"), marketingController.deletePremiumPlan);

// --- Referral Tree & Loyalty Points ------------------------------------------
router.get("/referrals/settings", auth, referralController.getSettings);
router.put("/referrals/settings", auth, authorize("superadmin"), referralController.updateSettings);
router.get("/referrals/users", auth, authorize(...RIDER_ROLES), scopeFilter, referralController.listUserReferrals);
router.post("/referrals/adjust-points", auth, authorize("superadmin", "admin"), referralController.adjustPoints);

// --- Platform Master Settings & Payment Gateways -----------------------------
router.get("/settings", auth, authorize("superadmin"), settingsController.getSettings);
router.put("/settings", auth, authorize("superadmin"), settingsController.updateSettings);
router.get("/settings/payment-gateways", auth, authorize("superadmin"), settingsController.listPaymentGateways);
router.put("/settings/payment-gateways/:id", auth, authorize("superadmin"), settingsController.updatePaymentGateway);

// --- Business Intelligence & Analytics ---------------------------------------
router.get("/analytics/overview", auth, authorize("superadmin", "admin"), scopeFilter, analyticsController.overview);
router.post("/analytics/sales-report", auth, authorize("superadmin", "admin"), analyticsController.salesReport);
router.get("/analytics/month-comparison", auth, authorize("superadmin", "admin"), analyticsController.monthComparison);
router.get("/analytics/city-comparison", auth, authorize("superadmin"), analyticsController.cityComparison);

// --- Live Fleet Tracking & Driver Activity -----------------------------------
router.get("/fleet/live-tracking", auth, authorize(...RIDER_ROLES), scopeFilter, fleetController.liveTracking);
router.get("/fleet/driver-activity", auth, authorize(...RIDER_ROLES), scopeFilter, fleetController.driverActivity);

// --- CMS: Cancellation Reasons, Legal Pages, FAQs ----------------------------
router.get("/cancel-reasons", auth, cmsController.listCancelReasons);
router.post("/cancel-reasons", auth, authorize("superadmin"), cmsController.createCancelReason);
router.put("/cancel-reasons/:id", auth, authorize("superadmin"), cmsController.updateCancelReason);
router.delete("/cancel-reasons/:id", auth, authorize("superadmin"), cmsController.deleteCancelReason);

router.get("/pages", auth, cmsController.listPages);
router.post("/pages", auth, authorize("superadmin"), cmsController.createPage);
router.put("/pages/:id", auth, authorize("superadmin"), cmsController.updatePage);
router.delete("/pages/:id", auth, authorize("superadmin"), cmsController.deletePage);

router.get("/faqs", auth, cmsController.listFaqs);
router.post("/faqs", auth, authorize("superadmin"), cmsController.createFaq);
router.put("/faqs/:id", auth, authorize("superadmin"), cmsController.updateFaq);
router.delete("/faqs/:id", auth, authorize("superadmin"), cmsController.deleteFaq);

// --- Dynamic Questions: post-trip survey questions & choices -----------------
router.get("/questions", auth, authorize("superadmin"), questionController.listQuestions);
router.post("/questions", auth, authorize("superadmin"), questionController.createQuestion);
router.put("/questions/:id", auth, authorize("superadmin"), questionController.updateQuestion);
router.delete("/questions/:id", auth, authorize("superadmin"), questionController.deleteQuestion);

router.get("/questions/:id/options", auth, authorize("superadmin"), questionController.listOptions);
router.post("/questions/:id/options", auth, authorize("superadmin"), questionController.createOption);
router.delete("/questions/:id/options/:optionId", auth, authorize("superadmin"), questionController.deleteOption);

module.exports = router;

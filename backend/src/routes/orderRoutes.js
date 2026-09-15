const express = require("express");
const orderController = require("../controllers/orderController");
const uploadController = require("../controllers/uploadController");
const legacyOrderController = require("../controllers/legacyOrderController");
const orderAvailabilityController = require("../controllers/orderAvailabilityController");
const orderInvoiceController = require("../controllers/orderInvoiceController");

const router = express.Router();

router.get("/categories", orderController.getCategories);
router.post("/fare-estimate", orderController.fareEstimate);
router.post("/distance", orderController.distanceEstimate);
router.post("/packagelist", orderController.packageListEstimate);
router.post("/create", orderController.createOrder);
router.post("/details", orderController.getOrderDetails);
router.post("/customer-cancel", orderController.customerCancel);
router.post("/driver-cancel", orderController.driverCancel);
router.post("/verify-pickup-otp", orderController.verifyPickupOtp);
router.post("/check-pickup-amount", orderController.checkPickupAmount);
router.post("/cancel-reasons", orderController.getCancelReasons);
router.post("/status-change", orderController.orderStatusChangeLegacy);
router.post("/buy/status-change", orderController.bOrderStatusChangeLegacy);
router.post("/buy/item-list", orderController.buyOrderItemList);
router.post("/buy/item-unavailable", orderController.markBuyOrderItemUnavailable);
router.post("/buy/item-upload", orderController.buyOrderItemUpload);
router.post("/rate", orderController.rateOrder);
router.post("/next-day-eligibility", orderController.checkNextDayEligibility);
router.post("/upload-photo", uploadController.uploadOrderPhoto);

// Live, hot-path endpoints the booking screen still calls on legacy PHP
// today (see orderAvailabilityController.js header) - the exact route path
// PHP's own available-vehicles.php/index.php aliases already named.
router.post("/available-vehicles", orderAvailabilityController.availableVehicles);
router.post("/payment-status", orderController.paymentMethodStatus);
router.post("/invoice-url", orderInvoiceController.generateInvoiceUrl);
router.get("/invoice", orderInvoiceController.renderInvoice);
router.post("/map-info", orderController.getMapInfo);

// My-orders list (was missing entirely - see legacyOrderController.js header)
router.post("/history", legacyOrderController.pkgHistory);

// Pre-migration buy_order history/tracking - read-mostly, no new rows are
// ever created here (order creation is createOrder above, writes pkg_order)
router.post("/legacy/history", legacyOrderController.buyHistory);
router.post("/legacy/detail", legacyOrderController.buyOrderDetail);
router.post("/legacy/map-info", legacyOrderController.buyMapInfo);
router.post("/legacy/rate", legacyOrderController.buyRate);
router.post("/legacy/cancel", legacyOrderController.buyCancel);
router.post("/legacy/pay-bill", legacyOrderController.payBill);

module.exports = router;

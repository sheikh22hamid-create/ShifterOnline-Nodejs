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
router.post("/advance-payment", orderController.advancePayment);

// My-orders list (was missing entirely - see legacyOrderController.js header)
router.post("/history", legacyOrderController.pkgHistory);

// buy_order history/tracking, plus (as of the cust_api/buy_order.php,
// confirm_item.php, item_remove.php ports below) the "Buy Anything" create
// and item-confirm/remove write paths too - a deliberate decision to keep
// buy_order as the live table for this feature rather than redesigning it
// onto pkg_order (which has no item-list/confirm-item/pay-bill concept).
router.post("/legacy/history", legacyOrderController.buyHistory);
router.post("/legacy/detail", legacyOrderController.buyOrderDetail);
router.post("/legacy/map-info", legacyOrderController.buyMapInfo);
router.post("/legacy/rate", legacyOrderController.buyRate);
router.post("/legacy/cancel", legacyOrderController.buyCancel);
router.post("/legacy/pay-bill", legacyOrderController.payBill);
router.post("/legacy/create", legacyOrderController.buyOrderCreate);
router.post("/legacy/confirm-item", legacyOrderController.confirmItem);
router.post("/legacy/item-remove", legacyOrderController.itemRemove);

module.exports = router;

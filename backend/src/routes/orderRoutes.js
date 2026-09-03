const express = require("express");
const orderController = require("../controllers/orderController");
const uploadController = require("../controllers/uploadController");

const router = express.Router();

router.get("/categories", orderController.getCategories);
router.post("/fare-estimate", orderController.fareEstimate);
router.post("/create", orderController.createOrder);
router.post("/details", orderController.getOrderDetails);
router.post("/customer-cancel", orderController.customerCancel);
router.post("/rate", orderController.rateOrder);
router.post("/upload-photo", uploadController.uploadOrderPhoto);

module.exports = router;

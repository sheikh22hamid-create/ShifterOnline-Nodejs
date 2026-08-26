const express = require("express");
const orderController = require("../controllers/orderController");

const router = express.Router();

router.get("/categories", orderController.getCategories);
router.post("/fare-estimate", orderController.fareEstimate);
router.post("/create", orderController.createOrder);
router.post("/details", orderController.getOrderDetails);
router.post("/customer-cancel", orderController.customerCancel);
router.post("/rate", orderController.rateOrder);

module.exports = router;

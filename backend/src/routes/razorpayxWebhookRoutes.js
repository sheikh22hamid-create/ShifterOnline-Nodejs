const express = require("express");
const controller = require("../controllers/razorpayxWebhookController");

const router = express.Router();
router.post("/", controller.handle);

module.exports = router;

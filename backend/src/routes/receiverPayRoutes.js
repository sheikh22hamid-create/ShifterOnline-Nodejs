const express = require("express");
const { createIpRateLimiter } = require("../middleware/ipRateLimiter");
const controller = require("../controllers/receiverPayController");
const senderController = require("../controllers/senderPayController");

const pageRouter = express.Router();
pageRouter.get("/s/:token", createIpRateLimiter({ name: "pay-page-sender", windowMs: 60000, max: 60 }), senderController.page);
pageRouter.get("/:token", createIpRateLimiter({ name: "pay-page", windowMs: 60000, max: 60 }), controller.page);

const apiLimiter = createIpRateLimiter({ name: "pay-api", windowMs: 60000, max: 60 });
const verifyLimiter = createIpRateLimiter({ name: "pay-verify", windowMs: 60000, max: 20 });

const apiRouter = express.Router();
apiRouter.get("/s/:token", apiLimiter, senderController.state);
apiRouter.post("/s/:token/order", apiLimiter, senderController.createOrder);
apiRouter.post("/s/:token/verify", verifyLimiter, senderController.verify);
apiRouter.get("/:token", apiLimiter, controller.state);
apiRouter.post("/:token/order", apiLimiter, controller.createOrder);
apiRouter.post("/:token/verify", verifyLimiter, controller.verify);
apiRouter.post("/:token/decline", apiLimiter, controller.decline);

module.exports = { pageRouter, apiRouter };

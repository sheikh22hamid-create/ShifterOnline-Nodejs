const express = require("express");
const { createIpRateLimiter } = require("../middleware/ipRateLimiter");
const controller = require("../controllers/trackController");

const pageRouter = express.Router();
pageRouter.get("/:token", createIpRateLimiter({ name: "track-page", windowMs: 60000, max: 60 }), controller.page);

const apiRouter = express.Router();
apiRouter.get("/:token", createIpRateLimiter({ name: "track-api", windowMs: 60000, max: 120 }), controller.snapshot);

const actionLimiter = createIpRateLimiter({ name: "track-action", windowMs: 60000, max: 10 });
apiRouter.post("/:token/pay-link", actionLimiter, controller.payLink);
apiRouter.post("/:token/review", actionLimiter, controller.review);

module.exports = { pageRouter, apiRouter };


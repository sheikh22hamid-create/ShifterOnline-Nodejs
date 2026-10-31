const express = require("express");
const { createIpRateLimiter } = require("../middleware/ipRateLimiter");
const controller = require("../controllers/routeShareController");

const pageRouter = express.Router();
pageRouter.get("/:token", createIpRateLimiter({ name: "route-page", windowMs: 60000, max: 60 }), controller.routePage);

const apiRouter = express.Router();
apiRouter.get("/:token", createIpRateLimiter({ name: "route-api", windowMs: 60000, max: 60 }), controller.routeData);

module.exports = { pageRouter, apiRouter };

const express = require("express");
const rateLimiter = require("../middleware/rateLimiter");
const controller = require("../controllers/receiverPayController");

const pageRouter = express.Router();
pageRouter.get("/:token", rateLimiter({ windowMs: 60 * 1000, max: 60 }), controller.page);

const apiRouter = express.Router();
apiRouter.use(rateLimiter({ windowMs: 60 * 1000, max: 30 }));
apiRouter.get("/:token", controller.state);
apiRouter.post("/:token/order", controller.createOrder);
apiRouter.post("/:token/verify", controller.verify);
apiRouter.post("/:token/decline", controller.decline);

module.exports = { pageRouter, apiRouter };

const express = require("express");
const legacyAuth = require("../middleware/legacyAuth");
const legacyController = require("../controllers/legacyController");

const router = express.Router();

router.use(legacyAuth);

router.post("/order/create", legacyController.createOrder);
router.post("/order/reject", legacyController.rejectOrder);
router.post("/dispatch/stop", legacyController.stopDispatch);

module.exports = router;

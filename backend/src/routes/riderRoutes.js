const express = require("express");
const riderController = require("../controllers/riderController");

const router = express.Router();

router.get("/test-drivers", riderController.listTestDrivers);
router.get("/:riderId/delivery-types", riderController.getDeliveryTypes);
router.post("/delivery-type", riderController.setDeliveryType);
router.post("/status", riderController.setStatus);
router.post("/location", riderController.updateLocation);

module.exports = router;

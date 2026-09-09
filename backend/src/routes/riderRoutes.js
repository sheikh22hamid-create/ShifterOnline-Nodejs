const express = require("express");
const riderController = require("../controllers/riderController");
const driverPlanController = require("../controllers/driverPlanController");

const router = express.Router();

router.get("/test-drivers", riderController.listTestDrivers);
router.get("/:riderId/delivery-types", riderController.getDeliveryTypes);
router.post("/delivery-type", riderController.setDeliveryType);
router.post("/status", riderController.setStatus);
router.post("/location", riderController.updateLocation);
router.post("/isolate-test-drivers", riderController.isolateTestDrivers);
router.post("/premium-plans", driverPlanController.list);
router.post("/premium-plans/purchase", driverPlanController.purchase);

module.exports = router;

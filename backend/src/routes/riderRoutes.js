const express = require("express");
const riderController = require("../controllers/riderController");
const driverPlanController = require("../controllers/driverPlanController");
const trainingController = require("../controllers/trainingController");

const router = express.Router();

router.get("/test-drivers", riderController.listTestDrivers);
router.get("/:riderId/delivery-types", riderController.getDeliveryTypes);
router.post("/delivery-type", riderController.setDeliveryType);
router.post("/status", riderController.setStatus);
router.post("/location", riderController.updateLocation);
router.post("/isolate-test-drivers", riderController.isolateTestDrivers);
router.post("/premium-plans", driverPlanController.list);
router.post("/premium-plans/purchase", driverPlanController.purchase);

// Driver mandatory training video gate endpoints
router.post("/training/status", trainingController.getStatus);
router.post("/training/progress", trainingController.saveProgress);
router.post("/training/complete", trainingController.complete);

// Monthly Driver Duty & Queue endpoints
const monthlyDriverController = require("../controllers/monthlyDriverController");
const orderQueueController = require("../controllers/orderQueueController");

router.get("/duty/status/:riderId", monthlyDriverController.getDutyStatus);
router.post("/duty/punch-in", monthlyDriverController.punchIn);
router.post("/duty/punch-out", monthlyDriverController.punchOut);
router.get("/queue/:riderId", orderQueueController.getDriverQueue);

module.exports = router;


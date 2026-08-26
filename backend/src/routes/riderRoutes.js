const express = require("express");
const riderController = require("../controllers/riderController");

const router = express.Router();

router.post("/status", riderController.setStatus);
router.post("/location", riderController.updateLocation);

module.exports = router;

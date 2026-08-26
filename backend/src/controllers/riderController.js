const prisma = require("../config/db");
const logger = require("../utils/logger");

async function setStatus(req, res) {
  try {
    const { rider_id, a_status } = req.body;
    if (!rider_id || ![0, 1].includes(Number(a_status))) {
      return res.status(400).json({ Result: false, msg: "rider_id and a_status (0 or 1) are required" });
    }

    await prisma.tbl_rider.update({
      where: { id: Number(rider_id) },
      data: { a_status: Number(a_status) },
    });

    return res.status(200).json({ Result: true, msg: "Status updated" });
  } catch (err) {
    logger.error("riderController.setStatus failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

/** REST fallback for clients that can't hold a live socket for location updates. */
async function updateLocation(req, res) {
  try {
    const { rider_id, lat, lng } = req.body;
    if (!rider_id || lat === undefined || lng === undefined) {
      return res.status(400).json({ Result: false, msg: "rider_id, lat and lng are required" });
    }

    await prisma.tbl_rider.update({
      where: { id: Number(rider_id) },
      data: { rlats: String(lat), rlongs: String(lng) },
    });

    return res.status(200).json({ Result: true, msg: "Location updated" });
  } catch (err) {
    logger.error("riderController.updateLocation failed:", err);
    return res.status(500).json({ Result: false, msg: "Internal server error" });
  }
}

module.exports = { setStatus, updateLocation };

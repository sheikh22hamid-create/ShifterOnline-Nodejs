const prisma = require("../config/db");
const logger = require("../utils/logger");

/** Flips verified-but-unconverted leads past their expiry window to "expired". */
async function expireStaleLeads() {
  try {
    return await prisma.tbl_driver_lead.updateMany({
      where: { status: "verified", expires_at: { lt: new Date() } },
      data: { status: "expired" },
    });
  } catch (err) {
    logger.error("driverLeadService.expireStaleLeads failed:", err);
    return { count: 0 };
  }
}

module.exports = { expireStaleLeads };

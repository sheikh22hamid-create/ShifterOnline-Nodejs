const prisma = require("../config/db");
const logger = require("../utils/logger");
const dailyDrivers = require("../services/dailyDriverOrderAssign");

// GET /orders/:id/daily-drivers - drives the "Daily Drivers" filter on the manual-assign pickers.
// `applicable` is false for orders the filter is not meant for (anything but scheduled, next-day or a
// Booking Guarantee order), in which case the pickers simply do not show the filter.
async function listForOrder(req, res) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ success: false, message: "Invalid order id" });
    const order = await prisma.pkg_order.findUnique({ where: { id } });
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    // Fail closed: scopeFilter yields NaN for a non-superadmin without a city; never treat that as unscoped.
    if (req.user?.role !== "superadmin") {
      if (!Number.isInteger(req.scopedCityId)) return res.status(403).json({ success: false, message: "Your account is not assigned to a city" });
      if (Number(order.city_id) !== req.scopedCityId) {
        return res.status(403).json({ success: false, message: "Forbidden: order is outside your assigned city" });
      }
    }

    if (!(await dailyDrivers.isApplicable(order))) {
      return res.json({ success: true, data: { applicable: false, drivers: [] } });
    }
    const drivers = await dailyDrivers.listAvailableDailyDrivers(order);
    return res.json({ success: true, data: { applicable: true, drivers } });
  } catch (err) {
    logger.error("adminDailyDriverOrder.listForOrder failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = { listForOrder };

const prisma = require("../config/db");
const logger = require("../utils/logger");

const MAX_KEY = "max_blocked_drivers_per_user";
const DEFAULT_MAX = 3;

async function getMaxBlockedDrivers() {
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: MAX_KEY } });
    const n = parseInt(row?.setting_value, 10);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MAX;
  } catch (err) {
    logger.error("getMaxBlockedDrivers: failed to read admin setting, using default:", err);
    return DEFAULT_MAX;
  }
}

// A customer can block up to an admin-decided number of drivers; blocked
// drivers are never offered that customer's orders (see dispatchManager).
// Calling this again for an already-blocked driver unblocks them.
async function toggleBlockedDriver(req, res) {
  try {
    const userId = Number(req.body?.user_id || 0);
    const riderId = Number(req.body?.rider_id || 0);
    if (!userId || !riderId) return res.status(200).json({ Result: false, msg: "user_id and rider_id required" });

    const existing = await prisma.tbl_user_blocked_driver.findUnique({
      where: { user_id_rider_id: { user_id: userId, rider_id: riderId } },
    });
    if (existing) {
      await prisma.tbl_user_blocked_driver.delete({ where: { id: existing.id } });
      return res.status(200).json({ Result: true, msg: "Driver unblocked", blocked: false });
    }

    const max = await getMaxBlockedDrivers();
    const count = await prisma.tbl_user_blocked_driver.count({ where: { user_id: userId } });
    if (count >= max) {
      return res.status(200).json({
        Result: false,
        msg: max === 0 ? "Blocking drivers is not available." : `You can block up to ${max} driver${max === 1 ? "" : "s"}. Unblock one to block another.`,
      });
    }

    await prisma.tbl_user_blocked_driver.create({ data: { user_id: userId, rider_id: riderId } });
    // A blocked driver can't also be a favourite.
    await prisma.tbl_favorite_driver.updateMany({ where: { user_id: userId, rider_id: riderId }, data: { status: 0 } });
    return res.status(200).json({ Result: true, msg: "Driver blocked. They will not be offered your orders.", blocked: true });
  } catch (err) {
    logger.error("blockedDriver.toggle failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

async function listBlockedDrivers(req, res) {
  try {
    const userId = Number(req.body?.user_id || 0);
    if (!userId) return res.status(200).json({ Result: false, msg: "user_id required" });
    const rows = await prisma.tbl_user_blocked_driver.findMany({ where: { user_id: userId }, orderBy: { id: "desc" } });
    const riders = await prisma.tbl_rider.findMany({
      where: { id: { in: rows.map((r) => r.rider_id) } },
      select: { id: true, first_name: true, last_name: true, vehicle: true },
    });
    const byId = new Map(riders.map((r) => [r.id, r]));
    const max = await getMaxBlockedDrivers();
    return res.status(200).json({
      Result: true,
      max_blocked: max,
      data: rows.map((r) => {
        const rider = byId.get(r.rider_id);
        return { id: r.rider_id, name: rider ? `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : `Driver #${r.rider_id}`, vehicle: rider?.vehicle || "" };
      }),
    });
  } catch (err) {
    logger.error("blockedDriver.list failed:", err);
    return res.status(200).json({ Result: false, msg: "Internal server error" });
  }
}

module.exports = { toggleBlockedDriver, listBlockedDrivers, getMaxBlockedDrivers, MAX_KEY };

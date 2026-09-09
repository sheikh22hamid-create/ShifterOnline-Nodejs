const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function riderName(r) {
  return r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || null;
}

async function listProgress(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;

    const riders = await prisma.tbl_rider.findMany({
      where,
      select: { id: true, first_name: true, last_name: true, full_name: true, fmobile: true, city_id: true },
      orderBy: { id: "desc" },
    });
    const riderIds = riders.map((r) => r.id);

    const progressRows = await prisma.driver_training_progress.findMany({ where: { rider_id: { in: riderIds } } });
    const progressByRider = Object.fromEntries(progressRows.map((p) => [p.rider_id, p]));

    let rows = riders.map((r) => {
      const progress = progressByRider[r.id];
      return {
        rider_id: r.id,
        full_name: riderName(r),
        fmobile: r.fmobile,
        watch_progress: progress ? progress.watch_progress : 0,
        is_completed: progress ? progress.is_completed : false,
        completed_at: progress ? progress.completed_at : null,
        updated_at: progress ? progress.updated_at : null,
      };
    });

    if (req.query.status === "completed") {
      rows = rows.filter((r) => r.is_completed);
    } else if (req.query.status === "pending") {
      rows = rows.filter((r) => !r.is_completed);
    }

    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "adminTraining.listProgress");
  }
}

/** Deletes the driver's progress row — their next status check comes back NOT_STARTED / 0%. */
/** Same rule adminRiderController.toggleStatus applies to any single-rider mutation: an admin/executive can only act within their own city. */
function isScopedOut(req, riderCityId) {
  return req.user.role !== "superadmin" && riderCityId !== parseInt(req.user.city_id, 10);
}

async function resetProgress(req, res) {
  try {
    const riderId = parseInt(req.params.riderId, 10);
    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { city_id: true } });
    if (!rider) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }
    if (isScopedOut(req, rider.city_id)) {
      return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
    }

    const existing = await prisma.driver_training_progress.findUnique({ where: { rider_id: riderId } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "No training progress recorded for this driver" });
    }

    await prisma.driver_training_progress.delete({ where: { rider_id: riderId } });
    return res.status(200).json({ success: true, message: "Training progress reset" });
  } catch (err) {
    return internalError(res, err, "adminTraining.resetProgress");
  }
}

module.exports = { listProgress, resetProgress };

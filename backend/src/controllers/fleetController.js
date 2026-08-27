const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function liveTracking(req, res) {
  try {
    const where = { a_status: 1 };
    if (req.scopedCityId) where.city_id = req.scopedCityId;

    const riders = await prisma.tbl_rider.findMany({
      where,
      select: { id: true, full_name: true, first_name: true, last_name: true, city_id: true, rlats: true, rlongs: true, vehicle: true, vehicle_no: true },
    });

    const riderIds = riders.map((r) => r.id);
    // o_status is checked alongside order_status because cancel() never
    // resets order_status, only o_status — see adminOrderController.js.
    const activeOrders = riderIds.length
      ? await prisma.pkg_order.findMany({
          where: { rid: { in: riderIds }, order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } },
          select: { rid: true, id: true },
        })
      : [];
    const activeOrderByRider = Object.fromEntries(activeOrders.map((o) => [o.rid, o.id]));

    const data = riders
      .filter((r) => r.rlats && r.rlongs)
      .map((r) => ({
        rider_id: r.id,
        full_name: r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim(),
        city_id: r.city_id,
        vehicle: r.vehicle,
        vehicle_no: r.vehicle_no,
        lat: Number(r.rlats),
        lng: Number(r.rlongs),
        // Not tracked anywhere in the live schema (tbl_rider only stores
        // rlats/rlongs) — omitted rather than fabricated.
        heading: null,
        battery_level: null,
        status: activeOrderByRider[r.id] ? "on_trip" : "idle",
        active_order_id: activeOrderByRider[r.id] || null,
      }));

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "fleet.liveTracking");
  }
}

async function driverActivity(req, res) {
  try {
    // driver_activity has no primary/unique key in the live DB, so Prisma's
    // client can't model it (@@ignore in schema.prisma) — raw SQL only. It
    // also has no city_id column, so city scoping has to go through
    // tbl_rider rather than a WHERE clause on this table directly.
    const conditions = [];
    const params = [];

    if (req.query.rider_id) {
      const riderId = parseInt(req.query.rider_id, 10);
      if (req.user.role !== "superadmin") {
        const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId }, select: { city_id: true } });
        if (!rider || rider.city_id !== req.scopedCityId) {
          return res.status(403).json({ success: false, message: "Forbidden: driver is outside your assigned city" });
        }
      }
      conditions.push("driver_id = ?");
      params.push(riderId);
    } else if (req.scopedCityId) {
      const riders = await prisma.tbl_rider.findMany({ where: { city_id: req.scopedCityId }, select: { id: true } });
      if (riders.length === 0) {
        return res.status(200).json({ success: true, total: 0, data: [] });
      }
      conditions.push(`driver_id IN (${riders.map(() => "?").join(",")})`);
      params.push(...riders.map((r) => r.id));
    }

    if (req.query.date) {
      conditions.push("date = ?");
      params.push(req.query.date);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, driver_id, time_duration, date, ride_count, driver_schudle_type, zone, total_fair_monthly
       FROM driver_activity ${where} ORDER BY date DESC LIMIT 200`,
      ...params
    );

    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "fleet.driverActivity");
  }
}

module.exports = { liveTracking, driverActivity };

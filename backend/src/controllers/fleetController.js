const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function liveTracking(req, res) {
  try {
    const where = {};
    if (req.scopedCityId) where.city_id = req.scopedCityId;

    const riders = await prisma.tbl_rider.findMany({
      where,
      select: {
        id: true,
        full_name: true,
        first_name: true,
        last_name: true,
        city_id: true,
        rlats: true,
        rlongs: true,
        rloc_updated_at: true,
        a_status: true,
        vehicle: true,
        vehicle_no: true,
      },
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

    // Drivers whose app stopped sending location pings (>15 mins) or who toggled offline
    const STALE_PING_THRESHOLD_MS = 15 * 60 * 1000;
    const now = Date.now();

    const data = riders
      .filter((r) => r.rlats && r.rlongs && Number(r.rlats) !== 0 && Number(r.rlongs) !== 0)
      .map((r) => {
        const hasActiveOrder = Boolean(activeOrderByRider[r.id]);
        const isFresh = r.rloc_updated_at
          ? now - new Date(r.rloc_updated_at).getTime() < STALE_PING_THRESHOLD_MS
          : false;

        let status;
        if (hasActiveOrder) {
          status = "on_trip";
        } else if (r.a_status === 1 && isFresh) {
          status = "idle";
        } else {
          status = "offline";
        }

        return {
          rider_id: r.id,
          full_name: r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim(),
          city_id: r.city_id,
          vehicle: r.vehicle,
          vehicle_no: r.vehicle_no,
          lat: Number(r.rlats),
          lng: Number(r.rlongs),
          heading: null,
          battery_level: null,
          status, // 'on_trip' | 'idle' | 'offline'
          online: status !== "offline",
          a_status: r.a_status,
          rloc_updated_at: r.rloc_updated_at,
          active_order_id: activeOrderByRider[r.id] || null,
        };
      });

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

async function activeTrips(req, res) {
  try {
    const where = {
      o_status: { in: ["Pending", "Processing", "Pickup", "On_Route"] },
      order_status: { in: [0, 1, 2, 3] },
    };
    if (req.scopedCityId) where.city_id = req.scopedCityId;

    const rows = await prisma.pkg_order.findMany({
      where,
      orderBy: { id: "desc" },
      take: 60,
    });

    const uids = [...new Set(rows.map((o) => o.uid))];
    const rids = [...new Set(rows.map((o) => o.rid).filter((rid) => rid))];
    const [customers, riders, packages] = await Promise.all([
      prisma.tbl_user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, mobile: true } }),
      prisma.tbl_rider.findMany({ where: { id: { in: rids } }, select: { id: true, first_name: true, last_name: true, full_name: true, fmobile: true, vehicle_no: true, rlats: true, rlongs: true } }),
      prisma.tbl_package.findMany({ select: { id: true, title: true } }),
    ]);
    const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));
    const packageById = Object.fromEntries(packages.map((p) => [p.id, p.title]));

    const data = rows.map((o) => {
      const customer = customerById[o.uid];
      const rider = o.rid ? riderById[o.rid] : null;
      return {
        id: o.id,
        uid: o.uid,
        customer_name: customer ? customer.name : null,
        customer_mobile: customer ? String(customer.mobile) : null,
        rid: o.rid,
        rider_name: rider ? rider.full_name || `${rider.first_name || ""} ${rider.last_name || ""}`.trim() : "Unassigned",
        rider_mobile: rider ? rider.fmobile : null,
        rider_vehicle: rider ? rider.vehicle_no : null,
        rider_lat: rider?.rlats ? Number(rider.rlats) : null,
        rider_lng: rider?.rlongs ? Number(rider.rlongs) : null,
        o_status: o.o_status,
        order_status: o.order_status,
        total_dcharge: String(o.total_dcharge),
        paddress: o.paddress,
        daddress: o.daddress,
        plat: o.plat,
        plong: o.plong,
        dlat: o.dlat,
        dlong: o.dlong,
        package_title: packageById[o.delivery_type] || o.category || null,
        booking_type: o.booking_type,
        odate: o.odate,
        city_id: o.city_id,
      };
    });

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "fleet.activeTrips");
  }
}

module.exports = { liveTracking, driverActivity, activeTrips };

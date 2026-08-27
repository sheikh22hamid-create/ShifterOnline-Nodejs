const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

async function overview(req, res) {
  try {
    const orderWhere = {};
    const riderWhere = {};
    if (req.scopedCityId) {
      orderWhere.city_id = req.scopedCityId;
      riderWhere.city_id = req.scopedCityId;
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [revenueAgg, todayRevenueAgg, totalOrders, activeOrders, totalDrivers, onlineDrivers, kycPending] = await Promise.all([
      prisma.pkg_order.aggregate({ where: { ...orderWhere, o_status: "Completed" }, _sum: { total_dcharge: true } }),
      prisma.pkg_order.aggregate({ where: { ...orderWhere, o_status: "Completed", odate: { gte: todayStart } }, _sum: { total_dcharge: true } }),
      prisma.pkg_order.count({ where: orderWhere }),
      // o_status is checked alongside order_status because cancel() never
      // resets order_status, only o_status — see adminOrderController.js.
      prisma.pkg_order.count({ where: { ...orderWhere, order_status: { in: [1, 2, 3] }, o_status: { notIn: ["Completed", "Cancelled"] } } }),
      prisma.tbl_rider.count({ where: riderWhere }),
      prisma.tbl_rider.count({ where: { ...riderWhere, a_status: 1 } }),
      prisma.tbl_rider.count({ where: { ...riderWhere, verification_status: "pending" } }),
    ]);

    return res.status(200).json({
      success: true,
      kpis: {
        total_revenue: round2(revenueAgg._sum.total_dcharge),
        today_revenue: round2(todayRevenueAgg._sum.total_dcharge),
        total_orders: totalOrders,
        active_orders: activeOrders,
        total_drivers: totalDrivers,
        online_drivers: onlineDrivers,
        kyc_pending_count: kycPending,
      },
    });
  } catch (err) {
    return internalError(res, err, "analytics.overview");
  }
}

async function salesReport(req, res) {
  try {
    const { start_date, end_date, city_id, status } = req.body;
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: "start_date and end_date are required" });
    }

    const scopedCityId = req.user.role === "superadmin" ? (city_id ? Number(city_id) : null) : parseInt(req.user.city_id, 10);
    const start = new Date(`${start_date}T00:00:00`);
    const end = new Date(`${end_date}T23:59:59`);
    const statusFilter = status || "Completed";
    const cityFilter = scopedCityId ? Prisma.sql`AND city_id = ${scopedCityId}` : Prisma.empty;

    const rows = await prisma.$queryRaw`
      SELECT DATE(odate) AS day, COUNT(*) AS bookings, COALESCE(SUM(total_dcharge), 0) AS revenue
      FROM pkg_order
      WHERE odate BETWEEN ${start} AND ${end}
        AND o_status = ${statusFilter}
        ${cityFilter}
      GROUP BY DATE(odate)
      ORDER BY day ASC
    `;

    const data = rows.map((r) => ({ date: r.day, bookings: Number(r.bookings), revenue: round2(r.revenue) }));
    const totals = data.reduce((acc, r) => ({ bookings: acc.bookings + r.bookings, revenue: round2(acc.revenue + r.revenue) }), { bookings: 0, revenue: 0 });

    return res.status(200).json({ success: true, totals, data });
  } catch (err) {
    return internalError(res, err, "analytics.salesReport");
  }
}

async function monthComparison(req, res) {
  try {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const scopedCityId = req.user.role === "superadmin" ? (req.query.city_id ? Number(req.query.city_id) : null) : parseInt(req.user.city_id, 10);
    const yearStart = new Date(`${year}-01-01T00:00:00`);
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00`);
    const cityFilter = scopedCityId ? Prisma.sql`AND city_id = ${scopedCityId}` : Prisma.empty;

    const [orderRows, userRows] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          MONTH(odate) AS month,
          COALESCE(SUM(CASE WHEN o_status = 'Completed' THEN total_dcharge ELSE 0 END), 0) AS gmv,
          SUM(CASE WHEN o_status = 'Completed' THEN 1 ELSE 0 END) AS completed_trips,
          SUM(CASE WHEN o_status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled_trips,
          COUNT(*) AS total_trips
        FROM pkg_order
        WHERE odate >= ${yearStart} AND odate < ${yearEnd}
          ${cityFilter}
        GROUP BY MONTH(odate)
      `,
      prisma.$queryRaw`
        SELECT MONTH(rdate) AS month, COUNT(*) AS new_customers
        FROM tbl_user
        WHERE rdate >= ${yearStart} AND rdate < ${yearEnd}
          ${cityFilter}
        GROUP BY MONTH(rdate)
      `,
    ]);

    const orderByMonth = Object.fromEntries(orderRows.map((r) => [Number(r.month), r]));
    const usersByMonth = Object.fromEntries(userRows.map((r) => [Number(r.month), Number(r.new_customers)]));

    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      const o = orderByMonth[m];
      const totalTrips = o ? Number(o.total_trips) : 0;
      const cancelled = o ? Number(o.cancelled_trips) : 0;
      return {
        month: m,
        gmv: round2(o?.gmv),
        completed_trips: o ? Number(o.completed_trips) : 0,
        cancellation_rate: totalTrips > 0 ? round2((cancelled / totalTrips) * 100) : 0,
        new_customers: usersByMonth[m] || 0,
      };
    });

    return res.status(200).json({ success: true, year, data: months });
  } catch (err) {
    return internalError(res, err, "analytics.monthComparison");
  }
}

async function cityComparison(req, res) {
  try {
    const [orderRows, driverRows, cities] = await Promise.all([
      prisma.$queryRaw`
        SELECT
          city_id,
          COALESCE(SUM(CASE WHEN o_status = 'Completed' THEN total_dcharge ELSE 0 END), 0) AS revenue,
          SUM(CASE WHEN o_status = 'Completed' THEN 1 ELSE 0 END) AS completed_trips,
          COUNT(*) AS total_trips
        FROM pkg_order
        WHERE city_id IS NOT NULL
        GROUP BY city_id
      `,
      prisma.tbl_rider.groupBy({ by: ["city_id"], _count: { id: true }, where: { city_id: { not: null } } }),
      prisma.tbl_city.findMany({ select: { id: true, title: true } }),
    ]);

    const cityNameById = Object.fromEntries(cities.map((c) => [c.id, c.title]));
    const driverCountByCity = Object.fromEntries(driverRows.map((r) => [r.city_id, r._count.id]));

    const data = orderRows.map((r) => {
      const cityId = Number(r.city_id);
      const totalTrips = Number(r.total_trips);
      const completedTrips = Number(r.completed_trips);
      const revenue = round2(r.revenue);
      return {
        city_id: cityId,
        city_name: cityNameById[cityId] || null,
        revenue,
        completed_trips: completedTrips,
        total_trips: totalTrips,
        avg_ticket_size: completedTrips > 0 ? round2(revenue / completedTrips) : 0,
        fulfillment_rate: totalTrips > 0 ? round2((completedTrips / totalTrips) * 100) : 0,
        driver_count: driverCountByCity[cityId] || 0,
      };
    });

    data.sort((a, b) => b.revenue - a.revenue);

    return res.status(200).json({ success: true, total: data.length, data });
  } catch (err) {
    return internalError(res, err, "analytics.cityComparison");
  }
}

module.exports = { overview, salesReport, monthComparison, cityComparison };

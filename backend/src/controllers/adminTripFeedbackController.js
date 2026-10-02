const prisma = require("../config/db");
const logger = require("../utils/logger");

const RATING_COLUMNS = ["customer_rating", "pickup_location_rating", "drop_location_rating", "route_rating"];

/**
 * Admin "Trip Feedback" table: every post-trip form a driver submitted
 * (customer / pickup / drop / route star ratings + no-entry-zone Yes/No),
 * joined with the order, customer and driver for context.
 * Query: page, limit, search (order/driver/customer id or name), no_entry
 * (yes|no), rating (1-5, matches any rating column), from, to (YYYY-MM-DD).
 */
async function list(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const where = {};
    if (req.query.no_entry === "yes") where.no_entry_zone = true;
    else if (req.query.no_entry === "no") where.no_entry_zone = false;

    const rating = parseInt(req.query.rating, 10);
    if (rating >= 1 && rating <= 5) where.OR = RATING_COLUMNS.map((c) => ({ [c]: rating }));

    if (req.query.from || req.query.to) {
      where.created_at = {};
      if (req.query.from) where.created_at.gte = new Date(`${req.query.from}T00:00:00`);
      if (req.query.to) where.created_at.lte = new Date(`${req.query.to}T23:59:59`);
    }

    // Narrow by order id / customer / driver search and by the admin's city.
    const search = String(req.query.search || "").trim();
    let idFilter = null; // order ids allowed, null = unrestricted
    if (search || req.scopedCityId) {
      const orderWhere = {};
      if (req.scopedCityId) orderWhere.city_id = req.scopedCityId;
      if (search) {
        const asNumber = parseInt(search, 10);
        const [users, riders] = await Promise.all([
          prisma.tbl_user.findMany({ where: { name: { contains: search } }, select: { id: true }, take: 200 }),
          prisma.tbl_rider.findMany({ where: { full_name: { contains: search } }, select: { id: true }, take: 200 }),
        ]);
        orderWhere.OR = [
          ...(Number.isFinite(asNumber) ? [{ id: asNumber }] : []),
          ...(users.length ? [{ uid: { in: users.map((u) => u.id) } }] : []),
          ...(riders.length ? [{ rid: { in: riders.map((r) => r.id) } }] : []),
        ];
        if (!orderWhere.OR.length) return res.status(200).json({ success: true, data: [], total: 0, page, limit });
      }
      const fb = await prisma.order_driver_feedback.findMany({ select: { order_id: true } });
      const orders = await prisma.pkg_order.findMany({
        where: { ...orderWhere, id: { in: fb.map((f) => f.order_id) } },
        select: { id: true },
      });
      idFilter = orders.map((o) => o.id);
      where.order_id = { in: idFilter };
    }

    const [total, rows] = await Promise.all([
      prisma.order_driver_feedback.count({ where }),
      prisma.order_driver_feedback.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * limit, take: limit }),
    ]);

    const orderIds = rows.map((r) => r.order_id);
    const uids = [...new Set(rows.map((r) => r.uid))];
    const rids = [...new Set(rows.map((r) => r.rider_id))];
    const [orders, users, riders] = await Promise.all([
      orderIds.length
        ? prisma.pkg_order.findMany({
            where: { id: { in: orderIds } },
            select: { id: true, paddress: true, daddress: true, goods_type_name: true, city_id: true },
          })
        : [],
      uids.length ? prisma.tbl_user.findMany({ where: { id: { in: uids } }, select: { id: true, name: true, mobile: true } }) : [],
      rids.length ? prisma.tbl_rider.findMany({ where: { id: { in: rids } }, select: { id: true, full_name: true, fmobile: true } }) : [],
    ]);
    const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const riderById = Object.fromEntries(riders.map((r) => [r.id, r]));

    const data = rows.map((r) => ({
      id: r.id,
      order_id: r.order_id,
      customer_id: r.uid,
      customer_name: userById[r.uid]?.name || `Customer #${r.uid}`,
      customer_mobile: userById[r.uid] ? String(userById[r.uid].mobile) : null,
      driver_id: r.rider_id,
      driver_name: riderById[r.rider_id]?.full_name || `Driver #${r.rider_id}`,
      driver_mobile: riderById[r.rider_id]?.fmobile || null,
      pickup: orderById[r.order_id]?.paddress || null,
      drop: orderById[r.order_id]?.daddress || null,
      goods_type: orderById[r.order_id]?.goods_type_name || null,
      customer_rating: r.customer_rating,
      pickup_location_rating: r.pickup_location_rating,
      drop_location_rating: r.drop_location_rating,
      route_rating: r.route_rating,
      no_entry_zone: r.no_entry_zone,
      customer_type: r.customer_type,
      created_at: r.created_at,
    }));

    return res.status(200).json({ success: true, data, total, page, limit });
  } catch (err) {
    logger.error("admin trip feedback list failed:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
}

module.exports = { list };

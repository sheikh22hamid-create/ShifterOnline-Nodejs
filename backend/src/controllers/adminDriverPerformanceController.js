const prisma = require("../config/db");
const logger = require("../utils/logger");
const { computeRates } = require("../services/driverPerformanceMath");

const TIERS = ["free", "daily", "normal"];
const SORTS = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  score_asc: (a, b) => (a.score ?? 101) - (b.score ?? 101),
  offered: (a, b) => b.offered - a.offered,
  penalty: (a, b) => b.penalty_total - a.penalty_total,
  name: (a, b) => String(a.rider_name || "").localeCompare(String(b.rider_name || "")),
};
const MAX_RIDERS = 500;
const MAX_EVENTS = 500;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminDriverPerformance.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

// Superadmin sees every city (optionally narrowed by ?city_id); everyone else is bound to their own city.
const cityScope = (req) => {
  if (req.user.role === "superadmin") {
    const raw = req.query.city_id;
    return raw != null && raw !== "" ? Number(raw) : null;
  }
  const cityId = req.user.city_id == null ? NaN : Number(req.user.city_id);
  if (!Number.isFinite(cityId)) throw httpError(403, "Your account is not assigned to a city");
  return cityId;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseFilters(req) {
  const tier = TIERS.includes(req.query.tier) ? req.query.tier : null;
  const from = DATE_RE.test(String(req.query.from || "")) ? String(req.query.from) : null;
  const to = DATE_RE.test(String(req.query.to || "")) ? String(req.query.to) : null;
  return { tier, from, to };
}

const num = (v) => Number(v) || 0;
const money = (v) => Math.round((Number(v) || 0) * 100) / 100;

// GET /driver-performance?tier=free|daily|normal&from=YYYY-MM-DD&to=YYYY-MM-DD&city_id=&search=&sort=score|score_asc|offered|penalty|name
const listPerformance = async (req, res) => {
  try {
    const cityId = cityScope(req);
    const { tier, from, to } = parseFilters(req);
    const search = String(req.query.search || "").trim().slice(0, 60);
    const like = search ? `%${search}%` : null;
    const searchId = /^\d+$/.test(search) ? Number(search) : null;

    // offered excludes any offer that has a `superseded` event for the same driver+order: the popup was
    // live when someone else took the order, so it never counts against the driver (spec section 4/7).
    const rows = await prisma.$queryRaw`
      SELECT e.rider_id, rd.full_name AS rider_name, rd.fmobile AS rider_mobile, rd.city_id,
        COUNT(DISTINCT CASE WHEN e.event = 'offered' AND NOT EXISTS (
          SELECT 1 FROM driver_order_event s WHERE s.order_id = e.order_id AND s.rider_id = e.rider_id AND s.event = 'superseded'
        ) THEN e.order_id END) AS offered,
        COUNT(DISTINCT CASE WHEN e.event = 'accepted'         THEN e.order_id END) AS accepted,
        COUNT(DISTINCT CASE WHEN e.event = 'rejected'         THEN e.order_id END) AS rejected,
        COUNT(DISTINCT CASE WHEN e.event = 'skipped'          THEN e.order_id END) AS skipped,
        COUNT(DISTINCT CASE WHEN e.event = 'completed'        THEN e.order_id END) AS completed,
        COUNT(DISTINCT CASE WHEN e.event = 'cancelled'        THEN e.order_id END) AS cancelled,
        COUNT(CASE WHEN e.event = 'penalty' THEN 1 END)                              AS penalty_count,
        COALESCE(SUM(CASE WHEN e.event = 'penalty'        THEN e.penalty_amount END), 0) AS penalty_gross,
        COALESCE(SUM(CASE WHEN e.event = 'penalty_waived' THEN e.penalty_amount END), 0) AS penalty_waived,
        MAX(e.created_at) AS last_activity
      FROM driver_order_event e
      JOIN tbl_rider rd ON rd.id = e.rider_id
      WHERE e.event <> 'counter_reset'
        AND (${cityId} IS NULL OR rd.city_id = ${cityId})
        AND (${tier} IS NULL OR e.tier = ${tier})
        AND (${from} IS NULL OR e.created_at >= ${from})
        AND (${to} IS NULL OR e.created_at < DATE_ADD(${to}, INTERVAL 1 DAY))
        AND (${like} IS NULL OR rd.full_name LIKE ${like} OR rd.fmobile LIKE ${like} OR rd.id = ${searchId})
      GROUP BY e.rider_id, rd.full_name, rd.fmobile, rd.city_id
      LIMIT ${MAX_RIDERS}`;

    const drivers = rows.map((r) => {
      const counts = {
        offered: num(r.offered), accepted: num(r.accepted), rejected: num(r.rejected),
        skipped: num(r.skipped), completed: num(r.completed),
      };
      const rates = computeRates(counts);
      return {
        rider_id: Number(r.rider_id),
        rider_name: r.rider_name,
        rider_mobile: r.rider_mobile,
        city_id: r.city_id,
        ...counts,
        cancelled: num(r.cancelled),
        penalty_count: num(r.penalty_count),
        penalty_total: money(num(r.penalty_gross) - num(r.penalty_waived)),
        acceptance_rate: rates.acceptanceRate,
        completion_rate: rates.completionRate,
        rejection_rate: rates.rejectionRate,
        skip_rate: rates.skipRate,
        score: rates.score,
        status: rates.status,
        last_activity: r.last_activity,
      };
    });

    drivers.sort(SORTS[req.query.sort] || SORTS.score);

    const totals = drivers.reduce(
      (t, d) => {
        for (const k of ["offered", "accepted", "rejected", "skipped", "completed", "cancelled", "penalty_count"]) t[k] += d[k];
        t.penalty_total = money(t.penalty_total + d.penalty_total);
        return t;
      },
      { offered: 0, accepted: 0, rejected: 0, skipped: 0, completed: 0, cancelled: 0, penalty_count: 0, penalty_total: 0 }
    );

    return res.json({
      success: true,
      data: { drivers, totals, filters: { tier, from, to, city_id: cityId }, truncated: rows.length >= MAX_RIDERS },
    });
  } catch (e) { return fail(res, e, "listPerformance"); }
};

// GET /driver-performance/:riderId?tier=&from=&to=  - one driver's order history + penalties.
const getDriverDetail = async (req, res) => {
  try {
    const riderId = /^\d+$/.test(String(req.params.riderId)) ? Number(req.params.riderId) : NaN;
    if (!Number.isSafeInteger(riderId) || riderId <= 0) throw httpError(400, "riderId must be a valid id");

    const rider = await prisma.tbl_rider.findUnique({
      where: { id: riderId },
      select: { id: true, full_name: true, fmobile: true, city_id: true },
    });
    if (!rider) throw httpError(404, "Driver not found");

    const cityId = cityScope(req);
    if (req.user.role !== "superadmin" && Number(rider.city_id) !== cityId) {
      throw httpError(403, "This driver belongs to another city");
    }

    const { tier, from, to } = parseFilters(req);
    const events = await prisma.$queryRaw`
      SELECT e.id, e.order_id, e.tier, e.event, e.reason, e.penalty_pct, e.penalty_amount, e.miss_no, e.created_at
      FROM driver_order_event e
      WHERE e.rider_id = ${riderId} AND e.event <> 'counter_reset'
        AND (${tier} IS NULL OR e.tier = ${tier})
        AND (${from} IS NULL OR e.created_at >= ${from})
        AND (${to} IS NULL OR e.created_at < DATE_ADD(${to}, INTERVAL 1 DAY))
      ORDER BY e.id DESC LIMIT ${MAX_EVENTS}`;

    const penalties = await prisma.$queryRaw`
      SELECT p.id, p.order_id, p.tier, p.kind, p.event, p.miss_no, p.pct, p.base_amount, p.amount, p.status,
             p.created_at, p.collected_at, p.waived_at
      FROM driver_tier_penalty p
      WHERE p.rider_id = ${riderId}
        AND (${tier} IS NULL OR p.tier = ${tier})
        AND (${from} IS NULL OR p.created_at >= ${from})
        AND (${to} IS NULL OR p.created_at < DATE_ADD(${to}, INTERVAL 1 DAY))
      ORDER BY p.id DESC LIMIT ${MAX_EVENTS}`;

    return res.json({
      success: true,
      data: {
        rider: { id: rider.id, name: rider.full_name, mobile: rider.fmobile, city_id: rider.city_id },
        events: events.map((e) => ({ ...e, id: Number(e.id), order_id: Number(e.order_id) })),
        penalties: penalties.map((p) => ({ ...p, id: Number(p.id), order_id: Number(p.order_id) })),
      },
    });
  } catch (e) { return fail(res, e, "getDriverDetail"); }
};

module.exports = { listPerformance, getDriverDetail };

const prisma = require("../config/db");
const logger = require("../utils/logger");

// Admin > Marketing > Premium Plans > Purchase History.
//
// Every plan purchase - a customer's (customerPlanService.purchaseCustomerPlan), a driver's
// (driverPlanService.purchaseDriverPlan) and an admin-granted reward plan (rewardPlanService) - is
// written as one tbl_user_plan_subscription row (plan_for USER / DRIVER). That table was complete but
// nothing in the admin panel read it, so purchases were invisible. This lists those rows with the
// buyer, the plan and the payment details.

const PLAN_FORS = ["USER", "DRIVER"];
const STATUSES = ["active", "expired", "cancelled", "pending"];
const SEARCH_ID_LIMIT = 500;

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: err?.message || "Internal server error" });
}

function customerEntity(u, id) {
  if (!u) return { id, type: "USER", name: `Customer #${id}`, mobile: "" };
  const mobile = u.mobile ? String(u.mobile).replace(/\.0$/, "") : "";
  return { id, type: "USER", name: (u.name && u.name.trim()) || (mobile ? `Customer (${mobile})` : `Customer #${id}`), mobile };
}

function driverEntity(d, id) {
  if (!d) return { id, type: "DRIVER", name: `Driver #${id}`, mobile: "" };
  const name = d.full_name || `${d.first_name || ""} ${d.last_name || ""}`.trim() || d.account_name || `Driver #${id}`;
  return { id, type: "DRIVER", name, mobile: d.fmobile || "" };
}

// plan_snapshot is what the plan looked like at purchase time; use its name when the plan row was
// later deleted or renamed.
function snapshotPlanName(snapshot) {
  try {
    return JSON.parse(snapshot || "{}").plan_name || null;
  } catch (_) {
    return null;
  }
}

function parseDay(value, endOfDay) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const d = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function listPlanPurchases(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const and = [];
    const planFor = String(req.query.plan_for || "").toUpperCase();
    if (PLAN_FORS.includes(planFor)) and.push({ plan_for: planFor });
    const status = String(req.query.status || "").toLowerCase();
    if (STATUSES.includes(status)) and.push({ status });
    const from = parseDay(req.query.from, false);
    const to = parseDay(req.query.to, true);
    if (from) and.push({ created_at: { gte: from } });
    if (to) and.push({ created_at: { lte: to } });

    // City-scoped staff only see their own city's customers and drivers.
    if (req.scopedCityId) {
      const [cityUsers, cityDrivers] = await Promise.all([
        prisma.tbl_user.findMany({ where: { city_id: req.scopedCityId }, select: { id: true } }),
        prisma.tbl_rider.findMany({ where: { city_id: req.scopedCityId }, select: { id: true } }),
      ]);
      and.push({
        OR: [
          { plan_for: "USER", user_id: { in: cityUsers.map((u) => u.id) } },
          { plan_for: "DRIVER", user_id: { in: cityDrivers.map((d) => d.id) } },
        ],
      });
    }

    // Search: transaction id, buyer name, or an exact mobile number.
    const q = String(req.query.q || "").trim();
    if (q) {
      const numeric = /^\d+$/.test(q) ? Number(q) : null;
      const [users, drivers] = await Promise.all([
        prisma.tbl_user.findMany({
          where: { OR: [{ name: { contains: q } }, ...(numeric !== null ? [{ mobile: numeric }] : [])] },
          select: { id: true },
          take: SEARCH_ID_LIMIT,
        }),
        prisma.tbl_rider.findMany({
          where: {
            OR: [
              { full_name: { contains: q } },
              { first_name: { contains: q } },
              { last_name: { contains: q } },
              { fmobile: { contains: q } },
            ],
          },
          select: { id: true },
          take: SEARCH_ID_LIMIT,
        }),
      ]);
      const or = [{ payment_txn_id: { contains: q } }];
      if (users.length) or.push({ plan_for: "USER", user_id: { in: users.map((u) => u.id) } });
      if (drivers.length) or.push({ plan_for: "DRIVER", user_id: { in: drivers.map((d) => d.id) } });
      and.push({ OR: or });
    }

    const where = and.length ? { AND: and } : {};
    const [total, rows, totals] = await Promise.all([
      prisma.tbl_user_plan_subscription.count({ where }),
      prisma.tbl_user_plan_subscription.findMany({
        where,
        orderBy: { id: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.tbl_user_plan_subscription.aggregate({ where, _sum: { amount_paid: true } }),
    ]);

    const userIds = [...new Set(rows.filter((r) => r.plan_for === "USER").map((r) => r.user_id))];
    const driverIds = [...new Set(rows.filter((r) => r.plan_for === "DRIVER").map((r) => r.user_id))];
    const planIds = [...new Set(rows.map((r) => r.plan_id))];
    const [users, drivers, plans] = await Promise.all([
      userIds.length ? prisma.tbl_user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, mobile: true } }) : [],
      driverIds.length
        ? prisma.tbl_rider.findMany({
            where: { id: { in: driverIds } },
            select: { id: true, full_name: true, first_name: true, last_name: true, account_name: true, fmobile: true },
          })
        : [],
      planIds.length ? prisma.tbl_premium_plan.findMany({ where: { id: { in: planIds } }, select: { id: true, plan_name: true, price: true } }) : [],
    ]);
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));
    const planById = Object.fromEntries(plans.map((p) => [p.id, p]));

    const data = rows.map((r) => {
      const plan = planById[r.plan_id];
      return {
        id: r.id,
        buyer: r.plan_for === "DRIVER" ? driverEntity(driverById[r.user_id], r.user_id) : customerEntity(userById[r.user_id], r.user_id),
        plan: {
          id: r.plan_id,
          name: plan?.plan_name || snapshotPlanName(r.plan_snapshot) || `Plan #${r.plan_id}`,
          type: r.plan_type,
          for: r.plan_for,
          list_price: plan ? Number(plan.price) : null,
        },
        amount_paid: Number(r.amount_paid),
        points_used: r.points_used,
        points_amount: Number(r.points_amount),
        payment_method: r.payment_method,
        payment_txn_id: r.payment_txn_id,
        wallet_bonus_credited: Number(r.wallet_bonus_credited),
        start_date: r.start_date,
        end_date: r.end_date,
        status: r.status,
        purchased_at: r.created_at,
      };
    });

    return res.status(200).json({
      success: true,
      total,
      page,
      limit,
      summary: { total_amount_paid: Number(totals?._sum?.amount_paid || 0) },
      data,
    });
  } catch (err) {
    return internalError(res, err, "adminPlanPurchase.list");
  }
}

module.exports = { listPlanPurchases };

const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

async function getSettings(req, res) {
  try {
    const settings = await prisma.tbl_referral_setting.findFirst();
    return res.status(200).json({ success: true, data: settings });
  } catch (err) {
    return internalError(res, err, "referrals.getSettings");
  }
}

async function updateSettings(req, res) {
  try {
    const existing = await prisma.tbl_referral_setting.findFirst();
    const { user_point, driver_point, min_trip_unlock, point_value, referral_enabled, share_message } = req.body;

    // Spec's body uses user_point/driver_point/min_trip_unlock; the real
    // columns are user_points_per_referral/driver_points_per_referral and
    // have no "minimum trips before payout unlock" field at all.
    const data = {};
    if (user_point !== undefined) data.user_points_per_referral = Number(user_point);
    if (driver_point !== undefined) data.driver_points_per_referral = Number(driver_point);
    if (point_value !== undefined) data.point_value = point_value;
    if (referral_enabled !== undefined) data.referral_enabled = Boolean(referral_enabled);
    if (share_message !== undefined) data.share_message = share_message;
    data.updated_at = new Date();

    if (min_trip_unlock !== undefined) {
      logger.warn("referrals.updateSettings: min_trip_unlock has no backing column on tbl_referral_setting — ignored");
    }

    const updated = existing
      ? await prisma.tbl_referral_setting.update({ where: { id: existing.id }, data })
      : await prisma.tbl_referral_setting.create({ data });

    return res.status(200).json({ success: true, message: "Referral settings updated", data: updated });
  } catch (err) {
    return internalError(res, err, "referrals.updateSettings");
  }
}

async function listUserReferrals(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const where = req.query.search ? { referral_code: { contains: req.query.search } } : {};

    // tbl_referral has no city_id of its own, so scoping has to go through
    // the referrer/referred tbl_user/tbl_rider rows. DB-level pagination
    // can't happen until after that city filter is applied, so this pulls
    // the full (search-filtered) set and paginates in JS — fine at the
    // current table size, but would need a real join if this table grows large.
    const allRows = await prisma.tbl_referral.findMany({ where, orderBy: { id: "desc" } });

    const userIds = allRows.filter((r) => r.referrer_type === "USER").map((r) => r.referrer_id);
    const driverIds = allRows.filter((r) => r.referrer_type === "DRIVER").map((r) => r.referrer_id);
    const referredUserIds = allRows.filter((r) => r.referred_type === "USER").map((r) => r.referred_id);
    const referredDriverIds = allRows.filter((r) => r.referred_type === "DRIVER").map((r) => r.referred_id);

    const [users, drivers] = await Promise.all([
      prisma.tbl_user.findMany({ where: { id: { in: [...new Set([...userIds, ...referredUserIds])] } }, select: { id: true, name: true, mobile: true, city_id: true } }),
      prisma.tbl_rider.findMany({ where: { id: { in: [...new Set([...driverIds, ...referredDriverIds])] } }, select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true, city_id: true } }),
    ]);
    const userById = Object.fromEntries(users.map((u) => [u.id, u]));
    const driverById = Object.fromEntries(drivers.map((d) => [d.id, d]));

    function entityOf(id, type) {
      return type === "USER" ? userById[id] : driverById[id];
    }
    function describe(entity, type) {
      if (!entity) return null;
      return type === "USER"
        ? { name: entity.name, mobile: String(entity.mobile) }
        : { name: entity.full_name || `${entity.first_name || ""} ${entity.last_name || ""}`.trim(), mobile: entity.fmobile };
    }

    let scopedRows = allRows;
    if (req.scopedCityId) {
      scopedRows = allRows.filter((r) => {
        const referrer = entityOf(r.referrer_id, r.referrer_type);
        const referred = entityOf(r.referred_id, r.referred_type);
        return referrer?.city_id === req.scopedCityId || referred?.city_id === req.scopedCityId;
      });
    }

    const total = scopedRows.length;
    const pageRows = scopedRows.slice((page - 1) * limit, (page - 1) * limit + limit);

    const data = pageRows.map((r) => ({
      id: r.id,
      referrer: { id: r.referrer_id, type: r.referrer_type, ...describe(entityOf(r.referrer_id, r.referrer_type), r.referrer_type) },
      referred: { id: r.referred_id, type: r.referred_type, ...describe(entityOf(r.referred_id, r.referred_type), r.referred_type) },
      referral_code: r.referral_code,
      status: r.status,
      points_awarded: r.points_awarded,
      registered_at: r.registered_at,
      verified_at: r.verified_at,
    }));

    return res.status(200).json({ success: true, total, page, limit, data });
  } catch (err) {
    return internalError(res, err, "referrals.listUserReferrals");
  }
}

async function adjustPoints(req, res) {
  try {
    const { user_id, user_type, points, type, reason } = req.body;
    if (!user_id || !points || !["credit", "debit"].includes(type)) {
      return res.status(400).json({ success: false, message: "user_id, points, and type (credit|debit) are required" });
    }
    const entityType = user_type === "DRIVER" ? "DRIVER" : "USER";
    const id = parseInt(user_id, 10);
    const pts = Math.abs(Number(points));
    const model = entityType === "DRIVER" ? prisma.tbl_rider : prisma.tbl_user;

    const entity = await model.findUnique({ where: { id } });
    if (!entity) {
      return res.status(404).json({ success: false, message: `${entityType === "DRIVER" ? "Driver" : "Customer"} not found` });
    }
    if (req.user.role !== "superadmin" && entity.city_id !== parseInt(req.user.city_id, 10)) {
      return res.status(403).json({ success: false, message: `Forbidden: ${entityType === "DRIVER" ? "driver" : "customer"} is outside your assigned city` });
    }

    const currentPoints = entity.referral_points || 0;
    if (type === "debit" && currentPoints < pts) {
      return res.status(400).json({ success: false, message: "Insufficient referral points for this debit" });
    }
    const balanceAfter = type === "credit" ? currentPoints + pts : currentPoints - pts;

    await prisma.$transaction([
      model.update({ where: { id }, data: { referral_points: balanceAfter } }),
      prisma.tbl_referral_point_log.create({
        data: {
          user_id: id,
          user_type: entityType,
          points: type === "credit" ? pts : -pts,
          txn_type: type,
          source: "admin_adjustment",
          balance_after: balanceAfter,
          note: reason || `Manual ${type} by admin #${req.user.id}`,
          created_at: new Date(),
        },
      }),
    ]);

    return res.status(200).json({ success: true, message: "Referral points adjusted", data: { id, referral_points: balanceAfter } });
  } catch (err) {
    return internalError(res, err, "referrals.adjustPoints");
  }
}

module.exports = { getSettings, updateSettings, listUserReferrals, adjustPoints };

const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("../services/bookingGuaranteeSettings");
const bookingGuarantee = require("../services/bookingGuaranteeService");

const MAX_LIMIT = 200;
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminBookingGuarantee.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

// Fail closed: scopeFilter yields NaN for a non-superadmin without a city; never treat that as unscoped.
function scopeOf(req) {
  if (req.user?.role === "superadmin") {
    return { cityId: Number.isInteger(req.scopedCityId) ? req.scopedCityId : null };
  }
  if (!Number.isInteger(req.scopedCityId)) {
    throw Object.assign(new Error("Your account is not assigned to a city"), { statusCode: 403 });
  }
  return { cityId: req.scopedCityId };
}

async function getSettings(req, res) {
  try {
    return res.json({ success: true, data: { assign_minutes: await settings.getAssignWindowMinutes() } });
  } catch (e) {
    return fail(res, e, "getSettings");
  }
}

async function saveSettings(req, res) {
  try {
    const assignMinutes = await settings.setAssignWindowMinutes(req.body?.assign_minutes);
    return res.json({ success: true, data: { assign_minutes: assignMinutes } });
  } catch (e) {
    return fail(res, e, "saveSettings");
  }
}

async function listCases(req, res) {
  try {
    const { cityId } = scopeOf(req);
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 100, 1), MAX_LIMIT);
    const open = req.query?.status === "open";
    let cases;
    if (cityId !== null) {
      cases = await prisma.$queryRaw(Prisma.sql`SELECT c.* FROM booking_guarantee_case c JOIN pkg_order o ON o.id = c.order_id WHERE o.city_id = ${cityId} ${open ? Prisma.sql`AND c.status = 'open'` : Prisma.empty} ORDER BY c.id DESC LIMIT ${limit}`);
    } else {
      cases = await prisma.booking_guarantee_case.findMany({ where: open ? { status: "open" } : {}, orderBy: { id: "desc" }, take: limit });
    }
    return res.json({ success: true, data: cases });
  } catch (e) {
    return fail(res, e, "listCases");
  }
}

async function caseAudit(req, res) {
  try {
    const { cityId } = scopeOf(req);
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ success: false, message: "orderId must be a valid id" });
    }
    if (cityId !== null) {
      const own = await prisma.pkg_order.findFirst({ where: { id: orderId, city_id: cityId }, select: { id: true } });
      if (!own) return res.status(404).json({ success: false, message: "Not found" });
    }
    const events = await prisma.booking_guarantee_audit.findMany({ where: { order_id: orderId }, orderBy: { id: "asc" } });
    return res.json({ success: true, data: events });
  } catch (e) {
    return fail(res, e, "caseAudit");
  }
}

// Name / mobile typeahead for the lock panel. Own query (not /customers) so the city scope fails closed and mobile matches partially.
async function searchCustomers(req, res) {
  try {
    const { cityId } = scopeOf(req);
    const q = String(req.query?.q ?? "").trim().slice(0, 50);
    if (q.length < 2) return res.json({ success: true, data: [] });
    const like = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = await prisma.$queryRaw(Prisma.sql`
      SELECT u.id, u.name, CAST(CAST(u.mobile AS UNSIGNED) AS CHAR) AS mobile, u.city_id, u.guarantee_locked
      FROM tbl_user u
      WHERE (u.name LIKE ${like} OR CAST(CAST(u.mobile AS UNSIGNED) AS CHAR) LIKE ${like})
      ${cityId !== null ? Prisma.sql`AND u.city_id = ${cityId}` : Prisma.empty}
      ORDER BY u.name ASC LIMIT 10`);
    return res.json({
      success: true,
      data: rows.map((r) => ({ id: Number(r.id), name: r.name, mobile: r.mobile, city_id: r.city_id, guarantee_locked: !!r.guarantee_locked })),
    });
  } catch (e) {
    return fail(res, e, "searchCustomers");
  }
}

async function setLock(req, res, locked) {
  try {
    const { cityId } = scopeOf(req);
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ success: false, message: "userId must be a valid id" });
    }
    const user = await prisma.tbl_user.findUnique({ where: { id: userId }, select: { id: true, city_id: true } });
    if (!user) return res.status(404).json({ success: false, message: "Customer not found" });
    if (cityId !== null && Number(user.city_id) !== cityId) {
      return res.status(403).json({ success: false, message: "This customer belongs to another city" });
    }
    await bookingGuarantee.setUserLock(userId, locked);
    return res.json({ success: true, message: locked ? "Customer locked" : "Customer unlocked" });
  } catch (e) {
    return fail(res, e, locked ? "lockUser" : "unlockUser");
  }
}
const lockUser = (req, res) => setLock(req, res, true);
const unlockUser = (req, res) => setLock(req, res, false);

module.exports = { getSettings, saveSettings, listCases, caseAudit, searchCustomers, lockUser, unlockUser };

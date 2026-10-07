const { Prisma } = require("@prisma/client");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("../services/bookingGuaranteeSettings");

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

module.exports = { getSettings, saveSettings, listCases, caseAudit };

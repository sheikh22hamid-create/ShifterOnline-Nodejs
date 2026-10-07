const prisma = require("../config/db");
const logger = require("../utils/logger");
const settings = require("../services/bookingGuaranteeSettings");

const MAX_LIMIT = 200;
const fail = (res, err, label) => {
  if (err.statusCode) return res.status(err.statusCode).json({ success: false, message: err.message });
  logger.error(`adminBookingGuarantee.${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
};

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
    const limit = Math.min(Math.max(parseInt(req.query?.limit, 10) || 100, 1), MAX_LIMIT);
    const where = req.query?.status === "open" ? { status: "open" } : {};
    let cases = await prisma.booking_guarantee_case.findMany({ where, orderBy: { id: "desc" }, take: limit });
    if (req.scopedCityId && cases.length) {
      const inCity = await prisma.pkg_order.findMany({
        where: { id: { in: cases.map((c) => c.order_id) }, city_id: Number(req.scopedCityId) },
        select: { id: true },
      });
      const allowed = new Set(inCity.map((o) => o.id));
      cases = cases.filter((c) => allowed.has(c.order_id));
    }
    return res.json({ success: true, data: cases });
  } catch (e) {
    return fail(res, e, "listCases");
  }
}

async function caseAudit(req, res) {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ success: false, message: "orderId must be a valid id" });
    }
    const events = await prisma.booking_guarantee_audit.findMany({ where: { order_id: orderId }, orderBy: { id: "asc" } });
    return res.json({ success: true, data: events });
  } catch (e) {
    return fail(res, e, "caseAudit");
  }
}

module.exports = { getSettings, saveSettings, listCases, caseAudit };

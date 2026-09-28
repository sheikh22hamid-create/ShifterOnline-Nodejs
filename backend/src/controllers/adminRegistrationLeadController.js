const prisma = require("../config/db");
const logger = require("../utils/logger");
const registrationLeadService = require("../services/registrationLeadService");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

/** Admin queue of OTP-verified drivers who never finished registration (GET /admin/registration-leads) */
async function listLeads(req, res) {
  try {
    const status = req.query?.status !== undefined ? req.query.status : "pending";
    const where = {};
    if (status && status !== "all") where.status = status;

    const leads = await prisma.tbl_registration_lead.findMany({
      where,
      orderBy: { otp_verified_at: "asc" },
    });

    let counts = { pending: 0, contacted: 0, registered: 0, dismissed: 0, total: 0 };
    if (typeof prisma.tbl_registration_lead.groupBy === "function") {
      const statusCounts = await prisma.tbl_registration_lead.groupBy({
        by: ["status"],
        _count: { id: true },
      });
      for (const c of statusCounts) {
        const cnt = c._count?.id || 0;
        counts[c.status] = cnt;
        counts.total += cnt;
      }
    }

    return res.status(200).json({ success: true, data: leads, counts });
  } catch (err) {
    return internalError(res, err, "adminRegistrationLeads.listLeads");
  }
}

/** Admin manually (re)sends the WhatsApp/SMS reminder (POST /admin/registration-leads/:id/send-reminder) */
async function sendReminder(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await registrationLeadService.sendReminder(id);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    if (err.message === "Lead not found") return res.status(404).json({ success: false, message: err.message });
    return internalError(res, err, "adminRegistrationLeads.sendReminder");
  }
}

/** Admin marks a lead contacted or dismissed (POST /admin/registration-leads/:id/status) */
async function updateStatus(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const status = String(req.body?.status || "").trim();
    if (!["contacted", "dismissed", "pending"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }

    const lead = await prisma.tbl_registration_lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });

    const updated = await prisma.tbl_registration_lead.update({ where: { id }, data: { status } });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return internalError(res, err, "adminRegistrationLeads.updateStatus");
  }
}

module.exports = { listLeads, sendReminder, updateStatus };

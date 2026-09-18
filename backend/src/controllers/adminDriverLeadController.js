const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

/** Admin queue of leads awaiting a verification call (GET /admin/driver-leads) */
async function listLeads(req, res) {
  try {
    const status = req.query?.status || "pending";
    const leads = await prisma.tbl_driver_lead.findMany({
      where: { status },
      orderBy: { submitted_at: "asc" },
    });
    return res.status(200).json({ success: true, data: leads });
  } catch (err) {
    return internalError(res, err, "adminDriverLeads.listLeads");
  }
}

/** Admin marks a lead verified after the phone call (POST /admin/driver-leads/:id/verify) */
async function verifyLead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const lead = await prisma.tbl_driver_lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.status !== "pending") return res.status(400).json({ success: false, message: `Lead is already ${lead.status}` });

    const settings = await prisma.tbl_referral_setting.findFirst();
    const windowDays = settings?.lead_verification_window_days || 45;
    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.tbl_driver_lead.update({
      where: { id },
      data: { status: "verified", verified_at: verifiedAt, expires_at: expiresAt, verified_by_admin_id: req.user?.id },
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return internalError(res, err, "adminDriverLeads.verifyLead");
  }
}

/** Admin marks a lead rejected after the phone call (POST /admin/driver-leads/:id/reject) */
async function rejectLead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const lead = await prisma.tbl_driver_lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.status !== "pending") return res.status(400).json({ success: false, message: `Lead is already ${lead.status}` });

    const updated = await prisma.tbl_driver_lead.update({
      where: { id },
      data: { status: "rejected", verified_at: new Date(), verified_by_admin_id: req.user?.id },
    });
    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return internalError(res, err, "adminDriverLeads.rejectLead");
  }
}

module.exports = { listLeads, verifyLead, rejectLead };

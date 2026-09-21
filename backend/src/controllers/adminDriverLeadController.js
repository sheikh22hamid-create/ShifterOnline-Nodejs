const prisma = require("../config/db");
const logger = require("../utils/logger");
const leadInviteNotifier = require("../services/leadInviteNotifier");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

/** Admin queue of leads awaiting a verification call (GET /admin/driver-leads) */
async function listLeads(req, res) {
  try {
    const status = req.query?.status !== undefined ? req.query.status : "pending";
    const leadType = req.query?.type || req.query?.lead_type;
    const where = {};
    if (status && status !== "all") where.status = status;
    if (leadType && leadType !== "all") where.lead_type = leadType;

    const leads = await prisma.tbl_driver_lead.findMany({
      where,
      orderBy: { submitted_at: "desc" },
    });

    const driverIds = [...new Set((leads || []).map((l) => l.driver_id).filter(Boolean))];
    let driverMap = new Map();
    if (driverIds.length > 0 && typeof prisma.tbl_rider?.findMany === "function") {
      const drivers = await prisma.tbl_rider.findMany({
        where: { id: { in: driverIds } },
        select: { id: true, full_name: true, first_name: true, last_name: true, fmobile: true },
      });
      for (const d of drivers) {
        const name = d.full_name || [d.first_name, d.last_name].filter(Boolean).join(" ") || `Driver #${d.id}`;
        driverMap.set(d.id, { id: d.id, name, mobile: d.fmobile || "" });
      }
    }

    const enrichedLeads = (leads || []).map((l) => ({
      ...l,
      lead_type: l.lead_type || "customer",
      driver: driverMap.get(l.driver_id) || { id: l.driver_id, name: `Driver #${l.driver_id}`, mobile: "" },
    }));

    // Quick counts across all statuses for dashboard badges
    let counts = { pending: 0, verified: 0, converted: 0, rejected: 0, expired: 0, total: 0, customer_total: 0, driver_total: 0 };
    if (typeof prisma.tbl_driver_lead.groupBy === "function") {
      const statusCounts = await prisma.tbl_driver_lead.groupBy({
        by: ["status"],
        where: leadType && leadType !== "all" ? { lead_type: leadType } : {},
        _count: { id: true },
      });
      for (const c of statusCounts) {
        const cnt = c._count?.id || 0;
        counts[c.status] = cnt;
        counts.total += cnt;
      }

      const typeCounts = await prisma.tbl_driver_lead.groupBy({
        by: ["lead_type"],
        _count: { id: true },
      });
      for (const tc of typeCounts) {
        if (tc.lead_type === "driver") counts.driver_total = tc._count?.id || 0;
        else counts.customer_total += tc._count?.id || 0;
      }
    }

    return res.status(200).json({ success: true, data: enrichedLeads, counts });
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

    // Auto-send WhatsApp invite to the customer via WhatsApp Bot
    let inviteResult = null;
    try {
      inviteResult = await leadInviteNotifier.sendLeadInvite(id);
    } catch (inviteErr) {
      logger.warn(`Auto invite delivery notice for lead #${id}:`, inviteErr.message);
    }

    return res.status(200).json({ success: true, data: updated, invite: inviteResult });
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

/** Admin triggers sending WhatsApp + SMS invite to a lead (POST /admin/driver-leads/:id/send-invite) */
async function sendInvite(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const result = await leadInviteNotifier.sendLeadInvite(id);
    return res.status(200).json({ success: true, data: result, message: result.message });
  } catch (err) {
    return internalError(res, err, "adminDriverLeads.sendInvite");
  }
}

module.exports = { listLeads, verifyLead, rejectLead, sendInvite };

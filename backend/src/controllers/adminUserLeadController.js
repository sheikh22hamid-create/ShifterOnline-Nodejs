const prisma = require("../config/db");
const logger = require("../utils/logger");
const leadInviteNotifier = require("../services/leadInviteNotifier");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

/** Admin queue of user-submitted leads (GET /api/admin/user-leads) */
async function listUserLeads(req, res) {
  try {
    const status = req.query?.status !== undefined ? req.query.status : "pending";
    const leadType = req.query?.type || req.query?.lead_type;
    const filterUserId = req.query?.user_id ? Number(req.query.user_id) : null;
    const search = req.query?.search ? String(req.query.search).trim().toLowerCase() : "";

    const where = {
      referrer_type: "user",
    };

    if (status && status !== "all") where.status = status;
    if (leadType && leadType !== "all") where.lead_type = leadType;
    if (filterUserId) where.user_id = filterUserId;

    const leads = await prisma.tbl_driver_lead.findMany({
      where,
      orderBy: { submitted_at: "desc" },
    });

    // Collect all referrer user IDs
    const userIds = [...new Set((leads || []).map((l) => l.user_id).filter(Boolean))];
    let userMap = new Map();

    if (userIds.length > 0 && typeof prisma.tbl_user?.findMany === "function") {
      const users = await prisma.tbl_user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, mobile: true, email: true, referral_points: true },
      });
      for (const u of users) {
        userMap.set(u.id, {
          id: u.id,
          name: u.name || `User #${u.id}`,
          mobile: u.mobile ? String(Math.round(u.mobile)) : "",
          email: u.email || "",
          referral_points: u.referral_points || 0,
        });
      }
    }

    let enrichedLeads = (leads || []).map((l) => ({
      ...l,
      lead_type: l.lead_type || "customer",
      user: userMap.get(l.user_id) || { id: l.user_id, name: `User #${l.user_id}`, mobile: "" },
    }));

    if (search) {
      enrichedLeads = enrichedLeads.filter((l) => {
        const cName = (l.name || "").toLowerCase();
        const cPhone = (l.phone || "").toLowerCase();
        const uName = (l.user?.name || "").toLowerCase();
        const uMobile = (l.user?.mobile || "").toLowerCase();
        const uId = String(l.user_id || "");
        return cName.includes(search) || cPhone.includes(search) || uName.includes(search) || uMobile.includes(search) || uId.includes(search);
      });
    }

    // Quick counts across statuses
    let counts = {
      pending: 0,
      verified: 0,
      converted: 0,
      rejected: 0,
      expired: 0,
      total: 0,
      customer_total: 0,
      driver_total: 0,
      total_reward_points: 0,
    };

    if (typeof prisma.tbl_driver_lead.groupBy === "function") {
      const baseWhere = { referrer_type: "user" };
      if (filterUserId) baseWhere.user_id = filterUserId;

      const statusCounts = await prisma.tbl_driver_lead.groupBy({
        by: ["status"],
        where: leadType && leadType !== "all" ? { ...baseWhere, lead_type: leadType } : baseWhere,
        _count: { id: true },
      });

      for (const c of statusCounts) {
        const cnt = c._count?.id || 0;
        counts[c.status] = cnt;
        counts.total += cnt;
      }

      const typeCounts = await prisma.tbl_driver_lead.groupBy({
        by: ["lead_type"],
        where: baseWhere,
        _count: { id: true },
      });

      for (const tc of typeCounts) {
        if (tc.lead_type === "driver") counts.driver_total = tc._count?.id || 0;
        else counts.customer_total += tc._count?.id || 0;
      }

      // Converted points count
      counts.total_reward_points = (counts.converted || 0) * 100;
    }

    // List of users who have submitted leads for dropdown filtering
    const allLeadUsers = await prisma.tbl_driver_lead.findMany({
      where: { referrer_type: "user" },
      select: { user_id: true },
      distinct: ["user_id"],
    });
    const distinctUserIds = allLeadUsers.map((item) => item.user_id).filter(Boolean);

    let submitterUsers = [];
    if (distinctUserIds.length > 0) {
      submitterUsers = await prisma.tbl_user.findMany({
        where: { id: { in: distinctUserIds } },
        select: { id: true, name: true, mobile: true },
        orderBy: { name: "asc" },
      });
      submitterUsers = submitterUsers.map((u) => ({
        id: u.id,
        name: u.name || `User #${u.id}`,
        mobile: u.mobile ? String(Math.round(u.mobile)) : "",
      }));
    }

    return res.status(200).json({
      success: true,
      data: enrichedLeads,
      counts,
      users: submitterUsers,
    });
  } catch (err) {
    return internalError(res, err, "adminUserLeads.listUserLeads");
  }
}

/** Admin marks a user-submitted lead verified (POST /api/admin/user-leads/:id/verify) */
async function verifyLead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const lead = await prisma.tbl_driver_lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.status !== "pending") {
      return res.status(400).json({ success: false, message: `Lead is already ${lead.status}` });
    }

    const settings = await prisma.tbl_referral_setting.findFirst();
    const windowDays = settings?.lead_verification_window_days || 45;
    const verifiedAt = new Date();
    const expiresAt = new Date(verifiedAt.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const updated = await prisma.tbl_driver_lead.update({
      where: { id },
      data: {
        status: "verified",
        verified_at: verifiedAt,
        expires_at: expiresAt,
        verified_by_admin_id: req.user?.id || 0,
      },
    });

    // Auto-send WhatsApp invite based on lead_type
    let inviteResult = null;
    try {
      inviteResult = await leadInviteNotifier.sendLeadInvite(id);
    } catch (inviteErr) {
      logger.warn(`Auto invite delivery notice for lead #${id}:`, inviteErr.message);
    }

    return res.status(200).json({ success: true, data: updated, invite: inviteResult });
  } catch (err) {
    return internalError(res, err, "adminUserLeads.verifyLead");
  }
}

/** Admin rejects a user lead (POST /api/admin/user-leads/:id/reject) */
async function rejectLead(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const lead = await prisma.tbl_driver_lead.findUnique({ where: { id } });
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    if (lead.status !== "pending") {
      return res.status(400).json({ success: false, message: `Lead is already ${lead.status}` });
    }

    const updated = await prisma.tbl_driver_lead.update({
      where: { id },
      data: { status: "rejected" },
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (err) {
    return internalError(res, err, "adminUserLeads.rejectLead");
  }
}

/** Export User Leads to CSV / Excel spreadsheet (GET /api/admin/user-leads/export) */
async function exportUserLeads(req, res) {
  try {
    const status = req.query?.status !== undefined ? req.query.status : "all";
    const leadType = req.query?.type || req.query?.lead_type;
    const filterUserId = req.query?.user_id ? Number(req.query.user_id) : null;

    const where = { referrer_type: "user" };
    if (status && status !== "all") where.status = status;
    if (leadType && leadType !== "all") where.lead_type = leadType;
    if (filterUserId) where.user_id = filterUserId;

    const leads = await prisma.tbl_driver_lead.findMany({
      where,
      orderBy: { submitted_at: "desc" },
    });

    const userIds = [...new Set((leads || []).map((l) => l.user_id).filter(Boolean))];
    let userMap = new Map();
    if (userIds.length > 0) {
      const users = await prisma.tbl_user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, mobile: true, email: true },
      });
      for (const u of users) {
        userMap.set(u.id, {
          name: u.name || `User #${u.id}`,
          mobile: u.mobile ? String(Math.round(u.mobile)) : "",
          email: u.email || "",
        });
      }
    }

    // Construct CSV rows
    const headers = [
      "Lead ID",
      "Contact Name",
      "Contact Phone",
      "Target Category",
      "Referrer User ID",
      "Referrer Name",
      "Referrer Mobile",
      "Status",
      "Submitted Date",
      "Verified Date",
      "Expires At",
      "Converted Date",
      "Reward Points",
    ];

    const rows = leads.map((l) => {
      const u = userMap.get(l.user_id) || {};
      const targetCat = l.lead_type === "driver" ? "Driver Partner" : "Customer";
      const pts = l.status === "converted" ? "100" : "0";
      return [
        l.id,
        `"${(l.name || "").replace(/"/g, '""')}"`,
        `"${l.phone || ""}"`,
        `"${targetCat}"`,
        l.user_id || "",
        `"${(u.name || "").replace(/"/g, '""')}"`,
        `"${u.mobile || ""}"`,
        `"${l.status}"`,
        l.submitted_at ? new Date(l.submitted_at).toISOString() : "",
        l.verified_at ? new Date(l.verified_at).toISOString() : "",
        l.expires_at ? new Date(l.expires_at).toISOString() : "",
        l.converted_at ? new Date(l.converted_at).toISOString() : "",
        pts,
      ].join(",");
    });

    // Prefix with UTF-8 BOM so Excel opens Hindi & English names without distortion
    const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="User_Contact_Referrals_${new Date().toISOString().split("T")[0]}.csv"`);
    return res.status(200).send(csvContent);
  } catch (err) {
    return internalError(res, err, "adminUserLeads.exportUserLeads");
  }
}

module.exports = {
  listUserLeads,
  verifyLead,
  rejectLead,
  exportUserLeads,
};

const prisma = require("../config/db");
const logger = require("../utils/logger");
const { normalizeToLast10Digits } = require("../utils/phone");

/**
 * User bulk-submits phone contacts as referral leads (POST /api/user/leads)
 */
async function submitLeads(req, res) {
  try {
    const uid = Number(req.body?.uid || req.body?.user_id || req.body?.id || req.user?.id || 0);
    const rawLeadType = String(req.body?.lead_type || req.body?.type || "customer").trim().toLowerCase();
    const leadType = rawLeadType === "driver" ? "driver" : "customer";
    const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];

    if (!uid) {
      return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "User ID is required." });
    }
    if (!contacts.length) {
      return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "At least one contact is required." });
    }

    let accepted = 0;
    const skipped = [];
    const now = new Date();

    for (const contact of contacts) {
      const name = String(contact?.name || "").trim();
      const phone = normalizeToLast10Digits(contact?.phone);
      if (!phone || phone.length < 6) {
        skipped.push({ phone: contact?.phone || "", reason: "invalid_phone" });
        continue;
      }

      // Check if this number is already registered or submitted
      const [existingUser, existingRider, existingLead] = await Promise.all([
        prisma.tbl_user.findFirst({ where: { mobile: Number(phone) } }),
        prisma.tbl_rider.findFirst({ where: { fmobile: phone } }),
        prisma.tbl_driver_lead.findFirst({ where: { phone } }),
      ]);

      if (existingUser || existingRider) {
        skipped.push({ phone, reason: "already_registered" });
        continue;
      }
      if (existingLead) {
        skipped.push({ phone, reason: "already_submitted" });
        continue;
      }

      await prisma.tbl_driver_lead.create({
        data: {
          driver_id: 0,
          user_id: uid,
          referrer_type: "user",
          lead_type: leadType,
          name: name || phone,
          phone,
          status: "pending",
          submitted_at: now,
        },
      });
      accepted += 1;
    }

    return res.status(200).json({
      Result: "true",
      ResponseCode: "200",
      ResponseMsg: `${accepted} contact(s) submitted, ${skipped.length} skipped.`,
      accepted,
      skipped,
      lead_type: leadType,
    });
  } catch (err) {
    logger.error("userLeadController.submitLeads failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

/**
 * User views their own submitted leads and current status (GET /api/user/leads)
 */
async function listMyLeads(req, res) {
  try {
    const uid = Number(req.query?.uid || req.query?.user_id || req.query?.id || req.user?.id || 0);
    if (!uid) {
      return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "User ID is required." });
    }

    const leads = await prisma.tbl_driver_lead.findMany({
      where: {
        user_id: uid,
        referrer_type: "user",
      },
      orderBy: { id: "desc" },
    });

    return res.status(200).json({ Result: "true", ResponseCode: "200", ResponseMsg: "OK", leads });
  } catch (err) {
    logger.error("userLeadController.listMyLeads failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

module.exports = { submitLeads, listMyLeads };

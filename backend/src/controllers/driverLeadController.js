const prisma = require("../config/db");
const logger = require("../utils/logger");

function normalizePhone(raw) {
  return String(raw || "").replace(/\D/g, "");
}

/** Driver bulk-submits phone contacts as referral leads (POST /rider/leads) */
async function submitLeads(req, res) {
  try {
    const riderId = Number(req.body?.rider_id || req.body?.rid || 0);
    const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];

    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required." });
    if (!contacts.length) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "At least one contact is required." });

    let accepted = 0;
    const skipped = [];
    const now = new Date();

    for (const contact of contacts) {
      const name = String(contact?.name || "").trim();
      const phone = normalizePhone(contact?.phone);
      if (!phone || phone.length < 6) {
        skipped.push({ phone: contact?.phone || "", reason: "invalid_phone" });
        continue;
      }

      // Digits-only comparison on both sides: tbl_user.mobile is numeric,
      // tbl_rider.fmobile is free-text, neither guaranteed to match a raw
      // string with punctuation/country-code formatting differences.
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
        data: { driver_id: riderId, name: name || phone, phone, status: "pending", submitted_at: now },
      });
      accepted += 1;
    }

    return res.status(200).json({
      Result: "true",
      ResponseCode: "200",
      ResponseMsg: `${accepted} contact(s) submitted, ${skipped.length} skipped.`,
      accepted,
      skipped,
    });
  } catch (err) {
    logger.error("driverLeadController.submitLeads failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

/** Driver views their own submitted leads and current status (GET /rider/leads) */
async function listMyLeads(req, res) {
  try {
    const riderId = Number(req.query?.rider_id || req.query?.rid || 0);
    if (!riderId) return res.status(200).json({ Result: "false", ResponseCode: "400", ResponseMsg: "Driver ID is required." });

    const leads = await prisma.tbl_driver_lead.findMany({
      where: { driver_id: riderId },
      orderBy: { id: "desc" },
    });

    return res.status(200).json({ Result: "true", ResponseCode: "200", ResponseMsg: "OK", leads });
  } catch (err) {
    logger.error("driverLeadController.listMyLeads failed:", err);
    return res.status(200).json({ Result: "false", ResponseCode: "500", ResponseMsg: "Internal server error" });
  }
}

module.exports = { submitLeads, listMyLeads };

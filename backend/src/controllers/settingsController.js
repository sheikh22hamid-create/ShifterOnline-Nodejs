const prisma = require("../config/db");
const logger = require("../utils/logger");

function internalError(res, err, label) {
  logger.error(`${label} failed:`, err);
  return res.status(500).json({ success: false, message: "Internal server error" });
}

// Columns on the legacy `setting` singleton row that are safe to expose/edit
// through this API — excludes SMS/OTP auth secrets (auth_key, auth_token,
// otp_auth, r_hash, one_hash) which stay write-only via direct DB access,
// same reasoning as keeping JWT_SECRET out of any HTTP response.
const SETTING_PUBLIC_FIELDS = [
  "currency",
  "d_title",
  "d_s_title",
  "timezone",
  "ukms",
  "utprice",
  "afprice",
  "bkms",
  "bprice",
  "abprice",
  "itemlimit",
  "itemkg",
  "mile_charge",
  "service_charge",
  "rider_commission",
  "kilo_limit",
  "is_wether_bad",
  "reject_timer",
  "payment_cod",
  "payment_wallet",
  "payment_online",
  "status",
  "admin_earning",
  "driver_pay",
  "refer_type",
  "refer_amount",
  "refer_join_amount",
  "drive_cancellation",
  "user_cancellation",
];

async function getSettings(req, res) {
  try {
    const [setting, appSettings] = await Promise.all([
      prisma.setting.findFirst(),
      prisma.app_settings.findMany(),
    ]);

    const publicSetting = {};
    if (setting) {
      for (const field of SETTING_PUBLIC_FIELDS) publicSetting[field] = setting[field];
      publicSetting.id = setting.id;
    }

    return res.status(200).json({
      success: true,
      data: {
        ...publicSetting,
        // Feature-flag-style overrides (auto_verification, manual_registration,
        // etc.) — this codebase has no dedicated columns for Google Maps/
        // Firebase keys; those are environment variables (see backend/.env),
        // deliberately not exposed over HTTP.
        flags: Object.fromEntries(appSettings.map((s) => [s.setting_key, s.setting_value])),
      },
    });
  } catch (err) {
    return internalError(res, err, "settings.getSettings");
  }
}

async function updateSettings(req, res) {
  try {
    const existing = await prisma.setting.findFirst();
    if (!existing) {
      return res.status(404).json({ success: false, message: "No settings row exists to update" });
    }

    const data = {};
    for (const field of SETTING_PUBLIC_FIELDS) {
      if (req.body[field] !== undefined) data[field] = req.body[field];
    }

    const updates = [];
    if (Object.keys(data).length > 0) {
      updates.push(prisma.setting.update({ where: { id: existing.id }, data }));
    }

    const flags = req.body.flags;
    if (flags && typeof flags === "object") {
      for (const [key, value] of Object.entries(flags)) {
        updates.push(
          prisma.app_settings.upsert({
            where: { setting_key: key },
            create: { setting_key: key, setting_value: String(value), updated_at: new Date() },
            update: { setting_value: String(value), updated_at: new Date() },
          })
        );
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: "No recognized fields to update" });
    }

    await prisma.$transaction(updates);

    return res.status(200).json({ success: true, message: "Settings updated" });
  } catch (err) {
    return internalError(res, err, "settings.updateSettings");
  }
}

async function listPaymentGateways(req, res) {
  try {
    const rows = await prisma.tbl_payment_list.findMany({ orderBy: { id: "asc" } });
    return res.status(200).json({ success: true, total: rows.length, data: rows });
  } catch (err) {
    return internalError(res, err, "settings.listPaymentGateways");
  }
}

async function updatePaymentGateway(req, res) {
  try {
    const id = parseInt(req.params.id, 10);
    const existing = await prisma.tbl_payment_list.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Payment gateway not found" });
    }

    const { title, img, attributes, status, subtitle, p_show } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (img !== undefined) data.img = img;
    if (attributes !== undefined) data.attributes = typeof attributes === "string" ? attributes : JSON.stringify(attributes);
    if (status !== undefined) data.status = Number(status);
    if (subtitle !== undefined) data.subtitle = subtitle;
    if (p_show !== undefined) data.p_show = Number(p_show);

    const updated = await prisma.tbl_payment_list.update({ where: { id }, data });
    return res.status(200).json({ success: true, message: "Payment gateway updated", data: updated });
  } catch (err) {
    return internalError(res, err, "settings.updatePaymentGateway");
  }
}

module.exports = { getSettings, updateSettings, listPaymentGateways, updatePaymentGateway };

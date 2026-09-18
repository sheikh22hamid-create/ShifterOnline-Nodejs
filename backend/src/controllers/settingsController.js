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

const DEFAULT_SETTING_DATA = {
  d_title: "Shifter Online",
  d_s_title: "Shifter",
  currency: "₹",
  timezone: "Asia/Kolkata",
  one_key: "",
  one_hash: "",
  r_key: "",
  r_hash: "",
  ukms: 0,
  utprice: 0,
  afprice: 0,
  bkms: 0,
  bprice: 0,
  abprice: 0,
  itemlimit: 10,
  itemkg: 50,
  mile_charge: 0,
  service_charge: 0,
  rider_commission: 0,
  kilo_limit: 0,
  is_wether_bad: 0,
  sms_type: "",
  auth_key: "",
  otp_id: "",
  acc_id: "",
  auth_token: "",
  twilio_number: "",
  otp_auth: "",
  payment_cod: 1,
  payment_wallet: 1,
  payment_online: 1,
};

async function getSettings(req, res) {
  try {
    let [setting, appSettings] = await Promise.all([
      prisma.setting.findFirst(),
      prisma.app_settings.findMany(),
    ]);

    if (!setting) {
      setting = await prisma.setting.create({ data: DEFAULT_SETTING_DATA });
    }

    const publicSetting = {};
    for (const field of SETTING_PUBLIC_FIELDS) publicSetting[field] = setting[field];
    publicSetting.id = setting.id;

    return res.status(200).json({
      success: true,
      data: {
        ...publicSetting,
        flags: Object.fromEntries(appSettings.map((s) => [s.setting_key, s.setting_value])),
      },
    });
  } catch (err) {
    return internalError(res, err, "settings.getSettings");
  }
}

const INT_FIELDS = new Set([
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
  "admin_earning",
  "driver_pay",
  "drive_cancellation",
  "user_cancellation",
]);

const NULLABLE_INT_FIELDS = new Set([
  "reject_timer",
  "payment_cod",
  "payment_wallet",
  "payment_online",
  "admin_earning",
  "driver_pay",
  "drive_cancellation",
  "user_cancellation",
]);

const FLOAT_FIELDS = new Set(["ukms", "utprice", "afprice"]);

const DECIMAL_FIELDS = new Set(["refer_amount", "refer_join_amount"]);

const BOOLEAN_FIELDS = new Set(["refer_type", "status"]);

async function updateSettings(req, res) {
  try {
    let existing = await prisma.setting.findFirst();
    if (!existing) {
      existing = await prisma.setting.create({ data: DEFAULT_SETTING_DATA });
    }

    const data = {};
    for (const field of SETTING_PUBLIC_FIELDS) {
      if (req.body[field] === undefined) continue;

      const val = req.body[field];
      if (INT_FIELDS.has(field)) {
        if (val === "" || val === null) {
          data[field] = NULLABLE_INT_FIELDS.has(field) ? null : 0;
        } else {
          const parsed = parseInt(val, 10);
          data[field] = Number.isNaN(parsed) ? (NULLABLE_INT_FIELDS.has(field) ? null : 0) : parsed;
        }
      } else if (FLOAT_FIELDS.has(field)) {
        if (val === "" || val === null) {
          data[field] = 0;
        } else {
          const parsed = parseFloat(val);
          data[field] = Number.isNaN(parsed) ? 0 : parsed;
        }
      } else if (DECIMAL_FIELDS.has(field)) {
        if (val === "" || val === null) {
          data[field] = null;
        } else {
          const parsed = parseFloat(val);
          data[field] = Number.isNaN(parsed) ? null : parsed;
        }
      } else if (BOOLEAN_FIELDS.has(field)) {
        data[field] = val === true || val === 1 || val === "true" || val === "1";
      } else {
        data[field] = String(val ?? "").trim();
      }
    }

    if (existing && Object.keys(data).length > 0) {
      await prisma.setting.update({ where: { id: existing.id }, data });
    }

    const flags = req.body.flags;
    if (flags && typeof flags === "object") {
      for (const [key, value] of Object.entries(flags)) {
        if (!key || typeof key !== "string") continue;
        const valStr = value === undefined || value === null ? "" : String(value).trim();
        try {
          await prisma.app_settings.upsert({
            where: { setting_key: key },
            create: { setting_key: key, setting_value: valStr, updated_at: new Date() },
            update: { setting_value: valStr, updated_at: new Date() },
          });
        } catch (upsertErr) {
          // Fallback if unique constraint is missing or has duplicate records
          const existingRow = await prisma.app_settings.findFirst({ where: { setting_key: key } });
          if (existingRow) {
            await prisma.app_settings.update({
              where: { id: existingRow.id },
              data: { setting_value: valStr, updated_at: new Date() },
            });
          } else {
            await prisma.app_settings.create({
              data: { setting_key: key, setting_value: valStr, updated_at: new Date() },
            });
          }
        }
      }
    }

    return res.status(200).json({ success: true, message: "Settings updated" });
  } catch (err) {
    logger.error("settingsController.updateSettings failed:", err);
    return res.status(500).json({ success: false, message: err.message || "Internal server error" });
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

// Lets an admin remove an app_settings row entirely (distinct from
// updateSettings' flags upsert, which can only create/update - never
// delete). Used by the "Other Feature Flags" generic editor so a key that's
// no longer needed doesn't linger forever with a stale value.
async function deleteFlag(req, res) {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ success: false, message: "key is required" });

    const existing = await prisma.app_settings.findFirst({ where: { setting_key: key } });
    if (!existing) return res.status(404).json({ success: false, message: "Setting not found" });

    await prisma.app_settings.delete({ where: { id: existing.id } });
    return res.status(200).json({ success: true, message: "Setting deleted" });
  } catch (err) {
    return internalError(res, err, "settings.deleteFlag");
  }
}

module.exports = { getSettings, updateSettings, listPaymentGateways, updatePaymentGateway, deleteFlag };

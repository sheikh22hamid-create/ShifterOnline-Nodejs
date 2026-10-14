const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const { uploadBuffer } = require("../utils/cloudinaryStorage");
const { evaluateDriverApproval } = require("../utils/driverApproval");
const { getRegistrationStatus } = require("../services/registrationCompletionService");

// POST /rider/registration/complete - an already-registered NORMAL driver adds
// what registration let them skip (PAN, insurance, PUC, bank details, email).
// It updates the existing account only; it never creates a rider or touches
// login details. Trial drivers finish through the full /auth/register flow.

const IMAGE_EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: "puc_image", maxCount: 1 },
  { name: "bima_image", maxCount: 1 },
]);

const fail = (res, msg, code = 401) => res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
const filled = (v) => String(v ?? "").trim() !== "";

async function saveImage(file, prefix) {
  const ext = IMAGE_EXT_BY_MIME[(file.mimetype || "").toLowerCase()] || path.extname(file.originalname || "").replace(".", "").toLowerCase();
  const filename = `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${["jpg", "jpeg", "png", "webp"].includes(ext) ? ext : "jpg"}`;
  return uploadBuffer(file.buffer, `images/rider_docs/${filename}`);
}

async function handler(req, res) {
  try {
    const body = req.body || {};
    const riderId = Number(body.rider_id || 0);
    const deviceId = String(body.device_id || "").trim();
    if (!riderId || !deviceId) return fail(res, "rider_id and device_id are required");

    // Same proof setStatus uses: the request must come from the device the
    // driver is currently logged in on, not just carry someone's rider_id.
    const device = await prisma.tbl_user_device.findFirst({
      where: { uid: riderId, user_type: "rider", is_active: true },
      orderBy: { last_login_at: "desc" },
    });
    if (!device || device.device_id !== deviceId) return fail(res, "Session expired. Please login again.", 403);

    const rider = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    if (!rider) return fail(res, "Driver not found", 404);

    const current = await getRegistrationStatus(riderId);
    if (current.is_trial) {
      return fail(res, "Please complete the full registration to continue.", 409);
    }

    const riderUpdate = {};
    const docUpdate = {};

    const email = String(body.email || "").trim();
    if (email) {
      if (!EMAIL_PATTERN.test(email)) return fail(res, "Enter a valid email address");
      riderUpdate.email = email;
    }

    const accountNumber = String(body.account_number || "").trim();
    const ifsc = String(body.ifsc || "").trim().toUpperCase();
    const accountName = String(body.account_name || "").trim();
    if (accountNumber || ifsc) {
      if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) return fail(res, "Enter a valid account number (9-18 digits)");
      if (!IFSC_PATTERN.test(ifsc)) return fail(res, "Enter a valid IFSC code");
      riderUpdate.account_number = accountNumber;
      riderUpdate.ifsc = ifsc;
      if (accountName) riderUpdate.account_name = accountName;
    }

    let docRow = await prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } });

    const panNumber = String(body.pan_number || "").trim().toUpperCase();
    if (panNumber) {
      if (!PAN_PATTERN.test(panNumber)) return fail(res, "Enter a valid PAN number");
      // An already-approved PAN is final; only a missing or unapproved one can change.
      if (!(docRow?.pan_status === 1 && filled(docRow?.pan_id))) {
        const clash = await prisma.tbl_personal_doc.findFirst({ where: { pan_id: panNumber, rider_id: { not: riderId } } });
        if (clash) return fail(res, `PAN Number (${panNumber}) is already registered with another driver account!`);
        docUpdate.pan_id = panNumber;
        // The app only flags it verified after its own PAN eKYC check; otherwise admin reviews it.
        docUpdate.pan_status = ["true", "1"].includes(String(body.pan_verified).toLowerCase()) ? 1 : 0;
      }
    }

    for (const [field, column, prefix] of [["puc_image", "puc_image", "puc"], ["bima_image", "bima_image", "bima"]]) {
      const file = req.files?.[field]?.[0];
      if (!file) continue;
      if (!IMAGE_EXT_BY_MIME[(file.mimetype || "").toLowerCase()]) return fail(res, "Upload JPG, PNG or WEBP images up to 5 MB.", 415);
      docUpdate[column] = await saveImage(file, prefix);
    }

    if (!Object.keys(riderUpdate).length && !Object.keys(docUpdate).length) {
      return fail(res, "Nothing to update. Fill at least one pending detail.");
    }

    if (Object.keys(riderUpdate).length) {
      await prisma.tbl_rider.update({ where: { id: riderId }, data: riderUpdate });
    }
    if (Object.keys(docUpdate).length) {
      if (!docRow) docRow = await prisma.tbl_personal_doc.create({ data: { rider_id: riderId, status: 0 } });
      await prisma.tbl_personal_doc.update({ where: { id: docRow.id }, data: docUpdate });
    }
    await evaluateDriverApproval(riderId);

    const registration = await getRegistrationStatus(riderId);
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: registration.is_complete ? "Registration completed!" : "Details saved. Some details are still pending.",
      registration,
    });
  } catch (err) {
    logger.error("driverRegistrationCompletionController.complete failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

function complete(req, res) {
  upload(req, res, (err) => {
    if (err) {
      logger.error("driverRegistrationCompletionController upload failed:", err);
      return fail(res, err.message || "Upload failed", 400);
    }
    return handler(req, res);
  });
}

module.exports = { complete };

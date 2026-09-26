const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const prisma = require("../config/db");
const logger = require("../utils/logger");
const otpService = require("../services/otpService");
const deviceSessionService = require("../services/deviceSessionService");
const { uploadBuffer } = require("../utils/cloudinaryStorage");
const { getAutoVerificationSettings } = require("../utils/driverVerificationSettings");
const { evaluateDriverApproval } = require("../utils/driverApproval");
const { normalizeToLast10Digits } = require("../utils/phone");
const { creditSignUpBonus } = require("../services/referralRewardService");

// Node port of the legacy PHP driver endpoints under
// Php Backend/production/admin/rider_api/*.php. Response shape kept
// identical to the PHP originals so the driver app needs no parsing
// changes beyond switching its base URL.
//
// Passwords stay plaintext to match existing tbl_rider data — same
// explicit decision as customerAuthController.js.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

function generateRefferCode(seed) {
  const prefix = (seed || "RID")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let random = "";
  for (let i = 0; i < 5; i++) random += chars[Math.floor(Math.random() * chars.length)];
  return prefix + random;
}

async function uniqueRefferCode(seed) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRefferCode(seed);
    const existsRider = await prisma.tbl_rider.findFirst({
      where: { OR: [{ reffer_code: code }, { referral_code: code }, { refferal_code: code }] },
    });
    if (existsRider) continue;
    const existsUser = await prisma.tbl_user.findFirst({
      where: { OR: [{ reffer_code: code }, { referral_code: code }, { refferal_code: code }] },
    });
    if (!existsUser) return code;
  }
  return generateRefferCode(seed) + Date.now().toString(36).slice(-4).toUpperCase();
}

// --- mobile_check.php ---
async function mobileCheck(req, res) {
  try {
    const mobile = String(req.body?.mobile || "").trim();
    if (!mobile) return fail(res, "Something Went Wrong!");

    const existing = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    if (existing) return fail(res, "Already Exist Mobile Number!");
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "New Number!" });
  } catch (err) {
    logger.error("riderAuthController.mobileCheck failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- send_otp.php --- (with TEST_DRIVER_MOBILES bypass)
async function sendOtp(req, res) {
  try {
    const mobile = otpService.normalizeMobile(req.body?.mobile);
    if (!mobile) return fail(res, "Mobile number is required.");
    if (!otpService.isValidIndianMobile(mobile)) return fail(res, "Invalid Mobile Number.");

    const result = await otpService.sendOtp(mobile, { allowTestBypass: true });
    if (!result.ok) return fail(res, result.message);
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: result.message,
      Details: result.sessionId,
    });
  } catch (err) {
    logger.error("riderAuthController.sendOtp failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- verify_otp.php --- (with TEST_DRIVER_MOBILES bypass, returns existing driver or "new user" marker)
async function verifyOtp(req, res) {
  try {
    const mobile = otpService.normalizeMobile(req.body?.mobile);
    const otp = String(req.body?.otp || "").trim();
    const deviceId = String(req.body?.device_id || "").trim();
    const fcmToken = String(req.body?.fcm_token || "").trim();
    if (!mobile || !otp) return fail(res, "Mobile and OTP are required.");
    if (!otpService.isValidIndianMobile(mobile)) return fail(res, "Invalid Mobile Number.");

    const result = await otpService.verifyOtp(mobile, otp, { allowTestBypass: true });
    if (!result.ok) return fail(res, result.message);

    const driver = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });

    if (driver) {
      if (fcmToken) {
        await prisma.tbl_rider.update({ where: { id: driver.id }, data: { fcm_token: fcmToken, device_id: deviceId } });
      }
      await deviceSessionService.registerDevice({
        uid: driver.id,
        userType: "rider",
        deviceId,
        fcmToken,
        platform: req.body?.platform,
        deviceName: req.body?.device_name,
        appVersion: req.body?.app_version,
      });

      // payment_complete/auto_verification_* let the app route a driver whose
      // docs are already verified but who never paid the auto-verification
      // charge straight back to the payment screen on re-login, instead of
      // stuck on a "Mobile Number Already Used!" resubmit of the registration
      // form (see registerHandler - full_name is already set for these rows).
      const paymentComplete = Number(driver.payment_complete) === 1;
      let verificationCharge = { charge: 0, chargeOld: 0, msg: "" };
      if (!paymentComplete) {
        verificationCharge = await getAutoVerificationSettings();
      }

      let driverRefferCode = driver.reffer_code || driver.referral_code;
      if (!driverRefferCode) {
        driverRefferCode = await uniqueRefferCode(driver.full_name || "RID");
        await prisma.tbl_rider.update({
          where: { id: driver.id },
          data: { reffer_code: driverRefferCode, referral_code: driverRefferCode },
        }).catch(() => {});
      }

      const driverResponse = {
        id: driver.id,
        full_name: driver.full_name,
        email: driver.email,
        mobile: driver.fmobile,
        fmobile: driver.fmobile,
        dob: driver.dob || "",
        nationality: driver.nationality || "Indian",
        full_address: driver.full_address || "",
        know_language: driver.know_language || "Hindi, English",
        vehicle_no: driver.vehicle_no || "",
        account_name: driver.account_name,
        account_number: driver.account_number,
        ifsc: driver.ifsc,
        vehicle: driver.vehicle,
        profile_picture: driver.profile_picture,
        verification_type: driver.verification_type,
        verification_status: driver.verification_status,
        status: driver.status,
        wallet_balance: driver.wallet_balance?.toString?.() ?? driver.wallet_balance,
        plan_type: driver.plan_type,
        monthly_plan: driver.monthly_plan,
        working_hours: driver.working_hours,
        fcm_token: fcmToken || driver.fcm_token,
        rdate: driver.rdate,
        reffer_code: driverRefferCode,
        referral_code: driverRefferCode,
        refferal_code: driver.refferal_code || "",
        payment_complete: paymentComplete ? 1 : 0,
        auto_verification_charge: verificationCharge.charge,
        auto_verification_charge_old: verificationCharge.chargeOld,
        auto_verification_msg: verificationCharge.msg,
      };

      return res.status(200).json({
        ResponseCode: "200",
        Result: "true",
        ResponseMsg: "Login Successfully.",
        Is_New_User: "0",
        DriverData: driverResponse,
      });
    }

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "OTP Verified. Continue Registration.",
      Is_New_User: "1",
      Mobile: mobile,
    });
  } catch (err) {
    logger.error("riderAuthController.verifyOtp failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- rider_login.php --- (password login, alternative to OTP flow above)
async function login(req, res) {
  try {
    const { mobile, password } = req.body || {};
    const deviceId = String(req.body?.device_id || "").trim();
    const fcmToken = String(req.body?.fcm_token || "").trim();
    if (!mobile || !password) return fail(res, "Something Went Wrong!");

    const anyActive = await prisma.tbl_rider.findFirst({ where: { status: 1 } });
    if (!anyActive) return fail(res, "Your Status Deactivate!!!");

    const rider = await prisma.tbl_rider.findFirst({
      where: { fmobile: String(mobile), status: 1, password: String(password) },
    });
    if (!rider) return fail(res, "Invalid Email/Mobile No or Password!!!");

    const data = {};
    if (fcmToken) data.fcm_token = fcmToken;
    if (deviceId) data.device_id = deviceId;
    if (Object.keys(data).length) {
      await prisma.tbl_rider.update({ where: { id: rider.id }, data });
    }
    if (deviceId) {
      await deviceSessionService.registerDevice({
        uid: rider.id,
        userType: "rider",
        deviceId,
        fcmToken,
        platform: req.body?.platform,
        deviceName: req.body?.device_name,
        appVersion: req.body?.app_version,
      });
    }

    return res.status(200).json({
      rider_data: {
        ...rider,
        ...data,
        mobile: rider.fmobile,
        fmobile: rider.fmobile,
        dob: rider.dob || "",
        nationality: rider.nationality || "Indian",
        full_address: rider.full_address || "",
        know_language: rider.know_language || "Hindi, English",
        vehicle_no: rider.vehicle_no || "",
        wallet_balance: rider.wallet_balance?.toString?.() ?? rider.wallet_balance,
      },
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Login successfully!",
    });
  } catch (err) {
    logger.error("riderAuthController.login failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- logout.php ---
async function logout(req, res) {
  try {
    const rid = Number(req.body?.rid || 0);
    if (!rid) return fail(res, "Something Went Wrong! rid is required.");

    const rider = await prisma.tbl_rider.findUnique({ where: { id: rid } });
    if (!rider) return fail(res, "Driver Not Found");

    await prisma.tbl_rider.update({ where: { id: rid }, data: { fcm_token: "" } });
    return res.status(200).json({ ResponseCode: "200", Result: true, ResponseMsg: "Logout successfully!" });
  } catch (err) {
    logger.error("riderAuthController.logout failed:", err);
    return fail(res, "Logout Failed!", 500);
  }
}

// ---------------------------------------------------------------------
// reg_user.php - registration with document numbers + profile/UPI photo
// upload. Ported field-for-field from the PHP version (duplicate-document
// check across tbl_personal_doc, auto-approval when all 4 docs verified).
// ---------------------------------------------------------------------

const IMAGE_EXT_BY_MIME = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

const registerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: "profile_photo", maxCount: 1 },
  { name: "upi_image", maxCount: 1 },
  { name: "puc_image", maxCount: 1 },
  { name: "bima_image", maxCount: 1 },
]);

const DOC_CONFIG = {
  aadhar: { idCol: "aadhar_id", statusCol: "aadhar_status", label: "Aadhar Card" },
  pan: { idCol: "pan_id", statusCol: "pan_status", label: "PAN Card" },
  rc: { idCol: "residence_id", statusCol: "residence_status", label: "Vehicle RC" },
  dl: { idCol: "lic_id", statusCol: "lic_status", label: "Driving License" },
};

function resolveDocKey(rawName) {
  const clean = String(rawName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (clean.includes("adhar") || clean.includes("aadhar") || clean.includes("aadhaar")) return "aadhar";
  if (clean.includes("pan")) return "pan";
  if (clean.includes("rc") || clean.includes("residence")) return "rc";
  if (clean.includes("dl") || clean.includes("lic") || clean.includes("license")) return "dl";
  return clean;
}

function truthyFlag(v) {
  return v === true || v === "true" || v === 1 || v === "1" || String(v).toLowerCase() === "approved";
}

function collectDocuments(body) {
  const docs = [];
  const pushIfPresent = (label, numberField, verifiedField) => {
    const num = body[numberField];
    if (num !== undefined && num !== "") {
      docs.push({ name: label, number: String(num), verified: truthyFlag(body[verifiedField] ?? "true") });
    }
  };

  const rawDocs = body.documents;
  if (rawDocs) {
    try {
      const parsed = typeof rawDocs === "string" ? JSON.parse(rawDocs) : rawDocs;
      if (Array.isArray(parsed)) {
        for (const d of parsed) {
          const name = d.DocumentName || d.document_name || d.name || "";
          const number = d.DocumentNumber || d.document_number || d.number || "";
          const isVer = d.isVerified ?? d.is_verified ?? d.status ?? true;
          if (name) docs.push({ name: String(name), number: String(number), verified: truthyFlag(isVer) });
        }
      }
    } catch {
      // ignore malformed documents payload, fall through to flat keys
    }
  }

  pushIfPresent("Aadhar", "aadhar_no", "aadhar_verified");
  pushIfPresent("Aadhar", "aadhar_number", "aadhar_verified");
  pushIfPresent("Pan", "pan_no", "pan_verified");
  pushIfPresent("Pan", "pan_number", "pan_verified");
  pushIfPresent("Rc", "rc_no", "rc_verified");
  pushIfPresent("Rc", "rc_number", "rc_verified");
  pushIfPresent("Dl", "dl_no", "dl_verified");
  pushIfPresent("Dl", "dl_number", "dl_verified");

  return docs;
}

// folder: "profile" | "rider_docs" - returns the relative path to store in the DB (e.g. "images/profile/xxx.jpg")
async function saveBufferedFile(file, folder) {
  const mime = (file.mimetype || "").toLowerCase();
  const ext = IMAGE_EXT_BY_MIME[mime] || path.extname(file.originalname || "").replace(".", "") || "jpg";
  const filename = `${Date.now()}_${crypto.randomBytes(8).toString("hex")}.${ext}`;
  return uploadBuffer(file.buffer, `images/${folder}/${filename}`);
}

async function registerHandler(req, res) {
  try {
    const body = req.body || {};
    const required = ["email", "mobile", "account_name", "account_number", "ifsc", "vehicle", "vehicle_no", "device_id", "city_id"];
    const missing = required.filter((k) => !String(body[k] || "").trim());
    if (missing.length) {
      return res.status(200).json({ ResponseCode: "401", Result: "false", ResponseMsg: "Missing Parameters", missing_params: missing });
    }

    const fullName = String(body.full_name || "").trim();
    const email = String(body.email).trim();
    const mobile = String(body.mobile).trim();
    const dob = String(body.dob || "").trim();
    const accountName = String(body.account_name).trim();
    const accountNumber = String(body.account_number).trim();
    const ifsc = String(body.ifsc).trim().toUpperCase();
    const vehicle = String(body.vehicle).trim();
    const vehicleNo = String(body.vehicle_no).trim();
    const deviceId = String(body.device_id).trim();
    const cityId = Number(body.city_id) || 1;
    const fcmToken = String(body.fcm_token || "").trim();

    const refCodeRaw = body.referral_code || body.refferal_code || body.reffer_code || body.refer_code || "";
    const refferalCode = String(refCodeRaw).trim().toUpperCase();

    let referrerId = 0;
    let referrerIsCustomer = false;
    if (refferalCode) {
      const refRider = await prisma.tbl_rider.findFirst({
        where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }, { refferal_code: refferalCode }] },
      });
      if (refRider) {
        referrerId = refRider.id;
      } else {
        const refUser = await prisma.tbl_user.findFirst({
          where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }, { refferal_code: refferalCode }] },
        });
        if (refUser) {
          referrerId = refUser.id;
          referrerIsCustomer = true;
        } else {
          return fail(res, "Invalid Referral Code!");
        }
      }
    }

    const existingRider = await prisma.tbl_rider.findFirst({ where: { fmobile: mobile } });
    let riderId = 0;
    let isExistingDraft = false;
    if (existingRider) {
      if (!existingRider.full_name) {
        riderId = existingRider.id;
        isExistingDraft = true;
      } else {
        return fail(res, "Mobile Number Already Used!");
      }
    }

    // tbl_personal_doc has no declared FK relation to tbl_rider in this
    // schema, so the "belongs to an existing rider" check from the PHP
    // version (orphaned docs left after a rider delete shouldn't block
    // re-registration) is done as a manual two-step lookup.
    const documents = collectDocuments(body);
    for (const doc of documents) {
      const resolved = resolveDocKey(doc.name);
      const cfg = DOC_CONFIG[resolved];
      if (!cfg || !doc.number) continue;

      const docRow = await prisma.tbl_personal_doc.findFirst({
        where: { [cfg.idCol]: doc.number, ...(riderId > 0 ? { rider_id: { not: riderId } } : {}) },
      });
      if (docRow) {
        const owner = await prisma.tbl_rider.findUnique({ where: { id: docRow.rider_id } });
        if (owner) {
          return fail(res, `${cfg.label} Number (${doc.number}) is already registered with another driver account!`);
        }
      }
    }

    const profilePhoto = req.files?.profile_photo?.[0];
    if (!profilePhoto || !IMAGE_EXT_BY_MIME[(profilePhoto.mimetype || "").toLowerCase()] || profilePhoto.size > 5 * 1024 * 1024) {
      return res.status(200).json({ ResponseCode: "415", Result: "false", ResponseMsg: "Invalid driver profile photo. Use JPG, PNG or WEBP up to 5 MB." });
    }

    const refferCode = await uniqueRefferCode(fullName || "RID");
    const now = new Date();
    const refTypeStr = referrerId > 0 ? (referrerIsCustomer ? "USER" : "DRIVER") : "";

    // The one-time auto-verification charge (if any) is priced at
    // registration time - a driver with no charge due is marked paid
    // immediately, otherwise approval stays gated until the verification
    // payment actually clears (see evaluateDriverApproval).
    const { charge: autoVerificationCharge } = await getAutoVerificationSettings();
    const initialPaymentComplete = autoVerificationCharge > 0 ? 0 : 1;

    if (isExistingDraft && riderId > 0) {
      await prisma.tbl_rider.update({
        where: { id: riderId },
        data: {
          full_name: fullName,
          email,
          dob,
          account_name: accountName,
          account_number: accountNumber,
          ifsc,
          vehicle,
          vehicle_no: vehicleNo,
          city_id: cityId,
          device_id: deviceId,
          fcm_token: fcmToken,
          refferal_code: refferalCode,
          reffer_code: refferCode,
          referral_code: refferCode,
          refer_by: referrerId,
          referred_by: referrerId,
          referred_by_type: refTypeStr,
          status: 1,
          payment_complete: initialPaymentComplete,
        },
      });
    } else {
      const created = await prisma.tbl_rider.create({
        data: {
          full_name: fullName,
          email,
          dob,
          password: "",
          fmobile: mobile,
          vehicle,
          vehicle_no: vehicleNo,
          account_name: accountName,
          account_number: accountNumber,
          ifsc,
          city_id: cityId,
          device_id: deviceId,
          fcm_token: fcmToken,
          rdate: now,
          verification_type: "manual",
          verification_status: "pending",
          all_verify: 0,
          a_status: 0,
          status: 1,
          profile_picture: "",
          refferal_code: refferalCode,
          reffer_code: refferCode,
          referral_code: refferCode,
          refer_by: referrerId,
          referred_by: referrerId,
          referred_by_type: refTypeStr,
          payment_complete: initialPaymentComplete,
        },
      });
      riderId = created.id;
    }

    // verifyOtp/login register this device in tbl_rider_device (via
    // deviceSessionService) so home.php's DeviceMatch check finds an active
    // row - registration never did, so a brand-new driver had no active
    // device row until their next login. Their very first post-registration
    // /home call then saw DeviceMatch: false and got force-logged-out back
    // to sign-in (see the same bug just fixed for the customer app's
    // register()).
    await deviceSessionService.registerDevice({
      uid: riderId,
      userType: "rider",
      deviceId,
      fcmToken,
      platform: req.body?.platform,
      deviceName: req.body?.device_name,
      appVersion: req.body?.app_version,
    });

    // Profile photo
    const profilePath = await saveBufferedFile(profilePhoto, "profile");
    await prisma.tbl_rider.update({
      where: { id: riderId },
      data: { profile_picture: profilePath },
    });

    // Referral row
    if (referrerId > 0 && riderId > 0) {
      const refType = referrerIsCustomer ? "USER" : "DRIVER";
      const existingRef = await prisma.tbl_referral.findFirst({
        where: { referred_id: riderId, referred_type: "DRIVER" },
      });
      if (!existingRef) {
        await prisma.tbl_referral.create({
          data: {
            referrer_id: referrerId,
            referrer_type: refType,
            referred_id: riderId,
            referred_type: "DRIVER",
            referral_code: refferalCode,
            status: "pending",
            points_awarded: 0,
            ride_id: 0,
            registered_at: now,
          },
        });
        await prisma.tbl_rider.update({
          where: { id: riderId },
          data: { referred_by: referrerId, referred_by_type: refType, refer_by: referrerId },
        });
        await creditSignUpBonus({ referredId: riderId, referredType: "DRIVER" });
      }
    } else if (riderId > 0) {
      // If no manual referral code was provided, check if a driver partner referred this phone as a driver lead
      const normalizedPhone = normalizeToLast10Digits(mobile);
      const matchedLead = await prisma.tbl_driver_lead.findFirst({
        where: { phone: normalizedPhone, lead_type: "driver", status: "verified", expires_at: { gte: now } },
      });
      if (matchedLead) {
        const isUserReferrer = matchedLead.referrer_type === "user" || (matchedLead.user_id && matchedLead.user_id > 0);
        const referrerId = isUserReferrer ? matchedLead.user_id : matchedLead.driver_id;
        const referrerType = isUserReferrer ? "USER" : "DRIVER";

        await prisma.tbl_referral.create({
          data: {
            referrer_id: referrerId,
            referrer_type: referrerType,
            referred_id: riderId,
            referred_type: "DRIVER",
            referral_code: "",
            status: "pending",
            source: "lead",
            points_awarded: 0,
            ride_id: 0,
            registered_at: now,
          },
        });
        await prisma.tbl_driver_lead.update({
          where: { id: matchedLead.id },
          data: { status: "converted", converted_user_id: riderId, converted_at: now },
        });
        await prisma.tbl_rider.update({
          where: { id: riderId },
          data: { referred_by: referrerId, referred_by_type: referrerType, refer_by: referrerId },
        });
        await creditSignUpBonus({ referredId: riderId, referredType: "DRIVER" });
      }
    }

    // UPI image
    const upiFile = req.files?.upi_image?.[0];
    let upiImagePath = "";
    if (upiFile) {
      const allowedExt = ["jpg", "jpeg", "png", "webp", "pdf"];
      let ext = path.extname(upiFile.originalname || "").replace(".", "").toLowerCase();
      if (!allowedExt.includes(ext)) ext = "jpg";
      const filename = `upi_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
      upiImagePath = await uploadBuffer(upiFile.buffer, `images/rider_docs/${filename}`);
    }

    // PUC certificate / vehicle insurance (bima) - both optional, image-only,
    // no document number or verification workflow (see DOC_CONFIG above).
    async function saveOptionalDocImage(fieldName, filePrefix) {
      const file = req.files?.[fieldName]?.[0];
      if (!file) return "";
      const allowedExt = ["jpg", "jpeg", "png", "webp", "pdf"];
      let ext = path.extname(file.originalname || "").replace(".", "").toLowerCase();
      if (!allowedExt.includes(ext)) ext = "jpg";
      const filename = `${filePrefix}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.${ext}`;
      return uploadBuffer(file.buffer, `images/rider_docs/${filename}`);
    }
    const pucImagePath = await saveOptionalDocImage("puc_image", "puc");
    const bimaImagePath = await saveOptionalDocImage("bima_image", "bima");

    // Personal doc row
    let docRow = await prisma.tbl_personal_doc.findFirst({ where: { rider_id: riderId } });
    if (!docRow) {
      docRow = await prisma.tbl_personal_doc.create({ data: { rider_id: riderId, status: 0 } });
    }

    const docUpdate = {};
    const verifiedSummary = [];
    for (const doc of documents) {
      const resolved = resolveDocKey(doc.name);
      const cfg = DOC_CONFIG[resolved];
      if (!cfg) continue;
      if (doc.number) docUpdate[cfg.idCol] = doc.number;
      docUpdate[cfg.statusCol] = doc.verified ? 1 : 0;
      verifiedSummary.push({
        document: cfg.label,
        document_number: doc.number,
        status: doc.verified ? "Approved" : "Pending",
        is_verified: doc.verified,
      });
    }
    if (upiImagePath) docUpdate.upi_image = upiImagePath;
    if (pucImagePath) docUpdate.puc_image = pucImagePath;
    if (bimaImagePath) docUpdate.bima_image = bimaImagePath;

    // Only populated when the RC's registered owner isn't the driver -
    // the app runs its own UIDAI eKYC OTP check against this name before
    // letting the driver proceed, but previously threw the result away
    // instead of ever sending it here.
    const rcOwnerName = String(body.rc_owner_name || "").trim();
    const rcOwnerAadhaarNumber = String(body.rc_owner_aadhar_number || "").trim();
    if (rcOwnerName) docUpdate.rc_owner_name = rcOwnerName;
    if (rcOwnerAadhaarNumber) docUpdate.rc_owner_aadhar_number = rcOwnerAadhaarNumber;

    if (Object.keys(docUpdate).length) {
      await prisma.tbl_personal_doc.update({ where: { id: docRow.id }, data: docUpdate });
    }

    // Approval now also requires the verification payment to have cleared
    // (see evaluateDriverApproval) - docsVerified alone used to be enough,
    // which let a driver skip the Razorpay charge entirely by force-quitting
    // the app right after eKYC succeeded.
    const { isAllVerified, docsVerified } = await evaluateDriverApproval(riderId);

    const riderData = await prisma.tbl_rider.findUnique({ where: { id: riderId } });
    const paymentComplete = Number(riderData.payment_complete) === 1;
    const responseMsg = isAllVerified
      ? "Registration successful and Driver profile approved!"
      : docsVerified && !paymentComplete
        ? `Documents verified! Complete the ₹${autoVerificationCharge} verification payment to activate your account.`
        : "Your account is under verification.";

    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: responseMsg,
      is_all_verified: isAllVerified,
      payment_complete: paymentComplete ? 1 : 0,
      auto_verification_charge: autoVerificationCharge,
      reffer_code: refferCode,
      rider_data: {
        ...riderData,
        mobile: riderData.fmobile,
        fmobile: riderData.fmobile,
        dob: riderData.dob || "",
        nationality: riderData.nationality || "Indian",
        full_address: riderData.full_address || "",
        know_language: riderData.know_language || "Hindi, English",
        vehicle_no: riderData.vehicle_no || "",
        wallet_balance: riderData.wallet_balance?.toString?.() ?? riderData.wallet_balance,
        payment_complete: paymentComplete ? 1 : 0,
        auto_verification_charge: autoVerificationCharge,
      },
      verified_documents: verifiedSummary,
    });
  } catch (err) {
    logger.error("riderAuthController.registerHandler failed:", err);
    return res.status(200).json({ ResponseCode: "500", Result: "false", ResponseMsg: `Server Error: ${err.message}` });
  }
}

function register(req, res) {
  registerUpload(req, res, (err) => {
    if (err) {
      logger.error("riderAuthController.register upload failed:", err);
      return res.status(200).json({ ResponseCode: "400", Result: "false", ResponseMsg: err.message || "Upload failed" });
    }
    return registerHandler(req, res);
  });
}

module.exports = { mobileCheck, sendOtp, verifyOtp, login, logout, register, uniqueRefferCode };

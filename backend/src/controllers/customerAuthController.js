const prisma = require("../config/db");
const logger = require("../utils/logger");
const otpService = require("../services/otpService");
const deviceSessionService = require("../services/deviceSessionService");

// Node port of the legacy PHP customer endpoints under
// Php Backend/production/admin/cust_api/*.php. Response shape
// ({ Result, ResponseCode, ResponseMsg, ... }) is kept identical so the
// Flutter customer app (ShifterOnline) needs no parsing changes when its
// Config.baseurl is switched from the legacy PHP host to this Node one.
//
// Passwords are stored and compared in PLAINTEXT, matching tbl_user's
// existing data — this is a known pre-existing issue, not something
// introduced here (see mobile_check.php / user_login.php). Left as-is by
// explicit product decision (2026-09-14) to avoid locking out every
// existing customer; hashing is a separate follow-up task.

function fail(res, msg, code = 401) {
  return res.status(200).json({ ResponseCode: String(code), Result: "false", ResponseMsg: msg });
}

function generateRefferCode(seed) {
  const prefix = (seed || "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "")
    .slice(0, 3)
    .padEnd(3, "X");
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1
  let random = "";
  for (let i = 0; i < 5; i++) random += chars[Math.floor(Math.random() * chars.length)];
  return prefix + random;
}

async function uniqueRefferCode(seed) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateRefferCode(seed);
    const exists = await prisma.tbl_user.findFirst({ where: { reffer_code: code } });
    if (!exists) return code;
  }
  return generateRefferCode(seed) + Date.now().toString(36).slice(-5).toUpperCase();
}

// --- mobile_check.php ---
async function mobileCheck(req, res) {
  try {
    const mobile = String(req.body?.mobile || "").trim();
    const ccode = String(req.body?.ccode || "").trim();
    if (!mobile) return fail(res, "Something Went Wrong!");

    const existing = await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile), ccode } });
    if (existing) return fail(res, "Already Exist Mobile Number!");
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "New Number!" });
  } catch (err) {
    logger.error("customerAuthController.mobileCheck failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- msg_otp.php ---
async function sendOtp(req, res) {
  try {
    const mobile = otpService.normalizeMobile(req.body?.mobile);
    if (!mobile) return fail(res, "Something Went Wrong!");

    const result = await otpService.sendOtp(mobile, { allowTestBypass: false });
    if (!result.ok) return fail(res, result.message);
    return res.status(200).json({
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: result.message,
      Details: result.sessionId,
    });
  } catch (err) {
    logger.error("customerAuthController.sendOtp failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- verify-otp.php ---
async function verifyOtp(req, res) {
  try {
    const mobile = otpService.normalizeMobile(req.body?.mobile);
    const otp = String(req.body?.otp || "").trim();
    const deviceId = String(req.body?.device_id || "").trim();
    if (!mobile || !otp) return fail(res, "Something Went Wrong!");

    const result = await otpService.verifyOtp(mobile, otp, { allowTestBypass: false });
    if (!result.ok) return fail(res, result.message);

    if (deviceId) {
      await prisma.tbl_user.updateMany({ where: { mobile: Number(mobile) }, data: { device_id: deviceId } });
    }
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: result.message });
  } catch (err) {
    logger.error("customerAuthController.verifyOtp failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- user_login.php ---
async function login(req, res) {
  try {
    const { mobile, password, ccode } = req.body || {};
    const deviceId = String(req.body?.device_id || "").trim();
    const fcmToken = String(req.body?.fcm_token || "").trim();
    if (!mobile || !password) return fail(res, "Something Went Wrong!");

    // Note: legacy user_login.php ran an equally pointless "does ANY user
    // in the whole table have status=1" gate before the real lookup below
    // (and even ran the real lookup's own query twice) - not a real
    // per-user check, just wasted round trips on a DB that's a WAN hop away
    // from this backend, so it's dropped here rather than ported as-is.
    const user = await prisma.tbl_user.findFirst({
      where: { mobile: Number(mobile), ccode: String(ccode || ""), status: 1, password: String(password) },
    });
    if (!user) return fail(res, "Invalid Email/Mobile No or Password!!!");

    const data = {};
    if (fcmToken) data.fcm_token = fcmToken;
    if (deviceId) data.device_id = deviceId;

    // These three don't depend on each other's results - only on user.id -
    // so they run concurrently instead of stacking their round trips.
    const [, , addressCount] = await Promise.all([
      Object.keys(data).length ? prisma.tbl_user.update({ where: { id: user.id }, data }) : Promise.resolve(),
      deviceSessionService.registerDevice({
        uid: user.id,
        deviceId,
        fcmToken,
        platform: req.body?.platform,
        deviceName: req.body?.device_name,
        appVersion: req.body?.app_version,
      }),
      prisma.tbl_address.count({ where: { uid: user.id } }),
    ]);

    return res.status(200).json({
      UserLogin: { ...user, ...data, wallet: user.wallet?.toString?.() ?? user.wallet },
      AddressExist: addressCount > 0,
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Login successfully!",
    });
  } catch (err) {
    logger.error("customerAuthController.login failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- reg_user.php ---
async function register(req, res) {
  try {
    const fname = String(req.body?.fname || "").trim();
    const email = String(req.body?.email || "").trim();
    const mobile = String(req.body?.mobile || "").trim();
    const ccode = String(req.body?.ccode || "").trim();
    const password = String(req.body?.password || "").trim();
    const cityId = Number(req.body?.city_id || 0) || null;
    const deviceId = String(req.body?.device_id || "").trim();
    const fcmToken = String(req.body?.fcm_token || "").trim();
    const referCodeRaw =
      req.body?.referral_code || req.body?.refferal_code || req.body?.reffer_code || req.body?.refer_code || "";
    const refferalCode = String(referCodeRaw).trim().toUpperCase();

    if (!fname || !email || !mobile || !password) return fail(res, "Something Went Wrong!");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, "Please enter a valid email address!");
    if (!/^[0-9]{6,15}$/.test(mobile)) return fail(res, "Please enter a valid mobile number!");

    const mobileTaken = await prisma.tbl_user.findFirst({ where: { mobile: Number(mobile) } });
    if (mobileTaken) return fail(res, "Mobile Number Already Used!");

    const emailTaken = await prisma.tbl_user.findFirst({ where: { email } });
    if (emailTaken) return fail(res, "Email Already Used!");

    let referrerId = 0;
    let referrerIsDriver = false;
    if (refferalCode) {
      const refUser = await prisma.tbl_user.findFirst({
        where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }] },
      });
      if (refUser) {
        referrerId = refUser.id;
      } else {
        const refRider = await prisma.tbl_rider.findFirst({
          where: { OR: [{ reffer_code: refferalCode }, { referral_code: refferalCode }] },
        });
        if (refRider) {
          referrerId = refRider.id;
          referrerIsDriver = true;
        } else {
          return fail(res, "Invalid Referral Code!");
        }
      }
    }

    const refferCode = await uniqueRefferCode(fname);
    const now = new Date();

    const newUser = await prisma.tbl_user.create({
      data: {
        name: fname,
        password,
        mobile: Number(mobile),
        rdate: now,
        email,
        ccode,
        fcm_token: fcmToken,
        city_id: cityId,
        device_id: deviceId,
        refferal_code: refferalCode,
        reffer_code: refferCode,
        referral_code: refferCode,
        refer_by: referrerId ? String(referrerId) : null,
        wallet: 0,
        status: 1,
      },
    });

    if (referrerId > 0) {
      const refType = referrerIsDriver ? "DRIVER" : "USER";
      await prisma.tbl_referral.create({
        data: {
          referrer_id: referrerId,
          referrer_type: refType,
          referred_id: newUser.id,
          referred_type: "USER",
          referral_code: refferalCode,
          status: "pending",
          points_awarded: 0,
          ride_id: 0,
          registered_at: now,
        },
      });
      await prisma.tbl_user.update({
        where: { id: newUser.id },
        data: { referred_by: referrerId, referred_by_type: refType },
      });

      if (referrerIsDriver) {
        const existingFav = await prisma.tbl_favorite_driver.findFirst({
          where: { user_id: newUser.id, rider_id: referrerId },
        });
        if (existingFav) {
          await prisma.tbl_favorite_driver.update({ where: { id: existingFav.id }, data: { status: 1 } });
        } else {
          await prisma.tbl_favorite_driver.create({
            data: { user_id: newUser.id, rider_id: referrerId, status: 1 },
          });
        }
      }
    }

    const created = await prisma.tbl_user.findUnique({ where: { id: newUser.id } });
    return res.status(200).json({
      UserLogin: { ...created, wallet: created.wallet?.toString?.() ?? created.wallet },
      ResponseCode: "200",
      Result: "true",
      ResponseMsg: "Sign Up Done Successfully!",
    });
  } catch (err) {
    logger.error("customerAuthController.register failed:", err);
    return fail(res, "Sign Up Failed. Please try again!", 500);
  }
}

// --- forget_password.php ---
// The PHP original changed the password from mobile+new-password alone, with
// no proof the caller ever received that mobile's OTP — anyone who knew a
// customer's number could reset their password outright. Fixed here (not
// carried forward, unlike the plaintext-password decision) by requiring the
// most recent otpService.verifyOtp() call for that mobile to have actually
// succeeded (tbl_otp.status=1) within the last 10 minutes, mirroring the
// verify-otp -> forgot-password step order the app's UI already uses.
const OTP_VERIFIED_WINDOW_MS = 10 * 60 * 1000;

async function forgotPassword(req, res) {
  try {
    const mobile = otpService.normalizeMobile(req.body?.mobile);
    const password = String(req.body?.password || "").trim();
    if (!mobile || !password) return fail(res, "Something Went wrong  try again !");

    const otpRow = await prisma.tbl_otp.findFirst({ where: { mobile }, orderBy: { id: "desc" } });
    const verifiedRecently =
      otpRow && otpRow.status === 1 && Date.now() - new Date(otpRow.created_at).getTime() <= OTP_VERIFIED_WINDOW_MS;
    if (!verifiedRecently) {
      return fail(res, "Please verify OTP for this mobile number before resetting the password.");
    }

    const result = await prisma.tbl_user.updateMany({ where: { mobile: Number(mobile) }, data: { password } });
    if (result.count === 0) return fail(res, "mobile Not Matched!!!!");

    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Password Changed Successfully!!!!!" });
  } catch (err) {
    logger.error("customerAuthController.forgotPassword failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- acc_delete.php ---
async function deleteAccount(req, res) {
  try {
    const uid = Number(req.body?.uid || 0);
    if (!uid) return fail(res, "Something Went Wrong!");

    await prisma.tbl_user.update({ where: { id: uid }, data: { status: 0 } });
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "Account Delete Successfully!!" });
  } catch (err) {
    logger.error("customerAuthController.deleteAccount failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

// --- country_code.php ---
async function countryCodeList(req, res) {
  try {
    const codes = await prisma.tbl_code.findMany();
    return res.status(200).json({ CountryCode: codes, ResponseCode: "200", Result: "true", ResponseMsg: "Country Code List Founded!" });
  } catch (err) {
    logger.error("customerAuthController.countryCodeList failed:", err);
    return fail(res, "Internal server error", 500);
  }
}

module.exports = {
  mobileCheck,
  sendOtp,
  verifyOtp,
  login,
  register,
  forgotPassword,
  deleteAccount,
  countryCodeList,
};

const prisma = require("../config/db");
const logger = require("../utils/logger");

// Ported from the legacy PHP msg_otp.php / verify-otp.php / send_otp.php /
// verify_otp.php (cust_api + rider_api) — both apps used the same 2Factor.in
// account and the same tbl_otp session table, just duplicated the cURL calls
// four times across two folders. Consolidated here as the single Node
// equivalent so both customerAuthController and riderAuthController share it.
// Env only - the key must never live in source control. Without it OTPs cannot
// be sent or verified (see the guards in sendOtp / verifyOtp).
const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY;
const TWOFACTOR_TEMPLATE = "ShifterOnlineNEWOTP";
const TWOFACTOR_BASE = "https://2factor.in/API/V1";

// Driver-app testing bypass, ported from rider_api/test_driver_config.php.
// The PHP version left this hardcoded `true` in every environment,
// including production, with only a comment warning to flip it before a
// real release — that warning was apparently never acted on. Node instead
// gates it on env so a production deploy can't silently inherit the same
// bypass: set ENABLE_OTP_TEST_MODE=true explicitly (e.g. in the dev/staging
// environment) to turn it on.
const TEST_MODE_ENABLED = process.env.ENABLE_OTP_TEST_MODE === "true";
const TEST_DRIVER_OTP = "123456";
const TEST_DRIVER_MOBILES = [
  "9999900001",
  "9999900002",
  "9999900003",
  "9999900004",
  "9999900005",
  "9999900006",
  "9999900007",
  "9999900008",
  "9999900009",
  "9999900010",
];

function isTestDriverMobile(mobile) {
  if (!TEST_MODE_ENABLED) return false;
  const m = String(mobile || "");
  return m.startsWith("99999") || m.startsWith("88888") || TEST_DRIVER_MOBILES.includes(m);
}

/** Strips spaces/dashes and a leading +91/91 country-code prefix, matching every PHP OTP endpoint. */
function normalizeMobile(raw) {
  let mobile = String(raw || "").replace(/[^0-9+]/g, "");
  if (mobile.startsWith("+91")) {
    mobile = mobile.slice(3);
  } else if (mobile.startsWith("91") && mobile.length > 10) {
    mobile = mobile.slice(2);
  }
  return mobile;
}

function isValidIndianMobile(mobile) {
  return /^[6-9][0-9]{9}$/.test(mobile);
}

/**
 * Sends an OTP via 2Factor.in and stores the session in tbl_otp (deleting
 * any prior session for that number first, same as the PHP endpoints).
 * @param {string} mobile - already normalized
 * @param {boolean} allowTestBypass - true for rider_api-equivalent callers
 */
async function sendOtp(mobile, { allowTestBypass = false } = {}) {
  if (allowTestBypass && isTestDriverMobile(mobile)) {
    const testSessionId = `TEST_${mobile}`;
    await prisma.tbl_otp.deleteMany({ where: { mobile } });
    await prisma.tbl_otp.create({
      data: { mobile, session_id: testSessionId, status: 0, created_at: new Date() },
    });
    return {
      ok: true,
      message: `OTP Sent Successfully. (TEST MODE - use OTP ${TEST_DRIVER_OTP})`,
      sessionId: testSessionId,
    };
  }

  if (!TWOFACTOR_API_KEY) {
    logger.error("otpService.sendOtp: TWOFACTOR_API_KEY is not configured");
    return { ok: false, message: "OTP service is not available right now. Please try again later." };
  }
  const url = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/SMS/${mobile}/AUTOGEN/${TWOFACTOR_TEMPLATE}`;
  let result;
  try {
    const resp = await fetch(url);
    result = await resp.json();
  } catch (err) {
    logger.error("otpService.sendOtp fetch failed:", err);
    return { ok: false, message: err.message || "OTP Send Failed." };
  }

  if (!result || !result.Status) {
    return { ok: false, message: "Invalid API Response" };
  }
  if (result.Status !== "Success") {
    return { ok: false, message: result.Details || "OTP Send Failed." };
  }

  const sessionId = result.Details;
  await prisma.tbl_otp.deleteMany({ where: { mobile } });
  await prisma.tbl_otp.create({
    data: { mobile, session_id: sessionId, status: 0, created_at: new Date() },
  });
  return { ok: true, message: "OTP Sent Successfully.", sessionId };
}

/**
 * Verifies an OTP against the latest tbl_otp session for that mobile.
 * @param {string} mobile - already normalized
 * @param {string} otp
 * @param {boolean} allowTestBypass - true for rider_api-equivalent callers
 */
async function verifyOtp(mobile, otp, { allowTestBypass = false } = {}) {
  if (allowTestBypass && isTestDriverMobile(mobile) && String(otp) === TEST_DRIVER_OTP) {
    return { ok: true, message: "OTP Verified Successfully!!" };
  }

  const otpRow = await prisma.tbl_otp.findFirst({
    where: { mobile },
    orderBy: { id: "desc" },
  });
  if (!otpRow) {
    return { ok: false, message: "OTP Session Not Found." };
  }

  if (!TWOFACTOR_API_KEY) {
    logger.error("otpService.verifyOtp: TWOFACTOR_API_KEY is not configured");
    return { ok: false, message: "OTP service is not available right now. Please try again later." };
  }
  const url = `${TWOFACTOR_BASE}/${TWOFACTOR_API_KEY}/SMS/VERIFY/${otpRow.session_id}/${otp}`;
  let verify;
  try {
    const resp = await fetch(url);
    verify = await resp.json();
  } catch (err) {
    logger.error("otpService.verifyOtp fetch failed:", err);
    return { ok: false, message: err.message || "Invalid OTP." };
  }

  if (!verify || verify.Status !== "Success") {
    return { ok: false, message: "Invalid OTP." };
  }

  await prisma.tbl_otp.update({ where: { id: otpRow.id }, data: { status: 1 } });
  return { ok: true, message: "OTP Verified Successfully!!" };
}

// The apps verify the OTP in one call (/verify-otp) and then log in / register
// / reset the password in a separate one, so those later calls must prove the
// mobile's latest OTP session really was verified - otherwise anyone who knows
// a number could skip the OTP step by calling them directly.
const OTP_VERIFIED_WINDOW_MS = 10 * 60 * 1000;

async function hasRecentVerifiedOtp(mobile) {
  const otpRow = await prisma.tbl_otp.findFirst({ where: { mobile }, orderBy: { id: "desc" } });
  return Boolean(otpRow && otpRow.status === 1 && Date.now() - new Date(otpRow.created_at).getTime() <= OTP_VERIFIED_WINDOW_MS);
}

module.exports = {
  hasRecentVerifiedOtp,
  normalizeMobile,
  isValidIndianMobile,
  isTestDriverMobile,
  sendOtp,
  verifyOtp,
  TEST_DRIVER_OTP,
};

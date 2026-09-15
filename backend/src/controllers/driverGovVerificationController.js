const logger = require("../utils/logger");
const prisma = require("../config/db");
const { verifyAadharPdf } = require("../utils/aadharPdfVerify");

// Node port of rider_api/generate_captcha_dl.php + verify_dl.php (official
// Sarathi Parivahan - Govt of India driving-licence lookup, used the same
// way most fintech/mobility KYC integrations do: fetch a captcha image,
// show it to the user, submit what they typed back with the session) and
// verify_rc.php (an unofficial, undocumented Acko API call using a
// hardcoded browser session cookie - ported as-is per explicit product
// decision, ["Port it as-is"] 2026-09-14; this is fragile by nature and the
// cookie WILL need refreshing from a real browser session periodically).

const SARATHI_HEADERS_BASE = {
  "accept-language": "en-US,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="152", "Not?A_Brand";v="24", "Brave";v="152"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-gpc": "1",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36",
};

// --- generate_captcha_dl.php ---
async function generateCaptcha(req, res) {
  try {
    const url = `https://sarathi.parivahan.gov.in/sarathiservice/jsp/common/captchaimage.jsp?${Date.now()}`;
    const resp = await fetch(url, {
      headers: {
        ...SARATHI_HEADERS_BASE,
        accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        priority: "i",
        referer: "https://sarathi.parivahan.gov.in/sarathiservice/envaction.do",
        "sec-fetch-dest": "image",
        "sec-fetch-mode": "no-cors",
        "sec-fetch-site": "same-origin",
      },
    });

    if (!resp.ok) {
      return res.status(500).json({ status: false, ResponseCode: "500", message: `Failed to generate captcha from Sarathi server (HTTP ${resp.status})` });
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    const setCookies = typeof resp.headers.getSetCookie === "function" ? resp.headers.getSetCookie() : [];
    let cookieString = setCookies.map((c) => c.split(";")[0]).join("; ");
    if (!cookieString.includes("STATEID")) {
      cookieString += (cookieString ? "; " : "") + "STATEID=ZHlLVUxHYWtBbGVBZnM3cG5qdEFSdz09";
    }
    const jsessionMatch = cookieString.match(/JSESSIONID=([^;]+)/);
    const jsessionId = jsessionMatch ? jsessionMatch[1] : "";

    if (req.query?.raw === "1") {
      res.set("Content-Type", "image/jpeg");
      res.set("X-Session-ID", jsessionId);
      res.set("X-Cookie", cookieString);
      return res.status(200).send(buffer);
    }

    const base64Image = buffer.toString("base64");
    return res.status(200).json({
      status: true,
      ResponseCode: "200",
      message: "Captcha generated successfully",
      data: {
        jsessionid: jsessionId,
        session_cookie: cookieString,
        captcha_image: `data:image/jpeg;base64,${base64Image}`,
        captcha_base64: base64Image,
      },
    });
  } catch (err) {
    logger.error("driverGovVerificationController.generateCaptcha failed:", err);
    return res.status(500).json({ status: false, ResponseCode: "500", message: "Failed to generate captcha from Sarathi server", error: err.message });
  }
}

function getInput(body, query, key, fallbacks = []) {
  for (const k of [key, ...fallbacks]) {
    if (body?.[k]) return String(body[k]).trim();
    if (query?.[k]) return String(query[k]).trim();
  }
  return "";
}

// --- verify_dl.php ---
async function verifyDrivingLicence(req, res) {
  try {
    const body = req.body || {};
    const query = req.query || {};
    const dlno = getInput(body, query, "dlno", ["dl_number", "dl_num", "dlNo"]);
    const dob = getInput(body, query, "dob", ["date_of_birth", "d_o_b"]);
    const captcha = getInput(body, query, "captcha", ["captchaByApplicant", "captcha_code"]);
    const jsessionid = getInput(body, query, "jsessionid", ["session_id", "jsession_id"]);
    const sessionCookie = getInput(body, query, "session_cookie", ["cookies", "cookie"]);

    if (!dlno) return res.status(400).json({ status: false, ResponseCode: "400", message: "DL number (dlno) is required." });
    if (!dob) return res.status(400).json({ status: false, ResponseCode: "400", message: "Date of birth (dob) is required. Format: DD-MM-YYYY" });
    if (!captcha) return res.status(400).json({ status: false, ResponseCode: "400", message: "Captcha code (captcha) is required." });
    if (!jsessionid && !sessionCookie) {
      return res.status(400).json({ status: false, ResponseCode: "400", message: "Session ID (jsessionid or session_cookie) is required from the generate-captcha API." });
    }

    const cookieHeader = sessionCookie || `JSESSIONID=${jsessionid}; STATEID=ZHlLVUxHYWtBbGVBZnM3cG5qdEFSdz09`;
    const url = "https://sarathi.parivahan.gov.in/sarathiservice/getLastEndorsedRtoDLserReq.do?";
    const postBody = new URLSearchParams({ dlno, dob, captchaByApplicant: captcha }).toString();

    let resp;
    let text;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: {
          ...SARATHI_HEADERS_BASE,
          accept: "application/json, text/javascript, */*; q=0.01",
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          origin: "https://sarathi.parivahan.gov.in",
          priority: "u=1, i",
          referer: "https://sarathi.parivahan.gov.in/sarathiservice/envaction.do",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-requested-with": "XMLHttpRequest",
          cookie: cookieHeader,
        },
        body: postBody,
      });
      text = await resp.text();
    } catch (err) {
      return res.status(500).json({ status: false, ResponseCode: "500", message: `Failed to connect to DL verification service: ${err.message}` });
    }

    const trimmed = text.trim();
    let data = null;
    try {
      data = JSON.parse(trimmed);
    } catch {
      // not JSON - handled below as HTML/text response
    }

    if (resp.status === 200 && trimmed && data !== null) {
      if (data && (data.status === "error" || data.status === false)) {
        return res.status(400).json({ status: false, ResponseCode: "400", message: data.msg || data.message || "DL verification failed", data });
      }
      const parsed = { dl_number: dlno, dob, status: "OK", raw_response: data };
      if (Array.isArray(data) && data.length >= 4) {
        const stateHolder = data[2] || "";
        const rto = data[3] || "";
        if (stateHolder.includes("@")) {
          const [state, holderName] = stateHolder.split("@").map((s) => s.trim());
          parsed.state = state;
          parsed.holder_name = holderName;
        } else {
          parsed.holder_name = stateHolder;
          parsed.state = "";
        }
        parsed.rto = rto;
      }
      return res.status(200).json({ status: true, ResponseCode: "200", message: "Driving Licence verified successfully", data: parsed });
    }

    if (resp.status === 200 && trimmed) {
      if (/Please Enter Valid Captcha/i.test(trimmed)) {
        return res.status(400).json({ status: false, ResponseCode: "400", message: "Invalid Captcha or Captcha session expired. Please regenerate captcha." });
      }
      if (/Record Not Found|No Record/i.test(trimmed)) {
        return res.status(404).json({ status: false, ResponseCode: "404", message: "Driving Licence details not found." });
      }
      return res.status(200).json({ status: true, ResponseCode: "200", data: trimmed });
    }

    return res.status(400).json({ status: false, ResponseCode: "400", message: "Invalid captcha, session expired, or DL not found.", http_code: resp.status });
  } catch (err) {
    logger.error("driverGovVerificationController.verifyDrivingLicence failed:", err);
    return res.status(500).json({ status: false, ResponseCode: "500", message: "Internal server error" });
  }
}

// --- verify_rc.php --- (Acko's undocumented vehicle-info API, hardcoded browser cookie - see file header)
// The cookie was committed in plaintext in the PHP source already (and
// still works as of the 2026-09-14 smoke test) - moved to env so a future
// rotation doesn't require another code deploy. Falls back to that same
// already-public value so this doesn't silently break existing deployments.
const ACKO_COOKIE =
  process.env.ACKO_SESSION_COOKIE ||
  "trackerid=cfcfa1d2-1296-4f53-8c38-fba0e4191538; acko_visit=AUWiVoBxCYTuhC2CBMqKqw; __cf_bm=ocp4NsMUjDqtKtvue76PVxWP3f1Y2X0WW5FQRkpD7qY-1787159997.7578132-1.0.1.1-6E0aE.RQcYtyvCRMJDZic0orgE5Cah6dGKIjp_zDWiV_3zFceDFVAbrjpikpPZVvQ0eFqOov0z5lAIvFaBjJZsWd2s1L3KbBgFN4bMIwCvolbta9TBr0fa11Fz3xMmit";

async function verifyRc(req, res) {
  try {
    const body = req.body || {};
    const query = req.query || {};
    const raw = getInput(body, query, "rc_number", ["regNo", "reg_num"]);
    const rcNumber = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!rcNumber) return res.status(400).json({ status: false, ResponseCode: "400", message: "RC number (registration number) is required." });

    const url = `https://www.acko.com/api/app/vehicleInfo/?regNo=${encodeURIComponent(rcNumber)}`;
    let resp;
    let text;
    try {
      resp = await fetch(url, {
        headers: {
          accept: "*/*",
          "accept-language": "en-US,en;q=0.7",
          priority: "u=1, i",
          referer: "https://www.acko.com/rto/how-to-check-vehicle-owner-details-by-number-plate/?utm_source=partnership&utm_campaign=siteplug&utm_term=BBS161",
          "sec-ch-ua": '"Not=A?Brand";v="99", "Brave";v="151", "Chromium";v="151"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "sec-gpc": "1",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
          cookie: ACKO_COOKIE,
        },
      });
      text = await resp.text();
    } catch (err) {
      return res.status(500).json({ status: false, ResponseCode: "500", message: `Failed to connect to verification server: ${err.message}` });
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      // fall through to not-found below
    }

    if (resp.status === 200 && data && data.registration_number) {
      return res.status(200).json(data);
    }
    return res.status(404).json({
      status: false,
      ResponseCode: "404",
      message: "Vehicle details not found or invalid RC number",
      error: data?.error || "Vehicle data not found",
    });
  } catch (err) {
    logger.error("driverGovVerificationController.verifyRc failed:", err);
    return res.status(500).json({ status: false, ResponseCode: "500", message: "Internal server error" });
  }
}

// --- verify_aadhar.php equivalent (no PHP original - new endpoint) ---
// Unlocks the driver's uploaded e-Aadhaar PDF using UIDAI's own documented
// password scheme (first 4 letters of name + birth year, brute-forced since
// the exact year isn't known upfront - see utils/aadharPdfVerify.js), then
// confirms both the name and (when dob is sent) date of birth printed
// inside it match what was submitted - reporting which one failed.
async function verifyAadhar(req, res) {
  try {
    const body = req.body || {};
    const aadharBase64 = body.aadhar_base64 || body.aadhar_pdf || body.aadharBase64;
    const fullName = body.full_name || body.fullName;
    const dob = body.dob || body.date_of_birth || body.dateOfBirth;

    if (!aadharBase64 || !fullName) {
      return res.status(400).json({ status: false, ResponseCode: "400", message: "aadhar_base64 and full_name are required." });
    }

    const result = await verifyAadharPdf({ aadharBase64, fullName, dob });
    if (!result.ok) {
      return res.status(200).json({ status: false, ResponseCode: "401", message: result.reason || "Aadhar details not matched.", field: result.field });
    }
    return res.status(200).json({ status: true, ResponseCode: "200", message: result.message || "Aadhar Verified Successfully" });
  } catch (err) {
    logger.error("driverGovVerificationController.verifyAadhar failed:", err);
    return res.status(200).json({ status: false, ResponseCode: "401", message: "Aadhar details not matched." });
  }
}

// --- dynamic_kyc_config (no PHP original - new endpoint) ---
// The Acko RC lookup and Sarathi DL lookup are unofficial APIs the driver
// app calls DIRECTLY from the device (not proxied through this backend) -
// deliberately, so requests come from many different driver IPs instead of
// this server's single IP, which is far more likely to get rate-limited or
// blacklisted by Acko/Sarathi as scraping traffic. The session cookies those
// calls need were previously hardcoded in the app itself, meaning a cookie
// rotation needed a new APK release and the value sat in plaintext in every
// installed app (visible to anyone who decompiles it). This endpoint lets
// the app fetch the current values instead - admin updates them here
// (PUT /admin/settings with flags.acko_session_cookie / flags.sarathi_state_id,
// see settingsController.js) and every app picks up the change on its next
// call, no release needed. Falls back to the same hardcoded values the app
// used before, so nothing breaks before an admin ever sets these.
const DEFAULT_ACKO_SESSION_COOKIE =
  "trackerid=cfcfa1d2-1296-4f53-8c38-fba0e4191538; acko_visit=AUWiVoBxCYTuhC2CBMqKqw; __cf_bm=ocp4NsMUjDqtKtvue76PVxWP3f1Y2X0WW5FQRkpD7qY-1787159997.7578132-1.0.1.1-6E0aE.RQcYtyvCRMJDZic0orgE5Cah6dGKIjp_zDWiV_3zFceDFVAbrjpikpPZVvQ0eFqOov0z5lAIvFaBjJZsWd2s1L3KbBgFN4bMIwCvolbta9TBr0fa11Fz3xMmit";
const DEFAULT_SARATHI_STATE_ID = "ZHlLVUxHYWtBbGVBZnM3cG5qdEFSdz09";

async function getDynamicKycConfig(req, res) {
  try {
    const rows = await prisma.app_settings.findMany({
      where: { setting_key: { in: ["acko_session_cookie", "sarathi_state_id"] } },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));

    const ackoCookie = byKey.acko_session_cookie || process.env.ACKO_SESSION_COOKIE || DEFAULT_ACKO_SESSION_COOKIE;
    const sarathiStateId = byKey.sarathi_state_id || DEFAULT_SARATHI_STATE_ID;

    // Self-seed: the admin Settings page ("Other Feature Flags") only renders
    // keys that already exist in app_settings, with no way to create a brand
    // new one from that UI. Creating these rows on first use (fire-and-forget,
    // doesn't block the app's response) means admin sees them pre-populated
    // and editable immediately, instead of needing a DB console the first time.
    if (!byKey.acko_session_cookie || !byKey.sarathi_state_id) {
      Promise.all([
        !byKey.acko_session_cookie
          ? prisma.app_settings.upsert({
              where: { setting_key: "acko_session_cookie" },
              create: { setting_key: "acko_session_cookie", setting_value: ackoCookie, updated_at: new Date() },
              update: {},
            })
          : null,
        !byKey.sarathi_state_id
          ? prisma.app_settings.upsert({
              where: { setting_key: "sarathi_state_id" },
              create: { setting_key: "sarathi_state_id", setting_value: sarathiStateId, updated_at: new Date() },
              update: {},
            })
          : null,
      ]).catch((err) => logger.error("driverGovVerificationController.getDynamicKycConfig seed failed:", err));
    }

    return res.status(200).json({
      status: true,
      ResponseCode: "200",
      data: { acko_session_cookie: ackoCookie, sarathi_state_id: sarathiStateId },
    });
  } catch (err) {
    logger.error("driverGovVerificationController.getDynamicKycConfig failed:", err);
    // Never block KYC on this lookup failing - hand back the same defaults
    // the app already ships with so verification still works.
    return res.status(200).json({
      status: true,
      ResponseCode: "200",
      data: { acko_session_cookie: DEFAULT_ACKO_SESSION_COOKIE, sarathi_state_id: DEFAULT_SARATHI_STATE_ID },
    });
  }
}

module.exports = { generateCaptcha, verifyDrivingLicence, verifyRc, verifyAadhar, getDynamicKycConfig };

const logger = require("../utils/logger");
const gstService = require("../services/gstService");

// Customer GST endpoints (spec 2026-11-15), mounted under /api/order/gst. Same trust model as the other customer order
// endpoints (the app sends its own uid); every read and write is scoped to that uid, so one customer's GST details are
// never returned to another uid. Verification calls a paid provider, so each customer is limited per hour.

const LIMIT_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map(); // uid -> timestamps of recent verify calls

function allowVerify(uid, now = Date.now()) {
  const recent = (attempts.get(uid) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= LIMIT_PER_HOUR) {
    attempts.set(uid, recent);
    return false;
  }
  recent.push(now);
  attempts.set(uid, recent);
  if (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
  return true;
}

const toUid = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
};
const fail = (res, status, message, extra = {}) => res.status(status).json({ ResponseCode: String(status), Result: "false", ResponseMsg: message, ...extra });

/** POST /gst/verify { uid, gstin }: verifies and, when valid, saves to this customer's profile. */
async function verify(req, res) {
  try {
    const uid = toUid(req.body?.uid);
    if (!uid) return fail(res, 400, "uid is required");
    if (!allowVerify(uid)) return fail(res, 429, "Too many GST checks. Please try again later.");
    const out = await gstService.verify(uid, req.body?.gstin);
    if (!out.ok) {
      // A bad number is a normal answer (200, valid:false) the app shows under the field; only a provider outage is a 503.
      return res.status(out.code === "UNAVAILABLE" ? 503 : 200).json({
        ResponseCode: out.code === "UNAVAILABLE" ? "503" : "200", Result: "false", valid: false, code: out.code, ResponseMsg: out.message,
      });
    }
    return res.status(200).json({ ResponseCode: "200", Result: "true", valid: true, saved: out.saved, details: out.details, ResponseMsg: "GSTIN verified" });
  } catch (err) {
    logger.error("gstController.verify failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

/** POST /gst/profile { uid }: this customer's saved GST details (null when none) for the booking screen to autofill. */
async function profile(req, res) {
  try {
    const uid = toUid(req.body?.uid);
    if (!uid) return fail(res, 400, "uid is required");
    const saved = await gstService.getProfile(uid);
    return res.status(200).json({ ResponseCode: "200", Result: "true", details: saved ? gstService.publicDetails(saved) : null });
  } catch (err) {
    logger.error("gstController.profile failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

/** POST /gst/remove { uid }: forgets this customer's saved GST details (past bookings keep theirs). */
async function remove(req, res) {
  try {
    const uid = toUid(req.body?.uid);
    if (!uid) return fail(res, 400, "uid is required");
    await gstService.removeProfile(uid);
    return res.status(200).json({ ResponseCode: "200", Result: "true", ResponseMsg: "GST details removed" });
  } catch (err) {
    logger.error("gstController.remove failed:", err);
    return fail(res, 500, "Internal server error");
  }
}

module.exports = { verify, profile, remove, allowVerify, LIMIT_PER_HOUR };

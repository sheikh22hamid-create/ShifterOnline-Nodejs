const prisma = require("../config/db");
const logger = require("../utils/logger");
const rules = require("./gstinRules");
const provider = require("./gstProvider");

// Customer GST details (spec 2026-11-15): verification, the customer's saved profile, the snapshot kept on a booking and the
// cache of provider answers. Raw SQL on three new tables (migration 20261115020000_add_customer_gst); a missing table only
// disables GST (every function degrades to "no GST details" and logs), it never breaks booking or the invoice.
//
// Privacy: a customer's saved GSTIN and details are only ever read by that customer's own uid. The cache holds public
// registry data keyed by GSTIN (no uid, nothing personal), so it can be shared without leaking whose it is.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const PUBLIC_FIELDS = ["gstin", "legal_name", "trade_name", "address", "state", "state_code", "pincode", "status"];
const publicDetails = (row) => ({
  gstin: row.gstin,
  legal_name: row.legal_name,
  trade_name: row.trade_name || "",
  address: row.address || "",
  state: row.state || "",
  state_code: row.state_code || "",
  pincode: row.pincode || "",
  status: row.gst_status ?? row.status ?? "",
});

const MESSAGES = {
  UNAVAILABLE: "We could not verify the GSTIN right now. You can still book without GST details.",
  INVALID: "This GSTIN could not be found. Please check the number.",
  INACTIVE: "This GSTIN is not active (its registration is cancelled or suspended).",
};

async function readCache(gstin, now = Date.now()) {
  try {
    const rows = await prisma.$queryRaw`SELECT * FROM gst_verification_cache WHERE gstin = ${gstin} LIMIT 1`;
    const row = rows[0];
    if (!row || now - new Date(row.verified_at).getTime() > CACHE_TTL_MS) return null;
    return publicDetails(row);
  } catch (err) {
    logger.error("gstService.readCache failed (migration not applied?):", err);
    return null;
  }
}

async function writeCache(details) {
  try {
    await prisma.$executeRaw`
      INSERT INTO gst_verification_cache (gstin, legal_name, trade_name, address, state, state_code, pincode, gst_status, verified_at)
      VALUES (${details.gstin}, ${details.legal_name}, ${details.trade_name || null}, ${details.address || null}, ${details.state || null},
              ${details.state_code || null}, ${details.pincode || null}, ${details.status || null}, ${new Date()})
      ON DUPLICATE KEY UPDATE legal_name = VALUES(legal_name), trade_name = VALUES(trade_name), address = VALUES(address),
        state = VALUES(state), state_code = VALUES(state_code), pincode = VALUES(pincode), gst_status = VALUES(gst_status), verified_at = VALUES(verified_at)`;
  } catch (err) {
    logger.error("gstService.writeCache failed:", err);
  }
}

async function getProfile(uid) {
  try {
    const rows = await prisma.$queryRaw`SELECT * FROM customer_gst_profile WHERE uid = ${Number(uid)} LIMIT 1`;
    return rows[0] ? { ...publicDetails(rows[0]), verified_at: rows[0].verified_at } : null;
  } catch (err) {
    logger.error(`gstService.getProfile failed for user ${uid} (migration not applied?):`, err);
    return null;
  }
}

async function saveProfile(uid, details) {
  const now = new Date();
  await prisma.$executeRaw`
    INSERT INTO customer_gst_profile (uid, gstin, legal_name, trade_name, address, state, state_code, pincode, gst_status, verified_at, created_at, updated_at)
    VALUES (${Number(uid)}, ${details.gstin}, ${details.legal_name}, ${details.trade_name || null}, ${details.address || null}, ${details.state || null},
            ${details.state_code || null}, ${details.pincode || null}, ${details.status || null}, ${now}, ${now}, ${now})
    ON DUPLICATE KEY UPDATE gstin = VALUES(gstin), legal_name = VALUES(legal_name), trade_name = VALUES(trade_name), address = VALUES(address),
      state = VALUES(state), state_code = VALUES(state_code), pincode = VALUES(pincode), gst_status = VALUES(gst_status),
      verified_at = VALUES(verified_at), updated_at = VALUES(updated_at)`;
}

async function removeProfile(uid) {
  try {
    await prisma.$executeRaw`DELETE FROM customer_gst_profile WHERE uid = ${Number(uid)}`;
    return true;
  } catch (err) {
    logger.error(`gstService.removeProfile failed for user ${uid}:`, err);
    return false;
  }
}

/**
 * Verifies a GSTIN for a customer and, when it is valid, saves it to THAT customer's profile.
 * Resolves { ok: true, details, source } or { ok: false, code: 'INVALID_FORMAT' | 'INVALID' | 'INACTIVE' | 'UNAVAILABLE', message }.
 * Details are only returned for a GSTIN the provider (or its fresh cache) confirmed: nothing is autofilled otherwise.
 */
async function verify(uid, input, { save = true } = {}) {
  const check = rules.validate(input);
  if (!check.ok) return { ok: false, code: "INVALID_FORMAT", message: check.message };
  const gstin = check.gstin;

  let details = await readCache(gstin);
  let source = "cache";
  if (!details) {
    const found = await provider.lookup(gstin);
    if (found.outcome === "unavailable") return { ok: false, code: "UNAVAILABLE", message: MESSAGES.UNAVAILABLE };
    if (found.outcome === "invalid") {
      return found.reason === "inactive"
        ? { ok: false, code: "INACTIVE", message: MESSAGES.INACTIVE }
        : { ok: false, code: "INVALID", message: MESSAGES.INVALID };
    }
    details = publicDetails({ ...found.details, gst_status: found.details.status });
    source = "provider";
    await writeCache({ ...details });
  }

  let saved = false;
  if (save) {
    try {
      await saveProfile(uid, details);
      saved = true;
    } catch (err) {
      logger.error(`gstService.verify: could not save the profile of user ${uid}:`, err);
    }
  }
  return { ok: true, details, source, saved };
}

/**
 * The verified details for a GSTIN typed at booking, from what is ALREADY stored (this customer's own profile, else a fresh
 * cache entry); no provider call, so booking is never slowed. null when it was never verified: the booking then simply
 * has no GST details.
 */
async function resolveStored(uid, input) {
  const check = rules.validate(input);
  if (!check.ok) return null;
  const profile = await getProfile(uid);
  if (profile && profile.gstin === check.gstin) return publicDetails(profile);
  return readCache(check.gstin);
}

async function attachToOrder(orderId, uid, details) {
  try {
    const now = new Date();
    await prisma.$executeRaw`
      INSERT INTO order_gst_detail (order_id, uid, gstin, legal_name, trade_name, address, state, state_code, pincode, verified_at, created_at)
      VALUES (${Number(orderId)}, ${Number(uid)}, ${details.gstin}, ${details.legal_name}, ${details.trade_name || null}, ${details.address || null},
              ${details.state || null}, ${details.state_code || null}, ${details.pincode || null}, ${now}, ${now})
      ON DUPLICATE KEY UPDATE order_id = order_id`; // a booking's GST snapshot is written once and never changed
    return true;
  } catch (err) {
    logger.error(`gstService.attachToOrder failed for order ${orderId}:`, err);
    return false;
  }
}

/** The GST details snapshotted on a booking, or null (no GSTIN given, or the table is not there yet). */
async function getOrderGst(orderId) {
  try {
    const rows = await prisma.$queryRaw`SELECT * FROM order_gst_detail WHERE order_id = ${Number(orderId)} LIMIT 1`;
    return rows[0] ? publicDetails(rows[0]) : null;
  } catch (err) {
    logger.error(`gstService.getOrderGst failed for order ${orderId} (migration not applied?):`, err);
    return null;
  }
}

module.exports = { verify, resolveStored, getProfile, saveProfile, removeProfile, attachToOrder, getOrderGst, publicDetails, PUBLIC_FIELDS, MESSAGES };

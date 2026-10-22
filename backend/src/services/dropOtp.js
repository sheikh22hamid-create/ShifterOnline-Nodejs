const crypto = require("crypto");
const prisma = require("../config/db");
const logger = require("../utils/logger");

// Drop OTP (spec 2026-10-16, moved 2026-10-22): the driver must enter the drop OTP to complete the trip.
// Arrival at the drop and the unloading/waiting timer are unaffected.
// Stored in app_settings like tieredDispatchSettings, default OFF.
const KEY = "drop_otp_enabled";
const TTL_MS = 5000;
let cache = null; // { at, value }

const toBool = (v) => ["1", "true", "on", "yes"].includes(String(v ?? "").trim().toLowerCase());

async function isEnabled({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  try {
    const row = await prisma.app_settings.findFirst({ where: { setting_key: KEY } });
    const value = toBool(row?.setting_value);
    cache = { at: Date.now(), value };
    return value;
  } catch (err) {
    // Fail closed: an unreadable switch must never put a new OTP step in front of a driver.
    logger.error("dropOtp.isEnabled: failed to read setting, treating drop OTP as disabled:", err);
    return false;
  }
}

/** A fresh 4-digit OTP when the feature is ON, otherwise null (the order never asks for a drop OTP). */
async function generateForNewOrder() {
  return (await isEnabled()) ? crypto.randomInt(1000, 10000) : null;
}

/**
 * The OTP gate applies only to an order that was given a drop OTP at creation AND while the switch is ON.
 * Turning the switch OFF is therefore an escape hatch that releases any order stuck at the drop.
 */
async function isRequired(order) {
  return order?.drop_otp != null && (await isEnabled());
}

const matches = (order, otp) =>
  otp !== undefined && otp !== null && order?.drop_otp != null && String(otp).trim() === String(order.drop_otp).trim();

// A 4-digit OTP must not be guessable by a script: after MAX_WRONG_ATTEMPTS wrong tries on an order, further
// attempts are refused for LOCK_MS (a cool-down, not a permanent lock, so an honest typo can't strand a driver).
// Kept in memory per process: it slows brute force without a schema change; the correct OTP clears the counter.
const MAX_WRONG_ATTEMPTS = 5;
const LOCK_MS = 10 * 60 * 1000;
const attempts = new Map(); // orderId -> { wrong, lockedUntil }

function lockRemainingMs(orderId) {
  const entry = attempts.get(orderId);
  if (!entry || !entry.lockedUntil) return 0;
  const left = entry.lockedUntil - Date.now();
  if (left <= 0) { attempts.delete(orderId); return 0; }
  return left;
}

function recordWrongAttempt(orderId) {
  const entry = attempts.get(orderId) || { wrong: 0, lockedUntil: 0 };
  entry.wrong += 1;
  if (entry.wrong >= MAX_WRONG_ATTEMPTS) { entry.lockedUntil = Date.now() + LOCK_MS; entry.wrong = 0; }
  attempts.set(orderId, entry);
}

function resetAttempts(orderId) {
  if (orderId !== undefined) attempts.delete(orderId); else attempts.clear();
}

/**
 * Completion gate. Returns null when the trip may complete, otherwise the refusal to send the driver app:
 * { msg, drop_otp_required: true, drop_otp_invalid } - the app opens (or re-opens) its OTP entry on it.
 */
async function completionRefusal(order, otp) {
  if (!(await isRequired(order))) return null;
  const left = lockRemainingMs(order.id);
  if (left > 0) {
    const minutes = Math.ceil(left / 60000);
    return {
      msg: `Too many wrong OTP attempts. Try again in ${minutes} min, or contact support.`,
      drop_otp_required: true, drop_otp_invalid: true, drop_otp_locked: true, retry_after_seconds: Math.ceil(left / 1000),
    };
  }
  const given = otp === undefined || otp === null ? "" : String(otp).trim();
  if (given === "") return { msg: "Enter the drop OTP to complete the delivery", drop_otp_required: true, drop_otp_invalid: false };
  if (!matches(order, given)) {
    recordWrongAttempt(order.id);
    return { msg: "Invalid drop OTP", drop_otp_required: true, drop_otp_invalid: true };
  }
  resetAttempts(order.id);
  return null;
}

module.exports = { isEnabled, generateForNewOrder, isRequired, matches, completionRefusal, resetAttempts, MAX_WRONG_ATTEMPTS, LOCK_MS, KEY };

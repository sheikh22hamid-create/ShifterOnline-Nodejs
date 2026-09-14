const express = require("express");
const router = express.Router();
const whatsappClient = require("../whatsapp/client");
const notifications = require("../whatsapp/notifications");
const customerHandler = require("../whatsapp/handlers/customerHandler");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const rateLimiter = require("../middleware/rateLimiter");
const logger = require("../utils/logger");

// Helper to validate and normalize phone numbers (10 to 15 numeric digits)
function validatePhoneNumber(phone) {
  if (!phone) return null;
  const clean = String(phone).replace(/\D/g, "");
  if (clean.length < 10 || clean.length > 15) return null;
  return clean;
}

/**
 * GET /api/v1/whatsapp/status
 * Returns connection status, connected phone number, and QR/Pairing codes.
 * Requires Authentication + Super Admin Role.
 */
router.get("/status", auth, authorize("superadmin"), (req, res) => {
  try {
    const statusData = whatsappClient.getBotStatus();
    return res.json({
      Result: true,
      success: true,
      data: statusData,
    });
  } catch (err) {
    logger.error("Error fetching WhatsApp bot status:", err);
    return res.status(500).json({ Result: false, success: false, msg: "Failed to fetch WhatsApp bot status" });
  }
});

/**
 * POST /api/v1/whatsapp/request-pairing-code
 * Requests an 8-digit Phone Pairing Code for WhatsApp authentication.
 * Requires Authentication + Super Admin Role.
 */
router.post(
  "/request-pairing-code",
  auth,
  authorize("superadmin"),
  rateLimiter({ windowMs: 60 * 1000, max: 10, message: "Too many pairing code requests. Please wait a minute." }),
  async (req, res) => {
    try {
      const { phone } = req.body;
      const cleanPhone = validatePhoneNumber(phone);

      if (!cleanPhone) {
        return res.status(400).json({
          Result: false,
          success: false,
          msg: "Valid phone number with country code is required (10-15 digits, e.g. 919876543210)",
        });
      }

      logger.info(`[AUDIT] WhatsApp pairing code requested by user ${req.user.username} (${req.user.id}, role: ${req.user.role}) for phone: ${cleanPhone}`);

      const code = await whatsappClient.requestPairingCodeForPhone(cleanPhone);

      return res.json({
        Result: true,
        success: true,
        pairingCode: code,
        msg: `Pairing code generated! Enter code on phone: ${code}`,
      });
    } catch (err) {
      logger.error("Error requesting WhatsApp pairing code:", err);
      return res.status(500).json({ Result: false, success: false, msg: err.message || "Failed to request pairing code" });
    }
  }
);

/**
 * POST /api/v1/whatsapp/send-notification
 * Outbound WhatsApp alert trigger.
 * Requires Authentication + Super Admin / City Admin Role.
 */
router.post(
  "/send-notification",
  auth,
  authorize("superadmin", "admin"),
  rateLimiter({ windowMs: 60 * 1000, max: 30, message: "Notification rate limit reached. Please try again in a minute." }),
  async (req, res) => {
    try {
      const { phone, message } = req.body;
      const cleanPhone = validatePhoneNumber(phone);
      const cleanMessage = typeof message === "string" ? message.trim() : "";

      if (!cleanPhone) {
        return res.status(400).json({ Result: false, success: false, msg: "Valid phone number is required (10-15 digits)" });
      }

      if (!cleanMessage || cleanMessage.length > 2000) {
        return res.status(400).json({ Result: false, success: false, msg: "Valid non-empty message text (max 2000 chars) is required" });
      }

      logger.info(`[AUDIT] Outbound WhatsApp notification triggered by user ${req.user.username} (${req.user.id}) to phone: ${cleanPhone}`);

      const sentSuccess = await notifications.sendWhatsAppNotification(cleanPhone, cleanMessage);

      if (sentSuccess) {
        return res.json({ Result: true, success: true, msg: "Message sent successfully" });
      } else {
        return res.status(500).json({ Result: false, success: false, msg: "Failed to send WhatsApp message. Bot may be disconnected." });
      }
    } catch (err) {
      logger.error("Error sending manual WhatsApp notification:", err);
      return res.status(500).json({ Result: false, success: false, msg: err.message || "Failed to send message" });
    }
  }
);

/**
 * POST /api/v1/whatsapp/switch-account
 * Safely terminates existing WhatsApp session and initiates pairing/QR for a new account.
 * Requires Authentication + Super Admin Role.
 */
router.post(
  "/switch-account",
  auth,
  authorize("superadmin"),
  rateLimiter({ windowMs: 60 * 1000, max: 5, message: "Account switch rate limit reached. Please try again shortly." }),
  async (req, res) => {
    try {
      const { phone } = req.body;
      let cleanPhone = null;
      if (phone) {
        cleanPhone = validatePhoneNumber(phone);
        if (!cleanPhone) {
          return res.status(400).json({
            Result: false,
            success: false,
            msg: "Provided phone number is invalid (must be 10-15 digits with country code)",
          });
        }
      }

      logger.info(`[AUDIT] WhatsApp account switch initiated by Super Admin user ${req.user.username} (${req.user.id})${cleanPhone ? ` for target phone: ${cleanPhone}` : ""}`);

      const result = await whatsappClient.switchWhatsAppAccount(cleanPhone);

      return res.json({
        Result: true,
        success: true,
        msg: "WhatsApp account switch initiated successfully. Previous session terminated and cleaned up.",
        data: result,
      });
    } catch (err) {
      logger.error("Error switching WhatsApp account:", err);
      return res.status(500).json({ Result: false, success: false, msg: err.message || "Failed to switch WhatsApp account" });
    }
  }
);

/**
 * POST /api/v1/whatsapp/logout
 * Terminate current WhatsApp session, clear auth state, and set status to DISCONNECTED.
 * Requires Authentication + Super Admin Role.
 */
router.post("/logout", auth, authorize("superadmin"), async (req, res) => {
  try {
    logger.info(`[AUDIT] WhatsApp account logout initiated by Super Admin user ${req.user.username} (${req.user.id})`);

    await whatsappClient.logoutWhatsAppBot();

    return res.json({
      Result: true,
      success: true,
      msg: "WhatsApp account logged out successfully. Session invalidated.",
    });
  } catch (err) {
    logger.error("Error logging out WhatsApp account:", err);
    return res.status(500).json({ Result: false, success: false, msg: err.message || "Failed to logout WhatsApp account" });
  }
});

/**
 * POST /api/v1/whatsapp/calculate-fare
 * Instant fare estimate REST helper.
 * Publicly accessible with rate limiting and input validation for frontend widgets and external calls.
 */
router.post(
  "/calculate-fare",
  rateLimiter({ windowMs: 60 * 1000, max: 60, message: "Too many fare calculation requests. Please try again shortly." }),
  async (req, res) => {
    try {
      const { phone, pickup, drop, vehicle } = req.body;

      if (!pickup || !drop) {
        return res.status(400).json({ Result: false, success: false, msg: "pickup and drop addresses are required" });
      }

      const cleanPhone = validatePhoneNumber(phone) || "9999999999";
      const result = await customerHandler.handleFareCalculation(cleanPhone, { pickup, drop, vehicle }, {});

      return res.json({ Result: true, success: true, replyText: result });
    } catch (err) {
      logger.error("Error calculating fare via REST helper:", err);
      return res.status(500).json({ Result: false, success: false, msg: err.message || "Failed to calculate fare" });
    }
  }
);

module.exports = router;

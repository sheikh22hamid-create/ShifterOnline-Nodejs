const express = require("express");
const router = express.Router();
const whatsappClient = require("../whatsapp/client");
const notifications = require("../whatsapp/notifications");
const customerHandler = require("../whatsapp/handlers/customerHandler");

/**
 * GET /api/v1/whatsapp/status
 * Returns connection status and QR code if waiting scan
 */
router.get("/status", (req, res) => {
  const status = whatsappClient.getBotStatus();
  return res.json({
    Result: true,
    data: status,
  });
});

/**
 * POST /api/v1/whatsapp/send-notification
 * Manual outbound WhatsApp alert trigger
 */
router.post("/send-notification", async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ Result: false, msg: "phone and message are required" });
    }

    const success = await notifications.sendWhatsAppNotification(phone, message);
    return res.json({ Result: success, msg: success ? "Message sent" : "Failed to send message" });
  } catch (err) {
    return res.status(500).json({ Result: false, msg: err.message });
  }
});

/**
 * POST /api/v1/whatsapp/calculate-fare
 * WhatsApp instant fare estimate REST helper
 */
router.post("/calculate-fare", async (req, res) => {
  try {
    const { phone, pickup, drop, vehicle } = req.body;
    const result = await customerHandler.handleFareCalculation(phone || "9999999999", { pickup, drop, vehicle }, {});
    return res.json({ Result: true, replyText: result });
  } catch (err) {
    return res.status(500).json({ Result: false, msg: err.message });
  }
});

/**
 * POST /api/v1/whatsapp/request-pairing-code
 * Requests an 8-digit Phone Pairing Code for WhatsApp authentication
 */
router.post("/request-pairing-code", async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ Result: false, msg: "phone number with country code is required (e.g. 919876543210)" });
    }

    const code = await whatsappClient.requestPairingCodeForPhone(phone);
    return res.json({ Result: true, pairingCode: code, msg: `Pairing code generated! Enter code on phone: ${code}` });
  } catch (err) {
    return res.status(500).json({ Result: false, msg: err.message });
  }
});

module.exports = router;

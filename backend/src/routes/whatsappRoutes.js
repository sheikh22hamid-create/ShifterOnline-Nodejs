const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const whatsappClient = require("../whatsapp/client");
const notifications = require("../whatsapp/notifications");
const customerHandler = require("../whatsapp/handlers/customerHandler");
const trialDriverCloudFlow = require("../whatsapp/trialDriverCloudFlow");
const { WHATSAPP_TEMPLATES } = require("../whatsapp/templates");
const templateService = require("../services/whatsappTemplateService");
const chatService = require("../services/whatsappChatService");
const prisma = require("../config/db");
const { uploadBuffer, urlForRelativePath } = require("../utils/cloudinaryStorage");
const auth = require("../middleware/auth");
const authorize = require("../middleware/authorize");
const rateLimiter = require("../middleware/rateLimiter");
const logger = require("../utils/logger");

// Helper to validate and normalize phone numbers (10 to 15 numeric digits)
function validatePhoneNumber(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/\D/g, "");
  if (clean.length === 10) {
    clean = `91${clean}`;
  }
  if (clean.length < 10 || clean.length > 15) return null;
  return clean;
}

/**
 * GET /api/v1/whatsapp/status
 * Returns connection status and connected phone number.
 * Pairing/QR codes are only returned to Super Admin.
 * Requires Authentication + Super Admin / Admin / Executive.
 */
router.get("/status", auth, authorize("superadmin", "admin", "executive"), (req, res) => {
  try {
    const statusData = whatsappClient.getBotStatus();
    const isSuperAdmin = req.user && req.user.role === "superadmin";

    // For non-superadmin (admin, executive), omit sensitive pairing & QR credentials
    const data = isSuperAdmin
      ? statusData
      : {
          status: statusData.status,
          connectedPhone: statusData.connectedPhone,
        };

    return res.json({
      Result: true,
      success: true,
      data,
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
 * POST /api/v1/whatsapp/request-qr
 * Generates/refreshes a live QR code for WhatsApp scanning.
 * Requires Authentication + Super Admin Role.
 */
router.post(
  "/request-qr",
  auth,
  authorize("superadmin"),
  rateLimiter({ windowMs: 60 * 1000, max: 10, message: "Too many QR requests. Please wait a minute." }),
  async (req, res) => {
    try {
      logger.info(`[AUDIT] WhatsApp QR code request initiated by user ${req.user.username} (${req.user.id})`);
      const result = await whatsappClient.switchWhatsAppAccount(null);
      return res.json({
        Result: true,
        success: true,
        msg: "Fresh WhatsApp QR code generation initiated",
        data: result,
      });
    } catch (err) {
      logger.error("Error requesting WhatsApp QR code:", err);
      return res.status(500).json({ Result: false, success: false, msg: err.message || "Failed to generate QR code" });
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
 * GET /api/v1/whatsapp/templates
 * Returns pre-built marketing, onboarding, and reminder WhatsApp templates,
 * merged with any permanently saved customizations from the database.
 * Requires Authentication + Super Admin / Admin / Executive.
 */
router.get("/templates", auth, authorize("superadmin", "admin", "executive"), async (req, res) => {
  try {
    const data = await templateService.getAllTemplates();
    return res.json({
      Result: true,
      success: true,
      data,
    });
  } catch (err) {
    logger.error("Error fetching WhatsApp templates:", err);
    return res.status(500).json({ Result: false, success: false, msg: "Failed to fetch WhatsApp templates" });
  }
});

/**
 * PUT /api/v1/whatsapp/templates/:id
 * Permanently saves customized message text and optional media attachment for a template in the database.
 * Requires Authentication + Super Admin / Admin.
 */
router.put("/templates/:id", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { message, media_url, media_type, media_filename } = req.body;

    const updated = await templateService.saveTemplate(
      id,
      { message, media_url, media_type, media_filename },
      req.user
    );

    return res.json({
      Result: true,
      success: true,
      msg: "Template saved permanently",
      data: updated,
    });
  } catch (err) {
    logger.error(`Error saving WhatsApp template ${req.params?.id}:`, err);
    return res.status(400).json({ Result: false, success: false, msg: err.message || "Failed to save template" });
  }
});

/**
 * POST /api/v1/whatsapp/templates/:id/reset
 * Resets a template's content back to the factory pre-made default in the database.
 * Requires Authentication + Super Admin / Admin.
 */
router.post("/templates/:id/reset", auth, authorize("superadmin", "admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const reset = await templateService.resetTemplate(id);

    return res.json({
      Result: true,
      success: true,
      msg: "Template reset to original default",
      data: reset,
    });
  } catch (err) {
    logger.error(`Error resetting WhatsApp template ${req.params?.id}:`, err);
    return res.status(400).json({ Result: false, success: false, msg: err.message || "Failed to reset template" });
  }
});

/**
 * Supported media formats for WhatsApp Broadcast
 */
const ALLOWED_MEDIA_EXT = [".jpg", ".jpeg", ".png", ".webp", ".mp4", ".3gp", ".mov"];
const broadcastMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 16 * 1024 * 1024 }, // 16 MB max
}).single("media");

/**
 * POST /api/v1/whatsapp/upload-media
 * Uploads an image or video for broadcast attachment or permanent template attachment.
 * Supports JPG, PNG, WEBP (up to 10MB) and MP4, 3GP, MOV (up to 16MB).
 * Requires Authentication + Super Admin / Admin / Executive.
 */
router.post(
  "/upload-media",
  auth,
  authorize("superadmin", "admin", "executive"),
  (req, res) => {
    broadcastMediaUpload(req, res, async (err) => {
      if (err) {
        logger.error("WhatsApp media upload multer error:", err);
        return res.status(400).json({ Result: false, success: false, msg: err.message || "Media upload error" });
      }
      if (!req.file) {
        return res.status(400).json({ Result: false, success: false, msg: "No media file provided (field name must be 'media')" });
      }

      const ext = path.extname(req.file.originalname || "").toLowerCase();
      if (!ALLOWED_MEDIA_EXT.includes(ext)) {
        return res.status(400).json({
          Result: false,
          success: false,
          msg: `Unsupported format '${ext}'. Allowed: Images (JPG, PNG, WEBP) up to 10MB, Videos (MP4, 3GP, MOV) up to 16MB.`,
        });
      }

      const isVideo = [".mp4", ".3gp", ".mov"].includes(ext);
      const mediaType = isVideo ? "video" : "image";

      if (!isVideo && req.file.size > 10 * 1024 * 1024) {
        return res.status(400).json({ Result: false, success: false, msg: "Image file exceeds 10 MB limit." });
      }

      try {
        const subfolder = isVideo ? "videos/broadcast" : "images/broadcast";
        const filename = `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`;
        const relativePath = await uploadBuffer(req.file.buffer, `${subfolder}/${filename}`);

        let deliveryUrl = urlForRelativePath(relativePath);
        if (!deliveryUrl) {
          const base = process.env.PUBLIC_BASE_URL || "http://localhost:5002";
          deliveryUrl = `${base.replace(/\/$/, "")}/${relativePath.replace(/^\//, "")}`;
        }

        return res.json({
          Result: true,
          success: true,
          msg: "Media uploaded successfully",
          data: {
            url: deliveryUrl,
            relativePath,
            mediaType,
            originalName: req.file.originalname,
            size: req.file.size,
          },
        });
      } catch (uploadErr) {
        logger.error("WhatsApp uploadMedia failed:", uploadErr);
        return res.status(500).json({ Result: false, success: false, msg: uploadErr.message || "Failed to upload media" });
      }
    });
  }
);

/**
 * POST /api/v1/whatsapp/send-broadcast
 * Send single or bulk WhatsApp outreach messages with optional media attachments and anti-ban pacing delays.
 * Requires Authentication + Super Admin / Admin / Executive.
 */
router.post(
  "/send-broadcast",
  auth,
  authorize("superadmin", "admin", "executive"),
  rateLimiter({ windowMs: 60 * 1000, max: 15, message: "Broadcast rate limit reached. Please wait a minute." }),
  async (req, res) => {
    try {
      const { recipients, message, campaignName, mediaUrl, mediaType } = req.body;

      const cleanMessage = typeof message === "string" ? message.trim() : "";
      if (!cleanMessage && !mediaUrl) {
        return res.status(400).json({ Result: false, success: false, msg: "Message text or media attachment is required" });
      }

      if (cleanMessage.length > 2000) {
        return res.status(400).json({ Result: false, success: false, msg: "Message exceeds maximum 2000 characters" });
      }

      if (mediaUrl && !["image", "video"].includes(mediaType)) {
        return res.status(400).json({ Result: false, success: false, msg: "mediaType must be 'image' or 'video' when mediaUrl is attached" });
      }

      // Parse and normalize phone list
      let rawList = [];
      if (Array.isArray(recipients)) {
        rawList = recipients;
      } else if (typeof recipients === "string") {
        rawList = recipients.split(/[\n,;]+/);
      } else {
        return res.status(400).json({ Result: false, success: false, msg: "Recipients must be an array or comma-separated list of phone numbers" });
      }

      const normalizedMap = new Map();
      for (const item of rawList) {
        const cleaned = validatePhoneNumber(item);
        if (cleaned) {
          normalizedMap.set(cleaned, true);
        }
      }

      const uniqueNumbers = Array.from(normalizedMap.keys());
      if (uniqueNumbers.length === 0) {
        return res.status(400).json({ Result: false, success: false, msg: "No valid 10-15 digit phone numbers provided" });
      }

      if (uniqueNumbers.length > 100) {
        return res.status(400).json({ Result: false, success: false, msg: "Batch limit exceeded (maximum 100 phone numbers allowed per broadcast)" });
      }

      // Check bot connectivity
      const botStatus = whatsappClient.getBotStatus();
      if (botStatus?.status !== "CONNECTED") {
        return res.status(503).json({
          Result: false,
          success: false,
          msg: `WhatsApp bot is currently ${botStatus?.status || "DISCONNECTED"}. Please connect your WhatsApp account in WhatsApp Account settings first.`,
        });
      }

      logger.info(
        `[AUDIT] WhatsApp broadcast started by ${req.user.username} (${req.user.id}, role: ${req.user.role}). Total: ${uniqueNumbers.length} recipients. Campaign: ${campaignName || "General"}. Media: ${mediaType || "none"}`
      );

      const results = [];
      let sentCount = 0;
      let failedCount = 0;

      for (let i = 0; i < uniqueNumbers.length; i++) {
        const phone = uniqueNumbers[i];
        try {
          const sent = await notifications.sendWhatsAppNotification(phone, cleanMessage, { mediaUrl, mediaType });
          if (sent) {
            sentCount++;
            results.push({ phone, status: "sent" });
          } else {
            failedCount++;
            results.push({ phone, status: "failed", reason: "Delivery failed" });
          }
        } catch (err) {
          failedCount++;
          results.push({ phone, status: "failed", reason: err.message || "Send error" });
        }

        // Anti-ban pacing delay: sleep 1.2s between messages if there are multiple
        if (i < uniqueNumbers.length - 1) {
          await new Promise((r) => setTimeout(r, 1200));
        }
      }

      return res.json({
        Result: true,
        success: true,
        msg: `Broadcast finished: ${sentCount} sent, ${failedCount} failed out of ${uniqueNumbers.length}`,
        total: uniqueNumbers.length,
        sent: sentCount,
        failed: failedCount,
        results,
      });
    } catch (err) {
      logger.error("Error executing WhatsApp broadcast:", err);
      return res.status(500).json({ Result: false, success: false, msg: err.message || "Failed to execute WhatsApp broadcast" });
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

/**
 * GET /api/v1/whatsapp/webhook
 * Meta WhatsApp Cloud API Webhook verification challenge.
 */
router.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const expectedToken = process.env.WHATSAPP_CLOUD_VERIFY_TOKEN || "shifter_trial_wa_2026";

  if (mode === "subscribe" && token === expectedToken) {
    logger.info("WhatsApp Cloud API webhook verified successfully");
    return res.status(200).send(challenge);
  }

  logger.warn(`WhatsApp webhook verification failed. Token mismatch: received=${token}, expected=${expectedToken}`);
  return res.sendStatus(403);
});

/**
 * POST /api/v1/whatsapp/webhook
 * Receives incoming messages, delivery receipts, and interactive button clicks from WhatsApp Cloud API.
 */
router.post("/webhook", (req, res) => {
  try {
    const body = req.body;
    logger.info(`WhatsApp Cloud webhook received: ${JSON.stringify(body)}`);

    // Acknowledge Meta immediately with 200 OK to prevent retries
    res.status(200).send("EVENT_RECEIVED");

    // 1. Record in Live Chat Inbox & update threads
    chatService.processWebhookPayload(body).catch((err) => {
      logger.error("Error processing WhatsApp webhook in chatService:", err);
    });

    // 2. Process trial driver flow asynchronously
    trialDriverCloudFlow.handleIncomingMessage(body).catch((err) => {
      logger.error("Error handling WhatsApp incoming message in trial flow:", err);
    });
  } catch (err) {
    logger.error("Error processing WhatsApp webhook payload:", err);
    return res.sendStatus(500);
  }
});

/**
 * GET /api/v1/whatsapp/chat/threads
 * List conversation threads with 24-hr session window state and unread count.
 */
router.get("/chat/threads", auth, authorize("superadmin", "admin", "executive"), async (req, res) => {
  try {
    const { search, type, limit, offset } = req.query;
    const threads = await chatService.getThreads({ search, type, limit, offset });
    return res.json({ success: true, Result: true, data: threads });
  } catch (err) {
    logger.error("GET /chat/threads failed:", err);
    return res.status(500).json({ success: false, message: "Failed to load chat threads" });
  }
});

/**
 * GET /api/v1/whatsapp/chat/threads/:phone/messages
 * Get conversation message history for a phone number.
 */
router.get("/chat/threads/:phone/messages", auth, authorize("superadmin", "admin", "executive"), async (req, res) => {
  try {
    const phone = req.params.phone;
    const { limit, offset } = req.query;
    const result = await chatService.getMessagesByPhone(phone, { limit, offset });
    return res.json({ success: true, Result: true, data: result });
  } catch (err) {
    logger.error(`GET /chat/threads/${req.params.phone}/messages failed:`, err);
    return res.status(500).json({ success: false, message: "Failed to load messages" });
  }
});

/**
 * POST /api/v1/whatsapp/chat/send
 * Admin sends a message (free-text within 24h, or template message).
 */
router.post("/chat/send", auth, authorize("superadmin", "admin", "executive"), async (req, res) => {
  try {
    const { phone, text, mediaUrl, mediaType, isTemplate, templateName, components } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: "phone is required" });
    }

    const message = await chatService.sendAdminMessage({
      phone,
      text,
      mediaUrl,
      mediaType,
      isTemplate: Boolean(isTemplate),
      templateName,
      components,
      adminUser: req.user,
    });

    return res.json({ success: true, Result: true, data: message });
  } catch (err) {
    logger.error("POST /chat/send failed:", err);
    return res.status(400).json({ success: false, message: err.message || "Failed to send message" });
  }
});

/**
 * GET /api/v1/whatsapp/chat/audience
 * Returns categorized audience lists (Customers, All Drivers, Incomplete, Complete, Trial)
 * with counts, city filter scoping, and search capability for multi-send.
 */
router.get("/chat/audience", auth, authorize("superadmin", "admin", "executive"), async (req, res) => {
  try {
    const type = req.query.type || "all"; // "customers" | "drivers" | "all"
    const subType = req.query.sub_type || "all"; // for drivers: "all" | "incomplete" | "complete" | "trial"
    const search = (req.query.search || "").trim().toLowerCase();

    const isSuperAdmin = req.user && req.user.role === "superadmin";
    const cityId = !isSuperAdmin && req.user?.city_id ? parseInt(req.user.city_id, 10) : null;

    let customers = [];
    let drivers = [];

    // 1. Fetch Customers if needed
    if (type === "all" || type === "customers") {
      const userWhere = {};
      if (cityId) userWhere.city_id = cityId;

      const userRows = await prisma.tbl_user.findMany({
        where: userWhere,
        select: {
          id: true,
          name: true,
          mobile: true,
          city_id: true,
          status: true,
        },
        orderBy: { id: "desc" },
        take: 500,
      });

      customers = userRows
        .map((u) => {
          let phone = String(u.mobile || "").replace(/\D/g, "");
          if (phone.length === 10) phone = `91${phone}`;
          return {
            id: `cust_${u.id}`,
            original_id: u.id,
            name: u.name || "Customer",
            phone,
            city_id: u.city_id,
            city_name: "",
            type: "customer",
            status: "customer",
            status_label: "Customer",
            details: `Customer #${u.id}`,
          };
        })
        .filter((u) => u.phone && u.phone.length >= 10);
    }

    // 2. Fetch Drivers if needed
    if (type === "all" || type === "drivers") {
      const riderWhere = {};
      if (cityId) riderWhere.city_id = cityId;

      const [riderRows, leadRows, cities] = await Promise.all([
        prisma.tbl_rider.findMany({
          where: riderWhere,
          select: {
            id: true,
            full_name: true,
            first_name: true,
            last_name: true,
            fmobile: true,
            city_id: true,
            vehicle: true,
            vehicle_no: true,
            status: true,
            a_status: true,
            verification_status: true,
            trial_status: true,
          },
          orderBy: { id: "desc" },
          take: 600,
        }),
        // Also fetch incomplete registration leads
        subType === "all" || subType === "incomplete"
          ? prisma.tbl_registration_lead.findMany({
              where: { status: { in: ["pending", "contacted"] } },
              orderBy: { id: "desc" },
              take: 300,
            })
          : Promise.resolve([]),
        prisma.tbl_city.findMany({ select: { id: true, title: true } }),
      ]);

      const cityNameMap = Object.fromEntries(cities.map((c) => [c.id, c.title]));

      // Attach city names to customers
      for (const cust of customers) {
        if (cust.city_id && cityNameMap[cust.city_id]) {
          cust.city_name = cityNameMap[cust.city_id];
          cust.details = `${cityNameMap[cust.city_id]} • Customer #${cust.original_id}`;
        }
      }

      const seenPhones = new Set();

      for (const r of riderRows) {
        let phone = String(r.fmobile || "").replace(/\D/g, "");
        if (phone.length === 10) phone = `91${phone}`;
        if (!phone || phone.length < 10) continue;
        seenPhones.add(phone);

        const isTrial = r.trial_status && r.trial_status !== "none";
        const isComplete = r.a_status === 1 && r.verification_status === "approved";
        const isIncomplete = !isComplete && !isTrial;

        let statusCategory = "complete";
        let statusLabel = "Approved Driver";
        if (isTrial) {
          statusCategory = "trial";
          statusLabel = `Trial (${r.trial_status})`;
        } else if (isIncomplete) {
          statusCategory = "incomplete";
          statusLabel = "Incomplete Registration";
        }

        const name = r.full_name || `${r.first_name || ""} ${r.last_name || ""}`.trim() || `Driver #${r.id}`;
        const cityName = cityNameMap[r.city_id] || "";
        const details = [cityName, r.vehicle, r.vehicle_no].filter(Boolean).join(" • ");

        drivers.push({
          id: `driver_${r.id}`,
          original_id: r.id,
          name,
          phone,
          city_id: r.city_id,
          city_name: cityName,
          type: "driver",
          status: statusCategory, // "incomplete" | "complete" | "trial"
          status_label: statusLabel,
          details,
        });
      }

      // Append leads if not already registered
      for (const lead of leadRows) {
        let phone = String(lead.phone || "").replace(/\D/g, "");
        if (phone.length === 10) phone = `91${phone}`;
        if (!phone || phone.length < 10 || seenPhones.has(phone)) continue;
        seenPhones.add(phone);

        drivers.push({
          id: `lead_${lead.id}`,
          original_id: lead.id,
          name: "Driver Lead (Incomplete)",
          phone,
          city_id: null,
          city_name: "",
          type: "driver",
          status: "incomplete",
          status_label: "Incomplete Lead",
          details: `OTP Verified Lead #${lead.id}`,
        });
      }
    }

    // Counts across categories
    const counts = {
      customers: customers.length,
      drivers_all: drivers.length,
      drivers_incomplete: drivers.filter((d) => d.status === "incomplete").length,
      drivers_complete: drivers.filter((d) => d.status === "complete").length,
      drivers_trial: drivers.filter((d) => d.status === "trial").length,
    };

    // Filter by type & subType
    let resultList = [];
    if (type === "customers") {
      resultList = customers;
    } else if (type === "drivers") {
      if (subType === "all") {
        resultList = drivers;
      } else {
        resultList = drivers.filter((d) => d.status === subType);
      }
    } else {
      resultList = [...customers, ...drivers];
    }

    // Filter by search query if provided
    if (search) {
      resultList = resultList.filter(
        (item) =>
          item.name.toLowerCase().includes(search) ||
          item.phone.includes(search) ||
          (item.city_name && item.city_name.toLowerCase().includes(search)) ||
          (item.details && item.details.toLowerCase().includes(search))
      );
    }

    return res.json({
      success: true,
      Result: true,
      counts,
      total: resultList.length,
      data: resultList,
    });
  } catch (err) {
    logger.error("GET /chat/audience failed:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to fetch audience" });
  }
});

/**
 * POST /api/v1/whatsapp/chat/send-bulk
 * Sends message/template to multiple selected recipients in one click with pacing.
 */
router.post("/chat/send-bulk", auth, authorize("superadmin", "admin", "executive"), async (req, res) => {
  try {
    const {
      recipients,
      text,
      mediaUrl,
      mediaType,
      isTemplate,
      templateName,
      templateLanguage = "en_US",
      components = [],
    } = req.body;

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, message: "recipients must be a non-empty array" });
    }

    if (!text && !mediaUrl && !templateName) {
      return res.status(400).json({ success: false, message: "Message text, media attachment, or template is required" });
    }

    // Deduplicate recipients by phone
    const cleanRecipients = [];
    const seen = new Set();
    for (const r of recipients) {
      const rawPhone = typeof r === "string" ? r : r?.phone;
      if (!rawPhone) continue;
      let digits = String(rawPhone).replace(/\D/g, "");
      if (digits.length === 10) digits = `91${digits}`;
      if (digits.length >= 10 && !seen.has(digits)) {
        seen.add(digits);
        cleanRecipients.push({
          phone: digits,
          name: typeof r === "object" ? r.name : null,
          type: typeof r === "object" ? r.type : null,
        });
      }
    }

    if (cleanRecipients.length === 0) {
      return res.status(400).json({ success: false, message: "No valid recipients found" });
    }

    if (cleanRecipients.length > 250) {
      return res.status(400).json({ success: false, message: "Maximum 250 recipients allowed per multi-send batch" });
    }

    logger.info(
      `[AUDIT] WhatsApp multi-send started by ${req.user.username || req.user.name} (${req.user.id}). Recipients: ${cleanRecipients.length}. Template: ${templateName || "none"}`
    );

    const results = [];
    let sentCount = 0;
    let failedCount = 0;

    for (let i = 0; i < cleanRecipients.length; i++) {
      const rec = cleanRecipients[i];
      try {
        const msg = await chatService.sendAdminMessage({
          phone: rec.phone,
          text,
          mediaUrl,
          mediaType,
          isTemplate: Boolean(isTemplate),
          templateName,
          templateLanguage,
          components,
          adminUser: req.user,
        });

        sentCount++;
        results.push({ phone: rec.phone, name: rec.name, status: "sent", message_id: msg?.message_id || msg?.id });
      } catch (sendErr) {
        failedCount++;
        results.push({ phone: rec.phone, name: rec.name, status: "failed", error: sendErr.message || "Delivery failed" });
      }

      // Small pacing delay (100ms) between calls to avoid socket and Meta API flood
      if (i < cleanRecipients.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return res.json({
      success: true,
      Result: true,
      data: {
        total: cleanRecipients.length,
        sent: sentCount,
        failed: failedCount,
        results,
      },
    });
  } catch (err) {
    logger.error("POST /chat/send-bulk failed:", err);
    return res.status(500).json({ success: false, message: err.message || "Failed to execute multi-send" });
  }
});

module.exports = router;

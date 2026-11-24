const prisma = require("../config/db");
const logger = require("../utils/logger");
const cloudApi = require("../whatsapp/cloudApiClient");
const { WHATSAPP_TEMPLATES } = require("../whatsapp/templates");

let tablesEnsured = false;

/**
 * Ensures chat messages and threads tables exist.
 * Idempotent: uses CREATE TABLE IF NOT EXISTS.
 */
async function ensureChatTables() {
  if (tablesEnsured) return;
  try {
    if (typeof prisma.$executeRawUnsafe === "function") {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS whatsapp_chat_messages (
          id INT AUTO_INCREMENT PRIMARY KEY,
          message_id VARCHAR(100) NULL,
          phone VARCHAR(20) NOT NULL,
          sender_name VARCHAR(150) NULL,
          direction ENUM('inbound', 'outbound') NOT NULL,
          message_type VARCHAR(30) NOT NULL DEFAULT 'text',
          body TEXT NULL,
          media_url TEXT NULL,
          media_type VARCHAR(50) NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'sent',
          error_message TEXT NULL,
          is_template BOOLEAN NOT NULL DEFAULT FALSE,
          template_name VARCHAR(100) NULL,
          admin_id INT NULL,
          admin_name VARCHAR(150) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_phone (phone),
          INDEX idx_created (created_at),
          INDEX idx_direction (direction),
          INDEX idx_msg_id (message_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);

      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS whatsapp_chat_threads (
          phone VARCHAR(20) PRIMARY KEY,
          contact_name VARCHAR(150) NULL,
          user_type VARCHAR(20) NOT NULL DEFAULT 'guest',
          user_id INT NULL,
          last_message TEXT NULL,
          last_message_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_inbound_at DATETIME NULL,
          unread_count INT NOT NULL DEFAULT 0,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_last_message (last_message_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
    }
    tablesEnsured = true;
  } catch (err) {
    logger.warn("ensureChatTables error (might be using mocks or tables exist):", err.message);
  }
}

/**
 * Normalizes phone number into international digits without leading '+'
 * e.g. "9876543210" -> "919876543210"
 */
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 10) {
    digits = `91${digits}`;
  }
  return digits;
}

/**
 * Formats phone for local 10-digit DB lookups
 */
function toTenDigits(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

/**
 * Looks up contact identity in tbl_user (customer) or tbl_rider (driver).
 */
async function resolveContactInfo(phone, fallbackName = null) {
  const ten = toTenDigits(phone);
  if (!ten) return { user_type: "guest", user_id: null, contact_name: fallbackName || phone };

  try {
    // Check rider first
    const rider = await prisma.tbl_rider.findFirst({
      where: {
        OR: [
          { fmobile: ten },
          { fmobile: `91${ten}` },
        ],
      },
      select: { id: true, full_name: true, first_name: true, title: true },
    });

    if (rider) {
      return {
        user_type: "driver",
        user_id: rider.id,
        contact_name: rider.full_name || rider.first_name || rider.title || fallbackName || `Driver #${rider.id}`,
      };
    }

    // Check user (customer)
    const user = await prisma.tbl_user.findFirst({
      where: {
        OR: [{ mobile: ten }, { mobile: `91${ten}` }],
      },
      select: { id: true, name: true, fname: true, lname: true },
    });

    if (user) {
      const fullName = user.name || [user.fname, user.lname].filter(Boolean).join(" ");
      return {
        user_type: "customer",
        user_id: user.id,
        contact_name: fullName || fallbackName || `Customer #${user.id}`,
      };
    }
  } catch (err) {
    logger.warn("resolveContactInfo lookup failed:", err.message);
  }

  return {
    user_type: "guest",
    user_id: null,
    contact_name: fallbackName || phone,
  };
}

/**
 * Emits socket update to all connected admins.
 */
function broadcastSocketUpdate(event, data) {
  try {
    const { getIO } = require("../sockets/socketServer");
    const io = getIO();
    if (io) {
      io.to("admins_all").emit(event, data);
    }
  } catch (_e) {
    // socket server may not be active in CLI or unit tests
  }
}

/**
 * Checks whether the 24-hour customer window is currently active.
 * Tolerates server clock skew and timezone offsets.
 */
function is24HourWindowActive(lastInboundAt) {
  if (!lastInboundAt) return false;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return false;
  const elapsed = Date.now() - t;
  return elapsed < 24 * 60 * 60 * 1000 && elapsed > -24 * 60 * 60 * 1000;
}

/**
 * Calculates remaining seconds in the 24-hour window.
 */
function getWindowSecondsRemaining(lastInboundAt) {
  if (!lastInboundAt) return 0;
  const t = new Date(lastInboundAt).getTime();
  if (Number.isNaN(t)) return 0;
  const elapsed = Date.now() - t;
  const remaining = Math.floor((24 * 60 * 60 * 1000 - Math.max(0, elapsed)) / 1000);
  return remaining > 0 ? remaining : 0;
}

/**
 * Records an inbound message from Meta Webhook and updates the conversation thread.
 */
async function recordInboundMessage({
  messageId,
  fromPhone,
  profileName,
  messageType = "text",
  body = null,
  mediaUrl = null,
  mediaType = null,
  createdAt = new Date(),
}) {
  await ensureChatTables();

  const phone = normalizePhone(fromPhone);
  if (!phone) return null;

  // Deduplicate by messageId
  if (messageId && typeof prisma.$queryRawUnsafe === "function") {
    try {
      const existing = await prisma.$queryRawUnsafe(
        "SELECT id FROM whatsapp_chat_messages WHERE message_id = ? LIMIT 1",
        messageId
      );
      if (Array.isArray(existing) && existing.length > 0) {
        return existing[0];
      }
    } catch (_e) {}
  }

  const contact = await resolveContactInfo(phone, profileName);
  const now = createdAt instanceof Date ? createdAt : new Date(createdAt);

  // 1. Insert message
  let insertedId = null;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO whatsapp_chat_messages 
       (message_id, phone, sender_name, direction, message_type, body, media_url, media_type, status, created_at)
       VALUES (?, ?, ?, 'inbound', ?, ?, ?, ?, 'delivered', ?)`,
      messageId || null,
      phone,
      contact.contact_name,
      messageType,
      body,
      mediaUrl,
      mediaType,
      now
    );

    const row = await prisma.$queryRawUnsafe(
      "SELECT id FROM whatsapp_chat_messages WHERE phone = ? ORDER BY id DESC LIMIT 1",
      phone
    );
    insertedId = row?.[0]?.id;
  } catch (err) {
    logger.error("Failed to insert whatsapp_chat_messages:", err);
  }

  // 2. Upsert thread safely
  const previewText = body || (messageType ? `[${messageType.toUpperCase()}]` : "[Media]");
  try {
    const threadCheck = await prisma.$queryRawUnsafe(
      "SELECT phone FROM whatsapp_chat_threads WHERE phone = ? LIMIT 1",
      phone
    );
    if (Array.isArray(threadCheck) && threadCheck.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_chat_threads 
         SET contact_name = COALESCE(?, contact_name),
             user_type = ?,
             user_id = ?,
             last_message = ?,
             last_message_at = NOW(),
             last_inbound_at = NOW(),
             unread_count = unread_count + 1
         WHERE phone = ?`,
        contact.contact_name,
        contact.user_type,
        contact.user_id,
        previewText,
        phone
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO whatsapp_chat_threads 
         (phone, contact_name, user_type, user_id, last_message, last_message_at, last_inbound_at, unread_count)
         VALUES (?, ?, ?, ?, ?, NOW(), NOW(), 1)`,
        phone,
        contact.contact_name,
        contact.user_type,
        contact.user_id,
        previewText
      );
    }
  } catch (err) {
    logger.error("Failed to upsert whatsapp_chat_threads:", err);
  }

  const messageRecord = {
    id: insertedId,
    message_id: messageId,
    phone,
    sender_name: contact.contact_name,
    direction: "inbound",
    message_type: messageType,
    body,
    media_url: mediaUrl,
    media_type: mediaType,
    status: "delivered",
    created_at: now,
  };

  const threadRecord = {
    phone,
    contact_name: contact.contact_name,
    user_type: contact.user_type,
    user_id: contact.user_id,
    last_message: previewText,
    last_message_at: now,
    last_inbound_at: now,
    is_window_active: true,
    time_remaining_seconds: 24 * 3600,
  };

  broadcastSocketUpdate("whatsapp:new_message", { message: messageRecord, thread: threadRecord });
  return messageRecord;
}

/**
 * Extracts and records message from raw Meta Cloud API Webhook payload.
 */
async function processWebhookPayload(payload) {
  try {
    const entry = payload?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value) return;

    // Handle delivery/read receipts
    if (value.statuses && value.statuses[0]) {
      const statusObj = value.statuses[0];
      const statusMsgId = statusObj.id;
      const statusState = statusObj.status; // sent, delivered, read, failed
      const errorMsg = statusObj.errors ? JSON.stringify(statusObj.errors) : null;

      await updateMessageStatus(statusMsgId, statusState, errorMsg);
      return;
    }

    // Handle incoming messages
    if (value.messages && value.messages[0]) {
      const msg = value.messages[0];
      const contactProfile = value.contacts?.[0]?.profile?.name || null;
      const fromPhone = msg.from;
      const messageId = msg.id;
      const timestamp = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();

      let messageType = msg.type || "text";
      let body = null;
      let mediaUrl = null;
      let mediaType = null;

      if (msg.type === "text") {
        body = msg.text?.body || "";
      } else if (msg.type === "interactive") {
        messageType = "interactive";
        body = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || "[Interactive Reply]";
      } else if (msg.type === "button") {
        messageType = "button";
        body = msg.button?.text || "[Button Click]";
      } else if (["image", "video", "document", "audio"].includes(msg.type)) {
        messageType = msg.type;
        body = msg[msg.type]?.caption || `[${msg.type.toUpperCase()}]`;
        mediaType = msg[msg.type]?.mime_type || null;
        // Meta provides media id; mediaUrl can be fetched if required
      } else if (msg.type === "location") {
        messageType = "location";
        body = `📍 Location: ${msg.location?.latitude}, ${msg.location?.longitude}`;
      }

      await recordInboundMessage({
        messageId,
        fromPhone,
        profileName: contactProfile,
        messageType,
        body,
        mediaUrl,
        mediaType,
        createdAt: timestamp,
      });
    }
  } catch (err) {
    logger.error("Error in processWebhookPayload:", err);
  }
}

/**
 * Updates delivery status of a sent message.
 */
async function updateMessageStatus(messageId, status, errorMessage = null) {
  if (!messageId) return;
  await ensureChatTables();

  try {
    await prisma.$executeRawUnsafe(
      `UPDATE whatsapp_chat_messages 
       SET status = ?, error_message = ? 
       WHERE message_id = ?`,
      status,
      errorMessage,
      messageId
    );

    broadcastSocketUpdate("whatsapp:status_update", { message_id: messageId, status, error: errorMessage });
  } catch (err) {
    logger.warn("updateMessageStatus failed:", err.message);
  }
}

/**
 * Retrieves all conversation threads.
 */
async function getThreads({ search = null, type = "all", limit = 50, offset = 0 } = {}) {
  await ensureChatTables();

  try {
    let sql = "SELECT * FROM whatsapp_chat_threads WHERE 1=1";
    const params = [];

    if (type && type !== "all") {
      sql += " AND user_type = ?";
      params.push(type);
    }

    if (search) {
      sql += " AND (phone LIKE ? OR contact_name LIKE ? OR last_message LIKE ?)";
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern);
    }

    sql += " ORDER BY last_message_at DESC LIMIT ? OFFSET ?";
    params.push(Number(limit) || 50, Number(offset) || 0);

    const rows = await prisma.$queryRawUnsafe(sql, ...params);
    const threads = (rows || []).map((t) => {
      const isWindowActive = is24HourWindowActive(t.last_inbound_at);
      const remainingSec = getWindowSecondsRemaining(t.last_inbound_at);
      const expiresAt = t.last_inbound_at
        ? new Date(new Date(t.last_inbound_at).getTime() + 24 * 3600 * 1000)
        : null;

      return {
        phone: t.phone,
        contact_name: t.contact_name,
        user_type: t.user_type,
        user_id: t.user_id,
        last_message: t.last_message,
        last_message_at: t.last_message_at,
        last_inbound_at: t.last_inbound_at,
        unread_count: Number(t.unread_count) || 0,
        is_window_active: isWindowActive,
        time_remaining_seconds: remainingSec,
        window_expires_at: expiresAt,
      };
    });

    return threads;
  } catch (err) {
    logger.error("getThreads failed:", err);
    return [];
  }
}

/**
 * Retrieves messages for a specific conversation thread and resets unread count.
 */
async function getMessagesByPhone(phone, { limit = 100, offset = 0 } = {}) {
  await ensureChatTables();
  const normalized = normalizePhone(phone);
  const tenDigits = toTenDigits(phone);
  if (!normalized) return { thread: null, messages: [] };

  try {
    // 1. Reset unread count for this thread
    await prisma.$executeRawUnsafe(
      "UPDATE whatsapp_chat_threads SET unread_count = 0 WHERE phone = ? OR phone = ?",
      normalized,
      tenDigits || normalized
    );

    // 2. Fetch thread info
    const threadRows = await prisma.$queryRawUnsafe(
      "SELECT * FROM whatsapp_chat_threads WHERE phone = ? OR phone = ? ORDER BY last_message_at DESC LIMIT 1",
      normalized,
      tenDigits || normalized
    );
    const rawThread = threadRows?.[0] || null;

    let thread = null;
    if (rawThread) {
      const isWindowActive = is24HourWindowActive(rawThread.last_inbound_at);
      thread = {
        phone: rawThread.phone,
        contact_name: rawThread.contact_name,
        user_type: rawThread.user_type,
        user_id: rawThread.user_id,
        last_message: rawThread.last_message,
        last_message_at: rawThread.last_message_at,
        last_inbound_at: rawThread.last_inbound_at,
        unread_count: 0,
        is_window_active: isWindowActive,
        time_remaining_seconds: getWindowSecondsRemaining(rawThread.last_inbound_at),
        window_expires_at: rawThread.last_inbound_at
          ? new Date(new Date(rawThread.last_inbound_at).getTime() + 24 * 3600 * 1000)
          : null,
      };
    } else {
      // If thread doesn't exist yet, construct active view so admin can start chatting
      const contact = await resolveContactInfo(normalized);
      thread = {
        phone: normalized,
        contact_name: contact.contact_name,
        user_type: contact.user_type,
        user_id: contact.user_id,
        last_message: null,
        last_message_at: null,
        last_inbound_at: new Date(),
        unread_count: 0,
        is_window_active: true,
        time_remaining_seconds: 24 * 3600,
        window_expires_at: null,
      };
    }

    // 3. Fetch messages matching normalized or 10-digit phone
    const messages = await prisma.$queryRawUnsafe(
      `SELECT * FROM whatsapp_chat_messages 
       WHERE phone = ? OR phone = ? 
       ORDER BY created_at ASC 
       LIMIT ? OFFSET ?`,
      normalized,
      tenDigits || normalized,
      Number(limit) || 100,
      Number(offset) || 0
    );

    return { thread, messages: messages || [] };
  } catch (err) {
    logger.error("getMessagesByPhone failed:", err);
    return { thread: null, messages: [] };
  }
}

/**
 * Sends an outbound message from Admin to a customer/driver.
 * Handles both 24-hr session free-text/media and approved template messages.
 */
async function sendAdminMessage({
  phone,
  text = null,
  mediaUrl = null,
  mediaType = null,
  isTemplate = false,
  templateName = null,
  templateLanguage = "en_US",
  components = [],
  adminUser = null,
}) {
  await ensureChatTables();
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Invalid destination phone number");
  }

  // 1. Fetch thread to check 24-hour window
  let rawThread = null;
  try {
    const threadRows = await prisma.$queryRawUnsafe(
      "SELECT * FROM whatsapp_chat_threads WHERE phone = ? LIMIT 1",
      normalized
    );
    rawThread = threadRows?.[0] || null;
  } catch (_e) {}

  const windowActive = is24HourWindowActive(rawThread?.last_inbound_at);

  if (rawThread?.last_inbound_at && !windowActive && !isTemplate) {
    throw new Error(
      "Cannot send free-text message: 24-Hour customer window is inactive or expired. Please select an approved Meta template."
    );
  }

  let metaResponse = null;
  let sentMessageId = null;
  let messageType = "text";
  let storedBody = text;

  // 2. Dispatch via Meta Cloud API
  if (isTemplate) {
    if (!templateName) throw new Error("Template name is required for template messages");

    // Map template to Meta approved template name
    const foundTpl = WHATSAPP_TEMPLATES.find((t) => t.id === templateName || t.name === templateName || t.metaTemplateName === templateName);
    let metaTemplateName = foundTpl?.metaTemplateName || templateName;

    if (!metaTemplateName) {
      const lowerName = String(templateName).toLowerCase();
      if (lowerName === "hello_world") {
        metaTemplateName = "hello_world";
      } else if (lowerName.includes("driver")) {
        metaTemplateName = "shifter_driver_onboard";
      } else if (lowerName.includes("sales") || lowerName.includes("booking") || lowerName.includes("payment")) {
        metaTemplateName = "shifter_booking_followup";
      } else {
        metaTemplateName = "shifter_customer_welcome";
      }
    }

    messageType = "template";
    storedBody = text || foundTpl?.message || `[Template: ${metaTemplateName}]`;

    // Smart default parameters for parameterized templates when sent from Live Chat UI
    if (metaTemplateName === "shifter_driver_unavailable" && (!components || components.length === 0)) {
      const recipientName = rawThread?.contact_name || "Customer";
      components = [
        {
          type: "body",
          parameters: [
            { type: "text", text: recipientName },
            { type: "text", text: "Recent" }
          ]
        }
      ];
    } else if (metaTemplateName === "shifter_partner_app_invite" && (!components || components.length === 0)) {
      const rawName = rawThread?.contact_name || "";
      const isPhoneOnly = /^\+?\d+$/.test(rawName.trim());
      const recipientName = (rawName && !isPhoneOnly) ? rawName.trim() : "Driver Partner";
      components = [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://res.cloudinary.com/jludyhhm/image/upload/v1795527682/whatsapp_templates/shifter_partner_invite_banner.jpg" }
            }
          ]
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: recipientName }
          ]
        }
      ];
    } else if (metaTemplateName === "shifter_driver_partner_app" && (!components || components.length === 0)) {
      const rawName = rawThread?.contact_name || "";
      const isPhoneOnly = /^\+?\d+$/.test(rawName.trim());
      const recipientName = (rawName && !isPhoneOnly) ? rawName.trim() : "Driver Partner";
      components = [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://res.cloudinary.com/jludyhhm/image/upload/v1795527682/whatsapp_templates/shifter_partner_invite_banner.jpg" }
            }
          ]
        },
        {
          type: "body",
          parameters: [
            { type: "text", text: recipientName }
          ]
        }
      ];
    } else if (metaTemplateName === "shifter_driver_incomplete_reg" && (!components || components.length === 0)) {
      components = [
        {
          type: "header",
          parameters: [
            {
              type: "image",
              image: { link: "https://res.cloudinary.com/jludyhhm/image/upload/v1795527581/whatsapp_templates/shifter_driver_banner_v1.jpg" }
            }
          ]
        }
      ];
    } else if (metaTemplateName === "customer_promo_benefits" && (!components || components.length === 0)) {
      components = [
        {
          type: "header",
          parameters: [
            {
              type: "video",
              video: {
                link: "https://res.cloudinary.com/jludyhhm/video/upload/v1795527598/whatsapp_templates/customer_promo_video_v1.mp4"
              }
            }
          ]
        }
      ];
    }

    try {
      metaResponse = await cloudApi.sendTemplateMessage(
        normalized,
        metaTemplateName,
        templateLanguage || "en_US",
        components
      );
    } catch (tplErr) {
      // If error is #132001 (translation/language code mismatch), retry with "en"
      if (tplErr.details?.code === 132001 && (templateLanguage || "en_US") === "en_US") {
        try {
          metaResponse = await cloudApi.sendTemplateMessage(
            normalized,
            metaTemplateName,
            "en",
            components
          );
        } catch (_retryErr) {
          throw tplErr;
        }
      } else {
        throw tplErr;
      }
    }

    // Capture header media URL so the Admin Live Chat UI displays the image/video in the bubble
    if (!mediaUrl && components && components.length > 0) {
      const headerParam = components.find((c) => c.type === "header")?.parameters?.[0];
      if (headerParam?.image?.link) {
        mediaUrl = headerParam.image.link;
        mediaType = "image";
      } else if (headerParam?.video?.link) {
        mediaUrl = headerParam.video.link;
        mediaType = "video";
      }
    }
  } else if (mediaUrl) {
    messageType = mediaType?.startsWith("video") ? "video" : "image";
    metaResponse = await cloudApi.sendMediaMessage(normalized, messageType, mediaUrl, text);
    storedBody = text || `[${messageType.toUpperCase()}]`;
  } else {
    if (!text || !text.trim()) throw new Error("Message text cannot be empty");
    messageType = "text";
    try {
      metaResponse = await cloudApi.sendTextMessage(normalized, text);
      storedBody = text;
    } catch (apiErr) {
      if (
        apiErr.details?.code === 131047 ||
        String(apiErr.message).includes("24 hours") ||
        String(apiErr.message).includes("re-engagement")
      ) {
        throw new Error(
          "Customer ki 24 ghante ki window close ho chuki hai. Meta ke niyam ke anusaar ab Template message hi bhejna hoga. Kripya 'Templates' button par click karke template chunein."
        );
      }
      throw apiErr;
    }
  }

  sentMessageId = metaResponse?.messages?.[0]?.id || null;
  const now = new Date();

  // 3. Resolve contact info if not yet resolved
  const contact = await resolveContactInfo(normalized, rawThread?.contact_name);

  // 4. Record outbound message in DB
  let insertedId = null;
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO whatsapp_chat_messages 
       (message_id, phone, sender_name, direction, message_type, body, media_url, media_type, status, is_template, template_name, admin_id, admin_name, created_at)
       VALUES (?, ?, ?, 'outbound', ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?)`,
      sentMessageId,
      normalized,
      adminUser?.name || adminUser?.username || "Admin",
      messageType,
      storedBody,
      mediaUrl,
      mediaType,
      Boolean(isTemplate),
      templateName || null,
      adminUser?.id || null,
      adminUser?.name || adminUser?.username || "Admin",
      now
    );

    const row = await prisma.$queryRawUnsafe(
      "SELECT id FROM whatsapp_chat_messages WHERE phone = ? ORDER BY id DESC LIMIT 1",
      normalized
    );
    insertedId = row?.[0]?.id;
  } catch (err) {
    logger.error("Failed to insert outbound whatsapp message:", err);
  }

  // 5. Update thread record safely
  try {
    const threadCheck = await prisma.$queryRawUnsafe(
      "SELECT phone FROM whatsapp_chat_threads WHERE phone = ? LIMIT 1",
      normalized
    );
    if (Array.isArray(threadCheck) && threadCheck.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_chat_threads 
         SET contact_name = COALESCE(?, contact_name),
             user_type = ?,
             user_id = ?,
             last_message = ?,
             last_message_at = NOW()
         WHERE phone = ?`,
        contact.contact_name,
        contact.user_type,
        contact.user_id,
        storedBody,
        normalized
      );
    } else {
      await prisma.$executeRawUnsafe(
        `INSERT INTO whatsapp_chat_threads 
         (phone, contact_name, user_type, user_id, last_message, last_message_at, unread_count)
         VALUES (?, ?, ?, ?, ?, NOW(), 0)`,
        normalized,
        contact.contact_name,
        contact.user_type,
        contact.user_id,
        storedBody
      );
    }
  } catch (err) {
    logger.error("Failed to update thread for outbound message:", err);
  }

  const messageRecord = {
    id: insertedId,
    message_id: sentMessageId,
    phone: normalized,
    sender_name: adminUser?.name || adminUser?.username || "Admin",
    direction: "outbound",
    message_type: messageType,
    body: storedBody,
    media_url: mediaUrl,
    media_type: mediaType,
    status: "sent",
    is_template: Boolean(isTemplate),
    template_name: templateName,
    admin_id: adminUser?.id || null,
    admin_name: adminUser?.name || adminUser?.username || "Admin",
    created_at: now,
  };

  broadcastSocketUpdate("whatsapp:message_sent", { message: messageRecord, phone: normalized });
  return messageRecord;
}

module.exports = {
  ensureChatTables,
  normalizePhone,
  resolveContactInfo,
  is24HourWindowActive,
  getWindowSecondsRemaining,
  recordInboundMessage,
  processWebhookPayload,
  updateMessageStatus,
  getThreads,
  getMessagesByPhone,
  sendAdminMessage,
};

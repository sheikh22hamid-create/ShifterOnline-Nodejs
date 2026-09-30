const qrcode = require("qrcode-terminal");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const groqService = require("./groqService");
const sessionManager = require("./sessionManager");
const chatControl = require("./chatControl");
const customerHandler = require("./handlers/customerHandler");
const driverHandler = require("./handlers/driverHandler");
const notifications = require("./notifications");

let sock = null;
let latestQrCode = null;
let latestPairingCode = null;
let connectionStatus = "DISCONNECTED";

const processedMessageIds = new Map();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 minutes deduplication window

function isDuplicateMessage(msgId) {
  if (!msgId) return false;
  const now = Date.now();
  if (processedMessageIds.has(msgId)) {
    return true;
  }
  processedMessageIds.set(msgId, now);

  if (processedMessageIds.size > 500) {
    for (const [id, time] of processedMessageIds.entries()) {
      if (now - time > DEDUP_TTL_MS) {
        processedMessageIds.delete(id);
      }
    }
  }
  return false;
}

function clearAuthDirectory() {
  try {
    const authDir = path.join(__dirname, "..", "..", ".wa_auth");
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      fs.mkdirSync(authDir, { recursive: true });
      logger.info("Cleared .wa_auth credentials directory.");
    }
  } catch (err) {
    logger.error("Failed to clear .wa_auth directory:", err);
  }
}

/**
 * Initializes WhatsApp Web socket client
 */
async function initWhatsAppBot() {
  try {
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch (e) {}
      sock = null;
    }

    const baileys = await import("@whiskeysockets/baileys");
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
    const authDir = path.join(__dirname, "..", "..", ".wa_auth");
    if (!fs.existsSync(authDir)) {
      fs.mkdirSync(authDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const pairingNumber = process.env.PAIRING_NUMBER || null;

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: !pairingNumber,
      browser: Browsers ? Browsers.ubuntu("Chrome") : ["Ubuntu", "Chrome", "20.0.04"],
      syncFullHistory: false,
      logger: require("pino")({ level: "silent" }),
    });

    notifications.setWhatsAppClient(sock);

    sock.ev.on("creds.update", saveCreds);

    if (pairingNumber && !sock.authState.creds.registered) {
      setTimeout(async () => {
        try {
          const cleanNum = pairingNumber.replace(/\D/g, "");
          const code = await sock.requestPairingCode(cleanNum);
          latestPairingCode = code;
          connectionStatus = "AWAITING_PAIRING_CODE";
          logger.info("=========================================");
          logger.info(`  WHATSAPP PAIRING CODE FOR ${cleanNum}: ${code}`);
          logger.info("=========================================");
        } catch (err) {
          logger.error("Failed to request pairing code:", err);
        }
      }, 3000);
    }

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQrCode = qr;
        connectionStatus = "AWAITING_QR_SCAN";
        logger.info("=========================================");
        logger.info("  SCAN WHATSAPP QR CODE BELOW TO CONNECT ");
        logger.info("=========================================");
        qrcode.generate(qr, { small: true });
      }

      if (connection === "close") {
        notifications.setWhatsAppClient(null);
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut =
          statusCode === DisconnectReason.loggedOut ||
          statusCode === 401 ||
          statusCode === 403;
        const shouldReconnect = !isLoggedOut;
        connectionStatus = "DISCONNECTED";
        logger.warn(`WhatsApp socket connection closed (status: ${statusCode}). Reconnecting: ${shouldReconnect}`);

        if (isLoggedOut) {
          logger.info("Account logged out from WhatsApp device. Clearing credentials and preparing fresh login...");
          clearAuthDirectory();
          setTimeout(initWhatsAppBot, 2000);
        } else if (shouldReconnect) {
          setTimeout(initWhatsAppBot, 5000);
        }
      } else if (connection === "open") {
        connectionStatus = "CONNECTED";
        latestQrCode = null;
        latestPairingCode = null;
        notifications.setWhatsAppClient(sock);
        logger.info("🚀 Shifter Online WhatsApp Bot successfully CONNECTED!");
      }
    });

    // Helper to extract text content from standard, ephemeral, or viewOnce WhatsApp messages
    function extractMessageText(msg) {
      if (!msg || !msg.message) return "";
      let content = msg.message;

      // Handle Ephemeral / Disappearing Messages
      if (content.ephemeralMessage?.message) {
        content = content.ephemeralMessage.message;
      }
      // Handle View Once Messages
      if (content.viewOnceMessage?.message) {
        content = content.viewOnceMessage.message;
      }
      if (content.viewOnceMessageV2?.message) {
        content = content.viewOnceMessageV2.message;
      }

      // Handle Native WhatsApp Location Share (Map Pin)
      if (content.locationMessage) {
        const lat = content.locationMessage.degreesLatitude;
        const lng = content.locationMessage.degreesLongitude;
        const name = content.locationMessage.name || content.locationMessage.address || "";
        return `LOCATION_PIN:${lat},${lng}${name ? `:${name}` : ""}`;
      }
      if (content.liveLocationMessage) {
        const lat = content.liveLocationMessage.degreesLatitude;
        const lng = content.liveLocationMessage.degreesLongitude;
        const caption = content.liveLocationMessage.caption || "";
        return `LOCATION_PIN:${lat},${lng}${caption ? `:${caption}` : ""}`;
      }

      return (
        content.conversation ||
        content.extendedTextMessage?.text ||
        content.imageMessage?.caption ||
        content.documentMessage?.caption ||
        content.documentWithCaptionMessage?.message?.documentMessage?.caption ||
        ""
      );
    }

    // Incoming & Outgoing Messages Handler
    sock.ev.on("messages.upsert", async (m) => {
      // Only process real-time user notification events, skip history sync/append
      if (m.type && m.type !== "notify") {
        return;
      }

      for (const msg of m.messages || []) {
        try {
          if (!msg.message) continue;

          const msgId = msg.key?.id;
          if (isDuplicateMessage(msgId)) {
            logger.debug(`Duplicate WhatsApp message skipped: ${msgId}`);
            continue;
          }

          // Skip stale/old messages (e.g. older than 2 minutes on reconnect/sync)
          const nowSec = Math.floor(Date.now() / 1000);
          const msgTimestamp = typeof msg.messageTimestamp === "number" ? msg.messageTimestamp : Number(msg.messageTimestamp?.low || msg.messageTimestamp || 0);
          if (msgTimestamp && (nowSec - msgTimestamp) > 120) {
            logger.debug(`Skipping stale old message (${nowSec - msgTimestamp}s old): ${msgId}`);
            continue;
          }

          const remoteJid = msg.key.remoteJid;

          // Ignore Groups (@g.us), Channels/Newsletters (@newsletter), and Status Broadcasts (@broadcast)
          // Reply ONLY to direct personal 1-on-1 messages (@s.whatsapp.net and @lid)
          if (
            !remoteJid ||
            remoteJid.endsWith("@g.us") ||
            remoteJid.endsWith("@newsletter") ||
            remoteJid.endsWith("@broadcast")
          ) {
            logger.debug(`Ignoring group/channel/broadcast: ${remoteJid}`);
            continue;
          }

          const textMessage = extractMessageText(msg);
          const senderPhone = remoteJid.split("@")[0].replace(/\D/g, "");

          // 1. Handle bot owner's own outbound messages (fromMe)
          // If the logged-in user types "stop" in a personal chat, pause bot for that chat.
          // If they type "/start" or "start", resume bot for that chat.
          if (msg.key.fromMe) {
            if (chatControl.isStopCommand(textMessage)) {
              chatControl.pauseChat(senderPhone || remoteJid);
              sessionManager.clearSession(senderPhone);
              logger.info(`⏸️ [OWNER] Bot PAUSED for personal chat ${senderPhone || remoteJid} (command: "${textMessage}")`);
            } else if (chatControl.isStartCommand(textMessage)) {
              chatControl.resumeChat(senderPhone || remoteJid);
              sessionManager.clearSession(senderPhone);
              logger.info(`▶️ [OWNER] Bot RESUMED for personal chat ${senderPhone || remoteJid} (command: "${textMessage}")`);
            } else {
              logger.debug(`Skipping outbound self message to ${remoteJid}`);
            }
            continue;
          }

          // 2. Check if this specific personal chat is paused
          if (chatControl.isChatPaused(senderPhone || remoteJid)) {
            // Check if contact sent /start or start to resume the bot
            if (chatControl.isStartCommand(textMessage)) {
              chatControl.resumeChat(senderPhone || remoteJid);
              sessionManager.clearSession(senderPhone);
              logger.info(`▶️ [CONTACT] Bot RESUMED for personal chat ${senderPhone} (command: "${textMessage}")`);
              const welcomeText =
                "Main Shifter Online Bot hoon! Main abhi training phase mein hoon. Hamari technical team aapki sahayata Se mujhe develop aur advance banaa rahi hai\n" +
                "Aap mujhse koi bhi sawal poochh sakte hain\n" +
                "Aapke sawal ka hamari team uchit jawab degi.";
              await sock.sendMessage(remoteJid, { text: welcomeText });
              continue;
            }

            // Chat is paused - do not process or reply
            logger.debug(`Chat ${senderPhone} is PAUSED. Skipping bot automated reply.`);
            continue;
          }

          // 3. Handle explicit /stop command from contact
          if (chatControl.isStopCommand(textMessage) && (/^\/stop/i.test(textMessage) || /bot/i.test(textMessage))) {
            chatControl.pauseChat(senderPhone || remoteJid);
            sessionManager.clearSession(senderPhone);
            await sock.sendMessage(remoteJid, {
              text: "⏸️ Bot service has been paused for this chat. Type */start* anytime to resume.",
            });
            continue;
          }

          if (!textMessage && !msg.message.imageMessage) {
            logger.debug(`Ignoring empty or unhandled message type from ${remoteJid}`);
            continue;
          }

          console.log(`\n=========================================\n📲 INCOMING CUSTOMER MSG (${senderPhone}): "${textMessage}"\n=========================================\n`);
          logger.info(`📲 Received WhatsApp message from ${senderPhone}: "${textMessage}"`);

          await handleIncomingWhatsAppMessage(remoteJid, senderPhone, textMessage, msg);
        } catch (msgErr) {
          logger.error("Error processing single upsert message:", msgErr);
        }
      }
    });

    return sock;
  } catch (err) {
    logger.error("Failed to initialize WhatsApp Bot client:", err);
    connectionStatus = "ERROR";
  }
}

/**
 * Detects if incoming message contains a high-priority global intent switch
 */
function detectGlobalIntent(text, sessionStep) {
  const t = (text || "").toLowerCase().trim();
  if (!t) return { isGlobalSwitch: false, intent: null };

  // 1. CANCEL / RESET / REJECT / NAHI
  if (
    /^(nhi|nahi|nah|no|cancel|stop|reset|exit|band|galat|wrong|menu)(?:\s+yrr|\s+bhai|\s+please)?$/i.test(t) ||
    t === "nhi" ||
    t === "nahi"
  ) {
    return { isGlobalSwitch: true, intent: "CANCEL_RESET" };
  }

  // 2. DRIVER SUPPORT NUMBER (Check BEFORE general driver)
  if (
    t.includes("driver support") ||
    t.includes("driver helpline") ||
    t.includes("driver care") ||
    (t.includes("driver") && (t.includes("support") || t.includes("helpline") || t.includes("number") || t.includes("phone") || t.includes("contact") || t.includes("care")))
  ) {
    return { isGlobalSwitch: true, intent: "DRIVER_SUPPORT" };
  }

  // 3. CUSTOMER CARE / CONTACT SUPPORT (Check BEFORE general driver)
  if (
    t.includes("customer care") ||
    t.includes("costumer care") ||
    t.includes("customer support") ||
    t.includes("costumer support") ||
    t.includes("helpline") ||
    t.includes("contact") ||
    t.includes("call center") ||
    t.includes("support number") ||
    t.includes("care number") ||
    t.includes("number do") ||
    t.includes("phone number") ||
    (t.includes("baat") && t.includes("karna")) ||
    (t.includes("baat") && t.includes("karni"))
  ) {
    return { isGlobalSwitch: true, intent: "CUSTOMER_SUPPORT" };
  }

  // 4. DRIVER ONBOARDING (Registration / Partner App / Joining)
  if (
    t.includes("registration") ||
    t.includes("register") ||
    t.includes("onboarding") ||
    t.includes("join") ||
    t.includes("attach") ||
    t.includes("partner") ||
    t.includes("kyc") ||
    t.includes("driver banna") ||
    t === "driver"
  ) {
    return { isGlobalSwitch: true, intent: "DRIVER_ONBOARDING" };
  }

  // 5. TRACK ORDER
  if (t.startsWith("track") || t.includes("order status") || t.match(/^#?\d+$/)) {
    return { isGlobalSwitch: true, intent: "TRACK_ORDER" };
  }

  // 6. START NEW FARE / BOOKING OR APP LINK
  if (t.startsWith("fare") || t.startsWith("book") || t === "app" || (t.includes("pickup") && t.includes("drop"))) {
    return { isGlobalSwitch: true, intent: "CALCULATE_FARE" };
  }

  return { isGlobalSwitch: false, intent: null };
}

/**
 * Message Processing Engine
 */
async function handleIncomingWhatsAppMessage(remoteJid, senderPhone, text, fullMsg) {
  try {
    const session = sessionManager.getSession(senderPhone);
    let replyText = "";
    const cleanText = (text || "").trim();

    // Check for high-priority global intent switch (e.g. Support, Driver Reg, Track, Cancel, etc.)
    const globalCheck = detectGlobalIntent(cleanText, session.step);

    if (globalCheck.isGlobalSwitch) {
      logger.info(`🔄 Global Intent Switch triggered: ${globalCheck.intent} (Previous step was: ${session.step})`);
      sessionManager.clearSession(senderPhone);

      // Handle the global intent immediately
      switch (globalCheck.intent) {
        case "CANCEL_RESET":
          replyText =
            `Bilkul! Aapka current process cancel kar diya gaya hai.\n\n` +
            `Aap kya help chahte hain?\n\n` +
            `• *App* — Delivery booking ke liye Customer App link\n` +
            `• *Track <OrderId>* — Order tracking status check karein\n` +
            `• *Driver* — Driver partner registration & app link\n` +
            `• *Support* — Customer care & driver helpline numbers`;
          break;

        case "DRIVER_SUPPORT":
          replyText =
            `📞 *Shifter Online Driver Support*\n\n` +
            `Driver Partners ke liye dedicated helpline details:\n` +
            `📱 *Driver Support Phone*: 9109114515\n` +
            `📱 *Customer Care*: 9109114515\n` +
            `📧 *Support Email*: support@shifteronline.com\n\n` +
            `📲 *Driver App Download Link*:\nhttps://play.google.com/store/apps/details?id=com.shifter.driver`;
          break;

        case "CUSTOMER_SUPPORT":
          replyText =
            `📞 *Shifter Online Customer Care*\n\n` +
            `Hamari support team se sampark karne ke liye details:\n` +
            `📱 *Customer Care Number*: 9109114515\n` +
            `📱 *Driver Helpline*: 9109114515\n` +
            `📧 *Support Email*: support@shifteronline.com\n` +
            `🌐 *Website*: https://shifteronline.com\n\n` +
            `🏢 *Company*: Movigo Logistic Aggregator Private Limited`;
          break;

        case "DRIVER_ONBOARDING":
          replyText =
            `🚚 *Shifter Online Driver Partner Program*\n\n` +
            `Aap Shifter Online ke saath judein aur apni gadi (Bike, 3-Wheeler, 4-Wheeler, E-Loader) se daily achhi kamai karein!\n\n` +
            `📋 *Required Documents*:\n` +
            `1️⃣ Driving License (DL)\n` +
            `2️⃣ Aadhaar Card / Govt ID Proof\n` +
            `3️⃣ Vehicle RC Book\n` +
            `4️⃣ Bank Account / UPI Details\n` +
            `5️⃣ Live Face verification\n` +
            `6️⃣ PAN Card\n\n` +
            `📲 *Registration Kaise Karein?*\n` +
            `Direct humari *Shifter Driver Partner App* download karke 5 min me aasan registration complete karein:\n` +
            `🔗 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n` +
            `📞 *Driver Support*: 9109114515`;
          break;

        case "TRACK_ORDER": {
          const orderId = cleanText.match(/\d+/)?.[0];
          if (orderId) {
            replyText = await customerHandler.handleTrackingQuery(orderId, senderPhone);
          } else {
            replyText = "📦 Order tracking ke liye kripya apna Order ID bhejein (e.g. *Track 244*).";
          }
          break;
        }

        case "CALCULATE_FARE":
        case "BOOK_TRIP": {
          sessionManager.clearSession(senderPhone);
          replyText =
            `📦 *Shifter Online Booking*\n\n` +
            `WhatsApp par direct booking ya fare calculation uplabdh nahi hai.\n` +
            `Goods delivery ya vehicle booking ke liye kripya hamari official *Shifter Online Customer App* download karein:\n\n` +
            `📲 *Download Shifter App*:\n` +
            `👉 https://play.google.com/store/apps/details?id=com.shifter.online\n\n` +
            `App me aap exact pickup-drop daalkar transparent live fare dekh sakte hain aur turant driver book kar sakte hain!\n\n` +
            `📞 *Customer Care*: 9109114515`;
          break;
        }

        default:
          break;
      }
    } else if (cleanText.startsWith("LOCATION_PIN:")) {
      replyText =
        `📍 *Location Received*\n\n` +
        `WhatsApp par direct booking ya fare calculation uplabdh nahi hai.\n` +
        `Goods delivery ya vehicle booking ke liye kripya hamari official *Shifter Online Customer App* download karein:\n\n` +
        `📲 *Download Shifter App*:\n` +
        `👉 https://play.google.com/store/apps/details?id=com.shifter.online\n\n` +
        `App me aap exact pickup-drop daalkar transparent live fare dekh sakte hain aur turant driver book kar sakte hain!\n\n` +
        `📞 *Customer Care*: 9109114515`;
    } else {
      // Session is IDLE - parse intent using Gemini AI / Groq AI / Fallback parser
      const aiAnalysis = await groqService.parseMessageWithAI(cleanText, session);
      const { intent, entities, aiResponse } = aiAnalysis;

      logger.info(`AI Classified Intent: ${intent}`);

      switch (intent) {
        case "DRIVER_SUPPORT":
          replyText =
            `📞 *Shifter Online Driver Support*\n\n` +
            `Driver Partners ke liye dedicated helpline details:\n` +
            `📱 *Driver Support Phone*: 9109114515\n` +
            `📱 *Customer Care*: 9109114515\n` +
            `📧 *Support Email*: support@shifteronline.com\n\n` +
            `📲 *Driver App*: https://play.google.com/store/apps/details?id=com.shifter.driver`;
          break;

        case "CUSTOMER_SUPPORT":
          replyText =
            `📞 *Shifter Online Customer Care*\n\n` +
            `Hamari support team se sampark karne ke liye details:\n` +
            `📱 *Customer Care Number*: 9109114515\n` +
            `📱 *Driver Helpline*: 9109114515\n` +
            `📧 *Support Email*: support@shifteronline.com\n` +
            `🌐 *Website*: https://shifteronline.com\n\n` +
            `🏢 *Company*: Movigo Logistic Aggregator Private Limited`;
          break;

        case "CANCEL_RESET":
          replyText =
            `Bilkul! Aapka current process cancel kar diya gaya hai.\n\n` +
            `Aap kya help chahte hain?\n\n` +
            `• *App* — Delivery booking ke liye Customer App link\n` +
            `• *Track <OrderId>* — Order tracking status check karein\n` +
            `• *Driver* — Driver partner registration & app link\n` +
            `• *Support* — Customer care & driver helpline numbers`;
          break;

        case "CALCULATE_FARE":
        case "BOOK_TRIP": {
          sessionManager.clearSession(senderPhone);
          replyText =
            `📦 *Shifter Online Booking*\n\n` +
            `WhatsApp par direct booking ya fare calculation uplabdh nahi hai.\n` +
            `Goods delivery ya vehicle booking ke liye kripya hamari official *Shifter Online Customer App* download karein:\n\n` +
            `📲 *Download Shifter App*:\n` +
            `👉 https://play.google.com/store/apps/details?id=com.shifter.online\n\n` +
            `App me aap exact pickup-drop daalkar transparent live fare dekh sakte hain aur turant driver book kar sakte hain!\n\n` +
            `📞 *Customer Care*: 9109114515`;
          break;
        }

        case "TRACK_ORDER": {
          const orderId = entities?.orderId || cleanText.match(/\d+/)?.[0];
          if (orderId) {
            replyText = await customerHandler.handleTrackingQuery(orderId, senderPhone);
          } else {
            replyText = "📦 Order tracking ke liye kripya apna Order ID bhejein (e.g. *Track 244*).";
          }
          break;
        }

        case "DRIVER_ONBOARDING": {
          if (aiResponse && !cleanText.match(/^driver$/i)) {
            replyText = aiResponse;
          } else {
            replyText =
              `🚚 *Shifter Online Driver Partner Program*\n\n` +
              `Aap Shifter Online ke saath judein aur apni gadi (Bike, 3-Wheeler, 4-Wheeler, E-Loader) se daily achhi kamai karein!\n\n` +
              `📋 *Required Documents*:\n` +
              `1️⃣ Driving License (DL)\n` +
              `2️⃣ Aadhaar Card / Govt ID Proof\n` +
              `3️⃣ Vehicle RC Book\n` +
              `4️⃣ Bank Account / UPI Details\n` +
              `5️⃣ Live Face verification\n` +
              `6️⃣ PAN Card\n\n` +
              `📲 *Registration Kaise Karein?*\n` +
              `Direct humari *Shifter Driver Partner App* download karke 5 min me aasan registration complete karein:\n` +
              `🔗 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n` +
              `📞 *Driver Support*: 9109114515`;
          }
          break;
        }

        case "CHECK_WALLET":
          replyText = await driverHandler.checkDriverStatus(senderPhone);
          break;

        case "FAQ_QUERY":
          if (aiResponse) {
            replyText = aiResponse;
          } else {
            replyText =
              "Main Shifter Online Bot hoon! Main abhi training phase mein hoon. Hamari technical team aapki sahayata Se mujhe develop aur advance banaa rahi hai\n" +
              "Aap mujhse koi bhi sawal poochh sakte hain\n" +
              "Aapke sawal ka hamari team uchit jawab degi.";
          }
          break;

        default:
          const isGreeting = /^(hi|hello|hey|menu|help|options|start|hola)$/i.test(cleanText);
          if (!isGreeting && aiResponse) {
            replyText = aiResponse;
          } else {
            replyText =
              "Main Shifter Online Bot hoon! Main abhi training phase mein hoon. Hamari technical team aapki sahayata Se mujhe develop aur advance banaa rahi hai\n" +
              "Aap mujhse koi bhi sawal poochh sakte hain\n" +
              "Aapke sawal ka hamari team uchit jawab degi.";
          }
          break;
      }
    }

    if (replyText && sock) {
      await sock.sendMessage(remoteJid, { text: replyText });
    }
  } catch (err) {
    logger.error(`Error handling WhatsApp message from ${senderPhone}:`, err);
    if (sock) {
      await sock.sendMessage(remoteJid, {
        text: "⚠️ Samajh nahi aaya. Kripya punah prayaas karein ya type *Help* karein.",
      });
    }
  }
}

async function requestPairingCodeForPhone(phone) {
  let cleanPhone = String(phone).replace(/\D/g, "");
  if (!cleanPhone || cleanPhone.length < 10) {
    throw new Error("Invalid phone number. Must be 10-15 numeric digits (e.g. 919876543210).");
  }

  // If 10 digits entered without country code, default to India (91)
  if (cleanPhone.length === 10) {
    cleanPhone = `91${cleanPhone}`;
  }

  // If sock is closed, disconnected, null, or already registered, freshly re-initialize
  if (!sock || connectionStatus === "DISCONNECTED" || sock.authState?.creds?.registered) {
    logger.info(`Re-initializing WhatsApp socket for fresh pairing with ${cleanPhone}...`);
    clearAuthDirectory();
    await initWhatsAppBot();
  }

  // Wait briefly for the WS connection to establish handshake
  let waitAttempts = 0;
  while ((!sock || connectionStatus === "DISCONNECTED") && waitAttempts < 10) {
    await new Promise((r) => setTimeout(r, 500));
    waitAttempts++;
  }

  if (!sock) {
    throw new Error("WhatsApp socket client not ready. Please try again.");
  }

  // Attempt pairing code generation with automatic retry if WS is still handshaking
  let code = null;
  let lastErr = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      code = await sock.requestPairingCode(cleanPhone);
      if (code) break;
    } catch (err) {
      lastErr = err;
      logger.warn(`Pairing code attempt ${attempt}/4 for ${cleanPhone} failed: ${err.message}`);
      if (attempt < 4) {
        if (err.message?.includes("Connection Closed") || !sock) {
          clearAuthDirectory();
          await initWhatsAppBot();
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }

  if (!code) {
    throw new Error(lastErr?.message || "Failed to generate pairing code. Please check number and try again.");
  }

  latestPairingCode = code;
  connectionStatus = "AWAITING_PAIRING_CODE";
  logger.info("=========================================");
  logger.info(`  WHATSAPP PAIRING CODE FOR ${cleanPhone}: ${code}`);
  logger.info("=========================================");
  return code;
}

async function logoutWhatsAppBot() {
  try {
    logger.info("Logging out WhatsApp bot and clearing session...");
    if (sock) {
      try {
        await sock.logout().catch(() => {});
      } catch (e) {}
      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch (e) {}
      sock = null;
    }

    notifications.setWhatsAppClient(null);
    clearAuthDirectory();

    connectionStatus = "DISCONNECTED";
    latestQrCode = null;
    latestPairingCode = null;

    logger.info("WhatsApp bot logged out and session cleared. Initializing fresh instance...");
    setTimeout(initWhatsAppBot, 1000);
    return true;
  } catch (err) {
    logger.error("logoutWhatsAppBot error:", err);
    throw err;
  }
}

async function switchWhatsAppAccount(targetPhone = null) {
  try {
    logger.info(`Switching WhatsApp account (Target phone: ${targetPhone || "QR Scan"})...`);
    if (sock) {
      try {
        await sock.logout().catch(() => {});
      } catch (e) {}
      try {
        sock.ev.removeAllListeners();
        sock.end(undefined);
      } catch (e) {}
      sock = null;
    }

    notifications.setWhatsAppClient(null);
    clearAuthDirectory();

    connectionStatus = "DISCONNECTED";
    latestQrCode = null;
    latestPairingCode = null;

    await initWhatsAppBot();

    if (targetPhone) {
      const cleanPhone = String(targetPhone).replace(/\D/g, "");
      await new Promise((r) => setTimeout(r, 1500));
      const code = await requestPairingCodeForPhone(cleanPhone);
      return { pairingCode: code, status: "AWAITING_PAIRING_CODE" };
    }

    return { status: "AWAITING_QR_SCAN" };
  } catch (err) {
    logger.error("switchWhatsAppAccount error:", err);
    throw err;
  }
}

function getBotStatus() {
  return {
    status: connectionStatus,
    qrCode: latestQrCode,
    pairingCode: latestPairingCode,
    pausedChats: chatControl.getAllPausedChats(),
  };
}

module.exports = {
  initWhatsAppBot,
  getBotStatus,
  requestPairingCodeForPhone,
  logoutWhatsAppBot,
  switchWhatsAppAccount,
  chatControl,
};

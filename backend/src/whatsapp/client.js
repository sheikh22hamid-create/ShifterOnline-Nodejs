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
const botMenuEngine = require("./botMenuEngine");
const senderIdentity = require("./driverOrder/senderIdentity");
const driverOrderFlow = require("./driverOrder/flow");
const driverMessages = require("./driverOrder/messages");

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

// Unwraps ephemeral (disappearing) and view-once wrappers to the real message content.
function unwrapContent(message) {
  let content = message;
  if (content?.ephemeralMessage?.message) content = content.ephemeralMessage.message;
  if (content?.viewOnceMessage?.message) content = content.viewOnceMessage.message;
  if (content?.viewOnceMessageV2?.message) content = content.viewOnceMessageV2.message;
  return content || null;
}

/** The map pin / Live Location payload of a message, or null. */
function locationContent(message) {
  const content = unwrapContent(message);
  return content?.liveLocationMessage || content?.locationMessage || null;
}

// Helper to extract text content from standard, ephemeral, or viewOnce WhatsApp messages
function extractMessageText(msg) {
  if (!msg || !msg.message) return "";
  const content = unwrapContent(msg.message);

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

/** msg.messageTimestamp in seconds (a number or a protobuf Long `{ low }`); 0 when absent. */
function messageTimestampSec(msg) {
  return typeof msg.messageTimestamp === "number"
    ? msg.messageTimestamp
    : Number(msg.messageTimestamp?.low || msg.messageTimestamp || 0);
}

/**
 * Dedup key. Live Location updates may reuse the share's message id, so they are keyed by sequence number and
 * position as well - an exact repeat is still skipped, a new position is not.
 */
function dedupId(msg) {
  const id = msg.key?.id;
  const live = unwrapContent(msg.message)?.liveLocationMessage;
  if (!id || !live) return id;
  const seq = live.sequenceNumber?.low ?? live.sequenceNumber ?? "";
  return `${id}:live:${seq}:${live.degreesLatitude},${live.degreesLongitude}`;
}

/** "LOCATION_PIN:22.7,75.8[:name]" -> { lat, lng } (numbers), else null. */
function parseLocationPin(text) {
  if (typeof text !== "string" || !text.startsWith("LOCATION_PIN:")) return null;
  const [lat, lng] = text.slice("LOCATION_PIN:".length).split(":")[0].split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/**
 * When the position was observed. A Live Location update is stamped on arrival: its messageTimestamp can be the
 * time the share started, which would make every update look old to the trip's arrival check.
 */
function locationTimestampMs(msg) {
  if (unwrapContent(msg.message)?.liveLocationMessage) return Date.now();
  const sec = messageTimestampSec(msg);
  return sec ? sec * 1000 : Date.now();
}

/**
 * WhatsApp Trial Order: sends a trial driver's message to their WhatsApp order's flow. Returns true when the sender
 * is such a driver (the message is then fully handled here), false for everyone else (normal bot handling).
 */
async function routeDriverMessage({ msg, text, sock: socket }) {
  const phone = senderIdentity.phoneFromMessage(msg);
  if (!phone) return false;
  let active;
  try {
    active = await senderIdentity.findActiveWhatsAppOrder(phone);
  } catch (err) {
    logger.error(`WhatsApp driver routing lookup failed for ${phone}:`, err);
    return false;
  }
  if (!active) return false;
  const { orderId, riderId } = active;

  const location = parseLocationPin(text);
  if (location) {
    await driverOrderFlow.handleDriverLocation({ orderId, riderId, ...location, timestampMs: locationTimestampMs(msg) });
    return true;
  }
  // Sticker, reaction, voice note...: nothing the flow can act on, and the customer menu must not answer it either.
  if (!text) return true;

  logger.info(`📲 WhatsApp trial driver ${phone} (order ${orderId}): "${text}"`);
  let reply;
  try {
    reply = await driverOrderFlow.handleDriverReply({ orderId, riderId, text });
  } catch (err) {
    logger.error(`WhatsApp driver reply failed for order ${orderId}:`, err);
    reply = `⚠️ Abhi aapka message process nahi ho saka. Thodi der baad dobara bhejein.\n\n${driverMessages.HELPLINE}`;
  }
  if (reply) await socket.sendMessage(msg.key.remoteJid, { text: reply });
  return true;
}

/** messages.update entries carrying a Live Location (directly or as an edit of the share) -> routeDriverMessage. */
async function routeLiveLocationUpdates(updates, socket) {
  for (const { key, update } of updates || []) {
    if (!key || key.fromMe || !update?.message) continue;
    const message = update.message.editedMessage?.message || update.message;
    if (!unwrapContent(message)?.liveLocationMessage) continue;
    const msg = { key, message, messageTimestamp: update.messageTimestamp };
    if (isDuplicateMessage(dedupId(msg))) continue;
    try {
      await routeDriverMessage({ msg, text: extractMessageText(msg), sock: socket });
    } catch (err) {
      logger.error("Error routing WhatsApp live location update:", err);
    }
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

    // Incoming & Outgoing Messages Handler
    sock.ev.on("messages.upsert", async (m) => {
      // Only real-time notify events reach the bot. Other batches (offline delivery / append) are used for one
      // thing only: a WhatsApp trial driver's shared location, so a Live Location update is never lost.
      const realtime = !m.type || m.type === "notify";

      for (const msg of m.messages || []) {
        try {
          if (!msg.message) continue;
          const isLocation = Boolean(locationContent(msg.message));
          if (!realtime && (!isLocation || msg.key?.fromMe)) continue;

          const msgId = msg.key?.id;
          if (isDuplicateMessage(dedupId(msg))) {
            logger.debug(`Duplicate WhatsApp message skipped: ${msgId}`);
            continue;
          }

          // Skip stale/old messages (e.g. older than 2 minutes on reconnect/sync). A location share is kept for now:
          // a Live Location update can carry the share's original timestamp, and a trial driver's position still
          // counts - it is dropped below unless the sender is routed to a WhatsApp order.
          const nowSec = Math.floor(Date.now() / 1000);
          const msgTimestamp = messageTimestampSec(msg);
          const isStale = Boolean(msgTimestamp && (nowSec - msgTimestamp) > 120);
          if (isStale && !isLocation) {
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
              sessionManager.clearSession(senderPhone, true);
              logger.info(`⏸️ [OWNER] Bot PAUSED for personal chat ${senderPhone || remoteJid} (command: "${textMessage}")`);
              await sock.sendMessage(remoteJid, {
                text: chatControl.getStopMessage(),
              });
            } else if (chatControl.isStartCommand(textMessage)) {
              chatControl.resumeChat(senderPhone || remoteJid);
              sessionManager.clearSession(senderPhone, true);
              sessionManager.updateSession(senderPhone, botMenuEngine.STEPS.AWAITING_LANGUAGE, {});
              logger.info(`▶️ [OWNER] Bot RESUMED for personal chat ${senderPhone || remoteJid} (command: "${textMessage}")`);
              const initialMenu = await botMenuEngine.processMenuMessage(senderPhone, "start");
              await sock.sendMessage(remoteJid, {
                text: `${chatControl.getResumeMessage()}${initialMenu}`,
              });
            } else {
              logger.debug(`Skipping outbound self message to ${remoteJid}`);
            }
            continue;
          }

          // 1b. A trial driver running a WhatsApp-channel order: every message (including "stop"/"start"/"hi") goes
          // to the order flow - never the chat-pause commands, the customer menu or the AI.
          if (await routeDriverMessage({ msg, text: textMessage, sock })) continue;
          if (!realtime || isStale) continue;

          // 2. Check if this specific personal chat is paused
          if (chatControl.isChatPaused(senderPhone || remoteJid)) {
            // Check if contact sent /start or start to resume the bot
            if (chatControl.isStartCommand(textMessage)) {
              chatControl.resumeChat(senderPhone || remoteJid);
              sessionManager.clearSession(senderPhone, true);
              sessionManager.updateSession(senderPhone, botMenuEngine.STEPS.AWAITING_LANGUAGE, {});
              logger.info(`▶️ [CONTACT] Bot RESUMED for personal chat ${senderPhone} (command: "${textMessage}")`);
              const initialMenu = await botMenuEngine.processMenuMessage(senderPhone, "start");
              await sock.sendMessage(remoteJid, {
                text: `${chatControl.getResumeMessage()}${initialMenu}`,
              });
              continue;
            }

            // Chat is paused - do not process or reply
            logger.debug(`Chat ${senderPhone} is PAUSED. Skipping bot automated reply.`);
            continue;
          }

          // 3. Handle explicit stop command from contact
          if (chatControl.isStopCommand(textMessage)) {
            chatControl.pauseChat(senderPhone || remoteJid);
            sessionManager.clearSession(senderPhone, true);
            await sock.sendMessage(remoteJid, {
              text: chatControl.getStopMessage(),
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

    // Live Location updates: Baileys emits a decoded message through messages.upsert, but an update modelled as an
    // edit of the original share arrives as messages.update - route those for trial drivers too.
    sock.ev.on("messages.update", async (updates) => {
      try {
        await routeLiveLocationUpdates(updates, sock);
      } catch (err) {
        logger.error("Error routing WhatsApp live location update:", err);
      }
    });

    return sock;
  } catch (err) {
    logger.error("Failed to initialize WhatsApp Bot client:", err);
    connectionStatus = "ERROR";
  }
}

/**
 * Bounded WhatsApp Message Processing Engine
 * Routes all customer, driver, and job seeker messages through a structured, numbered state machine.
 * Any random / free-form questions are strictly guarded and answered with the Helpline (9109114515).
 */
async function handleIncomingWhatsAppMessage(remoteJid, senderPhone, text, fullMsg) {
  try {
    const cleanText = (text || "").trim();

    // Record incoming user message into rolling conversation history
    sessionManager.addHistory(senderPhone, "user", cleanText);

    let replyText = "";
    if (cleanText.startsWith("LOCATION_PIN:")) {
      replyText =
        `📍 *Location Received*\n\n` +
        `WhatsApp par direct booking ya fare calculation uplabdh nahi hai. Delivery booking aur live fare dekhne ke liye kripya hamari official *Shifter Online Customer App* download karein:\n\n` +
        `📲 *Download Shifter App*:\n` +
        `👉 https://play.google.com/store/apps/details?id=com.shifter.online\n\n` +
        `📞 *Customer Care*: 9109114515\n\n` +
        `_(Main Menu ke liye '0' likhkar bhejein)_`;
    } else {
      replyText = await botMenuEngine.processMenuMessage(senderPhone, cleanText);
    }

    if (replyText && sock) {
      await sock.sendMessage(remoteJid, { text: replyText });
      sessionManager.addHistory(senderPhone, "assistant", replyText);
    }
  } catch (err) {
    logger.error(`Error handling WhatsApp message from ${senderPhone}:`, err);
    if (sock) {
      await sock.sendMessage(remoteJid, {
        text: "⚠️ Samajh nahi aaya. Kripya punah prayaas karein ya helpline 9109114515 par call karein. (Main Menu ke liye '0' likhein)",
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
  routeDriverMessage,
  routeLiveLocationUpdates,
};

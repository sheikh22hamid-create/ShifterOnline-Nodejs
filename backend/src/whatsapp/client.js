const qrcode = require("qrcode-terminal");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const groqService = require("./groqService");
const sessionManager = require("./sessionManager");
const customerHandler = require("./handlers/customerHandler");
const driverHandler = require("./handlers/driverHandler");
const notifications = require("./notifications");
const googleMapsLocation = require("../utils/googleMapsLocation");

let sock = null;
let latestQrCode = null;
let latestPairingCode = null;
let connectionStatus = "DISCONNECTED";

/**
 * Initializes WhatsApp Web socket client
 */
async function initWhatsAppBot() {
  try {
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
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        connectionStatus = "DISCONNECTED";
        logger.warn(`WhatsApp socket connection closed. Reconnecting: ${shouldReconnect}`);
        if (shouldReconnect) {
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

    // Incoming Messages Handler
    sock.ev.on("messages.upsert", async (m) => {
      for (const msg of m.messages || []) {
        try {
          if (!msg.message) continue;

          const remoteJid = msg.key.remoteJid;

          // Skip all outbound messages sent by this account to prevent self-reply loops
          if (msg.key.fromMe) {
            logger.debug(`Skipping outbound self message to ${remoteJid}`);
            continue;
          }

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

          if (!textMessage && !msg.message.imageMessage) {
            logger.debug(`Ignoring empty or unhandled message type from ${remoteJid}`);
            continue;
          }

          const senderPhone = remoteJid.split("@")[0].replace(/\D/g, "");

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
  if (t.startsWith("track") || t.includes("order status") || t.match(/^#?\d{4,6}$/)) {
    return { isGlobalSwitch: true, intent: "TRACK_ORDER" };
  }

  // 6. START NEW FARE / BOOKING
  if (t.startsWith("fare") || t.startsWith("book") || (t.includes("pickup") && t.includes("drop"))) {
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
            `• *Fare* ya *Book* — Fare estimate calculate karein\n` +
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
            `5️⃣ Profile & Vehicle Photo\n\n` +
            `📲 *Registration Kaise Karein?*\n` +
            `Direct humari *Shifter Driver Partner App* download karke 5 min me aasan registration complete karein:\n` +
            `🔗 https://play.google.com/store/apps/details?id=com.shifter.driver\n\n` +
            `📞 *Driver Support*: 9109114515`;
          break;

        case "TRACK_ORDER": {
          const orderId = cleanText.match(/\d{4,6}/)?.[0];
          if (orderId) {
            replyText = await customerHandler.handleTrackingQuery(orderId, senderPhone);
          } else {
            replyText = "📦 Order tracking ke liye kripya apna Order ID bhejein (e.g. *Track 1024*).";
          }
          break;
        }

        case "CALCULATE_FARE": {
          const parsed = parseFullBookingData(cleanText);
          if (parsed.pickup && parsed.drop) {
            sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_RADIUS", {
              pickupAddress: parsed.pickup,
              dropAddress: parsed.drop,
              vehicleCategory: parsed.vehicle || null,
            });
            replyText = `📍 *Pickup*: ${parsed.pickup}\n🎯 *Drop*: ${parsed.drop}\n\n` +
                        `⭕ *Driver Search Radius*\n\n` +
                        `Aapka driver search radius kitna hai? (1 km se 30 km ke beech enter karein, e.g. 1, 5, 10, 30):`;
          } else {
            replyText = await customerHandler.handleFareCalculation(senderPhone, {}, session);
            sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_PICKUP");
          }
          break;
        }

        default:
          break;
      }
    } else if (session.step !== "IDLE") {
      // User is in active wizard step and message is not a global intent switch
      replyText = await handleWizardSteps(senderPhone, cleanText, session, fullMsg);
    } else {
      // Session is IDLE - parse intent using Groq AI / Fallback parser
      const aiAnalysis = await groqService.parseMessageWithGroq(cleanText, session);
      const { intent, entities, aiResponse } = aiAnalysis;

      logger.info(`Groq AI Classified Intent: ${intent}`);

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
            `• *Fare* ya *Book* — Fare estimate calculate karein\n` +
            `• *Track <OrderId>* — Order tracking status check karein\n` +
            `• *Driver* — Driver partner registration & app link\n` +
            `• *Support* — Customer care & driver helpline numbers`;
          break;

        case "CALCULATE_FARE":
          replyText = await customerHandler.handleFareCalculation(senderPhone, entities, session);
          sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_PICKUP");
          break;

        case "BOOK_TRIP": {
          const parsed = parseFullBookingData(cleanText);
          if (parsed.pickup && parsed.drop) {
            sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_RADIUS", {
              pickupAddress: parsed.pickup,
              dropAddress: parsed.drop,
              vehicleCategory: parsed.vehicle || null,
            });
            replyText = `📍 *Pickup*: ${parsed.pickup}\n🎯 *Drop*: ${parsed.drop}\n\n` +
                        `⭕ *Driver Search Radius*\n\n` +
                        `Aapka driver search radius kitna hai? (1 km se 30 km ke beech enter karein, e.g. 1, 5, 10, 30):`;
          } else {
            replyText = "📦 *Shifter Online Booking*\n\nAapka Pickup location specify karein:\n• Text address likhein (e.g. *Pickup: CP Delhi, Drop: Noida Sector 18*)\n• Ya WhatsApp me 📎 *(Paperclip / +)* ➔ *Location* ➔ *Send Location* map se pin share karein!";
            sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_PICKUP");
          }
          break;
        }

        case "TRACK_ORDER": {
          const orderId = entities.orderId || cleanText.match(/\d{4,6}/)?.[0];
          if (orderId) {
            replyText = await customerHandler.handleTrackingQuery(orderId, senderPhone);
          } else {
            replyText = "📦 Order tracking ke liye kripya apna Order ID bhejein (e.g. *Track 1024*).";
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
              `5️⃣ Profile & Vehicle Photo\n\n` +
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
            replyText = "Main Shifter Online Bot hoon! Main aapko Fare Calculation, Order Tracking, Driver Details aur Support me madad kar sakta hoon.\n\n• Type *Fare* ya *Book* to calculate fare estimate\n• Type *Track <OrderId>* to track your order\n• Type *Driver* for partner details & app link\n• Type *Support* for customer care details";
          }
          break;

        default:
          const isGreeting = /^(hi|hello|hey|menu|help|options|start|hola)$/i.test(cleanText);
          if (!isGreeting && aiResponse) {
            replyText = aiResponse;
          } else {
            replyText = "Main Shifter Online Bot hoon! Main aapko Fare Calculation, Order Tracking, Driver Details aur Support me madad kar sakta hoon.\n\n• Type *Fare* ya *Book* to calculate fare estimate\n• Type *Track <OrderId>* to track your order\n• Type *Driver* for partner details & app link\n• Type *Support* for customer care details";
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
        text: "⚠️ Samajh nahi aaya. Kripya punah prayaas karein ya type *Book* to start.",
      });
    }
  }
}

/**
 * Intelligently cleans location text by stripping prefixes like "Pickup:", "*Pickup*:", "Drop location:", etc.
 */
function cleanLocationString(str) {
  if (!str) return "";
  let clean = String(str).trim();

  // Strip markdown formatting symbols (* _ ~ `)
  clean = clean.replace(/[*_~`]/g, "");

  // Strip prefix words like "Pickup:", "Pickup address:", "Drop location:", "From:", "To:"
  clean = clean.replace(/^(?:pickup|drop|location|address|from|to)\s*(?:address|location)?\s*[:=\-]*\s*/i, "");
  clean = clean.replace(/^(?:pickup|drop|location|address|from|to)\s*[:=\-]*\s*/i, "");
  clean = clean.replace(/^(?:pickup|drop|location|address|from|to)\s*(?:address|location)?\s*[:=\-]*\s*/i, "");

  // Trim colons, hyphens, commas, or spaces
  clean = clean.replace(/^[:=\-\s,]+/, "").replace(/[:=\-\s,]+$/, "").trim();

  return clean;
}

/**
 * Helper to parse vehicle type from text
 */
function parseVehicleType(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  if (t.includes("bike") || t.includes("two wheeler") || t.includes("2 wheeler") || t === "1") {
    return "Bike";
  }
  if (t.includes("3 wheeler") || t.includes("three wheeler") || t.includes("auto") || t.includes("tempo") || t === "2") {
    return "3 wheeler";
  }
  if (t.includes("4 wheeler") || t.includes("four wheeler") || t.includes("tata ace") || t.includes("truck") || t === "3") {
    return "4 wheeler";
  }
  if (t.includes("loader") || t.includes("e loader") || t.includes("eloader") || t === "4") {
    return "E loader";
  }

  const vehicleMatch = text.match(/vehicle\s*:\s*([^\n,]+)/i);
  if (vehicleMatch && vehicleMatch[1]) {
    const v = vehicleMatch[1].trim();
    return parseVehicleType(v) || v;
  }

  return null;
}

/**
 * Helper to smart-parse Pickup, Drop, and Vehicle from a single text string
 */
function parseFullBookingData(text) {
  if (!text) return { pickup: null, drop: null, vehicle: null };
  const t = text.trim();

  let pickup = null;
  let drop = null;
  let vehicle = parseVehicleType(t);

  // Pattern 1: Explicit "Pickup: <location>" and "Drop: <location>"
  const pickupMatch = t.match(/pickup\s*:\s*([^🎯\n,]+(?:,[^🎯\n,]+)*)/i);
  const dropMatch = t.match(/drop\s*:\s*([^🛵\n,]+(?:,[^🛵\n,]+)*)/i);

  if (pickupMatch && pickupMatch[1]) {
    pickup = pickupMatch[1].replace(/^pickup\s*:\s*/i, "").trim();
    if (/drop\s*:/i.test(pickup)) {
      pickup = pickup.split(/drop\s*:/i)[0].trim();
    }
  }

  if (dropMatch && dropMatch[1]) {
    drop = dropMatch[1].replace(/^drop\s*:\s*/i, "").trim();
    if (/vehicle\s*:/i.test(drop)) {
      drop = drop.split(/vehicle\s*:/i)[0].trim();
    }
  }

  if (pickup) pickup = cleanLocationString(pickup);
  if (drop) drop = cleanLocationString(drop);

  // Pattern 2: "<Pickup> to <Drop>" if regex didn't extract both
  if ((!pickup || !drop) && /\bto\b/i.test(t) && !t.toLowerCase().startsWith("track") && !t.toLowerCase().startsWith("book")) {
    const parts = t.split(/\bto\b/i);
    if (parts.length >= 2) {
      if (!pickup) pickup = cleanLocationString(parts[0]);
      if (!drop) drop = cleanLocationString(parts[1]);
    }
  }

  return { pickup, drop, vehicle };
}

/**
 * Handles Step-by-Step Multi-Turn Dialog Wizard
 */
async function handleWizardSteps(senderPhone, text, session, fullMsg) {
  const t = text ? text.trim() : "";
  const parsed = parseFullBookingData(t);

  // Handle Native WhatsApp Location Pin (Shared via 📎 Paperclip -> Location / Map Picker)
  if (t.startsWith("LOCATION_PIN:")) {
    const parts = t.replace("LOCATION_PIN:", "").split(":");
    const coords = parts[0].split(",");
    const lat = parseFloat(coords[0]);
    const lng = parseFloat(coords[1]);
    const pinName = parts[1] || "";

    const geoResult = await googleMapsLocation.reverseGeocodeLocation(lat, lng);
    const verifiedAddress = pinName ? `${pinName}, ${geoResult.formattedAddress}` : geoResult.formattedAddress;

    if (session.step === "BOOKING_AWAIT_DROP") {
      const p = session.data.pickupAddress || "Pickup Location";
      sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_RADIUS", {
        dropAddress: verifiedAddress,
        dropLat: lat,
        dropLng: lng,
      });
      return `🎯 *Drop Location Confirmed via Map Pin!*\n\n🏠 *Address*: ${verifiedAddress}\n📍 *Coordinates*: ${lat.toFixed(4)}, ${lng.toFixed(4)}\n\n` +
             `⭕ *Driver Search Radius*\n\n` +
             `Aapka driver search radius kitna hai?\n` +
             `Kripya 1 km se 30 km ke beech value enter karein (e.g. 1, 5, 10, 30):`;
    } else {
      sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_DROP", {
        pickupAddress: verifiedAddress,
        pickupLat: lat,
        pickupLng: lng,
      });
      return `📍 *Pickup Location Confirmed via Map Pin!*\n\n🏠 *Address*: ${verifiedAddress}\n📍 *Coordinates*: ${lat.toFixed(4)}, ${lng.toFixed(4)}\n\nAb *Drop Address* reply karein (ya WhatsApp 📎 -> Location se drop pin share karein):`;
    }
  }

  // Answer user questions mid-wizard
  if (
    t.toLowerCase().includes("kya save") ||
    t.toLowerCase().includes("kya tha") ||
    t.toLowerCase().includes("show address") ||
    t.toLowerCase().includes("meraa address")
  ) {
    const p = session.data.pickupAddress || "Not set yet";
    const d = session.data.dropAddress || "Not set yet";
    const r = session.data.searchRadius ? `${session.data.searchRadius} km` : "Not set yet";
    const v = session.data.vehicleCategory || "Not selected";
    return `📍 *Saved Pickup*: ${p}\n🎯 *Saved Drop*: ${d}\n⭕ *Saved Radius*: ${r}\n🛵 *Saved Vehicle*: ${v}\n\nKripya agla details reply karein!`;
  }

  switch (session.step) {
    case "BOOKING_AWAIT_PICKUP": {
      const p = cleanLocationString(parsed.pickup || (parsed.drop ? null : t));
      const d = cleanLocationString(parsed.drop);
      const v = parsed.vehicle;

      // Verify Pickup location with Google Maps
      const geoPickup = await googleMapsLocation.verifyAndGeocodeLocation(p);
      if (!geoPickup.isValid) {
        return `⚠️ *Location Not Found on Google Maps*\n\n"${p}" Google Maps par nahi mili.\nKripya landmark ya city ke saath sahi address reply karein (e.g. *Khajrana Police Station, Indore*):`;
      }

      const verifiedPickup = geoPickup.formattedAddress || p;

      if (d) {
        const geoDrop = await googleMapsLocation.verifyAndGeocodeLocation(d);
        if (!geoDrop.isValid) {
          return `⚠️ *Drop Location Not Found on Google Maps*\n\n"${d}" Google Maps par nahi mili.\nKripya landmark ya city ke saath sahi drop address reply karein:`;
        }
        const verifiedDrop = geoDrop.formattedAddress || d;

        sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_RADIUS", {
          pickupAddress: verifiedPickup,
          dropAddress: verifiedDrop,
          pickupLat: geoPickup.lat,
          pickupLng: geoPickup.lng,
          dropLat: geoDrop.lat,
          dropLng: geoDrop.lng,
          vehicleCategory: v || null,
        });
        return `📍 *Pickup*: ${verifiedPickup}\n🎯 *Drop*: ${verifiedDrop}\n\n` +
               `⭕ *Driver Search Radius*\n\n` +
               `Aapka driver search radius kitna hai?\n` +
               `Kripya 1 km se 30 km ke beech value enter karein (e.g. 1, 5, 10, 30):`;
      }

      sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_DROP", {
        pickupAddress: verifiedPickup,
        pickupLat: geoPickup.lat,
        pickupLng: geoPickup.lng,
      });
      return `📍 Pickup address verified!\n*${verifiedPickup}*\n\nAb *Drop Address* reply karein:`;
    }

    case "BOOKING_AWAIT_DROP": {
      const d = cleanLocationString(parsed.drop || t);
      const v = parsed.vehicle;
      const p = cleanLocationString(session.data.pickupAddress) || "Customer Specified Pickup";

      // Verify Drop location with Google Maps
      const geoDrop = await googleMapsLocation.verifyAndGeocodeLocation(d);
      if (!geoDrop.isValid) {
        return `⚠️ *Location Not Found on Google Maps*\n\n"${d}" Google Maps par nahi mili.\nKripya landmark ya city ke saath sahi drop address reply karein (e.g. *Noida Sector 62*):`;
      }

      const verifiedDrop = geoDrop.formattedAddress || d;

      sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_RADIUS", {
        pickupAddress: p,
        dropAddress: verifiedDrop,
        dropLat: geoDrop.lat,
        dropLng: geoDrop.lng,
        vehicleCategory: v || session.data.vehicleCategory || null,
      });
      return `🎯 Drop address verified!\n*${verifiedDrop}*\n\n` +
             `⭕ *Driver Search Radius*\n\n` +
             `Aapka driver search radius kitna hai?\n` +
             `Kripya 1 km se 30 km ke beech value enter karein (e.g. 1, 5, 10, 30):`;
    }

    case "BOOKING_AWAIT_RADIUS": {
      const rawMatch = t.match(/(\d+(?:\.\d+)?)/);
      const radiusVal = rawMatch ? parseFloat(rawMatch[1]) : NaN;

      if (isNaN(radiusVal) || radiusVal < 1 || radiusVal > 30) {
        return `⚠️ *Invalid Driver Search Radius!*\n\n` +
               `Driver search radius *1 km se 30 km* ke beech hona chahiye.\n` +
               `Kripya 1 se 30 ke beech ki value enter karein (e.g. 1, 5, 10, 30):`;
      }

      const validRadius = Math.round(radiusVal);
      const categories = await customerHandler.getActiveCategories();

      sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_CATEGORY", {
        searchRadius: validRadius,
        availableCategories: categories,
      });

      return customerHandler.formatCategoriesPrompt(categories, validRadius);
    }

    case "BOOKING_AWAIT_CATEGORY": {
      const categories = session.data.availableCategories || (await customerHandler.getActiveCategories());
      let selectedCat = null;

      const numMatch = t.match(/^(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < categories.length) {
          selectedCat = categories[idx];
        }
      }

      if (!selectedCat) {
        selectedCat = categories.find((c) => c.cat_name.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(c.cat_name.toLowerCase()));
      }

      if (!selectedCat) {
        return `⚠️ Invalid selection! Kripya list me se sahi Category number ya naam reply karein.\n\n` +
               customerHandler.formatCategoriesPrompt(categories, session.data.searchRadius || 5);
      }

      const { distanceKm, models } = await customerHandler.getCategoryModels(selectedCat.id, session.data);

      if (!models || models.length === 0) {
        return `⚠️ *${selectedCat.cat_name}* category me abhi koi vehicle model active nahi hai.\nKripya koi doosri category choose karein:\n\n` +
               customerHandler.formatCategoriesPrompt(categories, session.data.searchRadius || 5);
      }

      sessionManager.updateSession(senderPhone, "BOOKING_AWAIT_MODEL", {
        vehicleCategory: selectedCat.cat_name,
        categoryId: selectedCat.id,
        distanceKm,
        availableModels: models,
      });

      return customerHandler.formatModelsPrompt(selectedCat.cat_name, models, distanceKm);
    }

    case "BOOKING_AWAIT_MODEL": {
      const models = session.data.availableModels || [];
      let selectedModel = null;

      const numMatch = t.match(/^(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < models.length) {
          selectedModel = models[idx];
        }
      }

      if (!selectedModel) {
        selectedModel = models.find((m) => m.title.toLowerCase().includes(t.toLowerCase()) || t.toLowerCase().includes(m.title.toLowerCase()));
      }

      if (!selectedModel) {
        return `⚠️ Invalid Model Selection! Kripya list me se valid Model Number reply karein (1 se ${models.length} ke beech).\n\n` +
               customerHandler.formatModelsPrompt(session.data.vehicleCategory, models, session.data.distanceKm || 0);
      }

      const updatedSession = {
        ...session.data,
        selectedModel,
      };

      // Calculate final estimated fare result & app redirect link
      const fareResultText = await customerHandler.getFareEstimateResult(updatedSession);

      // Clear session - WhatsApp bot does NOT create actual orders or trigger dispatch!
      sessionManager.clearSession(senderPhone);

      return fareResultText;
    }

    default:
      sessionManager.clearSession(senderPhone);
      return "Session reset ho gaya hai. Aap *Book* ya *Fare* write karke start kar sakte hain.";
  }
}

async function requestPairingCodeForPhone(phone) {
  if (!sock) throw new Error("WhatsApp socket client not initialized");
  const cleanPhone = String(phone).replace(/\D/g, "");
  if (!cleanPhone) throw new Error("Invalid phone number");

  const code = await sock.requestPairingCode(cleanPhone);
  latestPairingCode = code;
  connectionStatus = "AWAITING_PAIRING_CODE";
  logger.info("=========================================");
  logger.info(`  WHATSAPP PAIRING CODE FOR ${cleanPhone}: ${code}`);
  logger.info("=========================================");
  return code;
}

function getBotStatus() {
  return {
    status: connectionStatus,
    qrCode: latestQrCode,
    pairingCode: latestPairingCode,
  };
}

module.exports = {
  initWhatsAppBot,
  getBotStatus,
  requestPairingCodeForPhone,
};

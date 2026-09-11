const fs = require("fs");
const path = require("path");
const { Groq } = require("groq-sdk");
const logger = require("../utils/logger");

let groqClient = null;
let cachedKnowledge = null;
let lastKnowledgeReadTime = 0;

function getBotKnowledge() {
  try {
    const knowledgePath = path.join(__dirname, "../../data/bot_knowledge.txt");
    if (!fs.existsSync(knowledgePath)) return "";
    const stats = fs.statSync(knowledgePath);
    if (!cachedKnowledge || stats.mtimeMs > lastKnowledgeReadTime) {
      cachedKnowledge = fs.readFileSync(knowledgePath, "utf-8");
      lastKnowledgeReadTime = stats.mtimeMs;
      logger.info(`Loaded fresh Bot Knowledge Base (${cachedKnowledge.length} chars).`);
    }
    return cachedKnowledge;
  } catch (err) {
    logger.error("Error reading bot knowledge base:", err);
    return cachedKnowledge || "";
  }
}

function clearBotKnowledgeCache() {
  cachedKnowledge = null;
  lastKnowledgeReadTime = 0;
}

const groqClientsMap = new Map();

/**
 * Resolves list of configured Groq API keys from process.env
 */
function getGroqApiKeys() {
  const keys = [];

  if (process.env.GROQ_API_KEY) keys.push(process.env.GROQ_API_KEY.trim());
  if (process.env.GROQ_API_KEY_2) keys.push(process.env.GROQ_API_KEY_2.trim());
  if (process.env.GROQ_API_KEY_3) keys.push(process.env.GROQ_API_KEY_3.trim());
  if (process.env.GROQ_API_KEY_FALLBACK) keys.push(process.env.GROQ_API_KEY_FALLBACK.trim());

  if (process.env.GROQ_API_KEYS) {
    const list = process.env.GROQ_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean);
    keys.push(...list);
  }

  return [...new Set(keys)].filter(Boolean);
}

/**
 * Gets or creates Groq client instance for a specific API key
 */
function getGroqClientForKey(apiKey) {
  if (!groqClientsMap.has(apiKey)) {
    groqClientsMap.set(apiKey, new Groq({ apiKey }));
  }
  return groqClientsMap.get(apiKey);
}

const SYSTEM_PROMPT = `
You are the official AI Assistant for Shifter Online — India's premier real-time intra-city logistics and freight platform.
Your goal is to parse user messages in Hindi, Hinglish, or English and classify their intent for an automated WhatsApp Bot.

Available Intents:
1. DRIVER_SUPPORT: User asking for driver support phone number, helpline, or driver customer care contact details.
2. CUSTOMER_SUPPORT: User asking for customer care phone number, contact details, helpline, support email, or wanting to talk to customer care.
3. CANCEL_RESET: User saying "no", "nhi", "nahi yrr", "cancel", "stop", "reset", "exit", or wanting to cancel the current process/flow.
4. DRIVER_ONBOARDING: User asking about joining as a driver partner, driver registration process, required documents, earnings, downloading driver app, or vehicle attachment.
5. CALCULATE_FARE: User wants to calculate price/fare quote for shipping goods (e.g., "Connaught place se Noida Tata Ace ka kitna lagega?").
6. BOOK_TRIP: User wants to book a delivery truck/bike immediately.
7. TRACK_ORDER: User wants to track an active order or check status (e.g., "Order #1024 kahan hai?").
8. CHECK_WALLET: Driver wants to check wallet balance, daily earnings, or withdrawal status.
9. FAQ_QUERY: User asking general questions about pricing rates, cancellation rules, company details, shifting services, or general help.
10. UNKNOWN: Casual greeting or unrelated query.

You MUST reply strictly in valid JSON format:
{
  "intent": "DRIVER_SUPPORT" | "CUSTOMER_SUPPORT" | "CANCEL_RESET" | "DRIVER_ONBOARDING" | "CALCULATE_FARE" | "BOOK_TRIP" | "TRACK_ORDER" | "CHECK_WALLET" | "FAQ_QUERY" | "UNKNOWN",
  "entities": {
    "pickup": "pickup location if mentioned or null",
    "drop": "drop location if mentioned or null",
    "vehicleType": "Bike" | "3 wheeler" | "4 wheeler" | "E loader" | null,
    "orderId": number or string or null,
    "goodsType": "goods description or null"
  },
  "aiResponse": "A polite, accurate, detailed 1-3 sentence response in natural Hinglish directly answering the user's question using the Official Company Knowledge Base provided below."
}
`;

/**
 * Parses user input using Groq AI API with Multi-Key Failover
 */
async function parseMessageWithGroq(userText, sessionContext = {}) {
  const apiKeys = getGroqApiKeys();

  if (apiKeys.length === 0) {
    logger.warn("No GROQ_API_KEY configured in .env. Using rule-based fallback parser.");
    return fallbackRuleBasedParser(userText);
  }

  const knowledgeBase = getBotKnowledge();
  const systemPromptWithKnowledge = SYSTEM_PROMPT + (knowledgeBase ? `\n\nOFFICIAL COMPANY KNOWLEDGE BASE:\n"""\n${knowledgeBase.slice(0, 10000)}\n"""` : "");

  // Multi-Key Failover Loop
  for (let i = 0; i < apiKeys.length; i++) {
    const apiKey = apiKeys[i];
    const keyLabel = `Key #${i + 1} (${apiKey.slice(0, 7)}...${apiKey.slice(-4)})`;

    try {
      const client = getGroqClientForKey(apiKey);

      const response = await client.chat.completions.create({
        model: process.env.GROQ_MODEL || "groq/compound-mini",
        messages: [
          { role: "system", content: systemPromptWithKnowledge },
          {
            role: "user",
            content: `Session Context: ${JSON.stringify(sessionContext)}\nUser Message: "${userText}"`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
        max_tokens: 500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error("Empty content returned from Groq API");

      const parsed = JSON.parse(content);
      logger.info(`✅ Groq AI parsing successful using ${keyLabel} (Intent: ${parsed.intent})`);
      return parsed;
    } catch (error) {
      logger.warn(`⚠️ Groq AI API error with ${keyLabel}: ${error.message}`);
      if (i < apiKeys.length - 1) {
        logger.info(`🔄 Failing over to next Groq API key #${i + 2}...`);
      }
    }
  }

  logger.error("❌ All configured Groq API keys failed or hit limits. Falling back to rule-based parser.");
  return fallbackRuleBasedParser(userText);
}

/**
 * Fallback intent classifier if GROQ_API_KEY is not configured
 */
function fallbackRuleBasedParser(text) {
  const t = (text || "").toLowerCase().trim();

  // 1. CANCEL / RESET / REJECT
  if (/^(nhi|nahi|nah|no|cancel|stop|reset|exit|band|galat|wrong|menu)(?:\s+yrr|\s+bhai|\s+please)?$/i.test(t) || t === "nhi" || t === "nahi") {
    return {
      intent: "CANCEL_RESET",
      entities: {},
      aiResponse: "Bilkul! Aapka current process cancel kar diya gaya hai.\n\nAap kya help chahte hain?\n\n• *Fare* / *Book* — Fare estimate calculate karein\n• *Track <OrderId>* — Order tracking status check karein\n• *Driver* — Driver partner registration & app link\n• *Support* — Customer care & driver helpline numbers",
    };
  }

  // 2. DRIVER SUPPORT NUMBER (Check BEFORE general driver or customer care)
  if (
    t.includes("driver support") ||
    t.includes("driver helpline") ||
    t.includes("driver care") ||
    (t.includes("driver") && (t.includes("support") || t.includes("helpline") || t.includes("number") || t.includes("phone") || t.includes("contact") || t.includes("care")))
  ) {
    return {
      intent: "DRIVER_SUPPORT",
      entities: {},
      aiResponse: "📞 *Shifter Online Driver Support*\n\nDriver Partners ke liye dedicated helpline details:\n📱 *Driver Support Phone*: 9109114515\n📱 *Customer Care*: 9109114515\n📧 *Support Email*: support@shifteronline.com\n\n📲 *Driver App*: https://play.google.com/store/apps/details?id=com.shifter.driver",
    };
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
    return {
      intent: "CUSTOMER_SUPPORT",
      entities: {},
      aiResponse: "📞 *Shifter Online Customer Care*\n\nHamari support team se sampark karne ke liye details:\n📱 *Customer Care Number*: 9109114515\n📱 *Driver Helpline*: 9109114515\n📧 *Support Email*: support@shifteronline.com\n🌐 *Website*: https://shifteronline.com\n\n🏢 *Company*: Movigo Logistic Aggregator Private Limited",
    };
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
    return {
      intent: "DRIVER_ONBOARDING",
      entities: {},
      aiResponse: "🚚 *Shifter Online Driver Partner Program*\n\nAap Shifter Online ke saath judein aur apni gadi se daily achhi kamai karein!\n\n📋 *Required Documents*:\n1️⃣ Driving License (DL)\n2️⃣ Aadhaar Card / Govt ID Proof\n3️⃣ Vehicle RC Book\n4️⃣ Bank Account / UPI Details\n5️⃣ Profile & Vehicle Photo\n\n📲 *Registration Link*:\nhttps://play.google.com/store/apps/details?id=com.shifter.driver\n\n📞 *Driver Support*: 9109114515",
    };
  }

  // 5. TRACK ORDER
  if (t.includes("track") || t.includes("kahan") || t.includes("order status") || t.match(/#?\d{4,6}/)) {
    const match = text.match(/\d{4,6}/);
    return {
      intent: "TRACK_ORDER",
      entities: { orderId: match ? match[0] : null },
      aiResponse: "Aapki order status check kar rahe hain...",
    };
  }

  // 6. FARE CALCULATION / BOOKING
  if (t.includes("fare") || t.includes("kitna") || t.includes("price") || t.includes("cost") || t.includes("rate") || t.includes("book") || t.includes("gadi") || t.includes("truck") || t.includes("tempo")) {
    return {
      intent: "CALCULATE_FARE",
      entities: {},
      aiResponse: "Aapki booking ke liye fare calculate karte hain.",
    };
  }

  // 7. CHECK WALLET
  if (t.includes("earning") || t.includes("wallet") || t.includes("payout") || t.includes("kamai")) {
    return {
      intent: "CHECK_WALLET",
      entities: {},
      aiResponse: "Aapki daily earnings aur wallet balance check ho raha hai.",
    };
  }

  return {
    intent: "FAQ_QUERY",
    entities: {},
    aiResponse: "Main Shifter Online Bot hoon! Main aapko Fare Calculation, Order Tracking, Driver Details aur Support me madad kar sakta hoon.",
  };
}

module.exports = {
  parseMessageWithGroq,
  fallbackRuleBasedParser,
  getBotKnowledge,
  clearBotKnowledgeCache,
};

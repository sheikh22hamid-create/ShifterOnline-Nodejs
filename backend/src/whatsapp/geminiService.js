const fs = require("fs");
const path = require("path");
const logger = require("../utils/logger");

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
      logger.info(`Loaded fresh Bot Knowledge Base for Gemini (${cachedKnowledge.length} chars).`);
    }
    return cachedKnowledge;
  } catch (err) {
    logger.error("Error reading bot knowledge base:", err);
    return cachedKnowledge || "";
  }
}

function getGeminiApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY.trim());
  if (process.env.GEMINI_API_KEY_2) keys.push(process.env.GEMINI_API_KEY_2.trim());
  if (process.env.GEMINI_API_KEYS) {
    const list = process.env.GEMINI_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean);
    keys.push(...list);
  }
  return [...new Set(keys)].filter(Boolean);
}

const CANDIDATE_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  "gemini-flash-lite-latest",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

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

CRITICAL GREETING RULE:
- ALWAYS start greetings with "Hello!" or "Hello ji!".
- NEVER use "Namaste" or "Namaskar" under any circumstances.

CRITICAL BOOKING & FARE ESTIMATE RULE:
- The WhatsApp Bot CANNOT book rides/orders, cannot take pickup/drop locations, and cannot calculate custom trip fares directly.
- NEVER ask the user for their pickup/drop location or attempt to initiate a booking in chat.
- If the user asks to book a vehicle/delivery or asks for prices/fare, ALWAYS state that WhatsApp direct booking is not available and instruct them to download the official Shifter Online Customer App: https://play.google.com/store/apps/details?id=com.shifter.online and mention Customer Care 9109114515.

CRITICAL DRIVER WALLET & PROFILE RULE:
- The WhatsApp Bot CANNOT display driver wallet balances, profile status, or earnings in chat.
- If a driver asks about wallet, earnings, balance, or profile, instruct them to open/download the official Shifter Driver Partner App: https://play.google.com/store/apps/details?id=com.shifter.driver and contact Driver Support 9109114515.
`;

/**
 * Calls Gemini REST API with timeout
 */
async function callGeminiApi(apiKey, model, userPrompt, systemPromptText, timeoutMs = 12000) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userPrompt }],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemPromptText }],
        },
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 600,
        },
      }),
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 150)}`);
    }

    const data = await response.json();
    const rawContent = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawContent) {
      throw new Error("Empty candidate content received from Gemini");
    }

    const parsed = JSON.parse(rawContent);
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Attempts to parse user message using Google Gemini with multi-key and multi-model cascade
 * Returns parsed object or null if all attempts fail
 */
async function parseMessageWithGemini(userText, sessionContext = {}) {
  const apiKeys = getGeminiApiKeys();
  if (apiKeys.length === 0) {
    return null;
  }

  const knowledgeBase = getBotKnowledge();
  const fullSystemPrompt =
    SYSTEM_PROMPT +
    (knowledgeBase ? `\n\nOFFICIAL COMPANY KNOWLEDGE BASE:\n"""\n${knowledgeBase.slice(0, 10000)}\n"""` : "");

  const userPrompt = `Session Context: ${JSON.stringify(sessionContext)}\nUser Message: "${userText}"`;

  // Unique model candidates list preserving order
  const models = [...new Set(CANDIDATE_MODELS)];

  for (let k = 0; k < apiKeys.length; k++) {
    const apiKey = apiKeys[k];
    const keyLabel = `Gemini Key #${k + 1} (${apiKey.slice(0, 6)}...${apiKey.slice(-4)})`;

    for (let m = 0; m < models.length; m++) {
      const model = models[m];
      try {
        const result = await callGeminiApi(apiKey, model, userPrompt, fullSystemPrompt);
        if (result && result.intent) {
          logger.info(`✅ Gemini AI parsing successful using ${keyLabel} [${model}] (Intent: ${result.intent})`);
          return result;
        }
      } catch (err) {
        logger.warn(`⚠️ Gemini API attempt failed [${keyLabel}, model: ${model}]: ${err.message}`);
      }
    }
  }

  logger.warn("⚠️ All Gemini API keys and models exhausted without success.");
  return null;
}

module.exports = {
  parseMessageWithGemini,
  getGeminiApiKeys,
};
